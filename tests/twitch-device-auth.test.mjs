import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  authorizeTwitchChat, lookupBroadcaster, mergeEnv, pollDeviceToken,
  TwitchLoginError, writeEnvConfig
} from '../src/twitch-device-auth.mjs';

const CLIENT_ID = 'abcdefghij1234567890';
const TOKEN = 'never-print-this-access-token';
const DEVICE_CODE = 'never-print-this-device-code';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deviceResponse() {
  return response(200, { device_code: DEVICE_CODE, user_code: 'ABCD-EFGH', expires_in: 600,
    interval: 5, verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH' });
}

test('device login handles pending then success, validates, and never gives secrets to output callback', async () => {
  let clock = 0;
  const requests = [];
  const fetchFn = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/device')) return deviceResponse();
    if (url.endsWith('/token') && requests.filter(item => item.url.endsWith('/token')).length === 1)
      return response(400, { status: 400, message: 'authorization_pending' });
    if (url.endsWith('/token')) return response(200, { access_token: TOKEN, scope: ['user:read:chat'] });
    if (url.endsWith('/validate')) return response(200, { client_id: CLIENT_ID, user_id: 'reader-42', scopes: ['user:read:chat'] });
    throw new Error('unexpected URL');
  };
  const displayed = [];
  const result = await authorizeTwitchChat({ clientId: CLIENT_ID, fetchFn,
    sleepFn: async ms => { clock += ms; }, nowFn: () => clock,
    onActivation: value => displayed.push(JSON.stringify(value)) });
  assert.deepEqual(result, { clientId: CLIENT_ID, accessToken: TOKEN, readerUserId: 'reader-42', broadcasterId: 'reader-42' });
  assert.equal(requests.filter(item => item.url.endsWith('/token')).length, 2);
  assert.match(displayed[0], /ABCD-EFGH/);
  assert.doesNotMatch(displayed.join(' '), new RegExp(`${TOKEN}|${DEVICE_CODE}`));
  assert.equal(requests.at(-1).options.headers.Authorization, `OAuth ${TOKEN}`);
});

test('polling expires deterministically without making a late token request', async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(() => pollDeviceToken({ clientId: CLIENT_ID,
    device: { deviceCode: DEVICE_CODE, expiresIn: 5, interval: 5 },
    fetchFn: async () => { calls++; return response(400, { message: 'authorization_pending' }); },
    sleepFn: async ms => { clock += ms; }, nowFn: () => clock
  }), error => error instanceof TwitchLoginError && error.code === 'expired');
  assert.equal(calls, 0);
});

test('polling cancellation stops before a token request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(() => pollDeviceToken({ clientId: CLIENT_ID, signal: controller.signal,
    device: { deviceCode: DEVICE_CODE, expiresIn: 60, interval: 1 },
    fetchFn: async () => { calls++; return response(400, { message: 'authorization_pending' }); },
    sleepFn: async () => { controller.abort(); }, nowFn: () => 0
  }), error => error.code === 'cancelled');
  assert.equal(calls, 0);
});

test('polling distinguishes invalid authorization and denied access', async () => {
  for (const [message, code] of [['invalid device code', 'invalid-authorization'], ['access_denied', 'access-denied']]) {
    let clock = 0;
    await assert.rejects(() => pollDeviceToken({ clientId: CLIENT_ID,
      device: { deviceCode: DEVICE_CODE, expiresIn: 60, interval: 1 },
      fetchFn: async () => response(400, { message }),
      sleepFn: async ms => { clock += ms; }, nowFn: () => clock
    }), error => error instanceof TwitchLoginError && error.code === code && !error.message.includes(DEVICE_CODE));
  }
});

test('slow_down increases the next polling interval', async () => {
  let clock = 0;
  const waits = [];
  let call = 0;
  const result = await pollDeviceToken({ clientId: CLIENT_ID,
    device: { deviceCode: DEVICE_CODE, expiresIn: 60, interval: 1 },
    fetchFn: async () => ++call === 1 ? response(400, { message: 'slow_down' }) : response(200, { access_token: TOKEN }),
    sleepFn: async ms => { waits.push(ms); clock += ms; }, nowFn: () => clock });
  assert.deepEqual(waits, [1000, 6000]);
  assert.equal(result.accessToken, TOKEN);
});

test('channel lookup uses bearer token and exact normalized login', async () => {
  let captured;
  const result = await lookupBroadcaster({ clientId: CLIENT_ID, accessToken: TOKEN, channel: '@Patch_Party',
    fetchFn: async (url, options) => {
      captured = { url, options };
      return response(200, { data: [{ id: 'broadcaster-9', login: 'patch_party' }] });
    } });
  assert.deepEqual(result, { broadcasterId: 'broadcaster-9', channelLogin: 'patch_party' });
  assert.equal(new URL(captured.url).searchParams.get('login'), 'patch_party');
  assert.equal(captured.options.headers.Authorization, `Bearer ${TOKEN}`);
});

test('environment merge preserves benign and unknown configuration without duplicate Twitch keys', () => {
  const output = mergeEnv('HOST=127.0.0.1\nPORT=4317\nROUND_SECONDS=30\nCUSTOM=value\nTWITCH_CLIENT_ID=old\nTWITCH_CLIENT_ID=duplicate\n', {
    clientId: CLIENT_ID, accessToken: TOKEN, readerUserId: 'reader-42', broadcasterId: 'broadcaster-9'
  });
  assert.match(output, /^HOST=127\.0\.0\.1\nPORT=4317\nROUND_SECONDS=30\nCUSTOM=value\n/m);
  assert.equal((output.match(/^TWITCH_CLIENT_ID=/gm) || []).length, 1);
  assert.match(output, new RegExp(`TWITCH_USER_ACCESS_TOKEN=${TOKEN}`));
});

test('safe config write requires confirmation and preserves existing non-Twitch settings', async t => {
  const folder = await mkdtemp(join(process.cwd(), 'tests', 'tmp-device-auth-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const envPath = join(folder, '.env');
  const original = 'HOST=127.0.0.1\nPORT=4317\nROUND_SECONDS=45\nNOTE=keep-me\n';
  await writeFile(envPath, original);
  const config = { clientId: CLIENT_ID, accessToken: TOKEN, readerUserId: 'reader-42', broadcasterId: 'broadcaster-9' };
  await assert.rejects(() => writeEnvConfig({ envPath, config, confirmOverwrite: async () => false }),
    error => error.code === 'save-declined');
  assert.equal(await readFile(envPath, 'utf8'), original);
  await writeEnvConfig({ envPath, config, confirmOverwrite: async () => true });
  const saved = await readFile(envPath, 'utf8');
  assert.match(saved, /^HOST=127\.0\.0\.1\nPORT=4317\nROUND_SECONDS=45\nNOTE=keep-me\n/);
  assert.match(saved, new RegExp(`TWITCH_USER_ACCESS_TOKEN=${TOKEN}`));
});

test('safe config writer refuses symbolic-link targets', async () => {
  const fs = { lstat: async () => ({ isSymbolicLink: () => true, isFile: () => false }) };
  await assert.rejects(() => writeEnvConfig({ envPath: '.env', fs,
    config: { clientId: CLIENT_ID, accessToken: TOKEN, readerUserId: 'reader', broadcasterId: 'broadcaster' },
    confirmOverwrite: async () => true }), error => error.code === 'unsafe-env');
});
