# Supabase setup for the Flo website

The website (`website/`, deployed on Vercel at https://flo.hellonaman.com) uses **Supabase Auth** for
accounts (Google first, email + password second) and **Supabase Postgres** for its server data.

| Piece | Where |
|---|---|
| Schema | `website/supabase/migrations/0001_init.sql` |
| Server data layer | `website/lib/db.ts`, `website/lib/mobile.ts` (direct Postgres, `DATABASE_URL`) |
| Auth clients | `website/lib/supabase/{server,client,env}.ts`, session refresh in `website/middleware.ts` |
| Auth pages | `/login`, `/signup`, `/auth/callback`, `/auth/forgot`, `/auth/reset` |
| Desktop app contract | `docs/03-accounts-contract.md` (unchanged: `/api/app/*` + `flo://auth`) |

## 1. Project

The production project is **FLO**. (For a fresh one: supabase.com → New project, pick the region
closest to Vercel's (e.g. `us-east-1` for Vercel `iad1`), and save the database password in your password
manager. It's needed for `DATABASE_URL`.)

## 2. Run the migration

Dashboard → **SQL Editor** → New query → paste all of `website/supabase/migrations/0001_init.sql` → Run.
Or with the CLI from `website/`: `npx supabase@<version> link --project-ref <ref>` then `npx supabase db push`.

It is idempotent (safe to run again). It creates:

- `public.profiles` (id = `auth.users.id`, email, name, avatar_url, timestamps). A trigger on `auth.users`
  creates the row from sign-up metadata (`name`/`full_name`, `avatar_url`/`picture`) and keeps the email
  in sync. RLS is on: a signed-in user can read and update only their own row (name and avatar only).
  Existing users are backfilled.
- Schema **`app`** (server only): `handoffs`, `slack_states`, `slack_handoffs`, `presence`,
  `mobile_devices`, `pair_codes`, `notifications`. RLS on with no policies, and no privileges for
  `anon`/`authenticated`. Every row cascades away when its user is deleted.

Checks afterwards:
- **Settings → API → Exposed schemas**: keep it `public` (and `graphql_public`). **Do not add `app`.**
- **Advisors → Security**: should report nothing for these tables.
- Table Editor → `profiles`: sign up once and a row appears.

## 3. Auth settings

**Authentication → URL Configuration**
- Site URL: `https://flo.hellonaman.com`
- Redirect URLs (the site appends `?next=…`, so use the wildcard forms):
  - `https://flo.hellonaman.com/auth/callback**`
  - `http://localhost:3000/auth/callback**`

**Authentication → Sign In / Providers → Email**
- Email provider: enabled. **Confirm email: on.** Secure email change: on.
- Minimum password length 8 (the forms ask for 8). Optional: leaked-password protection (Pro plan).

**Authentication → Sign In / Providers → Google** (already enabled on FLO)
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → *Web application*.
   - Authorized JavaScript origins: `https://flo.hellonaman.com`, `http://localhost:3000`
   - Authorized redirect URI: **`https://<project-ref>.supabase.co/auth/v1/callback`**
     (Supabase shows the exact value on the Google provider page). The site's own `/auth/callback` is
     *not* entered at Google; Supabase redirects there afterwards.
   - OAuth consent screen: app name Flo, support email, `hellonaman.com` as an authorized domain, scopes
     `email`, `profile`, `openid`. Publish it (otherwise only test users can sign in).
2. Paste the Client ID and Client Secret into the Supabase Google provider and save.

Google and email sign-ins with the same verified address end up as the same Supabase user.

**Email templates (recommended).** The default links use PKCE, which only completes in the browser that
asked for the email. To make confirmation and reset links work from any device (e.g. opened on a phone),
change these templates under Authentication → Emails:
- Confirm signup: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm your email</a>`
- Reset password: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>`

`/auth/callback` handles both `?code=` and `?token_hash=&type=`.

**SMTP.** Supabase's built-in mailer is rate-limited (a few emails an hour) and meant for testing.
For production set up custom SMTP (Resend, Postmark, SES…) under Authentication → Emails → SMTP, with
sender `Flo <no-reply@hellonaman.com>`.

**Rate limits.** Authentication → Rate Limits: the defaults are fine. The site also limits
`/api/app/login` per IP + email.

## 4. Environment variables (Vercel → Project → Settings → Environment Variables)

| Key | Value |
|---|---|
| `SITE_URL` | `https://flo.hellonaman.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key or publishable key `sb_publishable_…` (Settings → API) |
| `DATABASE_URL` | Connect → **Transaction pooler**: `postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| `AUTH_SECRET` | `openssl rand -base64 32` (keep the old value if one exists: changing it signs out every desktop app and voids paired-phone tokens) |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | see `docs/slack-setup.md` |
| `FCM_SERVICE_ACCOUNT` | Firebase service account JSON (see `docs/mobile-api.md`) |
| `DOWNLOAD_MAC`, `DOWNLOAD_WINDOWS`, `DOWNLOAD_LINUX` | installer URLs (server-only) |

Remove the old `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `DATABASE_AUTH_TOKEN` (NextAuth/Turso). Redeploy
after changing `NEXT_PUBLIC_*` (they are inlined at build time).

The service-role key is **not** used by the site. Don't add it to Vercel.

Notes on `DATABASE_URL`:
- Use the **transaction** pooler (port 6543): serverless functions open many short connections.
  `lib/db.ts` sets `prepare: false`, which that mode requires.
- It connects as the `postgres` role, which owns the `app` tables (RLS doesn't apply to owners). It never
  reaches the browser.

## 5. How the flows work

- **Google (main):** `/login` or `/signup` → Continue with Google → Supabase → Google →
  `https://<ref>.supabase.co/auth/v1/callback` → `/auth/callback?next=…&code=…` → session cookie → `next`.
- **Email sign-up:** `/signup` → Sign up with email → "Check your email to confirm" (Resend email) →
  link → `/auth/callback` → signed in → `next`.
- **Email sign-in:** wrong password and unconfirmed email get their own messages; unconfirmed shows a
  "Resend confirmation email" button.
- **Forgot password:** `/auth/forgot` → email → link → `/auth/callback?next=/auth/reset…` → new password.
- **Desktop app, Google:** Flo opens `/app/connect?state=<random>` → (signed out) `/login?next=…` → Google
  → `/auth/callback` → `/app/connect` → one-time code → `flo://auth?code=…&state=…` → app calls
  `/api/app/exchange` → Flo app token (30 days).
- **Desktop app, email:** the app posts to `/api/app/login`; the site checks the password with Supabase
  and returns the same Flo app token.
- **Downloads:** `/download` and `/api/download/<os>` need a signed-in session, else `/signup?next=…`.

## 6. Verify after deploying

1. https://flo.hellonaman.com/signup → Continue with Google → you land on `/download` signed in; a row
   exists in `public.profiles` with your name and picture.
2. Sign out → Sign up with email → confirmation email arrives → link signs you in.
3. `/auth/forgot` → reset email → new password works.
4. In the Flo app, Continue with Google → browser → Flo opens signed in.

## Local development

`.env.local` with the same keys. `SITE_URL=http://localhost:3000`. Without the Supabase keys the pages
still render and auth actions say "Supabase isn't configured". Integration tests run against a local
Postgres with a Supabase stand-in (`website/supabase/tests/supabase-stub.sql`); see `website/README.md`.
Never run the stub against a real project.
