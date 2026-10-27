import { normalizeTwitchChat } from './core.mjs';

export class TwitchReader {
  constructor({ env = process.env, onVote, onStatus = () => {} }) {
    this.config = {
      clientId: env.TWITCH_CLIENT_ID || '',
      token: env.TWITCH_USER_ACCESS_TOKEN || '',
      broadcasterId: env.TWITCH_BROADCASTER_ID || '',
      readerId: env.TWITCH_READER_USER_ID || ''
    };
    this.onVote = onVote;
    this.onStatus = onStatus;
    this.status = 'not-configured';
    this.ws = null;
    this.stopped = false;
    this.reconnectDelay = 2000;
    this.timer = null;
  }
  configured() { return Object.values(this.config).every(Boolean); }
  report(status) { this.status = status; this.onStatus(status); }

  async start() {
    if (!this.configured()) { this.report('not-configured'); return; }
    this.stopped = false;
    const { clientId, token, readerId } = this.config;
    try {
      const validation = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(10000)
      });
      if (!validation.ok) throw new Error('Twitch token validation failed (' + validation.status + ')');
      const info = await validation.json();
      if (info.client_id !== clientId || info.user_id !== readerId || !info.scopes?.includes('user:read:chat'))
        throw new Error('Token does not match reader or required scope');
      this.connect();
    } catch (err) {
      this.report('auth-error: ' + String(err.message).slice(0, 130));
    }
  }
  connect(url = 'wss://eventsub.wss.twitch.tv/ws') {
    if (this.stopped) return;
    this.report('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('message', async (msg) => {
      try {
        const envelope = JSON.parse(String(msg.data));
        const type = envelope.metadata?.message_type;
        if (type === 'session_welcome') {
          const sessionId = envelope.payload?.session?.id;
          if (!sessionId) throw new Error('No session id');
          await this.subscribe(sessionId);
          this.reconnectDelay = 2000;
          this.report('connected');
        } else if (type === 'session_reconnect') {
          const target = envelope.payload?.session?.reconnect_url;
          if (target?.startsWith('wss://eventsub.wss.twitch.tv/')) {
            const old = this.ws; this.connect(target);
            if (old) old.close();
          }
        } else if (type === 'notification') {
          const vote = normalizeTwitchChat(envelope);
          if (vote) this.onVote(vote);
        } else if (type === 'revocation') {
          this.report('subscription-revoked');
          this.stop();
        }
      } catch (err) {
        this.report('event-error: ' + String(err.message).slice(0, 100));
      }
    });
    ws.addEventListener('error', () => this.report('connection-error'));
    ws.addEventListener('close', () => {
      if (this.ws !== ws || this.stopped) return;
      this.report('disconnected');
      this.timer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    });
  }
  async subscribe(sessionId) {
    const { clientId, token, broadcasterId, readerId } = this.config;
    const result = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'channel.chat.message', version: '1',
        condition: { broadcaster_user_id: broadcasterId, user_id: readerId },
        transport: { method: 'websocket', session_id: sessionId }
      }), signal: AbortSignal.timeout(10000)
    });
    if (!result.ok) {
      const body = await result.text();
      throw new Error('Subscription failed (' + result.status + '): ' + body.slice(0, 130));
    }
  }
  stop() {
    this.stopped = true; clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }
}
