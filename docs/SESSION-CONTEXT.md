# Flo — complete project & session context (handoff)

_Last updated: 2026-11-09 · GitHub: https://github.com/NamanPatel7030/FLO (branch **`flo-mvp`**, the default) ·
local worktree `~/Flo/.claude/worktrees/flo-mvp` (local branch `worktree-flo-mvp`, remote name `flo`) ·
live website: **https://flo.hellonaman.com** (Vercel)_

This file captures everything built and decided in the Claude Code build session that ran from
2026-11-05 to 2026-11-09 (100 commits), so a new session can continue without the old conversation.
**Start with §0. It lists exactly what to do next.**

---

## 0. NEXT SESSION: do this first (Supabase is connected there)

**Context:**
- The website was ported to **Supabase Auth (Google first) + Supabase Postgres** (commit `b49c7c1`) and deployed.
- The code is done and tested locally. **The real Supabase project is not wired up yet**, so sign-in on the live site shows "Supabase isn't configured".

**Supabase project:**
- Name: **FLO** (production).
- Ref: **`dnncbcjsuhugrflvyrco`**.
- URL: `https://dnncbcjsuhugrflvyrco.supabase.co`.
- Google provider: **already enabled** by the user (Authentication → Providers → Google).
- The user said they also set the URL configuration. Verify it in step 3.

**Vercel:**
- Project **`flo`** in team `namanpatel7030s-projects` (Hobby). The CLI is logged in as `namanpatel7030`.
- The domain `flo.hellonaman.com` is attached and DNS works (GoDaddy CNAME `flo` → `14938e3471a9ccf3.vercel-dns-017.com`).
- Production env vars set so far: `SITE_URL`, `AUTH_SECRET` (generated; keep it), `NEXT_PUBLIC_SUPABASE_URL`.

**MCP servers:**
- `supabase` and `vercel` are added at **user scope** (`claude mcp add --scope user …`).
- A project-scoped `supabase` server pinned to the FLO ref lives in the repo's `.mcp.json`.
- Approve it and authenticate via `/mcp` if asked.

### Steps
1. **Check the connection:** confirm the Supabase MCP tools are loaded and that `list_projects` shows `dnncbcjsuhugrflvyrco`.
2. **Apply the migration:** run `website/supabase/migrations/0001_init.sql` with the Supabase MCP `apply_migration` (name `0001_init`), or `execute_sql` if needed. It's idempotent.
   - Then `list_tables` for schemas `public` and `app`, and expect:
     - `public.profiles`;
     - `app.handoffs`, `app.slack_states`, `app.slack_handoffs`, `app.presence`, `app.mobile_devices`, `app.pair_codes`, `app.notifications`.
   - Run `get_advisors` (security) and fix anything it flags.
   - **Do not** add `app` to the exposed API schemas.
   - Never run `website/supabase/tests/supabase-stub.sql` on the real project. It's a local test stand-in.
3. **Auth settings:**
   - Site URL: `https://flo.hellonaman.com`.
   - Redirect URLs: `https://flo.hellonaman.com/auth/callback**` and `http://localhost:3000/auth/callback**`. The wildcard matters because the site appends `?next=`.
   - Email confirmations on.
   - Google enabled; its Google Cloud OAuth client must have redirect URI `https://dnncbcjsuhugrflvyrco.supabase.co/auth/v1/callback` and a **published** consent screen.
   - If the MCP can't read or change auth config, ask the user to confirm it in the dashboard.
4. **Keys for Vercel** (from `website/`, with `npx vercel env add <NAME> production`, value piped on stdin):
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the publishable/anon key (public). Get it with the Supabase MCP `get_publishable_keys`.
   - `DATABASE_URL`: the **Transaction pooler** string (port 6543). **It contains the DB password: the user must add it themselves.** Give them exactly: `!cd website && npx vercel env add DATABASE_URL production`. Never ask for the password in chat.
   - Remove obsolete vars if present: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `DATABASE_AUTH_TOKEN`, `NEXT_PUBLIC_DOWNLOAD_*`.
5. **Redeploy** from `website/` with `npx vercel deploy --prod --yes`. `NEXT_PUBLIC_*` vars are baked in at build time, so a redeploy is required.
6. **Test live** on https://flo.hellonaman.com:
   - Google sign-in end to end (the user clicks; never enter credentials).
   - A row appears in `public.profiles`.
   - `/download` works when signed in.
   - `/api/download/mac` redirects signed-out visitors to `/signup?next=…`.
   - Desktop handoff: `/app/connect?state=x` → sign in → one-time code.
   - `node check-console.cjs` against production, or a quick Playwright pass.
7. **Point the Mac app at production.**
   - `src-tauri/src/model.rs` `Settings.account_url` defaults to `option_env!("FLO_ACCOUNT_URL").unwrap_or("http://localhost:3000")`. Change the default to `https://flo.hellonaman.com`, so account sign-in and the **in-app updater** (`{account_url}/api/updates/...`) use the live server.
   - Rebuild with `bash scripts/install-mac.sh`. The app's sign-in screen leads with "Continue with Google", which opens the browser.
   - Then do a real update test: `bash scripts/release-mac.sh 0.1.1 "notes"` writes `website/releases/latest.json` and `website/public/releases/<v>/…`.
   - **Note:** `website/.vercelignore` currently excludes `releases/` and `public/releases/`. Decide how to host release files (remove those lines for a real release, or set `RELEASE_BASE_URL` and host the `.tar.gz` on GitHub Releases or Supabase Storage).
8. **Before launch (advise the user):**
   - Custom SMTP in Supabase Auth: the built-in mailer is heavily rate-limited.
   - A published Google consent screen.
   - Optionally rename the GitHub branch `flo-mvp` → `main`.

### Other open items, in priority order
1. **Notch hover still "has issues"** (user report).
   - Fixed so far: springs and bounce removed, icon jump mid-open, sideways jump (window now resized and moved in one native `setFrame` call).
   - Still needed: the user never described the remaining problem. Ask for a screen recording (⌘⇧5) or a description.
2. **Keychain prompt after every new build or update** freezes startup until answered. macOS keys "Always Allow" to the exact build when the app isn't signed with an Apple Developer ID. **The user must choose:**
   - **1:** read the key off the main thread behind an "Unlock" screen (recommended).
   - **2:** store the key in a 0600 file.
   - **3:** get an Apple Developer ID later.

   The key is read in `src-tauri/src/lib.rs` setup → `secrets::db_key` (`src-tauri/src/secrets.rs`).
3. **Hermes:** the user's install is half-finished. `~/.local/bin/hermes` points at a missing `~/.hermes/hermes-agent/venv`. Flo now shows "Install incomplete". The user should re-run `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`, then use Flo Agent → Engine → Check again → Start. First real run, verify:
   - Hermes honours `HERMES_HOME`;
   - the provider id `openai-api` is correct;
   - the `--version` output parses.
4. **Live checks the user hasn't confirmed yet:**
   - The YouTube "search" Do-skill: the screen agent was fixed to hide Flo's card from screenshots, let clicks pass through it, wait for page loads and retry failed steps.
   - Music thumbnail plus play/pause through media keys.
5. **The full feature audit was stopped by the user.** Only `contract_tests.rs` and the meeting-note links landed.
6. **Launch extras:**
   - Slack app: `/slack/setup` has a one-click "Create Flo's Slack app"; set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` on Vercel.
   - Firebase for push: `mobile/google-services.json` and `FCM_SERVICE_ACCOUNT(_FILE)`.
   - Android APK: `cd mobile && npx eas-cli@25.3.0 login && npm run android:apk`.
   - Installer URLs: `DOWNLOAD_MAC`, `DOWNLOAD_WINDOWS`, `DOWNLOAD_LINUX` (server-only).

---

## 1. What Flo is
**Flo** is a local-first, bring-your-own-key voice assistant that lives in the MacBook **notch**
(macOS first; the Windows and Linux backends exist but have never been built or run on those OSes).

- **Maker:** Naman Gundaniya, *Forward Deployed Engineer*: "I'm the human. AI is my leverage. Together, we build anything." · https://hellonaman.com
- **Commit identity:** `NamanPatel7030 <namandeveloper7030@gmail.com>`. All 100 commits are authored this way; the repo-local git config is set.
- **Core promise:**
  - Hold a key and talk: Flo types it, drafts, remembers and reminds.
  - Whisper speech-to-text on the Mac.
  - Cloud AI only with the user's own key, through a visible network allow-list.

### Repository layout
| Path | What |
|---|---|
| `src-tauri/` | Rust backend (Tauri 2): STT, assistant, screen agent, Flo Agent (`floagent.rs`), Hermes (`hermes.rs`), Claude Code hooks, auto-continue, MCP, Slack, meetings, scheduler, updater, push relay, media |
| `src/` | React 19 + Vite + Tailwind v4 + motion: `src/island` (notch window), `src/dashboard` (app window) |
| `src/lib/mock.ts` (+ `mock*.ts`) | Browser mock backend for Playwright and the `localhost:5190` dev preview |
| `tests/e2e/` | Playwright (Chromium + WebKit) · `tests/perf/` screenshot / hover / idle / trace probes |
| `website/` | Next.js 15: marketing site, Supabase Auth + Postgres backend, update server, mobile/presence/push API, Slack OAuth broker, gated downloads |
| `mobile/` | Flo for Android (Expo SDK 58): pairs by QR, presence toggle, push inbox |
| `scripts/` | `install-mac.sh`, `sign-mac.sh`, `release-mac.sh`, `set-version.py`, `write-release-manifest.py`, `setup-signing.sh`, `mcp-test-server.py` |
| `docs/` | `supabase-setup.md`, `03-accounts-contract.md`, `flo-agent.md` (Hermes research and design), `mobile-api.md`, `slack-setup.md`, this file |

---

## 2. Architecture (key facts)

**Windows and motion**
- The island is a non-activating NSPanel; the dashboard is a normal window, destroyed on close.
- The island is resized and moved in **one native `setFrame` call** (`platform::set_frame_atomic`), so the notch never jumps.
- Notch motion is tween ease-out only: no springs or bounce. Tray icons are anchored to the camera.

**Speech and AI**
- whisper-rs, large-v3-turbo model, Metal GPU; adaptive language detection between English, Hindi and Gujarati; repeat-loop guards.
- Anthropic raw HTTP (`anthropic-version: 2026-10-21`); the user's model is `claude-haiku-5-5`.
- Also OpenAI-compatible providers, Gemini, Ollama and LM Studio.

**Network and data**
- **Egress allow-list** (`egress.rs`): every request declares a `Purpose`, and the network log shows it. Host classes: Local, Provider, ModelHub, Weather, Artwork (`i.ytimg.com` and `i.scdn.co`), the Account host, and MCP hosts.
- App database: SQLCipher, key in the macOS Keychain (see §0, item 2).

**Agents and integrations**
- **Claude Code:** Stop, Notification, UserPromptSubmit and SessionEnd hooks, plus a synchronous PermissionRequest (Allow/Deny from the notch). Usage-limit auto-continue with `claude --resume` (no permission bypass).
- **MCP:** stdio and Streamable HTTP, plus a tool-use loop so skills can call MCP tools.
- **Screen agent** (`agent.rs`): screenshot → vision model → one action (open_app, open_url, click, type, key, scroll, wait, confirm, done).
  - Flo's card is hidden from screenshots and clicks pass through it.
  - Up to 14 steps; up to 3 failed steps in a row are retried.
  - Every step is logged to `~/Library/Logs/Flo/flo.log`.
  - Always asks before send, post, pay or delete.
- **Flo Agent** (`floagent.rs` + `src/dashboard/pages/FloAgent.tsx`), the main screen and default landing page. Its command box routes each request:
  - on-screen tasks → the screen agent;
  - a named MCP server → the tool loop;
  - a matching skill → the skill runner;
  - everything else → the assistant, or Hermes when Hermes is the engine.
- **Hermes** (`hermes.rs`): detects the binary and runs `--version` (a broken install is reported as "Install incomplete"). It exports Flo's MCP servers and skills to a Flo-managed `HERMES_HOME`, runs `hermes gateway` on loopback with a random API key, and passes keys through process env only.

**Now Playing**
- A JXA helper under `/usr/bin/osascript` reads the system Now Playing.
- Controls use hardware media keys, falling back to the MediaRemote command.
- Artwork: the YouTube tab's thumbnail, or Spotify's cover.

**Signing and updates**
- Signing: a stable local identity "Flo Local Signing" (`~/.flo-signing/`).
- Updater: Tauri, with an ed25519 key at `~/.flo-signing/updater.key`, outside the repo.

**Website**
- **Auth:** Supabase Auth via `@supabase/ssr`. Cookie sessions refreshed in `middleware.ts`; `/auth/callback` exchanges the code (open-redirect guard); `/auth/forgot` and `/auth/reset`.
- **Database:** Postgres through `postgres@3.4.9` on the transaction pooler (`prepare:false`).
- **Desktop contract unchanged:** `/api/app/login`, `/api/app/handoff`, `/api/app/exchange`, `/api/app/me`, and the `flo://auth?code&state` deep link. App tokens are website JWTs signed with `AUTH_SECRET`.
- **Downloads:** `/api/download/<os>` requires sign-in; file URLs come from server-only env vars.
- **Updates:** `/api/updates/{target}/{arch}/{version}` returns 204 or a signed manifest.

---

## 3. Feature catalog (all committed and pushed)

### Dictation & assistant
- Push-to-talk (Control dictates and fn asks, by default) and hands-free mode; instant transcription on release.
- **Drafts:** "draft / write / reply …" types the result into the focused field, using a screenshot for context.
- **Assistant:** Go deeper and web search; marks to-dos done from natural language.
- **Dictionary learning:** a "Sorry, my mistake, updating X to Y" notch card with Undo.

### Notch
- One hover opens one large panel: quick actions (Dictate, Ask, Agent, Meeting, History, Open, Customize, Active/Away) plus the widget grid.
- **Widgets:** Now Playing (any app, real thumbnails), Today's to-dos, Claude sessions, Quick note, Stopwatch, Pomodoro, Clock with time zones, Weather.
- **Cards:** results, answers, reminders (Done / Snooze), Claude finished, and the Claude **permission** card (project · tool · app · wait time · Open · Allow/Deny · queue).
- **Customization:** size Small/Big/Bigger/Biggest, 15 animations, accent colour everywhere, per-cue sounds.
- Meeting call detection ignores Flo's own microphone use (Agent mode, dictation).

### Productivity
- **To-dos:** due dates from words, Reminders/Upcoming, Details, bulk actions, delete on hover.
- **Projects:** clients, auto-filing, and **Code** (clone a GitHub repo or link a folder; Edit with AI via Claude Code, Codex or Gemini).
- **Skills:**
  - canvas editor, custom platforms, MCP servers, Knowledge docs;
  - Build/Refine with AI;
  - Schedule (cron) with Run now;
  - Do-mode runs through the screen agent.
- **Meetings:** two-track capture, on-device speakers (sherpa-onnx), rename to remember a voice, "Owner: task" items saved as linked to-dos.
- **Claude auto-continue:** resumes a session after its usage limit resets.

### Account, presence, phone
- Sign-in screen (Google + email); Active / Away (with auto-away on lock or idle).
- Pair an Android phone by QR. Push notifications go out while Away and never while Active.
- **Android app** in `mobile/`.

### Integrations & platform
- **Slack:** one-click Connect (OAuth broker with an encrypted, single-use handoff); to-dos from DMs and mentions; send by voice with confirmation.
- **In-app updates:** Update → progress → Restart, verified with ed25519; released with `scripts/release-mac.sh`.
- **Flo Agent + Hermes:** see §2.
- **Settings and About:** Account+General and Appearance+Notch merged; a golden-ratio About page.
- **Avatars:** 52 designs of Naman; each screen shows its own, and clicking the portrait cycles through all of them.

### Website (https://flo.hellonaman.com)
- **Hero:** notch-centred, with dictated headline and illustrated cards. The fake macOS menu bar was removed on user request.
- **Content:** 14 story chapters, plus "Everything Flo does" (25 tiles).
- **Navigation:** a notch-twin "chin" dock; a light/dark/system theme switch.
- **Download button:** solid platform dropdown, rendered in a portal above everything.
- **Favicon:** the **real Flo app icon** (from `src-tauri/icons/icon.png`).
- **Pages:** maker card with cycling avatars; Google-first login/sign-up; downloads gated behind sign-in.

---

## 4. Infrastructure status

| Piece | Status |
|---|---|
| GitHub | `NamanPatel7030/FLO`, branch `flo-mvp` (default). `gh` is logged in as NamanPatel7030 with `repo` and `workflow` scopes. The pre-rewrite history is kept locally as `backup/pre-author-rewrite`. |
| Vercel | Project `flo` (Hobby, `namanpatel7030s-projects`), root `website/`. `website/.vercelignore` excludes local DBs, test releases and dev scripts. Production deploys **ready** at https://flo.hellonaman.com. |
| Domain | `flo.hellonaman.com`: GoDaddy CNAME → `14938e3471a9ccf3.vercel-dns-017.com` ✔ (HTTPS live) |
| Vercel env (prod) | `SITE_URL` ✔, `AUTH_SECRET` ✔, `NEXT_PUBLIC_SUPABASE_URL` ✔. **Missing:** `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, plus later `SLACK_*`, `FCM_*`, `DOWNLOAD_*` |
| Supabase | Project FLO `dnncbcjsuhugrflvyrco`, Google enabled. **Migration not yet applied** (see §0) |
| MCP | `supabase` and `vercel` at user scope (both showed ✔ Connected); project `.mcp.json` pins Supabase to the FLO ref. The Vercel CLI is logged in. |
| Mac app | Installed at `/Applications/Flo.app` (latest build includes the Flo Agent and Hermes fixes). Account URL still defaults to localhost (§0 step 7). |

---

## 5. How to run, test, build, release
```bash
# app preview (browser + mock backend)
npx vite --port 5190                    # http://localhost:5190/?nh=38&nw=200#/island  or  /#/agent
# website
cd website && npx next dev -p 3000      # never run `next build` while dev runs
# tests
cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --release --lib     # 269 passed
npx tsc --noEmit && npx vitest run                                          # 159 passed
npx playwright test --workers=3 --trace=off                                 # 216 passed (chromium + webkit)
cd website && npx tsc --noEmit && node check-console.cjs && node --test tests/auth-logic.test.mjs
#   integration tests (migration / mobile-api / slack-routes) need FLO_TEST_DATABASE_URL to a LOCAL postgres
cd mobile && npx tsc --noEmit && npx jest                                    # 35 passed
# Mac app
bash scripts/install-mac.sh                                                 # build + stable-sign + install
bash scripts/release-mac.sh 0.2.0 "What's new"                              # publish an update
# website deploy
cd website && npx vercel deploy --prod --yes
```
**Logs:** `~/Library/Logs/Flo/flo.log`.

**Probes:**
- `tests/perf/shot-states.mjs`: every notch state.
- `tests/perf/trace-open.mjs`: icon positions per frame.
- `tests/perf/idle-probe.mjs`: idle cost.
- `website/shot-*.cjs`: website screenshots.

---

## 6. Performance (installed app, idle)

| | Before | After |
|---|---|---|
| Total CPU | ~17 % | ~2–5 % |
| Notch WebKit content | ~10 % | ~0 % |
| Flo main process | | 0–4 %, ~90–110 MB |

Avatars are WebP, about 464 KB in the app.

---

## 7. Security & privacy rules followed
- Never type or handle third-party credentials. The user enters passwords and tokens: the DB password goes via `vercel env add`; Hermes and Slack tokens go into Flo's keychain UI.
- The update key and signing keychain stay outside the repo. `.gitignore` covers `.env*`, release artifacts, `google-services.json` and service accounts.
- A secret scan of every file and every commit was clean before each push.
- Supabase: RLS on every table; the `app` schema has no client grants; the server uses the direct Postgres connection.
- No permission-bypass flags anywhere. The screen agent confirms before send, post, pay or delete.
- The updater is https-only. The localhost exception was blocked by the safety checks and not applied.

---

## 8. Timeline (100 commits)
- **11-05, foundation:**
  - Tauri scaffold; dictation, assistant, meetings, Claude hooks.
  - Signing; hands-free; tests; Linux backend; Slack; account sign-in; onboarding; first websites.
- **11-06, depth:**
  - Vault; Now Playing; STT fixes; reminders; screen agent; widgets; drafts into the focused field.
- **11-07, breadth:**
  - Instant transcription; honest "finished" status; dictionary learning; deadlines; Notch tab; projects.
  - Skills plus canvas; MCP; Allow/Deny; website story.
- **11-08, platform:**
  - Accent colour; meeting speakers; MCP runtime; hands-free agent; Build with AI and cron; Projects code.
  - In-app updates; Android app; one-hover panel; one-click Slack; sign-in redesign; presence and push; auto-continue.
  - Gated downloads; media keys and thumbnails; calm notch motion; light theme; atomic frame; screen-agent fixes.
  - Avatars; **pushed to GitHub**.
- **11-09, launch work:**
  - Agent mode no longer seen as a call; **Flo Agent + Hermes**; dropdown fix and menu bar removed.
  - Broken-Hermes detection; Flo favicon; **Supabase Auth + Postgres**; **Vercel deploy at flo.hellonaman.com**.

Full list: `git log --reverse --oneline`.

---

## 9. User preferences
- Pixel-perfect, smooth, premium; **no bounce**; one hover shows everything; no extra clicks.
- Very **lightweight** (CPU and memory are watched).
- End-to-end working and tested, not mock-only. Self-test before delivering, using screenshots.
- No em dashes in app copy.
- **Google is the main login.**
- Commits as NamanPatel7030; push to `NamanPatel7030/FLO`.
- No Apple Developer account for now.
- Prefers Claude to do things itself and only asks for what truly needs the user (logins, passwords, dashboard clicks).
