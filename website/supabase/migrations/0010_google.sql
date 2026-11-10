-- One-click Connect Google (Calendar + Gmail), brokered by the website exactly like Connect Slack
-- (lib/google.ts, docs/google-setup.md).
--
-- google_states: the one-time OAuth state (10 min) issued to the desktop app. It holds sha256 of a
--   verifier that never leaves the desktop, the products asked for ("calendar gmail") and, when the app
--   was signed in, the Flo account. Deleted the moment the OAuth callback consumes it.
-- google_handoffs: Google's tokens (refresh + access token, granted scopes, account email) sealed with
--   AES-256-GCM under a key derived from AUTH_SECRET, parked under a one-time code for at most 5 minutes.
--   The desktop claims it once with its verifier and the row is deleted. `email` is kept beside the
--   sealed blob only so the claim can echo it.
--
-- Privacy: nothing Google-related stays here after the claim, or after 5 minutes (10 for an unused
-- state); expired rows are swept on the next insert. Tokens are never stored in plain text and never
-- logged. Refreshing an access token later (POST /api/google/refresh) stores nothing at all. Deleting a
-- user in Supabase Auth removes their rows (on delete cascade).
--
-- Server-only like the rest of `app`: RLS on with no policies, no client grants. Re-runnable.

create table if not exists app.google_states (
  state       text primary key,
  challenge   text not null,
  scopes      text not null default '',
  user_id     uuid references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.google_states is
  'One-click Connect Google: one-time OAuth state (10 min) bound to sha256(verifier) held by the desktop app, '
  'the products asked for (calendar, gmail) and the Flo account when the app was signed in. Deleted once consumed.';
create index if not exists google_states_expires_idx on app.google_states (expires_at);
create index if not exists google_states_user_idx on app.google_states (user_id);

create table if not exists app.google_handoffs (
  code        text primary key,
  sealed      text not null,
  challenge   text not null,
  user_id     uuid references auth.users (id) on delete cascade,
  email       text not null default '',
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
comment on table app.google_handoffs is
  'Google OAuth tokens sealed with AES-256-GCM (key derived from AUTH_SECRET), parked for 5 minutes under a '
  'one-time code. Claimed once by the desktop app with its verifier, then deleted. Never stored in plain text.';
create index if not exists google_handoffs_expires_idx on app.google_handoffs (expires_at);
create index if not exists google_handoffs_user_idx on app.google_handoffs (user_id);

alter table app.google_states enable row level security;
alter table app.google_handoffs enable row level security;
revoke all on table app.google_states from public, anon, authenticated;
revoke all on table app.google_handoffs from public, anon, authenticated;
