import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoteEngine, normalizeTwitchChat, parseVote, PATCHES } from '../src/core.mjs';

test('Twitch commands parse strictly', () => {
  assert.equal(parseVote('!patch 1'), 1);
  assert.equal(parseVote(' !PATCH 3 '), 3);
  for (const text of ['!patch 0', '!patch 4', '!patch 1 NOW', 'hi !patch 2', '<script>', '', null]) {
    assert.equal(parseVote(text), null, String(text));
  }
});
test('EventSub only accepts channel chat from real user', () => {
  const msg = { metadata: { subscription_type: 'channel.chat.message' }, payload: { event: {
    chatter_user_id: '1234', chatter_user_name: 'viewer', message: { text: '!patch 2' }
  } } };
  assert.deepEqual(normalizeTwitchChat(msg), { userId: '1234', name: 'viewer', choice: 2 });
  assert.equal(normalizeTwitchChat({ ...msg, metadata: { subscription_type: 'channel.follow' } }), null);
  assert.equal(normalizeTwitchChat({ payload: { event: { message: { text: '!patch 1' } } } }), null);
});
test('one vote per user per round', () => {
  let ms = 1000;
  const e = createVoteEngine({ now: () => ms, roundMs: 6000 });
  assert.equal(e.vote({ userId: 'user-1', name: 'Alice', choice: 2 }).ok, true);
  assert.equal(e.vote({ userId: 'user-1', name: 'Alice', choice: 3 }).reason, 'already_voted');
  assert.equal(e.vote({ userId: '', name: 'X', choice: 1 }).reason, 'invalid_user');
  assert.equal(e.vote({ userId: 'user-2', name: 'Bob', choice: 0 }).reason, 'invalid_choice');
  assert.equal(e.state().totalVotes, 1);
  assert.equal(e.state().options[1].votes, 1);
  ms += 6500; assert.equal(e.tick(), true);
  assert.equal(e.state().winner.id, 'fast-enemies');
  assert.equal(e.state().round, 2);
  assert.equal(e.state().totalVotes, 0);
  assert.equal(e.vote({ userId: 'user-1', name: 'Alice', choice: 1 }).ok, true);
});
test('tie and zero votes resolve deterministically', () => {
  let ms = 0;
  const e = createVoteEngine({ now: () => ms, roundMs: 10000 });
  assert.equal(e.tick(), false);
  ms = 10000; assert.equal(e.tick(), true);
  assert.equal(e.state().winner.id, PATCHES[0].id);
  assert.equal(e.state().options[0].id, PATCHES[3].id);
  assert.equal(e.vote({ userId: 'a', choice: 2 }).ok, true);
  assert.equal(e.vote({ userId: 'b', choice: 1 }).ok, true);
  ms = 20001; e.tick();
  assert.equal(e.state().winner.id, PATCHES[3].id);
  e.reset(); assert.equal(e.state().round, 1);
});
test('reject invalid durations and sanitize names', () => {
  assert.throws(() => createVoteEngine({ roundMs: 10 }));
  const e = createVoteEngine();
  e.vote({ userId: 'valid-1', name: '<evil>'.repeat(20), choice: 1 });
  assert.equal(e.state().recentVotes[0].name.includes('<'), false);
});
