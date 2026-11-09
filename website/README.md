# Flo website

Marketing site + account server for the Flo desktop app (Next.js). Handles sign-up, login
(Google first, email/password second; Supabase Auth), the gated download page, and the app sign-in handoff.

## The flow it implements
1. Visitor reads the landing page, signs up (`/signup`) or logs in (`/login`).
2. Signed in, they reach `/download` and get the installer.
3. The app opens its sign-in gate. "Continue with Google" (or email/password) authenticates
   against this site; `/app/connect` issues a one-time code the app exchanges for a token
   (`/api/app/exchange`) and opens `flo://…` to finish automatically.

## Run locally
```bash
cd website
cp .env.example .env.local      # Supabase URL + anon key, DATABASE_URL, AUTH_SECRET (openssl rand -base64 32)
npm install
npm run dev                     # http://localhost:3000
```
The app already points at `http://localhost:3000` by default, so local dev needs no app change.

## Deploy (Vercel + Supabase)
Full walkthrough: [`docs/supabase-setup.md`](../docs/supabase-setup.md).
1. **Supabase:** run `supabase/migrations/0001_init.sql` in the SQL editor; set Auth URL configuration
   (Site URL + `/auth/callback` redirect URLs), email confirmations, and the Google provider.
2. **Vercel:** root = `website/`; set every key from `.env.example`
   (`SITE_URL=https://flo.hellonaman.com`, Supabase URL + anon key, `DATABASE_URL` = transaction pooler,
   `AUTH_SECRET`), deploy.
3. **Point the app at it:** build the app with `FLO_ACCOUNT_URL=https://flo.hellonaman.com`
   (or set `accountUrl` in Settings). Only then is sign-in enforced; with the default empty/localhost
   value the app stays offline-first and never blocks dictation.
4. **Download links:** once installers are published, set `DOWNLOAD_MAC/WINDOWS/LINUX` (server-only).

## Tests
```bash
npx tsc --noEmit && node --test tests/auth-logic.test.mjs           # no server or database needed
# integration: a local Postgres the dev server also uses (DATABASE_URL in .env.development.local)
export FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test
node --test tests/migration.test.mjs     # applies supabase/tests/supabase-stub.sql + the migration
node --test tests/mobile-api.test.mjs && node tests/slack-routes.mjs && node check-console.cjs
```
