import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

test('loopback API, duplicate votes, demo and overlay', { timeout: 18000 }, async () => {
  const port = 43281;
  const origin = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env, PORT: String(port), HOST: '127.0.0.1',
    TWITCH_USER_ACCESS_TOKEN: '', TWITCH_CLIENT_ID: '', TWITCH_BROADCASTER_ID: '', TWITCH_READER_USER_ID: ''
  };
  let cookie = '';
  const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env, windowsHide: true, stdio: 'ignore' });
  const post = async (path, payload = {}) => {
    const res = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  try {
    let online = false;
    for (let n = 0; n < 35; n++) {
      try { const r = await fetch(origin + '/api/health'); if (r.ok) { online = true; break; } }
      catch { await sleep(100); }
    }
    assert.equal(online, true, 'server must become ready');
    const health = await (await fetch(origin + '/api/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.twitch, 'not-configured');
    const diagnostics = await (await fetch(origin + '/api/diagnostics')).json();
    assert.deepEqual(diagnostics, { ok: true, twitch: { status: 'not-configured', configured: false,
      connectedAt: null, chatNotifications: 0, validVoteCommands: 0, ignoredMessages: 0, rejectedVotes: 0 } });
    const state = await (await fetch(origin + '/api/state')).json();
    assert.equal(state.round, 1);
    assert.equal(state.demo, true);
    assert.equal(state.totalVotes, 0);
    assert.equal((await fetch(origin + '/')).status, 200);
    assert.equal((await fetch(origin + '/overlay')).status, 200);
    assert.equal((await fetch(origin + '/app.js')).status, 200);
    const vote = await post('/api/demo/vote', { name: 'spectator1', choice: 2 });
    assert.equal(vote.status, 200);
    assert.equal(vote.body.patch, 'fast-enemies');
    const duplicate = await post('/api/demo/vote', { name: 'spectator1', choice: 3 });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.reason, 'already_voted');
    const sim = await post('/api/demo/simulate');
    assert.equal(sim.body.inserted, 10);
    const repeatedSim = await post('/api/demo/simulate');
    assert.equal(repeatedSim.body.inserted, 0, 'simulated voters cannot be counted twice in one round');
    const after = await (await fetch(origin + '/api/state')).json();
    assert.equal(after.totalVotes, 11);
    const reset = await post('/api/demo/reset');
    assert.equal(reset.body.state.totalVotes, 0);
    assert.equal((await fetch(origin + '/foo')).status, 404);
  } finally { child.kill(); }
});
