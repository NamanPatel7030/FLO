-- ════════════════════════════════════════════════════════════════════════════
-- Flo website: initial schema (Supabase Postgres + Supabase Auth)
--
-- Run once in the Supabase SQL editor, or `supabase db push` (see docs/supabase-setup.md).
-- Safe to re-run: every statement is idempotent.
--
-- Layout
--   auth.users        owned by Supabase Auth (sign-up, password, Google, email confirmation)
--   public.profiles   one row per auth user (name, avatar). Exposed via the Data API, guarded by RLS:
--                     a signed-in user can read and update only their own row.
--   app.*             server-only tables (sign-in handoffs, Slack broker, presence, phones, inbox).
--                     The `app` schema is NOT in the Data API's exposed schemas and anon/authenticated
--                     have no privileges on it. RLS is on with no policies (deny-all) as a second wall.
--                     The Next.js server reaches these tables over a direct Postgres connection
--                     (DATABASE_URL, the `postgres` role, which owns them and bypasses RLS).
--
-- Every user-owned row references auth.users(id) ON DELETE CASCADE, so deleting a user in
-- Supabase Auth removes everything Flo stored for them.
-- ════════════════════════════════════════════════════════════════════════════

-- ── profiles ────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  name        text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_name_length check (char_length(name) <= 200),
  constraint profiles_avatar_length check (avatar_url is null or char_length(avatar_url) <= 2048)
);

comment on table public.profiles is
  'Public profile for each Supabase Auth user (display name + avatar). Created by a trigger on auth.users; '
  'email is mirrored from auth.users and kept in sync. RLS: a user can select/update only their own row.';
comment on column public.profiles.email is 'Mirror of auth.users.email (read-only for clients; synced by trigger).';
comment on column public.profiles.name is 'Display name from sign-up metadata (name / full_name), editable by the user.';
comment on column public.profiles.avatar_url is 'Avatar URL (Google picture / avatar_url metadata).';

create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

-- Clients (anon / authenticated keys) may only read and update their own profile; never insert or delete
-- (the trigger creates rows, ON DELETE CASCADE removes them).
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (name, avatar_url) on table public.profiles to authenticated;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- updated_at bookkeeping
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- New auth user → profile. Name from `name` or `full_name` (Google), avatar from `avatar_url` or `picture`.
-- SECURITY DEFINER so it can write public.profiles from the auth schema's insert; search_path pinned.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(meta ->> 'name'), ''), nullif(trim(meta ->> 'full_name'), ''), ''), 200),
    left(coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', '')), 2048)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Email change (after the user confirms it) → mirror it; a later Google sign-in fills a missing avatar/name.
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  update public.profiles p
     set email      = coalesce(new.email, p.email),
         name       = case when p.name = ''
                           then left(coalesce(nullif(trim(meta ->> 'name'), ''), nullif(trim(meta ->> 'full_name'), ''), ''), 200)
                           else p.name end,
         avatar_url = coalesce(p.avatar_url, left(coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', '')), 2048))
   where p.id = new.id
     and (p.email is distinct from coalesce(new.email, p.email)
          or p.name = ''
          or p.avatar_url is null);
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_user_updated();

-- Trigger functions are not meant to be called through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_updated() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Users that existed before this migration get a profile too.
insert into public.profiles (id, email, name, avatar_url)
select u.id,
       coalesce(u.email, ''),
       left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), ''), 200),
       left(coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', '')), 2048)
  from auth.users u
on conflict (id) do nothing;

-- ── private schema for server-only tables ───────────────────────────────────

create schema if not exists app;
comment on schema app is
  'Server-only Flo tables. Not exposed through the Data API; reached only by the website server over DATABASE_URL.';

revoke all on schema app from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app revoke all on functions from public, anon, authenticated;

-- ── app.handoffs ────────────────────────────────────────────────────────────
create table if not exists app.handoffs (
  code        text primary key,
  state       text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.handoffs is
  'Desktop sign-in handoff: a signed-in browser (/app/connect) gets a one-time code (5 min) bound to the '
  'desktop''s random state; the app redeems it once at /api/app/exchange for an app token.';
create index if not exists handoffs_expires_idx on app.handoffs (expires_at);
create index if not exists handoffs_user_idx on app.handoffs (user_id);

-- ── app.slack_states ────────────────────────────────────────────────────────
create table if not exists app.slack_states (
  state       text primary key,
  challenge   text not null,
  user_id     uuid references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.slack_states is
  'One-click Connect Slack: one-time OAuth state (10 min) bound to sha256(verifier) held by the desktop app, '
  'and to the Flo account when the app was signed in. Deleted once consumed.';
create index if not exists slack_states_expires_idx on app.slack_states (expires_at);
create index if not exists slack_states_user_idx on app.slack_states (user_id);

-- ── app.slack_handoffs ──────────────────────────────────────────────────────
create table if not exists app.slack_handoffs (
  code        text primary key,
  sealed      text not null,
  challenge   text not null,
  user_id     uuid references auth.users (id) on delete cascade,
  team        text not null default '',
  slack_user  text not null default '',
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.slack_handoffs is
  'Slack user token sealed with AES-256-GCM (key derived from AUTH_SECRET), parked for 5 minutes under a '
  'one-time code. Claimed once by the desktop app with its verifier, then deleted. Never stored in plain text.';
create index if not exists slack_handoffs_expires_idx on app.slack_handoffs (expires_at);
create index if not exists slack_handoffs_user_idx on app.slack_handoffs (user_id);

-- ── app.presence ────────────────────────────────────────────────────────────
create table if not exists app.presence (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  status   text not null check (status in ('active', 'away')),
  since    timestamptz not null default now()
);
comment on table app.presence is
  'Active / Away per account (set by the desktop or a paired phone). Pushes go to phones only while away.';

-- ── app.mobile_devices ──────────────────────────────────────────────────────
create table if not exists app.mobile_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  platform    text not null check (platform in ('android', 'ios')),
  token_hash  text not null unique,
  push_token  text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
comment on table app.mobile_devices is
  'Paired phones. token_hash is HMAC-SHA256(AUTH_SECRET, device token); the token itself is shown once and never '
  'stored. push_token is the FCM registration token (unique across devices when set).';
create index if not exists mobile_devices_user_idx on app.mobile_devices (user_id, created_at desc);
create unique index if not exists mobile_devices_push_token_key on app.mobile_devices (push_token) where push_token is not null;

-- ── app.pair_codes ──────────────────────────────────────────────────────────
create table if not exists app.pair_codes (
  code_hash   text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.pair_codes is
  'Six-digit phone pairing codes (5 min, single use), stored only as HMAC-SHA256(AUTH_SECRET, code).';
create index if not exists pair_codes_expires_idx on app.pair_codes (expires_at);
create index if not exists pair_codes_user_idx on app.pair_codes (user_id);

-- ── app.notifications ───────────────────────────────────────────────────────
create table if not exists app.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null default '',
  data        jsonb,
  created_at  timestamptz not null default now()
);
comment on table app.notifications is
  'Phone inbox: short summaries the desktop sends (Claude finished, reminders, digests). The newest 100 per '
  'account are kept; phones page through them by id.';
create index if not exists notifications_user_id_idx on app.notifications (user_id, id);

-- ── lock the private tables down ────────────────────────────────────────────
alter table app.handoffs        enable row level security;
alter table app.slack_states    enable row level security;
alter table app.slack_handoffs  enable row level security;
alter table app.presence        enable row level security;
alter table app.mobile_devices  enable row level security;
alter table app.pair_codes      enable row level security;
alter table app.notifications   enable row level security;
-- (no policies on purpose: anon / authenticated are denied everything)

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
