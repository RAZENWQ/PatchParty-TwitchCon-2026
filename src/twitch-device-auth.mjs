import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const TWITCH_SCOPE = 'user:read:chat';
const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const USERS_URL = 'https://api.twitch.tv/helix/users';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const CONFIG_KEYS = [
  'TWITCH_CLIENT_ID', 'TWITCH_USER_ACCESS_TOKEN',
  'TWITCH_READER_USER_ID', 'TWITCH_BROADCASTER_ID'
];

export class TwitchLoginError extends Error {
  constructor(code, message) { super(message); this.name = 'TwitchLoginError'; this.code = code; }
}

function formBody(values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
}

async function responseJson(response, code) {
  try { return await response.json(); }
  catch { throw new TwitchLoginError(code, 'Twitch returned an unreadable response.'); }
}

function cleanSingleLine(value, label) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value))
    throw new TwitchLoginError('invalid-response', `Twitch returned an invalid ${label}.`);
  return value;
}

export function validateClientId(value) {
  const clientId = String(value || '').trim();
  if (!/^[a-z0-9]{10,64}$/i.test(clientId))
    throw new TwitchLoginError('invalid-client-id', 'Client ID must be 10-64 letters or digits.');
  return clientId;
}

export function validateChannel(value) {
  if (value === undefined || value === null || value === '') return '';
  const channel = String(value).trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{1,25}$/.test(channel))
    throw new TwitchLoginError('invalid-channel', 'Channel must be a valid Twitch login name.');
  return channel;
}

export function verifiedActivationUri(value) {
  let uri;
  try { uri = new URL(value); } catch { /* handled below */ }
  if (!uri || uri.protocol !== 'https:' || uri.hostname !== 'www.twitch.tv' || uri.pathname !== '/activate' || uri.username || uri.password)
    throw new TwitchLoginError('invalid-activation-uri', 'Twitch returned an untrusted activation URI.');
  return uri.href;
}

export async function requestDeviceCode({ clientId, fetchFn = globalThis.fetch, signal } = {}) {
  const response = await twitchFetch(fetchFn, DEVICE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: validateClientId(clientId), scopes: TWITCH_SCOPE }), signal
  }, signal);
  if (!response.ok) throw new TwitchLoginError('device-request-failed', 'Twitch rejected the device authorization request.');
  const body = await responseJson(response, 'device-response-invalid');
  const expiresIn = Number(body.expires_in);
  const interval = Number(body.interval);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || !Number.isFinite(interval) || interval <= 0)
    throw new TwitchLoginError('device-response-invalid', 'Twitch returned invalid device authorization timing.');
  return {
    deviceCode: cleanSingleLine(body.device_code, 'device code'),
    userCode: cleanSingleLine(body.user_code, 'user code'),
    verificationUri: verifiedActivationUri(body.verification_uri),
    expiresIn, interval
  };
}

function abortError() { return new TwitchLoginError('cancelled', 'Twitch authorization was cancelled.'); }

async function twitchFetch(fetchFn, url, options, signal) {
  try { return await fetchFn(url, options); }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw abortError();
    throw new TwitchLoginError('network-error', 'Could not contact Twitch.');
  }
}

export function abortableSleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolveSleep, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

function tokenFailure(message) {
  const normalized = String(message || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'authorization pending') return 'pending';
  if (normalized === 'slow down') return 'slow-down';
  if (normalized.includes('access denied') || normalized.includes('authorization denied')) return 'denied';
  if (normalized.includes('expired')) return 'expired';
  if (normalized.includes('invalid device code')) return 'invalid';
  return 'failed';
}

export async function pollDeviceToken({ clientId, device, fetchFn = globalThis.fetch,
  sleepFn = abortableSleep, nowFn = Date.now, signal } = {}) {
  const startedAt = nowFn();
  const deadline = startedAt + device.expiresIn * 1000;
  let intervalMs = device.interval * 1000;
  while (nowFn() < deadline) {
    if (signal?.aborted) throw abortError();
    await sleepFn(intervalMs, signal);
    if (signal?.aborted) throw abortError();
    if (nowFn() >= deadline) break;
    const response = await twitchFetch(fetchFn, TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ client_id: validateClientId(clientId), scopes: TWITCH_SCOPE,
        device_code: device.deviceCode, grant_type: GRANT_TYPE }), signal
    }, signal);
    const body = await responseJson(response, 'token-response-invalid');
    if (response.ok && body.access_token) {
      return { accessToken: cleanSingleLine(body.access_token, 'access token') };
    }
    const failure = tokenFailure(body.message);
    if (failure === 'pending') continue;
    if (failure === 'slow-down') { intervalMs += 5000; continue; }
    if (failure === 'denied') throw new TwitchLoginError('access-denied', 'Twitch authorization was denied.');
    if (failure === 'expired') throw new TwitchLoginError('expired', 'The Twitch device code expired.');
    if (failure === 'invalid') throw new TwitchLoginError('invalid-authorization', 'Twitch rejected the device authorization.');
    throw new TwitchLoginError('token-request-failed', 'Twitch could not complete authorization.');
  }
  throw new TwitchLoginError('expired', 'The Twitch device code expired.');
}

export async function validateAccessToken({ clientId, accessToken, fetchFn = globalThis.fetch, signal } = {}) {
  const response = await twitchFetch(fetchFn, VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` }, signal
  }, signal);
  if (!response.ok) throw new TwitchLoginError('invalid-token', 'Twitch rejected the issued access token.');
  const body = await responseJson(response, 'validation-response-invalid');
  if (body.client_id !== clientId) throw new TwitchLoginError('client-mismatch', 'The issued token belongs to a different Twitch application.');
  if (!Array.isArray(body.scopes) || !body.scopes.includes(TWITCH_SCOPE))
    throw new TwitchLoginError('scope-mismatch', `The issued token is missing ${TWITCH_SCOPE}.`);
  return { readerUserId: cleanSingleLine(body.user_id, 'reader user ID') };
}

export async function lookupBroadcaster({ clientId, accessToken, channel, fetchFn = globalThis.fetch, signal } = {}) {
  const login = validateChannel(channel);
  const url = new URL(USERS_URL);
  url.searchParams.set('login', login);
  const response = await twitchFetch(fetchFn, url.href, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId }, signal
  }, signal);
  if (!response.ok) throw new TwitchLoginError('channel-lookup-failed', 'Twitch rejected the channel lookup.');
  const body = await responseJson(response, 'channel-response-invalid');
  const user = body?.data?.[0];
  if (!user || String(user.login).toLowerCase() !== login)
    throw new TwitchLoginError('channel-not-found', `Twitch channel "${login}" was not found.`);
  return { broadcasterId: cleanSingleLine(user.id, 'broadcaster user ID'), channelLogin: login };
}

export async function authorizeTwitchChat({ clientId, channel, fetchFn = globalThis.fetch,
  sleepFn = abortableSleep, nowFn = Date.now, signal, onActivation = () => {} } = {}) {
  const cleanClientId = validateClientId(clientId);
  const device = await requestDeviceCode({ clientId: cleanClientId, fetchFn, signal });
  onActivation({ verificationUri: device.verificationUri, userCode: device.userCode, expiresIn: device.expiresIn });
  const { accessToken } = await pollDeviceToken({ clientId: cleanClientId, device, fetchFn, sleepFn, nowFn, signal });
  const { readerUserId } = await validateAccessToken({ clientId: cleanClientId, accessToken, fetchFn, signal });
  const cleanChannel = validateChannel(channel);
  const broadcasterId = cleanChannel
    ? (await lookupBroadcaster({ clientId: cleanClientId, accessToken, channel: cleanChannel, fetchFn, signal })).broadcasterId
    : readerUserId;
  return { clientId: cleanClientId, accessToken, readerUserId, broadcasterId };
}

function envLine(key, value) { return `${key}=${value}`; }

export function mergeEnv(existing, config) {
  for (const value of Object.values(config)) cleanSingleLine(value, 'configuration value');
  const replacements = new Map([
    ['TWITCH_CLIENT_ID', config.clientId], ['TWITCH_USER_ACCESS_TOKEN', config.accessToken],
    ['TWITCH_READER_USER_ID', config.readerUserId], ['TWITCH_BROADCASTER_ID', config.broadcasterId]
  ]);
  const seen = new Set();
  const lines = String(existing || '').split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const merged = lines.map(line => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !replacements.has(match[1])) return line;
    const key = match[1];
    if (seen.has(key)) return null;
    seen.add(key);
    return envLine(key, replacements.get(key));
  }).filter(line => line !== null);
  for (const key of CONFIG_KEYS) if (!seen.has(key)) merged.push(envLine(key, replacements.get(key)));
  return `${merged.join('\n')}\n`;
}

export async function writeEnvConfig({ envPath = '.env', config, confirmOverwrite = async () => false,
  fs = { lstat, mkdir, readFile, rename, unlink, writeFile } } = {}) {
  const target = resolve(envPath);
  let existing = '';
  let exists = false;
  try {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) throw new TwitchLoginError('unsafe-env', 'Refusing to write through a symbolic-link .env file.');
    if (!info.isFile()) throw new TwitchLoginError('unsafe-env', 'The .env path is not a regular file.');
    existing = await fs.readFile(target, 'utf8');
    exists = true;
  } catch (error) {
    if (error instanceof TwitchLoginError) throw error;
    if (error.code !== 'ENOENT') throw new TwitchLoginError('env-read-failed', 'Could not inspect the .env file.');
  }
  if (exists && !(await confirmOverwrite()))
    throw new TwitchLoginError('save-declined', 'The existing .env file was left unchanged.');
  const output = mergeEnv(existing, config);
  await fs.mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await fs.writeFile(temporary, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
  } catch {
    try { await fs.unlink(temporary); } catch { /* best effort cleanup */ }
    throw new TwitchLoginError('env-write-failed', 'Could not safely save the .env file.');
  }
  return target;
}
