# Live Twitch EventSub voting verification — 2026-10-29

The running PatchParty service on PROJECT-V2 at http://127.0.0.1:4317 was checked via its loopback-only JSON endpoints after the owner said they sent a chat command.

## Observed from the real running service

- `/api/health`: `ok: true`; Twitch status `connected`.
- `/api/diagnostics`: `chatNotifications: 1`; `validVoteCommands: 1`; `ignoredMessages: 0`; `rejectedVotes: 0`.
- `/api/state`: current round **12** at the observation, with 0 votes in this new round (normal round reset).
- `/api/state` recorded the winner of completed round **11** as `low-gravity` / **MOON PHYSICS**, with **1** vote. Both `winner` and `activePatch` identified this patch.
- `demo: false`: this was the Twitch-connected path, not the local demo API.

## Conclusion

**Live functional E2E PASS for one chat vote:** an actual Twitch EventSub `channel.chat.message` notification was parsed as a valid vote, and the round winner was applied as the game’s active patch. The game and its OBS overlay are still separate browser renderers. This verifies server state, not the video capture or stream broadcast.

## Evidence limits

Only aggregate counters and gameplay state were recorded. No chat usernames, reader IDs, access tokens, refresh tokens or raw messages were saved. A distinct second spectator account was **not independently verified**, so this document does not assert that the voter was a separate person/account. One successful vote is not a load, resilience, long-duration, or post-expiry refresh test. At the time of this result, the newly implemented token-rotation path had 27 deterministic passing tests but had not yet been exercised during a real expiration.

Reproduce by inspecting the loopback endpoints and sending a new `!patch 1` from a valid Twitch chat account; round numbers and mutations vary per round.
