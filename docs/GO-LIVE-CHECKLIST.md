# Go-live and submission checklist

## Legitimate Twitch chat verification

- [ ] Keep the service bound to `127.0.0.1:4317`; do not expose the development server publicly.
- [x] Start PatchParty normally and verify `/api/health` reports `connected`.
- [x] Open `/api/diagnostics` locally and record safe aggregate counters after the test. No user IDs, messages, or tokens were exposed.
- [ ] Use a separate, legitimate Twitch viewer account in the configured broadcaster’s channel.
- [ ] Send exactly one valid command such as `!patch 1`.
- [ ] Verify `chatNotifications` and `validVoteCommands` each increase, and verify the corresponding game card gains one vote.
- [ ] Send an ordinary chat message only if appropriate for the channel; verify `chatNotifications` and `ignoredMessages` increase without changing game votes.
- [ ] If testing a duplicate command, verify `rejectedVotes` increases and the game count does not. Do not identify the viewer in screenshots or logs.
- [x] Record safe end-to-end evidence from real counters and round outcome in `docs/LIVE-TWITCH-E2E-2026-10-29.md`. No demo voters claimed.

## Repository and source package

- [ ] Review `git status`, `git diff`, and `git diff --check`; make sure no `.env`, credentials, logs, recordings, screenshots with private data, or temporary files are staged.
- [ ] Run `npm run check` and `npm test` on Node.js 24+.
- [ ] Add the intended source/docs/tests to Git, then run `npm run package:submission` so the ZIP reflects the tracked file set.
- [ ] Inspect `dist/patchparty-source.zip` entries and confirm they are relative, expected, Git-tracked files only.
- [ ] Commit locally with the third Codex iteration description.
- [ ] Create or select the owner-controlled GitHub repository, verify its visibility meets the rules, and push from the owner’s normal environment.
- [ ] Open the remote repository in a logged-out/private browser and verify the README and source are accessible to judges.

## YouTube demo

- [ ] Record the silent screen-only storyboard in `docs/VIDEO-STORYBOARD.md`, including an actual Twitch vote and visible Codex evidence.
- [ ] Keep the final duration at or below 2:45 (and below the event’s three-minute limit).
- [ ] Review every frame for tokens, `.env`, private chat, email, account IDs, stream keys, and unrelated notifications.
- [ ] Use no copyrighted music or third-party footage.
- [ ] Upload through the owner’s YouTube account, set the required public visibility, and verify playback while logged out.

## Devpost

- [ ] Re-check the current official rules and deadline before submission.
- [ ] Paste and proofread the English draft from `docs/DEVPOST-SUBMISSION-DRAFT.md`.
- [ ] Add the accessible source URL, public YouTube URL, and genuine Codex session identifier(s).
- [ ] State accurately that the MVP was manually authored and Codex materially revised it.
- [ ] Claim live Twitch voting only after the legitimate chat test succeeds and appears in the demo.
- [ ] Preview all fields, submit from the owner’s Devpost account, and retain the confirmation page.

Live verification note: EventSub accepted one command and applied the low-gravity patch in round 11. Separate viewer-account verification, duplicate-vote test and filmed demo remain open.
