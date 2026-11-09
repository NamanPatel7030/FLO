-- Minimal stand-in for the parts of a Supabase database that 0001_init.sql relies on, so the migration
-- and the data layer can be tested against a plain local Postgres (tests/migration.test.mjs).
-- NEVER run this against a real Supabase project: there, `auth` and these roles already exist.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Supabase's auth.uid(): the `sub` claim of the request JWT.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants table privileges in public to the API roles by default; mimic that.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
