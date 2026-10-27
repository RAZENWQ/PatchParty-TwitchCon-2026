import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createVoteEngine } from './src/core.mjs';
import { TwitchReader } from './src/twitch.mjs';

const projectDir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(projectDir, '.env'))) process.loadEnvFile(join(projectDir, '.env'));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4317);
const roundSecs = Math.min(120, Math.max(5, Number(process.env.ROUND_SECONDS || 30)));
if (!(Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535)) throw new Error('Invalid PORT');
const engine = createVoteEngine({ roundMs: roundSecs * 1000 });
let twitchStatus = 'not-configured';
let connections = new Set();
const createdAt = new Date().toISOString();
const readOnlyStatus = () => ({
  ...engine.state(),
  twitch: twitchStatus,
  demo: twitchStatus !== 'connected',
  createdAt
});

function broadcast(event, data) {
  for (const res of connections) {
    try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
    catch { connections.delete(res); }
  }
}
engine.onChange((event) => broadcast(event, readOnlyStatus()));
const twitch = new TwitchReader({
  onVote: vote => engine.vote(vote),
  onStatus: status => { twitchStatus = status; broadcast('connection', readOnlyStatus()); }
});
twitch.start();

function reply(res, status, payload, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  });
  res.end(JSON.stringify(payload));
}
function demoSession(req) {
  const match = /(?:^|;\s*)patchparty_demo=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie || '');
  return match?.[1] || null;
}
function ensureDemoSession(req, res) {
  const existing = demoSession(req);
  if (existing) return existing;
  const id = randomUUID();
  res.setHeader('Set-Cookie', 'patchparty_demo=' + id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400');
  return id;
}
function localhost(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function safeStatic(res, file, type) {
  const path = join(projectDir, 'public', file);
  try {
    const data = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
    });
    res.end(data);
  } catch { reply(res, 404, { error: 'not_found' }); }
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 1500) throw new Error('payload_too_large');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('invalid_json'); }
}
const rate = new Map();
function allowDemo(req) {
  if (!localhost(req) || twitchStatus === 'connected') return false;
  const key = req.socket.remoteAddress;
  const now = Date.now();
  const current = rate.get(key) || { since: now, count: 0 };
  if (now - current.since > 60000) { current.since = now; current.count = 0; }
  current.count++;
  rate.set(key, current);
  return current.count <= 60;
}
const staticRoutes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  if (req.method === 'GET' && staticRoutes[pathname]) {
    return safeStatic(res, ...staticRoutes[pathname]);
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    return reply(res, 200, { ok: true, app: 'PatchParty', uptime: Math.round(process.uptime()), twitch: twitchStatus });
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    if (localhost(req) && twitchStatus !== 'connected') ensureDemoSession(req, res);
    return reply(res, 200, readOnlyStatus());
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('event: ready\ndata: ' + JSON.stringify(readOnlyStatus()) + '\n\n');
    connections.add(res);
    req.on('close', () => connections.delete(res));
    return;
  }
  if (req.method === 'POST' && pathname.startsWith('/api/demo/')) {
    if (!allowDemo(req)) return reply(res, 403, { ok: false, reason: 'demo_not_available' });
    try {
      if (pathname === '/api/demo/reset') {
        engine.reset(); return reply(res, 200, { ok: true, state: readOnlyStatus() });
      }
      if (pathname === '/api/demo/vote') {
        const input = await readJson(req);
        const name = String(input.name || 'spectator').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
        if (!name) return reply(res, 400, { ok: false, reason: 'invalid_name' });
        const vote = engine.vote({ userId: 'demo:session:' + ensureDemoSession(req, res), name, choice: Number(input.choice) });
        return reply(res, vote.ok ? 200 : 409, vote);
      }
      if (pathname === '/api/demo/simulate') {
        const round = engine.state().round;
        const names = ['pixelpilot','neonpanda','starlord','tinyturtle','orbitfox','bitwitch','synthcat','glitchwolf','sunflare','v0id'];
        let inserted = 0;
        for (let i = 0; i < names.length; i++) {
          const choice = 1 + ((i * 7 + round) % 3);
          if (engine.vote({ userId: 'demo:auto:' + names[i], name: names[i], choice }).ok) inserted++;
        }
        return reply(res, 200, { ok: true, inserted });
      }
    } catch (err) { return reply(res, 400, { ok: false, reason: String(err.message).slice(0, 70) }); }
  }
  return reply(res, 404, { error: 'route_not_found' });
});
const ticker = setInterval(() => {
  engine.tick();
  broadcast('clock', readOnlyStatus());
}, 1000);
server.on('close', () => { clearInterval(ticker); twitch.stop(); });
server.listen(PORT, HOST, () => {
  console.log('PatchParty listening on http://' + HOST + ':' + PORT);
  console.log('Twitch connection: ' + twitchStatus + '; demo mode unless live token validated.');
});
