# Flo mobile + presence API (contract)

Server: the Flo website (`website/`, Next.js), same host as `Settings.account_url`.
Auth: desktop calls use the existing app session token (see `website/app/api/app/*`, `src-tauri/src/account.rs`).
Mobile calls use a per-device token issued at pairing (`Authorization: Bearer <deviceToken>`), stored hashed.

## Presence
Status is `active` (at the Mac) or `away` (AFK). Push notifications go to the phone **only while away**.

- `POST /api/presence` (desktop or mobile) `{ status: "active" | "away" }` → `{ status, since }`
- `GET  /api/presence` (desktop or mobile) → `{ status, since }`

## Pairing a phone (QR, no password typing on the phone)
1. Desktop `POST /api/mobile/pair/start` → `{ code: "483 920", payload: "flo-pair://<host>/<code>", expiresAt }` (6 digits, 5 min, single use). Desktop shows a QR of `payload` and the code.
2. Phone scans (or types the code + server URL) → `POST /api/mobile/pair/claim { code, deviceName, platform: "android", pushToken? }` → `{ deviceToken, user: { name, email }, server }`.
3. `POST /api/mobile/device { pushToken }` (mobile) — update the FCM token when it rotates.
4. `GET /api/mobile/devices` (desktop) → `[{ id, name, platform, lastSeen }]`; `DELETE /api/mobile/devices/:id` (desktop) or `DELETE /api/mobile/device` (mobile, sign out).

## Notifications
- `POST /api/push` (desktop) `{ kind, title, body, data? }`
  - `kind`: `claude_done` | `claude_needs_you` | `claude_limit` | `claude_resumed` | `todo_due` | `todos_digest` | `reminder` | `skill_ran` | `meeting_summary`
  - Server stores it (inbox, last 100 per user) and, **only if presence is `away`**, sends an FCM push to every paired device. Returns `{ stored: true, pushed: <n>, reason? }`.
  - The desktop also checks presence before sending, so nothing leaves the Mac while the user is active.
- `GET /api/mobile/inbox?after=<id>` (mobile) → `[{ id, kind, title, body, data, createdAt }]`
- Push delivery: FCM HTTP v1, service account from env `FCM_SERVICE_ACCOUNT` (JSON) or `FCM_SERVICE_ACCOUNT_FILE`. If unset, notifications are stored but `pushed: 0, reason: "push not configured"`.

## Claude auto-continue (usage limits)
The desktop (`src-tauri/src/autocontinue.rs`) notices when a Claude Code session stops at a usage limit, works out when the limit resets, and — if "Auto-continue when limits reset" is on (Settings, or per session) — resumes it a minute after the reset with `claude --resume <id> --print "<continue prompt>"` (no permission-bypass flags; permission questions still reach the phone as `claude_needs_you`).
- `claude_limit` — "Claude hit its limit in api" · "Will continue at 3:00 PM." / "Will try again in 15 min." / "Resets at 3:00 PM. Auto-continue is off: tap to turn it on in Flo."
  `data`: `{ project, sessionId, resetsAt: <ISO> | null, autoContinue: boolean }`
- `claude_resumed` — "Resumed api" · "Claude is continuing where it left off." `data`: `{ project, sessionId }`
- After 3 resumes in a day that all hit the limit again, the desktop stops and sends `claude_needs_you` ("Claude stopped in api").
- Proposed, not built yet (needs settings sync): `POST /api/claude/auto-continue { enabled, sessionId? }` (mobile) so a tap on a `claude_limit` notification can turn auto-continue on; the desktop would pick it up on its presence poll. Until then the phone only informs.

## Payload size / privacy
Titles/bodies are short summaries (e.g. "Claude finished in api — 3 files changed"), never transcripts or code.
