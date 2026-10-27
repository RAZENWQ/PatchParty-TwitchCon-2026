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

test('authorization rejection schedules validation retry without exposing token in status', async () => {
  const timers = [];
  const statuses = [];
  let validations = 0;
  const fetchFn = async () => {
    validations++;
    return validations === 1 ? { ok: false, status: 401 } : { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
  };
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket, onVote() {}, onStatus: value => statuses.push(value),
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  await reader.start();
  assert.equal(reader.status, 'authorization-expired');
  assert.equal(statuses.some(value => value.includes('secret-token')), false);
  timers.shift()();
  await flush();
  assert.equal(validations, 2);
  assert.equal(reader.status, 'connecting');
  reader.stop();
});

test('expired authorization during subscription retries validation rather than blind reconnect', async () => {
  MockWebSocket.instances = [];
  const timers = [];
  let validations = 0;
  const fetchFn = async url => {
    if (url.includes('/validate')) {
      validations++;
      return { ok: true, json: async () => ({ client_id: 'client', user_id: 'reader', scopes: ['user:read:chat'] }) };
    }
    return { status: 401 };
  };
  const reader = new TwitchReader({ env, fetchFn, WebSocketClass: MockWebSocket, onVote() {},
    setTimer: fn => { timers.push(fn); return fn; }, clearTimer() {} });
  await reader.start();
  MockWebSocket.instances[0].emit('message', welcome());
  await flush();
  assert.equal(reader.status, 'authorization-expired');
  assert.equal(timers.length, 1);
  timers.shift()();
  await flush();
  assert.equal(validations, 2);
  reader.stop();
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
