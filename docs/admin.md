# Admin panel

`/admin` on the website shows who uses Flo and how much: totals, new sign-ups, daily / weekly /
monthly active users (computer, phone, either), the activation funnel, weekly retention cohorts,
platforms and app versions, how phone questions were answered, and a searchable users table with
CSV export and a page per user.

## Who can open it

Only signed-in users whose **confirmed** email is listed in `ADMIN_EMAILS`. Everyone else, signed
in or not, gets the site's normal 404 page (`/api/admin/*` answers 404 too), so the panel's
existence isn't revealed. Pages are server-rendered on every request and marked `noindex`.

Set it in Vercel: Project → Settings → Environment Variables → add `ADMIN_EMAILS` for Production
(and Preview if you want it there), for example:

```
ADMIN_EMAILS=naman@example.com, ops@example.com
```

Comma separated, case-insensitive. Redeploy (or trigger a new deployment) for the change to apply.
Unset or empty means nobody can open it.

### Demo mode (local only)

`ADMIN_DEMO=1 npm run dev` renders the panel with built-in fake data (example.com people), no
sign-in and no database. It is ignored on Vercel (`VERCEL` is set there).

## What it shows, and where that comes from

Nothing new is collected from devices by default. The panel reads:

| Data | Source |
| --- | --- |
| Email, name, sign-in provider, signed up, last web sign-in | Supabase Auth (`auth.users`, confirmed accounts only) and `public.profiles` |
| First / last time the computer app signed in or launched | `app.app_usage` (already used for the public user counter) |
| Active days and approximate minutes per day | `app.usage_days` (migration 0009, below) |
| Paired phones: name, platform, paired, last seen | `app.mobile_devices` (never the token hash or push token) |
| Computer platform and app version | the snapshot the computer shares with a paired phone (`app.desktop_state`) |
| Phone requests: counts, kind, status, who answered, times | `app.mobile_requests` (kept 7 days; **never** the question, screen context or answer) |
| Sync on, number of encrypted items | `app.sync_keys`, `app.sync_items` (never ciphertext) |
| Phone inbox counts by kind | `app.notifications` (never titles or bodies) |
| Usage counts (dictations, words, assistant questions, agent runs, meetings) | `app.usage_counts`, **only for people who opted in** |

### Active time (`app.usage_days`)

The signed-in desktop app already polls the server every 10 to 20 seconds for phone requests while
it's open, and calls `/api/app/me` on launch; a paired phone calls the API whenever it's used. The
server turns that existing traffic into one "ping" per account, surface (`desktop` / `phone`) and
UTC day, at most once per 10 minutes (guarded by `updated_at` in the upsert). So:

- active day = a day with at least one ping
- minutes ≈ pings × 10 (10-minute blocks in which the app was open and signed in; not keystrokes)
- `requests` = phone asks / to-dos / notes queued that day (a count only)

Rows are deleted after 400 days and when the account is deleted.

### Usage counts (opt-in, `app.usage_counts`)

Off by default. In the desktop app, Settings → Privacy → **Share usage counts with Flo** ("Only
numbers, like how many dictations and assistant questions per day. Never what you say or type.").
When it's on, the app sends daily totals for the last 7 days, computed from its local database, once
an hour to `POST /api/app/usage` (an account request through the egress guard, so it is listed in the
network log). Turning it off stops sending and calls `DELETE /api/app/usage`, which deletes the
stored counts. Code: `src-tauri/src/usage_share.rs`.

Definitions: active = active in the last 7 days; at risk = was active before, not in the last 7
days; not activated = no app check-in ever.

## Setting it up

1. Apply `website/supabase/migrations/0009_usage_days.sql` to the Supabase project (SQL editor or
   `supabase db push`). Until then the panel works but shows a banner and no daily activity.
2. Set `ADMIN_EMAILS` in Vercel and deploy the website.
3. Release a desktop build to ship the opt-in toggle (activity from check-ins needs no app update).

## Code

- `website/lib/admin-access.ts`: the access decision (pure, tested)
- `website/lib/admin-metrics.ts`: all aggregation, sorting, CSV (pure, tested)
- `website/lib/admin-data.ts`: the database reads; `website/lib/admin-demo.ts`: demo data
- `website/lib/usage.ts`, `website/lib/usage-logic.ts`: pings, phone request counts, opt-in counts
- `website/app/admin/**`, `website/app/api/admin/users` (CSV), `website/app/api/app/usage`
- Tests: `website/tests/admin-logic.test.mjs`, `admin-routes.test.mjs` (needs `FLO_SITE`),
  `usage-migration.test.mjs` (needs `FLO_TEST_DATABASE_URL`)
