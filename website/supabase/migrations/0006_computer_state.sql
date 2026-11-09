-- The phone's view of the computer: to-dos, Claude Code approvals and settings.
--
-- desktop_state: one small snapshot per account that the signed-in desktop app publishes when
-- something changes (only while a phone is paired). Rebuilt from known fields by the server
-- (lib/desktop-state.ts), never secrets: API keys and tokens stay on the computer.
--
-- mobile_actions: what the phone asks the computer to do with that state (complete or reopen a
-- to-do, Allow / Deny a Claude Code permission prompt, change a simple setting). The computer picks
-- them up on its existing request poll, applies them and republishes the snapshot.
--
-- Server-only like the rest of `app`: no client grants, RLS on with no policies.
create table if not exists app.desktop_state (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  state       jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint desktop_state_size check (octet_length(state::text) <= 200000)
);
comment on table app.desktop_state is
  'Latest snapshot of the computer (to-dos, approvals, non-secret settings) for the paired phone.';
alter table app.desktop_state enable row level security;
revoke all on table app.desktop_state from public, anon, authenticated;

create table if not exists app.mobile_actions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references app.mobile_devices (id) on delete set null,
  kind        text not null check (kind in ('todo_done', 'todo_reopen', 'approve', 'reject', 'setting')),
  target      text not null check (char_length(target) between 1 and 80),
  value       jsonb,
  status      text not null default 'pending' check (status in ('pending', 'taken', 'done', 'failed')),
  message     text check (message is null or char_length(message) <= 300),
  created_at  timestamptz not null default now(),
  taken_at    timestamptz,
  done_at     timestamptz
);
comment on table app.mobile_actions is
  'Actions from a paired phone (to-dos, approvals, settings), applied by the user''s computer. Kept 1 day.';
create index if not exists mobile_actions_user_status_idx on app.mobile_actions (user_id, status, id);
alter table app.mobile_actions enable row level security;
revoke all on table app.mobile_actions from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
