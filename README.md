# PatchParty — Twitch Chat Becomes the Game Designer

**Status: playable local MVP / Twitch live authorization not yet tested / Codex account reconnect pending.**

A game for Twitch: the broadcaster pilots a character through an arena, and chat voters **rewrite the rules** every 30 seconds. Viewers vote with **!patch 1**, **!patch 2**, **!patch 3**; one vote per user per round. The winning patch changes gameplay.

## First run on PROJECT-V2

Requires Node.js **24+**. No package installation needed.

~~~powershell
cd "$env:USERPROFILE\Documents\PatchParty-TwitchCon-2026"
npm test
npm start
~~~

- Main game: **http://127.0.0.1:4317/**
- OBS Browser Source: **http://127.0.0.1:4317/overlay**
- Health: **http://127.0.0.1:4317/api/health**

The program defaults to localhost (this computer only), port 4317. Do not expose the development server to the internet.

## Playing locally

Move with **W/A/S/D** or arrow keys. Collect green orbs, avoid pink enemies, survive and score. Press **RESTART** to replay (or **Space** after losing).

Without Twitch credentials the UI says **LOCAL DEMO · TWITCH NOT CONNECTED**. Click one voting card (one vote per round), or **ADD DEMO VOTERS**. The server simulates sample spectators **only** after clicking that button. Click **RESET ROUNDS** to begin again. When the countdown ends, the winning patch changes gameplay.

Patches: Moon Physics (drift), Hyper Enemies (faster enemies), Laser Walls (damaging edges), Shield Rain (more orbs and periodic health), Reverse Drive (inverted controls), Turbo Player (faster movement).

For OBS, create a Browser Source and paste the overlay URL, with width 1920 and height 1080. For a real Twitch demonstration, stream with your authorized Twitch channel and have legitimate chat users cast votes.

## Optional real Twitch chat connection (NOT yet tested)

1. Register an app via [Twitch Developer Console](https://dev.twitch.tv/console/apps) using a Twitch account with 2FA, and consult [Twitch chat/EventSub docs](https://dev.twitch.tv/docs/chat/authenticating).
2. Obtain a valid Twitch **user OAuth access token** with the scope **user:read:chat**, for an authorized channel/chat-reading account. Do not paste secrets into ChatGPT. This game only reads chat; it does not post messages.
3. Copy .env.example to .env inside this project and fill:

   - TWITCH_CLIENT_ID
   - TWITCH_USER_ACCESS_TOKEN
   - TWITCH_BROADCASTER_ID
   - TWITCH_READER_USER_ID

4. Restart npm start. The backend checks the OAuth token with Twitch /oauth2/validate, opens the official WebSocket EventSub transport, subscribes to channel.chat.message and displays connection status.
5. Send !patch 1 from a real viewer in the broadcaster channel. The counter must change in live-connected mode. Verify and record this interaction with Twitch visible.

**No live Twitch integration tests have been completed yet.** OAuth flow is manually provided by the Twitch account owner; this local MVP does not implement token refresh or full production hardening. Never commit credentials or expose tokens in the frontend.

## API / controls

- GET /api/state — safe read-only vote state.
- GET /api/events — Server-Sent Events for game and OBS overlay.
- GET /api/health — server/Twitch status.
- POST /api/demo/vote — JSON {"name":"viewer","choice":2}; first vote counts.
- POST /api/demo/simulate — ten local sample voters.
- POST /api/demo/reset — reset local rounds.

Demo routes accept requests only from loopback and when Twitch is not connected. Local API has a 60-request/minute limiter.

The app uses no external scripts, images or copyrighted music.

## Verification and limits

~~~powershell
npm run check
npm test
~~~

Node's built-in tests cover strict vote parsing, Twitch event normalization, duplicates, round closure, ties and HTTP demo endpoints.

The Canvas game is local to the browser; the overlay shows votes and applied patches, not player position. This is a **hackathon prototype**, not a production-ready Twitch service. Live Twitch authorization and Codex session evidence remain mandatory for eligible submission.

See docs/HACKATHON-SUBMISSION.md.
