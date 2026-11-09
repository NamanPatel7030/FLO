# Flo — full project & session context

_Last updated: 2026-11-08 · branch `flo-mvp` on https://github.com/NamanPatel7030/FLO · local worktree `~/Flo/.claude/worktrees/flo-mvp` (local branch `worktree-flo-mvp`)_

This file captures everything built and decided in the Claude Code build session that started on
2026-11-05, so anyone (or any future session) can pick up exactly where it stopped.

---

## 1. What Flo is

**Flo** is a local-first, bring-your-own-key voice assistant that lives in the MacBook **notch**
(macOS first; Windows and Linux backends exist but have never been built or run on those OSes).

- **Maker:** Naman Gundaniya, *Forward Deployed Engineer*: "I'm the human. AI is my leverage. Together, we build anything." · https://hellonaman.com
- **GitHub identity used for commits:** `NamanPatel7030 <namandeveloper7030@gmail.com>`
- **Core promise:**
  - Hold a key and talk: Flo types it, drafts, remembers and reminds.
  - Speech-to-text runs on the Mac with Whisper.
  - Cloud AI only with the user's own key, through a visible network allow-list.

### Repository layout

| Path | What |
|---|---|
| `src-tauri/` | Rust backend (Tauri 2): STT, assistant, agent, Claude Code hooks, MCP, Slack, meetings, scheduler, updater, push relay… |
| `src/` | React 19 + Vite + Tailwind v4 + motion UI: `src/island` = the notch window, `src/dashboard` = the app window |
| `src/lib/mock.ts` (+ `mock*.ts`) | Browser mock backend used by Playwright e2e and the `localhost:5190` dev preview |
| `tests/e2e/` | Playwright specs (Chromium + WebKit) |
| `tests/perf/` | Screenshot / hover / idle probes |
| `website/` | Next.js 15 marketing site + account backend (Supabase Auth + Postgres, see `docs/supabase-setup.md`), update server, mobile/push API, Slack OAuth broker |
| `mobile/` | Flo for Android (Expo SDK 58), companion app for push notifications |
| `scripts/` | `install-mac.sh`, `sign-mac.sh`, `release-mac.sh`, `set-version.py`, `write-release-manifest.py`, `setup-signing.sh`, `mcp-test-server.py` |
| `docs/` | `mobile-api.md`, `slack-setup.md`, `feature-audit.md` (partial), this file |

---

## 2. Architecture (key facts)

**Windows**
- The **island** is a non-activating NSPanel at the top of the screen.
- The **dashboard** is a normal window, destroyed when closed to save memory.
- The island is resized and moved in **one native `setFrame` call**, so the notch never jumps sideways.

**Speech**
- whisper-rs, large-v3-turbo model, Metal GPU.
- Adaptive language detection between English, Hindi and Gujarati.
- Repeat-loop and garbage guards.
- Transcription starts on key release.

**AI**
- Anthropic raw HTTP (`anthropic-version: 2026-10-21`). The user's model is `claude-haiku-5-5`.
- Also OpenAI-compatible providers, Gemini, Ollama and LM Studio.
- Retries with `retry-after`.

**Network and data**
- **Egress allow-list** (`egress.rs`): every request declares a `Purpose`, and the network log shows it. Classes are Local, Provider, ModelHub, Weather, Artwork (`i.ytimg.com` and `i.scdn.co` only), Account host and MCP hosts.
- **Database:** SQLCipher. The encryption key lives in the macOS Keychain (see the known issue in §8).

**Claude Code integration**
- Hooks: Stop, Notification, UserPromptSubmit, SessionEnd and a synchronous PermissionRequest (Allow/Deny from the notch).
- Background-task-aware "finished" detection.

**Automation**
- **MCP:** stdio and Streamable HTTP clients, plus a tool-use loop so skills can call MCP tools.
- **Screen agent** (`agent.rs`): screenshot → vision model → one action (open_app, open_url, click, type, key, scroll, wait, confirm, done). Up to 14 steps; it asks before anything irreversible.

**Now Playing**
- A JXA helper under `/usr/bin/osascript` reads the system-wide Now Playing (MediaRemote).
- Controls use hardware media keys.
- Artwork comes from the YouTube tab's thumbnail or Spotify's cover.

**Signing and updates**
- **Signing:** a stable local identity "Flo Local Signing" (`~/.flo-signing/`), so macOS permissions survive rebuilds.
- **Updates:** Tauri updater with an ed25519 key at `~/.flo-signing/updater.key` (outside the repo, never committed).

---

## 3. Feature catalog (all committed and pushed)

### Dictation & assistant
- Push-to-talk (Control dictates and fn asks, by default) and hands-free mode. Transcription is instant on release.
- **Drafts:** "draft / write / reply …" types the result into the focused field, using a screenshot for context.
- **Assistant:** Go deeper, web search and Markdown answers, plus marking to-dos done from natural language.
- **Dictionary learning:** a "Sorry, my mistake, updating X to Y" notch card with Undo.

### Notch
- **Collapsed tray:** Claude sessions, to-dos and a live **music activity** (artwork + equalizer).
- **One hover opens one large panel:** quick actions (Dictate, Ask, Agent, Meeting, History, Open, Customize, Active/Away) plus the widget grid. No extra clicks.
- **Motion:** calm tween-and-ease, no springs or bounce. Tray icons are anchored to the camera, so they don't jump.
- **Widgets:** Now Playing (any app), Today's to-dos (beige, scrollable, check with a reason), Claude sessions, Quick note, Stopwatch, Pomodoro, Clock with time zones, Weather.
- **Cards:** results, answers, reminders (Done / Snooze), Claude finished, **Claude permission** (project · tool · app · wait time · Open · Allow/Deny · queue), corrections and meeting prompt.
- **Notch settings:** size Small/Big/Bigger/Biggest, 15 animations, accent colour applied everywhere instantly, and per-cue sounds (start / stop / notify).

### Productivity
- **To-dos:** due dates from words, a Reminders/Upcoming section, Details (who, where, when, conversation), bulk mark-all-done and clear, delete on hover.
- **Projects:** client details and auto-filing of captured items.
- **Code** (in Projects):
  - Clone a GitHub repo into a folder you pick, or link an existing folder.
  - The repo card shows branch, last commit and changes.
  - **Edit with AI** runs Claude Code, Codex or Gemini in Terminal, or in the background with a log you can stop.
- **Coding agents:** Settings → Integrations cards that use the provider's own CLI sign-in. Flo never sees credentials.
- **Skills:**
  - Canvas editor (drag and drop, connect, hover to delete or detach).
  - Custom platforms, multiple MCP servers and Knowledge docs.
  - **Build with AI** / Refine with AI.
  - **Schedule (cron)** with presets, a preview and Run now.
  - Do-mode runs through the screen agent.
- **Meetings:**
  - Live transcript, with two-track capture: mic = You, Core Audio process tap = Others.
  - On-device speaker diarization with sherpa-onnx CAM++; rename a speaker and the voice is remembered.
  - Summaries with "Owner: task" action items, filed as dated, linked to-dos.
- **Claude auto-continue:** detects usage-limit stops, parses the reset time and resumes with `claude --resume` (no permission bypass). Toggle in Settings plus a per-session switch.

### Account, presence, phone
- **App sign-in:** modern split-screen design, Google + email, offline-first. The website has the matching login and sign-up.
- **Active / Away:** a sidebar card, a notch tile and Settings, plus auto-away on screen lock or idle.
- **Phone pairing:** pair an Android phone by QR. While Away, short summaries go through the website to FCM. Nothing is sent while Active.
- **Android app** (`mobile/`): pair, Away/Back toggle, inbox, per-kind notification channels. 35 jest tests.

### Integrations
- **Slack:**
  - One-click **Connect Slack** (OAuth v2 user token, brokered by the website).
  - The token is handed over encrypted and single-use, protected by a verifier that never leaves the Mac.
  - Slack DMs and mentions become to-dos; sending by voice asks for confirmation first.
  - The setup page has a **Create Flo's Slack app** button with the manifest pre-filled.
- **In-app updates:**
  - Flo checks `{account_url}/api/updates/{target}/{arch}/{version}`.
  - Shows Update → progress → Restart now.
  - Every update is verified with ed25519.
  - Released with `scripts/release-mac.sh <version> "notes"`.

### App polish
- Settings merged: Account + General, Appearance + Notch.
- **About** page on the golden ratio (spiral centred on the logo, 2×2 stats).
- The 52 Naman avatar designs (see §4).

### Website (Next.js)
- **Hero:** a macOS menu bar the notch sits in, a dictated headline, and illustrated cards wired to the notch.
- **Story:** a scroll-driven notch story with **14 chapters**, plus **"Everything Flo does"**, a filterable grid of 25 features.
- **Navigation:** a notch-twin "chin" dock with All features.
- **Theme:** light theme with a System / Light / Dark switch.
- **Downloads require an account:** `/api/download/<os>` sends visitors to sign-up first; file URLs come from server-only env vars.
- **Backend routes:** account (Supabase Auth, Google first), update server, mobile/presence/push API, Slack OAuth broker.
- **Favicon:** set from `big-curl-wave-final.png`.

---

## 4. Branding assets
- **Favicon:** `website/public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `android-chrome-192/512.png`, `site.webmanifest`. All are generated from `~/Downloads/big-curl-wave-final.png`.
- **52 avatars:** `website/public/naman/*.webp` (320 px) and `src/assets/naman/*.webp` (200 px), from `hellonaman-favicons-all-52.zip` (28 ocean + 24 playful designs).
- **Per-screen designs** (`website/lib/avatars.ts`, `src/lib/avatars.ts`):

  | Screen | Design |
  |---|---|
  | Website home "Made by" | sunburst |
  | Login | octopus-hi |
  | Sign-up | hi-bubble |
  | Download | paper-boat |
  | Privacy | porthole |
  | Terms | anchor |
  | Slack setup | sticker-icons |
  | Slack connected | rainbow-arc |
  | App sidebar | big-curl-wave |
  | App About | hi-bubble |
  | App sign-in | octopus-hi |

- **Cycling:** clicking the website's "Made by" portrait or the app's About portrait cycles through all 52.
- **Not done:** using them on a blog (no blog exists in this repo; hellonaman.com's repo was not provided).

---

## 5. How to run, test, build, release

```bash
# app dev preview (browser + mock backend)
npx vite --port 5190                 # then http://localhost:5190/?nh=38&nw=200#/island  (notch) or /#/home
# website
cd website && npx next dev -p 3000   # NEVER run `next build` while dev is running
# tests
cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --release --lib   # 245 passed, 3 ignored
npx tsc --noEmit && npx vitest run                                        # 151 passed
npx playwright test --workers=3                                          # ~195 tests, chromium + webkit
cd website && npx tsc --noEmit && node check-console.cjs && node tests/slack-routes.mjs && node --test tests/mobile-api.test.mjs
cd mobile && npx tsc --noEmit && npx jest                                 # 35 passed
# build + install on this Mac (stable signing)
bash scripts/install-mac.sh
# publish an update (served by the website's /api/updates route)
bash scripts/release-mac.sh 0.2.0 "What's new"
```

**Handy probes:**
- `tests/perf/shot-states.mjs`: every notch state, plus open-animation frames.
- `tests/perf/trace-open.mjs`: icon positions per frame.
- `tests/perf/idle-probe.mjs`: idle timers and animation frames.
- `tests/perf/hover-probe.mjs`: hover smoothness.

**Log:** `~/Library/Logs/Flo/flo.log`. Screen-agent steps are logged there as "agent step N".

---

## 6. Measured performance (installed app, idle, 2026-11-08)

| | Before | After |
|---|---|---|
| Total idle CPU | ~17 % | ~2–5 % |
| Notch WebKit content + GPU | ~10 % | ~0 % |
| Flo main process | ~6 % | 0–4 %, ~90–110 MB |

**What changed:**
- No animations run while the notch is collapsed.
- The hover tracker polls by distance: 4/s far away, 30/s close, 60/s inside.
- Now Playing is event-driven.
- Avatars are WebP (464 KB in the app).

---

## 7. Security & privacy decisions
- **Credentials:** never typed or handled by Flo for third-party services. Coding-agent CLIs, Slack, Firebase and Google are all configured by the user.
- **Update key and signing keychain:** live in `~/.flo-signing/`, outside the repo. The `.gitignore` excludes release artifacts, `.env*`, `google-services.json` and service-account files.
- **Before the GitHub push:** a secret scan of all files and all 93 commits was clean. The only hit was a deliberately fake test token.
- **Commit identity:** the author was rewritten to NamanPatel7030 with `git filter-branch`. The original history is kept locally as `backup/pre-author-rewrite`.
- **Screen agent:** no permission-bypass flags anywhere; it confirms before send, post, pay or delete. `claude --resume` runs without `--dangerously-skip-permissions`.
- **Updater transport:** https-only. A localhost-http exception for local update testing was **blocked by the session's safety checks and not applied**.
- **Downloads:** need an account, and installer URLs are server-only env vars (`DOWNLOAD_MAC`, `DOWNLOAD_WINDOWS`, `DOWNLOAD_LINUX`).

---

## 8. Known issues & untested items
1. **Notch hover still has issues** (user report, 2026-11-08). The sideways jump was fixed with an atomic `setFrame`, but the user still sees problems. Next step: get a screen recording (⌘⇧5) or a description, then fix.
2. **Keychain prompt after every new build or update** freezes startup until answered. macOS keys "Always Allow" to the exact build when the app isn't signed with an Apple Developer ID. **Decision pending (1 / 2 / 3):**
   - **1:** read the key off the main thread with an "Unlock" screen (recommended).
   - **2:** store the key in a 0600 file.
   - **3:** get an Apple Developer ID later.
3. **Live update test:** blocked because the local test server is http. Can be done on the https Vercel deployment.
4. **Screen agent:** the YouTube "search" skill fix (Flo's card hidden from screenshots, clicks pass through, load waits, retries) is installed but **not yet confirmed by the user**.
5. **Music:** the thumbnail and media-key controls are installed but not yet confirmed live (nothing was playing during testing). The first artwork lookup triggers a macOS "control Google Chrome" prompt.
6. **Never built or run:**
   - Windows and Linux builds.
   - The Android APK (needs Firebase + EAS).
   - Real FCM delivery.
   - A real Slack OAuth round-trip.
   - Real Hermes.
   - Codex and Gemini background flags.
   - Core Audio tap permission flow.
   - Build-with-AI output against a real model.
   - Scheduled skills firing in the installed app.
7. **Stopped by the user (not built):**
   - **Flo Agent + Hermes Agent integration:** a "Flo Agent" main screen, a unified command box, Hermes as an optional engine, a Slack gateway.
   - **The full feature audit:** only its first fixes landed — `contract_tests.rs` plus meeting-note links.

---

## 9. Pending decisions & what the user needs to provide
- [ ] Hover issue: a screen recording or description.
- [ ] Keychain fix: choose 1 / 2 / 3.
- [ ] Supabase: create a free project "flo"? (The Supabase MCP was disconnected by the user on 2026-11-08.) Plan: Postgres replaces Turso/libsql in `website/lib/db.ts`, and Storage hosts the installers and update files; keep NextAuth with Google, or move to Supabase Auth.
- [ ] Resume Flo Agent + Hermes and the full feature audit (one at a time).
- [ ] `!npx vercel login`, then deploy `website/` with env vars: `SITE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `DATABASE_URL`/token (or Supabase), `SLACK_CLIENT_ID/SECRET`, `FCM_SERVICE_ACCOUNT(_FILE)`, `DOWNLOAD_MAC/WINDOWS/LINUX`.
- [ ] Google OAuth client. Redirect: `https://<domain>/api/auth/callback/google`.
- [ ] Slack app: use the **Create Flo's Slack app** button on `/slack/setup`, then turn on Public Distribution.
- [ ] Firebase project for push (`mobile/google-services.json` plus a server service account).
- [ ] Android APK: `cd mobile && npx eas-cli@25.3.0 login && npm run android:apk`.
- [ ] Optional: rename the GitHub default branch `flo-mvp` → `main`.

---

## 10. Timeline (95 commits)

### 2026-11-05: foundation
- Reverse-engineering report and architecture; Tauri 2 + React 19 scaffold.
- MVP:
  - notch island and glass dashboard;
  - local dictation and the assistant;
  - meetings and attention to-dos;
  - Claude Code reminders.
- Permissions, history and stable signing.
- Claude session tray; "Open" focuses the real session window.
- Meeting detection, correction learning, configurable keys, hands-free mode.
- Playwright e2e plus a real-pipeline selftest; never hang on Keychain.
- Linux backend and 3-OS CI.
- Codex/Cursor/webhook agents, Slack to-dos and confirmed send, idle CPU fix.
- Typing test.
- Providers: MiniMax, Qwen, Ollama Cloud.
- Assistant Go deeper and web search.
- Account sign-in (email/password + Google via `flo://`), offline-first.
- Onboarding; theme and notch customization; first website redesigns.

### 2026-11-06: depth
- Flo Vault knowledge graph.
- Now Playing and media/volume.
- Hallucination-on-silence fix; meeting call detection by window title; Hindi/Gujarati language lock.
- To-do reminders 5 minutes early.
- Website art-directed rebuild.
- Notch widgets and push-to-talk sound cues.
- Screen-control agent foundation; compound voice commands.
- 8 customizable widgets.
- Drafts typed into the focused field.
- "tri-tri" STT loop fix.
- Beige to-do/Claude tiles, live previews, auto-close.

### 2026-11-07: breadth
- Instant transcription and smarter screen-aware drafts.
- Honest "Claude finished"; reminder Done/Snooze.
- Correction learning shown in the notch.
- Deadlines, Reminders, Details, bulk actions.
- Notch tab (sizes, 15 animations, sounds) and a working custom colour.
- Projects with clients; per-sound customization.
- Skills, the skill canvas, custom platforms, MCP servers.
- Allow/Deny Claude permissions from the notch; delete to-dos.
- Website notch story, glass dock, interactive chapters, OS-aware download.

### 2026-11-08: platform
- Skill canvas drag and drop.
- Website notch-twin dock and a bigger notch.
- Accent everywhere, merged Settings, golden-ratio About, clock time zones.
- Meeting who-said-what.
- MCP tool runtime and the hands-free agent.
- Website dictated hero, plus every feature on the site.
- Build with AI and cron skills.
- Projects code + Edit with AI + coding agents.
- In-app updates.
- Android app.
- One-hover notch panel, live music, permission card.
- One-click Slack.
- Sign-in redesign.
- Active/Away + push.
- Claude auto-continue.
- Gated downloads.
- Media keys and real thumbnails.
- Calm notch motion; contract tests; lighter polling.
- Website light theme.
- Create-Slack-app button.
- Atomic notch frame and screen-agent fixes.
- Wave favicon and 52 avatars.
- **Pushed to GitHub** (`flo-mvp`).

Full list: `git log --reverse --oneline` (95 commits including this one).

---

## 11. User preferences observed in this session
- Wants everything "pixel perfect", smooth, attractive, premium; **no bounce** in the notch; one hover should show everything (no extra clicks).
- Wants Flo **very lightweight** (CPU and memory are watched).
- Wants features end-to-end working and tested, not mock-only; asks for self-testing before delivery.
- Prefers no em dashes in app copy (a test enforces it on Home).
- Commits are authored as NamanPatel7030; push goes to `NamanPatel7030/FLO`.
- No Apple Developer account for now (updates are self-hosted).
