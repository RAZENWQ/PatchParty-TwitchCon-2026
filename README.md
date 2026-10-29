# PatchParty — Twitch Chat Becomes the Game Designer

**Status: playable Codex-refined prototype / live Twitch connection confirmed / no live chat vote observed yet.**

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

## Optional real Twitch chat connection

The owner can authorize chat reading from a phone with Twitch's documented public-client Device Code Flow. The CLI needs a Client ID but **never a Client Secret**.

1. As the owner, register a **public** application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Twitch requires 2FA to register applications. Choose the Device Code Grant/public-client option if shown. Copy only its Client ID; do not create, paste, or store a Client Secret for this flow.
2. Stop the PatchParty process normally if you intend to replace the process configuration. Do not terminate an unrelated process. From this repository, run:

   ~~~powershell
   npm.cmd run twitch:login -- --client-id=YOUR_CLIENT_ID
   ~~~

   If the authorized reader is reading another broadcaster's chat, specify the broadcaster login:

   ~~~powershell
   npm.cmd run twitch:login -- --client-id=YOUR_CLIENT_ID --channel=channel_login
   ~~~

3. The CLI prints only a verified `https://www.twitch.tv/activate...` address and user code. Open that address on the owner's phone, sign in to the intended chat-reading account, confirm the matching code, review the `user:read:chat` permission, and approve. Press Ctrl+C to cancel safely.
4. After Twitch issues a token, the CLI validates the application Client ID, required scope, and reader user ID. With `--channel`, it resolves that exact login through Helix; without it, the authorized token owner is used as the broadcaster.
5. If `.env` already exists, explicitly answer `y` before only the Twitch values are replaced. `HOST`, `PORT`, `ROUND_SECONDS`, comments, and other settings are preserved. Declining leaves the file unchanged. `.env` is Git-ignored and secret: never print, share, upload, or commit it.
6. Start/restart with `npm.cmd start`. The backend validates the token, opens Twitch EventSub WebSocket, and subscribes to `channel.chat.message`. From a separate legitimate viewer account, send `!patch 1` in the selected channel and verify the counter changes and `/api/health` reports Twitch connected.

Existing `.env` files created by an earlier PatchParty version have no refresh token. Run `npm.cmd run twitch:login -- --client-id=YOUR_CLIENT_ID` once to reauthorize and save the initial rotating refresh token. After that, the backend reactively refreshes on an authorization failure, validates the new access token, and atomically saves both rotated tokens. Twitch refresh tokens rotate on every use and expire after 30 days; invalid, revoked, expired, or incomplete refresh responses require the owner to run the login command again. PatchParty does not blindly retry an invalid authorization.

The owner has confirmed that the local service reached Twitch's connected state. No live chat vote has yet been observed, so end-to-end command delivery remains to be demonstrated with a legitimate viewer. Automated authorization and EventSub lifecycle tests use injected offline mocks. See Twitch's official [Device Code Flow documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow).

## API / controls

- GET /api/state — safe read-only vote state.
- GET /api/events — Server-Sent Events for game and OBS overlay.
- GET /api/health — server/Twitch status.
- GET /api/diagnostics — loopback-only aggregate Twitch status and message/vote counters; never message text, identities, channel IDs or tokens.
- POST /api/demo/vote — JSON {"name":"viewer","choice":2}; first vote counts.
- POST /api/demo/simulate — ten local sample voters.
- POST /api/demo/reset — reset local rounds.

Demo routes accept requests only from loopback and when Twitch is not connected. Local API has a 60-request/minute limiter.

The app uses no external scripts, images or copyrighted music.

## Verification and limits

Empty rounds do not activate a patch. A genuine round winner becomes the server-authoritative active patch for both the game and OBS overlay until another genuine winner replaces it or the rounds are reset. Demo voting uses an HttpOnly browser-session identity, and the built-in sample voters cannot be counted twice in one round.

The Twitch backend validates authorization, verifies the subscription acknowledgement before reporting connected, performs bounded reactive token refresh, resubscribes after recovery, performs EventSub reconnect handover, and detects stale connections. These lifecycle paths are covered with offline mocks only; no live refresh or chat-message integration test has been performed.

~~~powershell
npm run check
npm test
npm run package:submission
~~~

Node's built-in tests cover strict vote parsing, Twitch event normalization, duplicate and empty rounds, reset state, demo identities, HTTP endpoints, privacy-safe Twitch counters, subscription acknowledgement, bounded authorization recovery, two successive token rotations, invalid/revoked/old refresh tokens, validation rejection, reconnect handover, device-code pending/success/expiry/denial/slow-down behavior, channel lookup, log secrecy, safe configuration writes, and source ZIP inspection.

The Canvas game is local to the browser; the overlay shows votes and applied patches, not player position. This is a **hackathon prototype**, not a production-ready Twitch service. Live Twitch authorization and Codex session evidence remain mandatory for eligible submission.

`npm run package:submission` creates `dist/patchparty-source.zip` from eligible Git-tracked files only. Add intended files to Git before making the final package; `dist/` is ignored.

See docs/HACKATHON-SUBMISSION.md and docs/GO-LIVE-CHECKLIST.md.
