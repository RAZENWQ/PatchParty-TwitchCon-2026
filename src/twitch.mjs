import { normalizeTwitchChat } from './core.mjs';
import { refreshTwitchTokens, TwitchLoginError, writeEnvConfig } from './twitch-device-auth.mjs';

const DEFAULT_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

export class TwitchReader {
  constructor({ env = process.env, onVote, onStatus = () => {}, fetchFn = globalThis.fetch,
    WebSocketClass = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout,
    refreshFn = refreshTwitchTokens, saveTokens } = {}) {
    this.config = {
      clientId: env.TWITCH_CLIENT_ID || '', token: env.TWITCH_USER_ACCESS_TOKEN || '',
      refreshToken: env.TWITCH_REFRESH_TOKEN || '', refreshTokenIssuedAt: env.TWITCH_REFRESH_TOKEN_ISSUED_AT || '',
      broadcasterId: env.TWITCH_BROADCASTER_ID || '', readerId: env.TWITCH_READER_USER_ID || ''
    };
    this.onVote = onVote;
    this.onStatus = onStatus;
    this.fetch = fetchFn;
    this.WebSocketClass = WebSocketClass;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.refreshFn = refreshFn;
    this.saveTokens = saveTokens || (tokens => writeEnvConfig({ config: {
      clientId: this.config.clientId, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      refreshTokenIssuedAt: tokens.refreshTokenIssuedAt, readerUserId: this.config.readerId,
      broadcasterId: this.config.broadcasterId
    }, confirmOverwrite: async () => true }));
    this.refreshing = null;
    this.transientAuthRetries = 0;
    this.status = 'not-configured';
    this.ws = null;
    this.stopped = false;
    this.reconnectDelay = 2000;
    this.timer = null;
    this.retryNeedsAuth = false;
    this.keepaliveTimer = null;
    this.authRenewalTimer = null;
    this.lastMessageAt = 0;
    this.connectedAt = null;
    this.counters = {
      chatNotifications: 0,
      validVoteCommands: 0,
      ignoredMessages: 0,
      rejectedVotes: 0
    };
  }

  configured() { return Boolean(this.config.clientId && this.config.token && this.config.broadcasterId && this.config.readerId); }
  report(status) { this.status = status; this.onStatus(status); }
  diagnostics() {
    return {
      status: this.status,
      configured: this.configured(),
      connectedAt: this.connectedAt,
      ...this.counters
    };
  }

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
      if (!validation.ok) throw Object.assign(new Error('authorization rejected'), { auth: validation.status === 401 });
      const info = await validation.json();
      if (info.client_id !== clientId || info.user_id !== readerId || !info.scopes?.includes('user:read:chat'))
        throw Object.assign(new Error('authorization does not match configured reader or scope'), { auth: true });
      this.transientAuthRetries = 0;
      this.scheduleTokenRenewal(Number(info.expires_in));
      this.connect(DEFAULT_WS_URL, false);
    } catch (err) {
      if (err.auth) {
        if (await this.recoverAuthorization()) this.connect(DEFAULT_WS_URL, false);
      } else {
        this.report('authorization-error');
        if (++this.transientAuthRetries <= 3) this.scheduleRetry(true);
      }
    }
  }

  async recoverAuthorization() {
    if (this.refreshing) return this.refreshing;
    if (!this.config.refreshToken) { this.report('authorization-expired'); return false; }
    if (this.transientAuthRetries >= 3) { this.report('authorization-error'); return false; }
    this.report('refreshing-authorization');
    this.refreshing = (async () => {
      let refreshed = false;
      try {
        const tokens = await this.refreshFn({ clientId: this.config.clientId,
          refreshToken: this.config.refreshToken, readerUserId: this.config.readerId,
          issuedAt: this.config.refreshTokenIssuedAt, fetchFn: this.fetch });
        refreshed = true;
        await this.saveTokens(tokens);
        this.config.token = tokens.accessToken;
        this.config.refreshToken = tokens.refreshToken;
        this.config.refreshTokenIssuedAt = tokens.refreshTokenIssuedAt;
        this.transientAuthRetries = 0;
        return true;
      } catch (error) {
        if (refreshed || (error instanceof TwitchLoginError && error.code === 'needs-reauthorization')) {
          this.config.refreshToken = '';
          this.report('authorization-expired');
        } else {
          this.report('authorization-error');
          if (++this.transientAuthRetries < 3) this.scheduleRetry(true);
        }
        return false;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  scheduleTokenRenewal(expiresIn) {
    this.clearTimer(this.authRenewalTimer);
    this.authRenewalTimer = null;
    if (!this.config.refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return;
    const delay = Math.min(2 * 60 * 60 * 1000, Math.max(15000, (expiresIn - 300) * 1000));
    this.authRenewalTimer = this.setTimer(() => {
      this.authRenewalTimer = null;
      void this.renewConnectedAuthorization();
    }, delay);
  }

  async renewConnectedAuthorization() {
    if (this.stopped) return;
    const renewed = await this.recoverAuthorization();
    if (this.stopped) return;
    const old = this.ws;
    this.ws = null;
    this.stopLiveness();
    try { old?.close(); } catch { /* noop */ }
    if (renewed) await this.authenticateAndConnect();
    else if (this.status !== 'authorization-expired') this.scheduleRetry(true);
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
          try { await this.subscribe(session.id); }
          catch (error) {
            if (!error.auth || !(await this.recoverAuthorization())) throw error;
            await this.subscribe(session.id);
          }
        }
        this.reconnectDelay = 2000;
        this.startLiveness(ws, Number(session.keepalive_timeout_seconds || 10));
        this.connectedAt = new Date().toISOString();
        this.report('connected');
      } else if (type === 'session_keepalive') {
        // Receiving the frame updates lastMessageAt above.
      } else if (type === 'session_reconnect') {
        const target = envelope.payload?.session?.reconnect_url;
        if (typeof target === 'string' && target.startsWith('wss://eventsub.wss.twitch.tv/')) this.connect(target, true);
        else throw new Error('invalid reconnect URL');
      } else if (type === 'notification') {
        if (envelope.metadata?.subscription_type === 'channel.chat.message') {
          this.counters.chatNotifications++;
          const vote = normalizeTwitchChat(envelope);
          if (vote) {
            this.counters.validVoteCommands++;
            const result = this.onVote(vote);
            if (result && result.ok === false) this.counters.rejectedVotes++;
          } else {
            this.counters.ignoredMessages++;
          }
        }
      } else if (type === 'revocation') {
        const reason = envelope.payload?.subscription?.status || '';
        if (reason === 'authorization_revoked' || reason === 'user_removed') {
          await this.recoverAuthorization();
          try { ws.close(); } catch { /* noop */ }
        } else {
          this.report('subscription-revoked');
        }
      }
    } catch (err) {
      if (err.auth) {
        await this.recoverAuthorization();
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
    this.clearTimer(this.authRenewalTimer);
    this.authRenewalTimer = null;
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }
}
