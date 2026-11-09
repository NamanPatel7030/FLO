-- "Sync your data": end-to-end encrypted backup and multi-Mac sync.
--
-- The Mac app encrypts every item with a key that never leaves the user's Macs (stored in the
-- macOS Keychain, shown once as a recovery key). This server only ever stores ciphertext: it can't
-- read to-dos, notes, history or settings. Off by default; nothing is stored until a user turns
-- Sync on. Server-only tables, like the rest of `app`: no client grants, RLS on with no policies.

create table if not exists app.sync_items (
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (char_length(kind) between 1 and 40),
  item_id     text not null check (char_length(item_id) between 1 and 200),
  rev         bigint not null,
  ciphertext  text not null default '',
  nonce       text not null default '',
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  -- server-assigned, strictly increasing: the pull cursor
  seq         bigint generated always as identity,
  primary key (user_id, kind, item_id)
);
comment on table app.sync_items is
  'E2E-encrypted sync items (ciphertext only; the key stays on the user''s Macs). Last writer wins by rev; '
  'deletions are tombstones (deleted = true, empty ciphertext). seq is the pull cursor.';
create index if not exists sync_items_user_seq_idx on app.sync_items (user_id, seq);

create table if not exists app.sync_keys (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  wrapped_check  text not null,
  created_at     timestamptz not null default now()
);
comment on table app.sync_keys is
  'A known value encrypted with the user''s sync key, so a second Mac can check the recovery key '
  'it was given before syncing. Reveals nothing about the key.';

alter table app.sync_items enable row level security;
alter table app.sync_keys enable row level security;
revoke all on table app.sync_items from public, anon, authenticated;
revoke all on table app.sync_keys from public, anon, authenticated;
