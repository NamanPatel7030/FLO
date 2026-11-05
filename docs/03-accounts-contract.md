# Flo accounts — contract between website, app UI and app backend

Flo stays local-first: the account only gates sign-in and downloads. Dictation, notes, to-dos,
screen text and keys never leave the Mac. The app talks to exactly one account host (egress guard).

## Website (Next.js, `website/`)
Env: `AUTH_SECRET` (random 32+ bytes), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `DATABASE_URL`
(`file:./flo.db` locally; `libsql://…` Turso in prod) + `DATABASE_AUTH_TOKEN`, `SITE_URL`,
`NEXT_PUBLIC_DOWNLOAD_MAC`, `NEXT_PUBLIC_DOWNLOAD_WINDOWS`, `NEXT_PUBLIC_DOWNLOAD_LINUX` (URLs).

Pages: `/` landing · `/signup` · `/login` · `/download` (requires session → else `/signup?next=/download`)
· `/app/connect?state=…` (signs in if needed, then hands a code to the app) · `/privacy` · `/terms`.

Auth: Auth.js v5 — Credentials (email + password, bcrypt) and Google. Same user table for both
(Google sign-in with an email that already has a password links to it).

### App API (JSON)
| Method | Path | Body / headers | 200 response | Errors |
|---|---|---|---|---|
| POST | `/api/app/login` | `{email, password}` | `{token, user}` | 401 `{error}` |
| GET | `/api/app/me` | `Authorization: Bearer <token>` | `{user}` | 401 |
| POST | `/api/app/handoff` | `{state}` (needs website session) | `{code}` (one-time, 5 min) | 401 |
| POST | `/api/app/exchange` | `{code, state}` | `{token, user}` | 400/401 |

`user = {id, email, name, image?}`. `token` = JWT HS256 signed with `AUTH_SECRET`, claims
`sub, email, name, iat, exp` (30 days).

Google from the app: app opens `${SITE_URL}/app/connect?state=<random>` in the browser → website signs
the user in (Google or password) → calls `/api/app/handoff` → redirects to
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
