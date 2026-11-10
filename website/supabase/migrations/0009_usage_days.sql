-- Usage over time, for the admin panel (/admin, docs/admin.md).
--
-- usage_days: how many 10-minute blocks each account's desktop app and paired phones were in use, per
--   UTC day. Derived only from requests the apps already make (the desktop's phone-request poll and
--   check-in, the phone's own API calls); no new data comes from devices. The server bumps `pings` at most
--   once per 10 minutes per account and surface (the `where updated_at < now() - 10 min` below is the
--   guard), so minutes in use ≈ pings × 10. `requests` counts phone asks / to-dos / notes queued that day
--   (counts only; the text itself stays in app.mobile_requests for 7 days, as before).
--
-- usage_counts: opt-in only. When the user turns on Settings → Privacy → "Share usage counts with Flo",
--   the desktop app sends daily totals it computes from its local database (dictations, words dictated,
--   assistant asks, agent runs, meetings recorded) once an hour. Numbers only, never content. Turning the
--   toggle off deletes the stored counts (DELETE /api/app/usage).
--
-- Retention: rows older than 400 days are deleted by the server (lib/usage.ts). Deleting a user in
-- Supabase Auth removes their rows (on delete cascade).
--
-- Server-only like the rest of `app`: RLS on with no policies, no client grants. Re-runnable.

create table if not exists app.usage_days (
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,
  surface     text not null check (surface in ('desktop', 'phone')),
  pings       int not null default 1 check (pings >= 0),
  requests    int not null default 0 check (requests >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day, surface)
);
comment on table app.usage_days is
  'Active 10-minute blocks per account, UTC day and surface (desktop / phone), derived from requests the apps '
  'already make; plus the number of phone requests queued that day. Counts only. Kept 400 days.';
create index if not exists usage_days_day_idx on app.usage_days (day);

create table if not exists app.usage_counts (
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,
  kind        text not null check (kind in ('dictations', 'words', 'assistant_asks', 'agent_runs', 'meetings')),
  n           int not null check (n between 0 and 10000000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day, kind)
);
comment on table app.usage_counts is
  'Opt-in daily usage totals sent by the desktop app (Settings → Privacy → Share usage counts). Numbers only, '
  'never content. Deleted when the user turns sharing off. Kept 400 days.';
create index if not exists usage_counts_day_idx on app.usage_counts (day);

alter table app.usage_days enable row level security;
alter table app.usage_counts enable row level security;
revoke all on table app.usage_days from public, anon, authenticated;
revoke all on table app.usage_counts from public, anon, authenticated;
