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

## Your computer on the phone (to-dos, approvals, settings)
Migration `0006_computer_state.sql`. The phone never talks to the computer directly: the computer publishes a snapshot, the phone queues actions, the computer applies them on its existing poll.

- `POST /api/app/state` (desktop) `{ v: 1, computer: { platform, appVersion }, todos: { open: [...], done: [...] }, approvals: [...], waiting: [...], settings: [...] }` → `{ stored, updatedAt }`.
  Published by `src-tauri/src/phone_state.rs` when something changes (1.2 s debounce) and every 5 min as a heartbeat, only while signed in. The server rebuilds it from known fields with caps (`website/lib/desktop-state.ts`), drops any setting whose key looks like a credential, and **stores nothing while no phone is paired** (unpairing the last phone deletes it). `DELETE /api/app/state` (desktop) forgets it.
  - `approvals`: Claude Code permission prompts still waiting `{ id, project, summary, tool, at, expiresAt }` (the computer hands them back to the terminal after 2 min).
  - `waiting`: sessions waiting for a typed reply `{ id, project, message, status, at }` (read-only on the phone).
  - `settings`: an explicit allow-list `{ key, label, section, kind: toggle|select|number|text|list, value, editable, options?, min?, max?, hint? }`. Never API keys, tokens, the account URL, the system prompt or local server URLs. Privacy settings (screen awareness, cloud use) are read-only.
- `GET /api/mobile/state` (mobile) → `{ state | null, updatedAt | null, actions: [{ id, kind, target, value, status, message, createdAt }] }` (actions from the last 10 min). The phone polls this only while the app is open.
- `POST /api/mobile/actions` (mobile) `{ kind: todo_done | todo_reopen | approve | reject | setting, target, value? }` → 202 `{ action }`. `value` only for `setting` (boolean, number or short string).
- `GET /api/app/requests?actions=1` (desktop) → `{ requests, actions }`: pending actions are handed out once (retried after 1 min if not finished, dropped after 10 min). Without `?actions=1` (older desktops) actions are left alone.
- `POST /api/app/actions/:id` (desktop) `{ ok, message? }`. The computer re-checks everything: unknown to-dos, closed questions and non-editable settings fail with a message the phone shows.

## Ask from the phone (screen context, cloud fallback)
Migrations `0005_mobile_ask.sql`, `0007_request_context.sql`.

- `POST /api/mobile/ask` (mobile) `{ mode: ask | todo | note, text, context? }` → 202 `{ request }`. `context` is the visible text of the phone screen, sent by the voice bubble only while the user holds **Ask** (never Dictate, never password fields): `"App: <label> (<package>)\nWindow: <title>\nAlready in the field: <text>\n\n<screen lines>"`. Kept for asks only, line breaks kept, capped at 6000 characters (newest/bottom lines win).
- `GET /api/app/requests?actions=1` (desktop) hands the ask out with `context`; the desktop answers with one plain-text call (`src-tauri/src/phone.rs` `direct_answer`): the answer is the text itself, inserted into the phone's field. Asks expire after 1 hour; to-dos and notes wait for the computer (7 days).
- `GET /api/mobile/ask/:id` (mobile) → `{ request: { id, mode, text, status, answer, createdAt, answeredBy: computer | cloud | null }, hint? }`. If an ask is still pending after 8 s and the computer looks offline (no snapshot in 12 min), the server claims it once and answers with cloud AI (Vercel AI Gateway, `anthropic/claude-sonnet-5.5`, same prompt) during this call (up to ~20 s), marking `answeredBy: "cloud"`. If the gateway fails it goes back to the computer and the usual hint shows. Pending to-dos / notes with the computer off get `hint: { reason: "queued", text: "Saved. Your computer will add it when it's back online." }`. `FLO_CLOUD_ANSWERS=off` disables the fallback.

## Payload size / privacy
Titles/bodies are short summaries (e.g. "Claude finished in api — 3 files changed"), never transcripts or code.
