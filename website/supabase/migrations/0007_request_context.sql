-- Phone Ask: the phone's screen as context, and answers from the cloud while the computer is off.
--
-- context: what was visible on the phone when the user held Ask in the Flo voice bubble (visible
--   text only, never password fields, never sent with Dictate), so "how should I reply to her?" is
--   answered from the conversation on screen. Capped at 6000 characters; deleted with the request
--   after 7 days like the rest of the row.
-- answered_by: 'computer' (the user's signed-in desktop app) or 'cloud' (the server answered with
--   cloud AI because the computer was offline). Null while unanswered.
-- cloud_tried_at: when the server claimed the request for a cloud answer, so it tries only once.
--
-- Server-only like the rest of `app`: RLS stays on with no policies, no client grants.
alter table app.mobile_requests
  add column if not exists context text check (context is null or char_length(context) <= 6000);
alter table app.mobile_requests
  add column if not exists answered_by text check (answered_by is null or answered_by in ('computer', 'cloud'));
alter table app.mobile_requests
  add column if not exists cloud_tried_at timestamptz;
