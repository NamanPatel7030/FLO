-- Who actually uses the Flo app: one row per account, stamped when its desktop app signs in
-- (/api/app/exchange) or checks in on launch (/api/app/me). Feeds the public user counter
-- (/api/stats), which only ever returns totals. Server-only, like the rest of `app`.
create table if not exists app.app_usage (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
comment on table app.app_usage is
  'First and last time each account''s desktop app signed in or launched. Only aggregate counts leave the server.';
create index if not exists app_usage_last_seen_idx on app.app_usage (last_seen);
alter table app.app_usage enable row level security;
revoke all on table app.app_usage from public, anon, authenticated;
