# Twitch reauthorization checklist

Use this checklist when PatchParty reports `authorization-expired`, or once after upgrading from a version whose `.env` has no `TWITCH_REFRESH_TOKEN`.

1. Keep `.env` private. Do not paste tokens into logs, chat, issues, or source control.
2. From this repository, run `npm.cmd run twitch:login -- --client-id=YOUR_CLIENT_ID` (add `--channel=channel_login` when the reader and broadcaster differ).
3. Open only the verified `https://www.twitch.tv/activate` address printed by the CLI, confirm the code, and approve `user:read:chat` with the intended reader account.
4. Confirm replacement of only the Twitch settings in `.env`. The CLI preserves benign settings such as `HOST`, `PORT`, and `ROUND_SECONDS`.
5. Restart PatchParty at a planned time so the process loads the new configuration. Verify connected status before a live demonstration.

PatchParty refreshes reactively after Twitch rejects authorization. A refresh is accepted only after the new access token matches the configured client, reader, and scope. Invalid, revoked, 30-day-old, or incomplete rotation results stop at `authorization-expired` and require this manual flow; they are not retried indefinitely.
