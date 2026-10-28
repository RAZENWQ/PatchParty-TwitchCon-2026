# PatchParty — Devpost submission draft

## Tagline

Streamers play the game. Their audience rewrites its rules.

## What it does

PatchParty is a playable browser arena game in which the broadcaster moves, collects orbs, and avoids enemies while Twitch chat votes on the next rule change. Viewers use `!patch 1`, `!patch 2`, or `!patch 3`; one vote per Twitch user is accepted in each 30-second round. The winning patch can change gravity, movement, enemy speed, arena hazards, or recovery. A separate read-only overlay is designed for OBS.

The Node.js service owns vote rounds and patch selection, streams state to the game and overlay with Server-Sent Events, and reads `channel.chat.message` notifications through Twitch EventSub WebSockets. A local demo mode remains available when Twitch is not connected.

## Audience value

PatchParty gives viewers a direct, legible way to shape a stream without taking control away from the broadcaster. Every round creates a quick collective decision and a new gameplay problem, giving both active chatters and lurkers an easy reason to stay for the next outcome. The OBS view makes the choices and result understandable even when the game is only one part of a stream layout.

## How Codex was used

The original proof-of-concept MVP was manually authored and is preserved in Git history as commit `9bf35f5`. Codex then materially revised the project: it corrected round/reset synchronization and demo identity behavior, made the winning patch server-authoritative, hardened EventSub authorization/reconnect/subscription handling, improved accessibility and overlay behavior, added a public-client Twitch Device Code authorization workflow, added privacy-safe live diagnostics, expanded automated tests, and created reproducible submission packaging and documentation.

Codex did not originate the MVP, and this submission does not claim that it did. The saved Codex session identifiers are recorded in `docs/CODEX-SESSION-EVIDENCE.md`.

## Setup and operation

PatchParty requires Node.js 24 or newer and no package installation. Run `npm test`, then `npm start`, and open `http://127.0.0.1:4317/`. The OBS Browser Source URL is `http://127.0.0.1:4317/overlay`.

For Twitch, the owner registers a public Twitch application, runs `npm run twitch:login -- --client-id=...` (optionally with `--channel=...`), approves the device code, and restarts the service. The CLI requests `user:read:chat`, validates the resulting token, and writes the EventSub configuration to the Git-ignored `.env` only with confirmation when replacing existing settings. It does not use a Client Secret. Full owner instructions are in the README.

## Testing

`npm run check` performs syntax checks. `npm test` covers vote parsing, round rules, safe demo identities, HTTP routes, EventSub subscription acknowledgement, reconnect handover, authorization retry, device-code outcomes, output secrecy, privacy-safe diagnostic counters, and submission ZIP validation. Network-facing Twitch behavior is dependency-injected and mock-tested so the automated suite is deterministic and does not use credentials.

## Current evidence and caveats

The local service has been confirmed connected to Twitch, but no live chat vote has yet been observed. The final demo must therefore show a legitimate viewer sending a command and the aggregate diagnostic and vote totals changing before any claim of end-to-end voting is made.

This is a hackathon prototype, not a production service. Access tokens are short-lived, the game simulation runs locally in each browser, the overlay synchronizes vote/patch state rather than player position, and the development server must remain loopback-only. The public repository, public YouTube demo, and Devpost submission are owner-operated final steps and are not claimed complete here.
