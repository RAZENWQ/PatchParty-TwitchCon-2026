# Silent screen-only demo storyboard (maximum 2:45)

Use large cursor movements, readable zoom, and short on-screen captions. Record only windows needed for the story. Do not show `.env`, tokens, account settings, browser password UI, terminal environment output, private messages, or viewer identities. Use no music or other copyrighted audio.

## 0:00–0:18 — Premise

- Show the PatchParty title and playable arena at `127.0.0.1:4317`.
- Caption: “The streamer plays. Twitch chat rewrites the rules.”
- Move the character and collect one orb.

## 0:18–0:42 — Three choices, one shared round

- Frame the three current patch cards and countdown.
- Caption: “Every 30 seconds, viewers vote: !patch 1 / 2 / 3.”
- Briefly show the Twitch channel and chat beside the game. Hide unrelated conversations and notifications.

## 0:42–1:15 — Legitimate live Twitch vote

- Start with `http://127.0.0.1:4317/api/diagnostics` visible long enough to show the connected status and pre-vote aggregate counters. No identities or message text should appear.
- From a separate legitimate viewer account, send one `!patch N` command in the selected channel.
- Return to the game and diagnostics. Show the selected card count and the increases in `chatNotifications` and `validVoteCommands`.
- Do not stage or label this segment as successful until the counters actually change. If no EventSub notification arrives, record it as a connection diagnostic, fix the integration, and re-record; do not substitute demo voters as live evidence.

## 1:15–1:38 — Rule becomes gameplay

- Let the round end and show the winning patch announcement.
- Demonstrate the visible gameplay effect for several seconds.
- Caption: “The server applies the winning rule to the next round.”

## 1:38–1:58 — OBS-ready overlay

- Show OBS with the loopback `/overlay` Browser Source and the live choice totals/result.
- Keep stream keys, account controls, and private docks out of frame.
- Caption: “A clean overlay keeps chat’s decision visible on stream.”

## 1:58–2:24 — Codex evidence

- Show the saved Codex conversation/session identifier and a concise diff or test output for diagnostics, EventSub hardening, and packaging.
- Show the provenance sentence: “Original MVP manually authored; Codex materially revised and tested it.”
- Do not show ignored JSONL logs if they contain internal paths or unrelated context.

## 2:24–2:40 — Verification

- Show `npm run check` and `npm test` completing successfully.
- Briefly show `npm run package:submission` and the safe archive entry inspection/test result.

## 2:40–2:45 — Close

- Return to the game and overlay.
- Caption: “PatchParty — chat becomes the game designer.”
