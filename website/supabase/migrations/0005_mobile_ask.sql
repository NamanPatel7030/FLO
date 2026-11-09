-- Phone → Mac requests: "Ask Flo" and "Dictate" from the Android app.
--
-- The phone records speech on the device (Android speech recognition), then queues the text here.
-- The paired Mac picks pending requests up (it polls while signed in), runs them with the user's
-- own assistant (or saves the to-do / note), and posts the answer back, which also lands in the
-- phone's inbox. Server-only like the rest of `app`: no client grants, RLS on with no policies.
create table if not exists app.mobile_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references app.mobile_devices (id) on delete set null,
  mode        text not null check (mode in ('ask', 'todo', 'note')),
  text        text not null check (char_length(text) between 1 and 2000),
  status      text not null default 'pending' check (status in ('pending', 'taken', 'done', 'failed')),
  answer      text check (answer is null or char_length(answer) <= 4000),
  created_at  timestamptz not null default now(),
  taken_at    timestamptz,
  done_at     timestamptz
);
comment on table app.mobile_requests is
  'Ask / Dictate requests from a paired phone, answered by the user''s Mac. Kept 7 days.';
create index if not exists mobile_requests_user_status_idx on app.mobile_requests (user_id, status, id);
alter table app.mobile_requests enable row level security;
revoke all on table app.mobile_requests from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
