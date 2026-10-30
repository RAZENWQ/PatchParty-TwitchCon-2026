# Live Twitch chat → EventSub → PatchParty: 2026-10-30

This page documents a real end-to-end acceptance test performed on PROJECT-V2, not the local demo-voter endpoint.

## Verified facts

- Twitch channel popout: `codenexuslive`, authenticated owner account
- Live Twitch EventSub status: `connected`
- Chat command `!patch 1` produced one `channel.chat.message` notification and one accepted valid vote
- After round **122**, the live engine selected `SHIELD RAIN` and displayed it as the active gameplay patch with **one** vote
- A second chat command `!patch 2` produced another live EventSub notification and valid vote
- After round **137**, the live engine selected `HYPER ENEMIES` and displayed it as the active patch with **one** vote
- Aggregate counts for the running server after both checks: `chatNotifications=2`, `validVoteCommands=2`, `ignoredMessages=0`, `rejectedVotes=0`
- At the time of verification, `demo=false` in `/api/state`

## Direct recording evidence

The verified 75-second unedited voting take is:
`dist/PatchParty-live-e2e-20261030-145151-SERVER-PASS-REVIEW-VIDEO.mp4`.

The recorder's aggregate-only, no-PII evidence is:
`dist/PatchParty-live-e2e-20261030-145151-evidence.json`.

The video shows the running game on the left and Twitch chat on the right: a new `!patch 2` message arrives, option 2 receives 1 vote/100%, and `HYPER ENEMIES` appears as the active patch at the end of the round.

The final submission edit additionally includes a short gameplay recording, the real read-only OBS browser overlay, and a terminal capture of the 28 automated tests.

## Scope and limitations

The live chat messages were sent from the account authenticated in the Twitch browser. No separate spectator account or audience turnout was independently verified. The server's authenticated EventSub delivery was real, but a public Twitch broadcast through OBS has **not** been independently demonstrated. Browser game controls were exercised locally. The game-over overlay in the continuous chat take is genuine survival gameplay, not the result of a streaming failure. No fake Twitch events, fabricated vote counts or credential strings were inserted into the footage.

The source repository deliberately excludes OAuth tokens, refresh tokens, `.env`, private account material, and screen recordings. Keep raw footage local and upload only the final edited video to an appropriate video platform.
