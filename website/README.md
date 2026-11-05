# Flo website

Marketing site + account server for the Flo desktop app (Next.js). Handles sign-up, login
(email/password + Google), the gated download page, and the app sign-in handoff.

## The flow it implements
1. Visitor reads the landing page, signs up (`/signup`) or logs in (`/login`).
2. Signed in, they reach `/download` and get the installer.
3. The app opens its sign-in gate. "Continue with Google" (or email/password) authenticates
   against this site; `/app/connect` issues a one-time code the app exchanges for a token
   (`/api/app/exchange`) and opens `flo://…` to finish automatically.

## Run locally
```bash
cd website
cp .env.example .env.local      # fill AUTH_SECRET (openssl rand -base64 32) + Google keys
npm install
npm run dev                     # http://localhost:3000
```
The app already points at `http://localhost:3000` by default, so local dev needs no app change.

## Deploy (Vercel + Turso)
1. **Database:** `turso db create flo` → put its URL in `DATABASE_URL` and a token
   (`turso db tokens create flo`) in `DATABASE_AUTH_TOKEN`. Tables auto-create on first use.
2. **Google OAuth:** add `https://YOURDOMAIN/api/auth/callback/google` as an authorized redirect URI.
3. **Vercel:** import the repo (root = `website/`), set every key from `.env.example`
   (`SITE_URL=https://YOURDOMAIN`), deploy.
4. **Point the app at it:** build the app with `FLO_ACCOUNT_URL=https://YOURDOMAIN`
   (or set `accountUrl` in Settings). Only then is sign-in enforced; with the default empty/localhost
   value the app stays offline-first and never blocks dictation.
5. **Download links:** once installers are published (GitHub Releases), set
   `NEXT_PUBLIC_DOWNLOAD_MAC/WINDOWS/LINUX`.
