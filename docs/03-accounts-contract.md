# Flo accounts — contract between website, app UI and app backend

Flo stays local-first: the account only gates sign-in and downloads. Dictation, notes, to-dos,
screen text and keys never leave the Mac. The app talks to exactly one account host (egress guard).

## Website (Next.js, `website/`)
Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL` (Supabase transaction
pooler), `AUTH_SECRET` (random 32+ bytes; signs app tokens), `SITE_URL`, `DOWNLOAD_MAC/WINDOWS/LINUX`
(server-only). Setup: `docs/supabase-setup.md`.

Pages: `/` landing · `/signup` · `/login` · `/download` (requires session → else `/signup?next=/download`)
· `/app/connect?state=…` (signs in if needed, then hands a code to the app) · `/auth/callback` (Supabase
email links + Google) · `/auth/forgot` · `/auth/reset` · `/privacy` · `/terms`.

Auth: Supabase Auth. Google is the primary sign-in; email + password (with email confirmation, resend
and password reset) is the secondary path. Website sessions are Supabase cookies (`@supabase/ssr`,
refreshed by `middleware.ts`). Account ids are Supabase user uuids; `public.profiles` holds
name/avatar (`supabase/migrations/0001_init.sql`). `/api/app/login` checks the password with
Supabase server-side and returns Flo's own app token, so the desktop contract below is unchanged.
Supabase links Google and email sign-ins with the same verified email to one user.

### App API (JSON)
| Method | Path | Body / headers | 200 response | Errors |
|---|---|---|---|---|
| POST | `/api/app/login` | `{email, password}` | `{token, user}` | 401 `{error}` (wrong password, or "Confirm your email first…"), 429, 503 |
| GET | `/api/app/me` | `Authorization: Bearer <token>` | `{user}` | 401 |
| POST | `/api/app/handoff` | `{state}` (needs website session) | `{code}` (one-time, 5 min) | 401 |
| POST | `/api/app/exchange` | `{code, state}` | `{token, user}` | 400/401 |

`user = {id, email, name, image}` (`id` = Supabase user uuid, `image` may be null). `token` = JWT HS256 signed with `AUTH_SECRET`, claims
`sub, email, name, iat, exp` (30 days).

Google from the app: app opens `${SITE_URL}/app/connect?state=<random>` in the browser → (signed out)
`/login?next=/app/connect?state=…` → Continue with Google → Supabase → Google → `/auth/callback?next=…`
(PKCE code exchange, cookie session) → back on `/app/connect` → calls `/api/app/handoff` → redirects to
`flo://auth?code=<code>&state=<state>` and ALSO shows the code with a Copy button (manual fallback).
App calls `/api/app/exchange`.

## App backend (Rust) — Tauri commands
- `account_status() -> {signedIn, user?, accountUrl, offline}` (offline = token cached but server unreachable)
- `account_login({email, password}) -> user`
- `account_google_start() -> {state}` (opens the browser)
- `account_exchange({code, state?}) -> user` (manual paste or deep link)
- `account_logout()`
- event `flo://account` → `{signedIn, user?}` when the deep link completes sign-in
- `Settings.accountUrl` (default: build-time `FLO_ACCOUNT_URL`, else `http://localhost:3000`)
- Token stored in the Keychain (`account-token`); cached user in settings for offline start.

## Onboarding (app UI)
Gate: if `!signedIn` → Sign-in screen (email/password, "Continue with Google", "Create account" link
to `${accountUrl}/signup`). After sign-in, if `!settings.onboarded` → onboarding:
1. About you — name, role (developer, founder, designer, student, sales, writer, other),
   what you'll use Flo for (multi-select: emails, Slack/WhatsApp, coding prompts, docs, notes, meetings),
   languages (English, Hindi, Gujarati, Hinglish, other), apps you live in.
2. Personalise — derive system prompt + dictionary seeds + suggested shortcuts (shown, editable).
3. Permissions (live).
4. Voice model (download / cloud key).
5. Demos (interactive, live): Hold ⌃ → dictate into a demo text box; ⌃+Space hands-free;
   Hold fn → ask "what's on my screen"; tray demo (fake Claude session); meeting detection preview.
6. Done → `onboarded = true`.
