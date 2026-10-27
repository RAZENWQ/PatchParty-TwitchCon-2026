import { normalizeTwitchChat } from './core.mjs';

const DEFAULT_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

export class TwitchReader {
  constructor({ env = process.env, onVote, onStatus = () => {}, fetchFn = globalThis.fetch,
    WebSocketClass = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.config = {
      clientId: env.TWITCH_CLIENT_ID || '', token: env.TWITCH_USER_ACCESS_TOKEN || '',
      broadcasterId: env.TWITCH_BROADCASTER_ID || '', readerId: env.TWITCH_READER_USER_ID || ''
    };
    this.onVote = onVote;
    this.onStatus = onStatus;
    this.fetch = fetchFn;
    this.WebSocketClass = WebSocketClass;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.status = 'not-configured';
    this.ws = null;
    this.stopped = false;
    this.reconnectDelay = 2000;
    this.timer = null;
    this.retryNeedsAuth = false;
    this.keepaliveTimer = null;
    this.lastMessageAt = 0;
  }

  configured() { return Object.values(this.config).every(Boolean); }
  report(status) { this.status = status; this.onStatus(status); }

  async start() {
    if (!this.configured()) { this.report('not-configured'); return; }
    this.stopped = false;
    await this.authenticateAndConnect();
  }

  async authenticateAndConnect() {
    if (this.stopped) return;
    this.clearTimer(this.timer);
    this.report('authenticating');
    const { clientId, token, readerId } = this.config;
    try {
      const validation = await this.fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(10000)
      });
      if (!validation.ok) throw Object.assign(new Error('authorization rejected (' + validation.status + ')'), { auth: true });
      const info = await validation.json();
      if (info.client_id !== clientId || info.user_id !== readerId || !info.scopes?.includes('user:read:chat'))
        throw Object.assign(new Error('authorization does not match configured reader or scope'), { auth: true });
      this.connect(DEFAULT_WS_URL, false);
    } catch (err) {
      this.report(err.auth ? 'authorization-expired' : 'authorization-error');
      this.scheduleRetry(true);
    }
  }

  scheduleRetry(revalidate = false) {
    if (this.stopped) return;
    if (revalidate) this.retryNeedsAuth = true;
    if (this.timer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    this.timer = this.setTimer(() => {
      this.timer = null;
      const needsAuth = this.retryNeedsAuth;
      this.retryNeedsAuth = false;
      if (needsAuth) this.authenticateAndConnect();
      else this.connect(DEFAULT_WS_URL, false);
    }, delay);
  }

  connect(url = DEFAULT_WS_URL, handover = false) {
    if (this.stopped) return;
    this.report(handover ? 'reconnecting' : 'connecting');
    const previous = handover ? this.ws : null;
    const ws = new this.WebSocketClass(url);
    if (!handover) this.ws = ws;
    ws.addEventListener('message', msg => this.handleMessage(ws, msg, { handover, previous }));
    ws.addEventListener('error', () => {
      if (this.ws === ws || handover) this.report('connection-error');
    });
    ws.addEventListener('close', () => {
      if (this.stopped || this.ws !== ws) return;
      this.stopLiveness();
      if (this.retryNeedsAuth) return;
      this.report('disconnected');
      this.scheduleRetry(false);
    });
  }

  async handleMessage(ws, msg, context) {
    this.lastMessageAt = Date.now();
    try {
      const envelope = JSON.parse(String(msg.data));
      const type = envelope.metadata?.message_type;
      if (type === 'session_welcome') {
        const session = envelope.payload?.session;
        if (!session?.id) throw new Error('missing EventSub session id');
        if (context.handover) {
          this.ws = ws;
          if (context.previous && context.previous !== ws) context.previous.close();
        } else {
          await this.subscribe(session.id);
        }
        this.reconnectDelay = 2000;
        this.startLiveness(ws, Number(session.keepalive_timeout_seconds || 10));
        this.report('connected');
      } else if (type === 'session_keepalive') {
        // Receiving the frame updates lastMessageAt above.
      } else if (type === 'session_reconnect') {
        const target = envelope.payload?.session?.reconnect_url;
        if (typeof target === 'string' && target.startsWith('wss://eventsub.wss.twitch.tv/')) this.connect(target, true);
        else throw new Error('invalid reconnect URL');
      } else if (type === 'notification') {
        const vote = normalizeTwitchChat(envelope);
        if (vote) this.onVote(vote);
      } else if (type === 'revocation') {
        const reason = envelope.payload?.subscription?.status || '';
        if (reason === 'authorization_revoked' || reason === 'user_removed') {
          this.report('authorization-expired');
          this.scheduleRetry(true);
          try { ws.close(); } catch { /* noop */ }
        } else {
          this.report('subscription-revoked');
        }
      }
    } catch (err) {
      if (err.auth) {
        this.report('authorization-expired');
        this.scheduleRetry(true);
        try { ws.close(); } catch { /* noop */ }
      } else {
        this.report('event-error');
      }
    }
  }

  startLiveness(ws, keepaliveSeconds) {
    this.stopLiveness();
    const timeoutMs = Math.max(5000, keepaliveSeconds * 1000 + 5000);
    this.lastMessageAt = Date.now();
    const check = () => {
      if (!this.stopped && this.ws === ws && Date.now() - this.lastMessageAt >= timeoutMs) {
        this.report('connection-stale');
        try { ws.close(); } catch { /* noop */ }
      } else if (!this.stopped && this.ws === ws) {
        this.keepaliveTimer = this.setTimer(check, timeoutMs);
      }
    };
    this.keepaliveTimer = this.setTimer(check, timeoutMs);
  }

  stopLiveness() {
    this.clearTimer(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  async subscribe(sessionId) {
    const { clientId, token, broadcasterId, readerId } = this.config;
    const result = await this.fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'channel.chat.message', version: '1',
        condition: { broadcaster_user_id: broadcasterId, user_id: readerId },
        transport: { method: 'websocket', session_id: sessionId } }),
      signal: AbortSignal.timeout(10000)
    });
    if (result.status === 401 || result.status === 403)
      throw Object.assign(new Error('subscription authorization rejected'), { auth: true });
    if (result.status !== 202) throw new Error('subscription request rejected (' + result.status + ')');
    const body = await result.json();
    const subscription = body?.data?.[0];
    if (!subscription?.id || subscription.status !== 'enabled' || subscription.transport?.session_id !== sessionId)
      throw new Error('invalid subscription acknowledgement');
    return subscription;
  }

  stop() {
    this.stopped = true;
    this.clearTimer(this.timer);
    this.timer = null;
    this.retryNeedsAuth = false;
    this.stopLiveness();
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }
}
