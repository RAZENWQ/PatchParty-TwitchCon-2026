export const PATCHES = Object.freeze([
  { id: 'low-gravity', label: 'MOON PHYSICS', subtitle: 'Float through danger', icon: '◒', color: '#a78bfa' },
  { id: 'fast-enemies', label: 'HYPER ENEMIES', subtitle: 'Enemy speed x1.75', icon: '⚡', color: '#fb7185' },
  { id: 'laser-walls', label: 'LASER WALLS', subtitle: 'Arena edges pulse', icon: '▤', color: '#22d3ee' },
  { id: 'shield-rain', label: 'SHIELD RAIN', subtitle: 'Extra shield pickups', icon: '◇', color: '#86efac' },
  { id: 'reverse-controls', label: 'REVERSE DRIVE', subtitle: 'Invert the arrow keys', icon: '⇄', color: '#fde68a' },
  { id: 'speed-boost', label: 'TURBO PLAYER', subtitle: 'Move much faster', icon: '»', color: '#f0abfc' }
]);

export function parseVote(text) {
  if (typeof text !== 'string' || text.length > 250) return null;
  const match = /^!patch\s+([123])\s*$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}

export function normalizeTwitchChat(envelope) {
  if (envelope?.metadata?.subscription_type !== 'channel.chat.message') return null;
  const event = envelope?.payload?.event;
  if (!event || typeof event.chatter_user_id !== 'string') return null;
  const choice = parseVote(event.message?.text);
  return choice ? { userId: event.chatter_user_id, name: String(event.chatter_user_name || 'Viewer').slice(0, 32), choice } : null;
}

export function createVoteEngine({ now = () => Date.now(), roundMs = 30000 } = {}) {
  if (!Number.isFinite(roundMs) || roundMs < 5000 || roundMs > 120000) throw new Error('Invalid round duration');
  let round = 1;
  let startedAt = now();
  let options = PATCHES.slice(0, 3);
  let votes = new Map();
  let winner = null;
  let activePatch = null;
  let lastResult = null;
  let generation = 1;
  let activity = [];
  const listeners = new Set();

  function state() {
    const counts = options.map(p => Array.from(votes.values()).filter(v => v.choice === p.id).length);
    const total = counts.reduce((sum, n) => sum + n, 0);
    return {
      round, startedAt, closesAt: startedAt + roundMs,
      serverTime: now(), remainingMs: Math.max(0, startedAt + roundMs - now()),
      options: options.map((p, i) => ({ ...p, number: i + 1, votes: counts[i], percent: total ? Math.round(counts[i] * 100 / total) : 0 })),
      totalVotes: total, recentVotes: activity.slice(-5).reverse(), winner,
      activePatch, lastResult, generation
    };
  }
  function announce(type) {
    const snapshot = state();
    for (const fn of listeners) { try { fn(type, snapshot); } catch { /* isolate subscribers */ } }
  }
  function vote({ userId, name, choice }) {
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(userId)) return { ok: false, reason: 'invalid_user' };
    if (!Number.isInteger(choice) || choice < 1 || choice > 3) return { ok: false, reason: 'invalid_choice' };
    if (now() >= startedAt + roundMs) tick();
    if (votes.has(userId)) return { ok: false, reason: 'already_voted' };
    const patch = options[choice - 1];
    const cleanName = String(name || 'viewer').replace(/[<>]/g, '').trim().slice(0, 28);
    votes.set(userId, { choice: patch.id, name: cleanName });
    activity.push({ name: cleanName, choice, at: now() });
    if (activity.length > 35) activity = activity.slice(-35);
    announce('vote');
    return { ok: true, choice, patch: patch.id };
  }
  function tick() {
    if (now() < startedAt + roundMs) return false;
    const counts = options.map(p => Array.from(votes.values()).filter(v => v.choice === p.id).length);
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) {
      winner = null;
      lastResult = { type: 'no-votes', round, at: now() };
    } else {
      let best = 0;
      counts.forEach((count, i) => { if (count > counts[best]) best = i; });
      winner = { ...options[best], votes: counts[best], round, at: now() };
      activePatch = { ...winner };
      lastResult = { type: 'winner', round, winner: { ...winner } };
    }
    round++;
    startedAt = now();
    const offset = ((round - 1) * 3) % PATCHES.length;
    options = [0, 1, 2].map(i => PATCHES[(offset + i) % PATCHES.length]);
    votes.clear();
    activity = [];
    announce('patch');
    return true;
  }
  function reset() {
    round = 1; startedAt = now(); options = PATCHES.slice(0, 3);
    votes.clear(); winner = null; activePatch = null; lastResult = null; activity = [];
    generation++;
    announce('reset');
  }
  return { state, vote, tick, reset, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}
