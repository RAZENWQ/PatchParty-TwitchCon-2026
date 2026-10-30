import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchReader } from '../src/twitch.mjs';

const env = {
  TWITCH_CLIENT_ID: 'client', TWITCH_USER_ACCESS_TOKEN: 'secret-token',
  TWITCH_BROADCASTER_ID: 'broadcaster', TWITCH_READER_USER_ID: 'reader'
};
const flush = () => new Promise(resolve => setImmediate(resolve));

class MockWebSocket {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; MockWebSocket.instances.push(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  emit(type, value = {}) { this.listeners.get(type)?.(value); }
  close() { this.closed = true; this.emit('close'); }
}

function welcome(id = 'session-1', keepalive = 10) {
  return { data: JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: keepalive } } }) };
}

function chat(text, overrides = {}) {
  return { data: JSON.stringify({
    metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' },
    payload: { event: { chatter_user_id: 'private-user', chatter_user_name: 'PrivateName', message: { text }, ...overrides } }
  }) };
}

test('validates token and reports connected only after subscription acknowledgement', async () => {
  MockWebSocket.instances = [];
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/validate')) return { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
    return { status: 202, json: async () => ({ data: [{ id: 'sub-1', status: 'enabled', transport: { session_id: 'session-1' } }] }) };
  };
  const statuses = [];
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket, onVote() {}, onStatus: value => statuses.push(value) });
  await reader.start();
  assert.equal(reader.status, 'connecting');
  MockWebSocket.instances[0].emit('message', welcome());
  await flush();
  assert.equal(reader.status, 'connected');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(JSON.parse(calls[1].options.body).transport.session_id, 'session-1');
  reader.stop();
});

test('expired token without refresh token requires manual authorization without a retry loop', async () => {
  const timers = [];
  const statuses = [];
  const fetchFn = async () => ({ ok: false, status: 401 });
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket, onVote() {}, onStatus: value => statuses.push(value),
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  await reader.start();
  assert.equal(reader.status, 'authorization-expired');
  assert.equal(statuses.some(value => value.includes('secret-token')), false);
  assert.equal(timers.length, 0);
  reader.stop();
});

test('expired authorization during subscription retries validation rather than blind reconnect', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  let validations = 0;
  let subscriptions = 0;
  const fetchFn = async url => {
    if (url.includes('/validate')) {
      validations++;
      return { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
    }
    subscriptions++;
    return subscriptions === 1 ? { status: 401 } : { status: 202, json: async () => ({ data: [{ id: 'sub-2', status: 'enabled', transport: { session_id: 'session-1' } }] }) };
  };
  const refreshEnv = { ...env, TWITCH_REFRESH_TOKEN: 'old-refresh', TWITCH_REFRESH_TOKEN_ISSUED_AT: '2026-10-29T00:00:00.000Z' };
  const saved = [];
  const reader = new TwitchReader({ env: refreshEnv, fetchFn, WebSocketClass: MockWebSocket, onVote() {},
    refreshFn: async () => ({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh', refreshTokenIssuedAt: '2026-10-29T01:00:00.000Z' }),
    saveTokens: async tokens => saved.push(tokens),
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  await reader.start();
  MockWebSocket.instances[0].emit('message', welcome());
  await flush();
  assert.equal(reader.status, 'connected');
  assert.equal(reader.config.token, 'rotated-access');
  assert.equal(reader.config.refreshToken, 'rotated-refresh');
  assert.equal(saved.length, 1);
  assert.equal(timers.length, 1); // liveness only
  assert.equal(validations, 1);
  reader.stop();
});

test('concurrent authorization failures share one refresh and persistence operation', async () => {
  let releases;
  const gate = new Promise(resolve => { releases = resolve; });
  let refreshes = 0;
  let saves = 0;
  const reader = new TwitchReader({ env: { ...env, TWITCH_REFRESH_TOKEN: 'old-refresh' }, onVote() {},
    refreshFn: async () => { refreshes++; await gate; return { accessToken: 'new-access', refreshToken: 'new-refresh', refreshTokenIssuedAt: '2026-10-29T00:00:00.000Z' }; },
    saveTokens: async () => { saves++; } });
  const first = reader.recoverAuthorization();
  const second = reader.recoverAuthorization();
  releases();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(refreshes, 1);
  assert.equal(saves, 1);
});

test('transient refresh failure is bounded and does not leak secrets', async () => {
  const timers = [];
  const statuses = [];
  let refreshes = 0;
  const reader = new TwitchReader({ env: { ...env, TWITCH_REFRESH_TOKEN: 'private-refresh' }, onVote() {},
    onStatus: status => statuses.push(status), refreshFn: async () => { refreshes++; throw new Error('private-refresh secret-token'); },
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  for (let attempt = 0; attempt < 5; attempt++) await reader.recoverAuthorization();
  assert.equal(timers.length, 1);
  assert.equal(refreshes, 3);
  assert.doesNotMatch(JSON.stringify({ statuses, diagnostics: reader.diagnostics() }), /private-refresh|secret-token/);
});

test('session_reconnect hands over transport without creating a duplicate subscription', async () => {
  MockWebSocket.instances = [];
  let subscriptions = 0;
  const fetchFn = async url => {
    if (url.includes('/validate')) return { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
    subscriptions++;
    return { status: 202, json: async () => ({ data: [{ id: 'sub-1', status: 'enabled', transport: { session_id: 'session-1' } }] }) };
  };
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket, onVote() {} });
  await reader.start();
  const old = MockWebSocket.instances[0];
  old.emit('message', welcome());
  await flush();
  old.emit('message', { data: JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=ok' } } }) });
  const replacement = MockWebSocket.instances[1];
  assert.equal(old.closed, false);
  replacement.emit('message', welcome('session-2'));
  await flush();
  assert.equal(reader.ws, replacement);
  assert.equal(old.closed, true);
  assert.equal(subscriptions, 1);
  assert.equal(reader.status, 'connected');
  reader.stop();
});

test('counts genuine chat notifications, parsed commands, ignored messages, and rejected votes', async () => {
  MockWebSocket.instances = [];
  const votes = [];
  const fetchFn = async url => {
    if (url.includes('/validate')) return { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
    return { status: 202, json: async () => ({ data: [{ id: 'sub-1', status: 'enabled', transport: { session_id: 'session-1' } }] }) };
  };
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket,
    onVote: vote => { votes.push(vote); return { ok: votes.length === 1 }; } });
  await reader.start();
  const ws = MockWebSocket.instances[0];
  ws.emit('message', welcome());
  await flush();
  ws.emit('message', chat('hello stream'));
  ws.emit('message', chat('!patch 2'));
  ws.emit('message', chat('!PATCH 3'));
  ws.emit('message', { data: JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.follow' }, payload: {} }) });
  await flush();
  assert.deepEqual(votes.map(({ choice }) => choice), [2, 3]);
  assert.deepEqual(reader.diagnostics(), {
    status: 'connected', configured: true, connectedAt: reader.connectedAt,
    chatNotifications: 3, validVoteCommands: 2, ignoredMessages: 1, rejectedVotes: 1
  });
  assert.match(reader.connectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(reader.diagnostics()), /private-user|PrivateName|hello stream|secret-token/);
  reader.stop();
});

test('renews access tokens before expiry and creates a fresh EventSub subscription', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  const saved = [];
  const refreshEnv = {
    ...env, TWITCH_REFRESH_TOKEN: 'rotating-refresh',
    TWITCH_REFRESH_TOKEN_ISSUED_AT: '2026-10-30T00:00:00.000Z'
  };
  const fetchFn = async (url, options) => {
    if (url.includes('/validate')) {
      return { ok: true, json: async () => ({
        client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'], expires_in: 3600
      }) };
    }
    const sessionId = JSON.parse(options.body).transport.session_id;
    return { status: 202, json: async () => ({
      data: [{ id: 'sub-' + sessionId, status: 'enabled', transport: { session_id: sessionId } }]
    }) };
  };
  const reader = new TwitchReader({
    env: refreshEnv, fetchFn, WebSocketClass: MockWebSocket, onVote() {},
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return fn; },
    clearTimer() {}, refreshFn: async () => ({
      accessToken: 'new-access', refreshToken: 'new-refresh',
      refreshTokenIssuedAt: '2026-10-30T01:00:00.000Z'
    }), saveTokens: async data => saved.push(data)
  });
  await reader.start();
  const first = MockWebSocket.instances[0];
  first.emit('message', welcome('session-1'));
  await flush();
  assert.equal(reader.status, 'connected');
  const proactive = timers.find(t => t.delay > 1000000);
  assert.ok(proactive);
  proactive.fn();
  await flush();
  assert.equal(saved.length, 1);
  assert.equal(reader.config.token, 'new-access');
  assert.equal(first.closed, true);
  const second = MockWebSocket.instances.at(-1);
  assert.notEqual(second, first);
  second.emit('message', welcome('session-2'));
  await flush();
  assert.equal(reader.status, 'connected');
  assert.equal(reader.ws, second);
  assert.ok(timers.filter(t => t.delay > 1000000).length >= 2);
  reader.stop();
});
