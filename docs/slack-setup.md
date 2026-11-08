# One-click Connect Slack: one-time setup

Flo users connect Slack with one button (Settings → Integrations → **Connect Slack**). For that to work,
whoever runs the Flo website creates **one** Slack app and gives the website its Client ID and Secret.
It takes about a minute, and you only do it once. After that, every Flo user just clicks Connect Slack.

Until the keys are set, Connect Slack opens `<SITE_URL>/slack/setup`. That page lists the missing keys
and prints the manifest below with your URL already filled in.

## 1. Create the Slack app from the manifest (≈1 min)

1. Open <https://api.slack.com/apps?new_app=1> → **From a manifest** → pick any workspace you own.
2. Paste [`website/slack-app-manifest.yml`](../website/slack-app-manifest.yml). Replace
   `https://flo.example.com` with your `SITE_URL` (no trailing slash), or copy the version printed on
   `/slack/setup`. For local testing, add `http://localhost:3000/api/slack/callback` as a second redirect URL.
3. Click **Create**.

The app only asks for **user** scopes, so it acts as the person who clicks Connect and never as a bot:
`channels:history groups:history im:history mpim:history im:read users:read search:read chat:write`.
These are the scopes `src-tauri/src/slack.rs` uses. Keep them in sync with `SLACK_USER_SCOPES` in
`website/lib/slack.ts`.

## 2. Give the website the keys

In the app's **Basic Information → App Credentials**, copy the Client ID and Client Secret:

```bash
# website/.env.local (local) or your host's environment (production)
SLACK_CLIENT_ID=1234567890.1234567890
SLACK_CLIENT_SECRET=…
```

`AUTH_SECRET` and `SITE_URL` must also be set (they already are if sign-in works). `AUTH_SECRET` derives
the key that encrypts tokens during the hand-off.

## 3. Let other workspaces connect

In **Manage Distribution**, click **Activate Public Distribution**. Without this, only members of the
workspace that owns the app can connect. Slack requires an `https://` redirect URL for this step.
Listing the app in the Slack Marketplace is not needed.

## 4. Deploy

Restart `npm run dev`, or redeploy the website. Then click **Connect Slack** in Flo.

---

## How it works (and why the token never stays on our server)

```
Flo (Mac)                          Flo website                              Slack
─────────                          ───────────                              ─────
verifier = random, kept in memory
POST /api/slack/start {challenge = sha256(verifier)}  (+ Flo account bearer if signed in)
                        ──▶ one-time state (10 min)
opens /api/slack/install?state ──▶ checks state, sets an HttpOnly state cookie
                                   ──▶ slack.com/oauth/v2/authorize?user_scope=…&state
                                                                user clicks Allow
                                   /api/slack/callback?code&state ◀──
                                   state must match the cookie and is burned (single use)
                                   oauth.v2.access (client secret) ──▶ authed_user.access_token
                                   token sealed with AES-256-GCM under a one-time handoff code (5 min)
                                   ──▶ /slack/connected ("Slack connected — you can close this tab")
flo://slack?code=<handoff> ◀────── page opens the deep link
POST /api/slack/claim {code, verifier} ──▶ code + sha256(verifier) (+ same account) must match,
                                           works once, row deleted, token returned
token → macOS keychain (secrets "slack"). From then on Flo talks only to slack.com.
```

- **CSRF:** the state is issued by the server, used once, expires after 10 minutes, and is pinned to the
  browser that started the flow with an HttpOnly, SameSite=Lax cookie.
- **Intercepted deep links:** another app could register `flo://`, but the handoff code is useless without
  the verifier. The verifier never leaves the Mac until the claim, and then only over TLS to our own
  account host. A forged `flo://slack` link can't cancel a real flow either, because Flo clears its
  verifier only after a successful claim.
- **At rest:** the token is held only as an encrypted blob for at most 5 minutes, and is deleted the
  moment it's claimed. It is never logged.
- **Rate limits:** start, install, callback and claim are each limited per IP.
- **Disconnect** in Flo deletes the keychain entry. It can also call Slack's `auth.revoke`, so the token
  stops working everywhere.

Advanced users can still paste their own `xoxp-` user token (Settings → Integrations → Slack →
*Advanced: paste a token*). That path needs no website at all.

### Testing

- `cd website && node tests/slack-routes.mjs` runs against the dev server on :3000 with no real Slack calls.
  It covers the setup page, state validation, and claim single-use, expiry and account binding.
- `npx playwright test tests/e2e/slack.spec.ts` tests the desktop UI against the mock backend.
- `cd src-tauri && cargo test --release --lib slack` tests deep-link parsing and PKCE.
