-- Reply to Claude Code sessions from the phone.
--
-- Two new phone action kinds:
--   reply   target = Claude Code session id, value = the text (at most 4000 characters) for that
--           session: an answer to its question, or the next prompt once it has finished.
--   choose  target = session id, value = {id?, answers: [[option label, ...], ...]} for a
--           multiple-choice question Claude is asking.
-- The server validates both (lib/desktop-state.ts parseAction) and the computer re-checks them;
-- the text only ever reaches Claude as a prompt, never a shell.
--
-- 0006 declared the kind check inline, so Postgres named it mobile_actions_kind_check. Re-runnable.
alter table app.mobile_actions drop constraint if exists mobile_actions_kind_check;
alter table app.mobile_actions add constraint mobile_actions_kind_check
  check (kind in ('todo_done', 'todo_reopen', 'approve', 'reject', 'setting', 'reply', 'choose'));

-- value was unbounded jsonb. 4000 characters of text is at most ~24 KB as JSON (4-byte characters,
-- escapes); a choice is far smaller. Bound it so nothing larger is ever stored.
alter table app.mobile_actions drop constraint if exists mobile_actions_value_size;
alter table app.mobile_actions add constraint mobile_actions_value_size
  check (value is null or octet_length(value::text) <= 32000);

comment on table app.mobile_actions is
  'Actions from a paired phone (to-dos, approvals, settings, replies to Claude Code sessions), applied by the user''s computer. Kept 1 day.';
