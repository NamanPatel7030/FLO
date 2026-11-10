# One-click Connect Google: one-time setup

Flo users connect Google Calendar and Gmail with one button (Settings → Integrations → **Connect Google**).
It works like Connect Slack: the Flo website brokers the OAuth flow and hands the tokens to the desktop
app, which keeps them in the system keychain. Whoever runs the Flo website creates **one** Google Cloud
OAuth client and gives the website its Client ID and Secret, once.

Until the keys are set, Connect Google opens `<SITE_URL>/google/setup`. That page lists the missing keys
(names only, never values) and shows the exact redirect URI for this site.

Production site: `https://flo.hellonaman.com`.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/projectcreate>, name it (for example `Flo`), and create it.
   Make sure it's selected in the project picker at the top.

## 2. Enable the APIs

1. **APIs & Services → Library**.
2. Search **Google Calendar API** → **Enable**.
3. Search **Gmail API** → **Enable**.

## 3. OAuth consent screen

**APIs & Services → OAuth consent screen** (in the newer console this is **Google Auth Platform →
Branding / Audience / Data Access**).

1. User type: **External**.
2. App name: `Flo`. User support email: your address. Developer contact: your address.
3. App domain: home page `https://flo.hellonaman.com`, privacy policy and terms URLs on the same domain.
4. Authorized domains: `hellonaman.com`.
5. Scopes (**Data Access → Add or remove scopes**), add exactly these:
   - `openid`
   - `.../auth/userinfo.email` (shown as `email`)
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`

   These match `GOOGLE_SCOPES` in `website/lib/google-logic.ts`. A user can connect Calendar only, Gmail
   only, or both; Flo always asks for `openid email` so it can show which account is connected.
6. **Audience → Test users**: while the app's publishing status is **Testing**, only test users can
   connect. Add each person's Google address (up to 100).

   > Google expires refresh tokens for apps in Testing after **7 days**. Test users will see "Reconnect
   > Google" in Flo once a week until the app is published and verified (see below).

## 4. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Google Auth Platform →
Clients → Create client**).

1. Application type: **Web application**. Name: `Flo website`.
2. Authorized redirect URIs:
   - `https://flo.hellonaman.com/api/google/callback`
   - `http://localhost:3000/api/google/callback` (local development only)

   The URI must match `<SITE_URL>/api/google/callback` exactly (no trailing slash). `/google/setup` prints
   the one this server computes.
3. No JavaScript origins are needed. Click **Create** and copy the Client ID and Client Secret.

## 5. Give the website the keys

In Vercel → the website project → **Settings → Environment Variables**, add both for **Production** and
**Preview**:

```bash
GOOGLE_OAUTH_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
```

Locally, put the same two lines in `website/.env.local`. `AUTH_SECRET` and `SITE_URL` must also be set
(they already are if sign-in works). `AUTH_SECRET` derives the key that encrypts tokens during the hand-off.

Then **redeploy** (env changes only apply to new deployments), or restart `npm run dev`.

## 6. Apply the migration

Run `website/supabase/migrations/0010_google.sql` against the Supabase database (SQL editor or your usual
migration path). It creates `app.google_states` and `app.google_handoffs`, private like the rest of the
`app` schema (RLS on, no policies, no grants to `anon` / `authenticated`). It is safe to run twice.

Then click **Connect Google** in Flo.

---

## Verification (before launching to the public)

While the app is in **Testing**, up to 100 test users can connect, and each sees Google's "Google hasn't
verified this app" warning (they click **Continue**). To let anyone connect:

- **`calendar.readonly`** and **`gmail.send`** are **sensitive** scopes: publishing needs Google's OAuth
  app verification (brand review, a privacy policy on `hellonaman.com`, a demo video of how each scope is
  used). No security assessment.
- **`gmail.readonly`** is a **restricted** scope: on top of verification it needs an independent
  **CASA security assessment** (Cloud Application Security Assessment), renewed **every year**.
- An unverified app that's switched to **In production** keeps showing the warning and is capped at
  **100 users** in total.
- Plan: launch Calendar first (sensitive only), and add Gmail after the CASA assessment, or keep Gmail
  limited to test users until then.

Verification is requested from **Google Auth Platform → Verification Center** once the consent screen,
domain ownership (Search Console) and privacy policy are in place.

## How it works (and why tokens never stay on our server)

```
Flo (your computer)                Flo website                               Google
───────────────────                ───────────                               ──────
verifier = random, kept in memory
POST /api/google/start {challenge = sha256(verifier), scopes: ["calendar","gmail"]}  (+ Flo bearer if signed in)
                        ──▶ one-time state (10 min), remembers the products asked for
opens /api/google/install?state ──▶ checks state, sets an HttpOnly state cookie (Path=/api/google)
                                   ──▶ accounts.google.com/o/oauth2/v2/auth
                                       ?scope=openid email …&access_type=offline&prompt=consent
                                        &include_granted_scopes=true&state
                                                                 user clicks Allow
                                   /api/google/callback?code&state ◀──
                                   state must match the cookie and is burned (single use)
                                   oauth2.googleapis.com/token (client secret) ──▶ refresh + access token, id_token
                                   email read from the id_token; tokens sealed with AES-256-GCM
                                   (HKDF info "flo/google-handoff/v1") under a one-time handoff code (5 min)
                                   ──▶ /google/connected ("Google connected. You can close this tab.")
flo://google?code=<handoff> ◀───── page opens the deep link
POST /api/google/claim {code, verifier} ──▶ code + sha256(verifier) (+ same account) must match,
                                            works once, row deleted
   ◀── {refreshToken, accessToken, expiresIn, scope, email}
tokens → keychain. Flo calls Calendar and Gmail directly from your computer.

about once an hour:
POST /api/google/refresh {refresh_token}  (Flo bearer required)
                                   ──▶ oauth2.googleapis.com/token (grant_type=refresh_token, client secret)
   ◀── {access_token, expires_in, scope?}           nothing stored, nothing logged
```

- **Why refresh goes through the website:** Google needs the client secret to refresh a token, and the
  secret must never ship inside the desktop app. `POST /api/google/refresh` uses the refresh token for that
  one call and forgets it. It needs a signed-in Flo desktop session (401 otherwise), is rate-limited
  (60 per hour per account, 120 per hour per IP), and answers `400 {"error":"invalid_grant"}` when Google
  says access was revoked or expired, so Flo can show "Reconnect Google". If the desktop isn't signed in
  to Flo it uses the access token until it expires, then asks you to sign in.
- **CSRF:** the state is issued by the server, used once, expires after 10 minutes, and is pinned to the
  browser that started the flow with an HttpOnly, SameSite=Lax cookie.
- **Intercepted deep links:** the handoff code is useless without the verifier, which never leaves your
  computer until the claim (over TLS, to our own server).
- **At rest:** tokens exist on the server only as an encrypted blob for at most 5 minutes, deleted the
  moment they're claimed. They are never logged. If someone unticks both Calendar and Gmail on Google's
  screen, the website revokes the token straight away and shows "Nothing to connect".
- **Disconnect** in Flo revokes the token at `https://oauth2.googleapis.com/revoke` directly from your
  computer and deletes the keychain entries. People can also remove Flo at
  <https://myaccount.google.com/permissions>.
- **Phone:** only the next three meetings' title, start, end, attendee count and whether there's a join
  link reach the phone (through the computer's snapshot). No email content and no attendee names.

### Testing

- `cd website && node --test tests/google-logic.test.mjs` tests scopes, the authorize URL, token parsing
  and the refresh body (no network).
- `FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/google-migration.test.mjs`
  checks the migration against a **local** Postgres.
- `FLO_TEST_DATABASE_URL=… node tests/google-routes.mjs` runs against the dev server on :3000 with no real
  Google calls: setup page, start validation, state CSRF and single use, claim single use, expiry and
  account binding, refresh auth.
