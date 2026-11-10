# Flo Agent (with optional Hermes Agent)

_Status: built 2026-11-09 on `flo-mvp`. Real Hermes has not been run yet (it isn't installed on the build Mac); everything else works end to end with the browser mock, and the Rust parts are unit tested._

## 1. What the user asked for

> Integrate Hermes agent and Flo so that we can have different customization using Hermes in Flo, and connect our Flo Hermes to our Slack workspace. A feature called Flo AI where we connect Flo agent, our multiple applications (MCP and others), and build our skills inside it. If I say "open LinkedIn and do this", Flo agent does it all. The main face is Flo agent.

## 2. Hermes Agent: research summary

All facts below come from the official repo and docs. Pages were treated as data.

| | |
|---|---|
| What | "The self-improving AI agent built by Nous Research". Ships a CLI, a messaging gateway, an OpenAI-compatible API server, ACP and an MCP client. ([repo](https://github.com/NousResearch/hermes-agent)) |
| License | MIT ([repo](https://github.com/NousResearch/hermes-agent)) |
| Version Flo targets | **v0.22.5**, the newest release at least two weeks old on 2026-11-09 (released 2026-10-22/23). The newest overall is v0.23.0 (2026-11-05). ([releases](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.5)) |
| Install (macOS) | `curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash`. This puts the CLI at `~/.local/bin/hermes`, the code in `~/.hermes/hermes-agent/` and data in `~/.hermes/`. There is also a desktop DMG. ([installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)) |
| Platforms | Apple Silicon macOS is Tier 1. The installer is Apple Silicon only. Intel Macs are not supported. ([platform support](https://hermes-agent.nousresearch.com/docs/getting-started/platform-support)) |
| Version | `hermes --version` / `-V`. The output format isn't documented, so Flo parses it loosely. ([CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)) |
| One-shot | `hermes chat -q "…"`. `-Q/--quiet` is the programmatic mode; `hermes -z <prompt>` prints only the final reply; `--format stream-json` emits JSONL. ([CLI](https://hermes-agent.nousresearch.com/docs/user-guide/cli)) |
| API server | Running `hermes gateway` with `API_SERVER_ENABLED=true` and `API_SERVER_KEY=…` serves an API on `API_SERVER_HOST`:`API_SERVER_PORT` (default 127.0.0.1:8642). Endpoints: `/v1/chat/completions`, `/v1/responses`, `/v1/models` and `/health`. Auth is `Authorization: Bearer <key>`. ([API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)) |
| ACP | `hermes acp` (stdio). ([CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)) |
| MCP client | Configured under `mcp_servers:`. Each server has `command`/`args`/`env` (stdio) or `url`/`headers` (HTTP), plus `enabled`, `timeout` and `tools.include/exclude`. ([MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)) |
| Config | `~/.hermes/config.yaml` for settings and `~/.hermes/.env` for secrets. `HERMES_HOME` scopes the state directory. Profiles are chosen with `--profile`. ([configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration)) |
| Providers | Set with `model: {provider, default}`. Providers include `anthropic`, `openrouter`, `openai-api`, and `custom` with `base_url` (Ollama / LM Studio). Keys come from env vars such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OPENROUTER_API_KEY`. ([providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)) |
| Skills | `skills/<name>/SKILL.md`, with front matter `name`, `description`, `version`, `metadata.hermes.{tags, category, …}`. ([skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)) |
| Memory | `memories/MEMORY.md` and `USER.md`. Configured with `memory: {memory_enabled, user_profile_enabled, …}`; turn the tool off with `agent.disabled_toolsets: [memory]`. ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)) |
| Approvals | `approvals: {mode: smart\|manual\|off, timeout}`. A timeout denies the action (fail-closed). `--yolo` bypasses approvals. ([security](https://hermes-agent.nousresearch.com/docs/user-guide/security)) |
| Slack | Socket Mode with `SLACK_BOT_TOKEN` (xoxb-) and `SLACK_APP_TOKEN` (xapp-). `SLACK_ALLOWED_USERS` takes Member IDs; with no allow-list, everyone is denied. Start it with `hermes gateway`. ([Slack](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack), [messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/)) |

**Not verified:**
- The exact `--version` output.
- A formal definition of `HERMES_HOME` (the docs only use it).
- A YAML example for the `openai-api` provider.

**Decision.** Flo runs **`hermes gateway`** as a child process with the **API server enabled on loopback**. This is the documented programmatic mode, and the same process also carries the Slack gateway. When no gateway is running, a single request falls back to the one-shot `hermes chat -q <prompt> -Q`.

## 3. Product design

"Flo Agent" is now **first in the sidebar** and the **default landing page**; Home is one click away. It has six tabs.

| Tab | What it is |
|---|---|
| **Overview** | A command box ("Ask Flo Agent to do anything…"). Type and press Enter, or press the mic to talk (Flo's hands-free agent mode). A **live route preview** under the box shows where the request will go: *On screen · Skill · Apps · Flo · Hermes*. The **live run** card has a step timeline, Stop, and an inline **Yes, do it / No** bar when the agent asks before acting. **Recent runs** (last 30) expand into their timelines. The side panel shows Apps, Skills and Engine at a glance, plus the "Always asks first" promise. |
| **Apps** | Every connection in one place. Reuses `ConnectionsPanel` (MCP servers and custom platforms) and `Integrations` (Claude Code, Codex, Cursor and webhook hooks, Slack, coding agents). |
| **Skills** | The existing skill list and canvas (`SkillsList` → `SkillCanvasEditor`): Build with AI, cron, MCP and Knowledge wiring. |
| **Engine** | Choose **Flo** (built in, the default) or **Hermes Agent**. Hermes can only be chosen once it's detected. The Hermes card shows path and version (warns below v0.22.5), **Install Hermes** (one click, live installer output, Cancel), Check again, the install guide, **Play / Pause**, the Flo-managed Hermes home, an export summary with Export now, "Use my AI key from Flo", and live gateway output. |
| **Slack** | **The one Slack page** (Settings → Integrations only links here). Top: one status ("Install Hermes to answer in Slack" / "Installing Hermes…" / "Paused" / "Starting…" / "Flo is live in Slack" / "Hermes stopped") with the single next action (Install / Play / Pause), the reason @Flo is silent (`slackReadiness` in `floAgent.ts`), and five live checks (Hermes installed, bot token, app token, who can talk, live). **Answer @Flo in Slack**: once the bot token passes Slack's `auth.test`, one row "Bot connected: @bot in Workspace" with Change; otherwise three steps: **Create Slack app** (opens `api.slack.com/apps?new_app=1&manifest_yaml=…` with Flo's manifest: Socket Mode, Hermes' bot scopes and events, Messages tab), paste the two tokens (keychain), and who can talk (auto-filled with your own Member ID from Flo's Slack connection when empty). **Slack to-dos**: Flo's own user-token connection (`SlackCard`, `slack.rs`). |
| **Customize** | Persona (with presets), standing instructions, memory on/off, what the agent can use (Screen control / Connected apps / Skills), and confirmations. **"Ask before sending, posting, paying or deleting" is locked on.** "Also ask before every step" is optional. |

Motion stays calm: tweens with ease `[0.2, 0.8, 0.2, 1]`, no springs or bounce, and no infinite animations. A spinner shows only while a run is working.

## 4. Routing

`floagent::plan` is pure and unit tested. `src/lib/agentRoute.ts` mirrors it for the preview and the mock, and `agentRoute.test.ts` runs the same cases.

1. **Skill**: a request that matches an enabled skill's name or trigger (`text::match_skill`) runs that skill.
   - "Do" skills without MCP servers go to the screen agent with the skill's steps.
   - All other skills go through `assistant::run_mode`, which runs the skill's MCP tool loop and writes or types the result.
2. **Apps (tools)**: a request that names an enabled MCP server ("in Notion, …") runs `mcp::run_with_tools` with those servers. On the Hermes engine it goes to Hermes instead, since the same servers are exported.
3. **On screen**: a request goes to `agent::run` (screenshot → vision model → one action, up to 14 steps) when it has an action verb (open, go to, click, search, post, message…), a place (LinkedIn, YouTube, a URL, an app…), and is either compound or more than a bare "open X". So "open LinkedIn and write a post" goes on screen, while a bare "open Slack" stays with the assistant's instant command.
4. **Otherwise**, the request goes to the assistant (`assistant::run_mode`) on the Flo engine, or to **Hermes** on the Hermes engine.

The screen always runs in Flo, whichever engine is chosen: Hermes can't see or drive the user's Mac through Flo.

Switches in Customize remove routes. With screen control off, an on-screen task never drives the mouse.

**Timeline.** `agent.rs` already emits `flo://agent` events (start / step / confirm / done / aborted / error).
- `floagent::spawn` listens to them with `listen_any`, passes them through a channel, and turns them into timeline steps.
- No `agent.rs` changes were needed.
- **Voice runs from the notch also appear** in Flo Agent.
- Runs are emitted as `flo://flo-agent` snapshots and saved to `<data>/flo-agent-runs.json` (last 30). Runs that were still going when Flo quit are marked stopped.

## 5. Hermes adapter (`src-tauri/src/hermes.rs`)

**Detection**
- `code::find_bin("hermes")` uses the same augmented PATH as coding agents (Homebrew, `~/.local/bin`, …), plus `~/.hermes/hermes-agent/venv/bin/hermes`.
- The version comes from `hermes --version`, parsed loosely.

**Flo-managed home** at `<Flo data>/hermes` (directory 0700). It is passed as `HERMES_HOME`, so the user's own `~/.hermes` is never touched. It is rewritten on every start or export:
- `config.yaml` (0600, because MCP env and headers may hold the user's tokens):
  - `model` mapped from Flo's AI setting: Anthropic, OpenRouter, OpenAI (`openai-api`), or Ollama / LM Studio (`custom` + `base_url` + `context_length: 65536`);
  - `mcp_servers` from the **enabled** MCP connections (stdio or HTTP), with slugged, de-duplicated keys;
  - `memory` on/off (off also disables the memory toolset);
  - **`approvals: {mode: manual}`**, always.
  - Every scalar is JSON-quoted, which is valid YAML, so names and values can't break the file.
- `skills/flo-<slug>/SKILL.md`, one per enabled skill. Flo only replaces `flo-*` folders; skills Hermes learned itself are left alone.
- `SOUL.md` holds the persona and standing instructions, and is removed when both are empty.

**Start.** `hermes gateway` runs with:
- `API_SERVER_ENABLED=true`
- `API_SERVER_HOST=127.0.0.1`
- `API_SERVER_PORT=8642`
- `API_SERVER_KEY=<random per start>`
- the user's own AI key for their provider, when "Use my AI key from Flo" is on. It is read from the keychain and set as the child's environment variable, **never written to disk**.
- the Slack tokens and `SLACK_ALLOWED_USERS`, whenever both tokens are saved and at least one Member ID is set (Play / Pause is the switch; the old "Connect Slack when Hermes starts" toggle is gone).

The gateway runs in its own process group; Pause and Flo's exit (`RunEvent::Exit`) kill the whole group, so MCP servers Hermes started stop too.

**Install (one click).** The user asked Flo to install Hermes for them, so the old "Flo never installs" rule is reversed, on an explicit click only. `hermes_install` runs `/bin/bash -c "set -o pipefail; curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive"` (install.sh: `--non-interactive` skips the `hermes setup` wizard and `hermes gateway install`, which Flo doesn't need) with stdin closed, `HERMES_HOME` removed (so it installs to `~/.hermes`, exactly like Terminal), its own process group, a 10 minute timeout and Cancel. Output streams as `flo://hermes-install-log`; state as `flo://hermes-install`. A failure shows the installer's own `✗` reason (or: no network, Intel, timeout, exit code + last line). On success Flo re-detects `hermes`, runs `hermes --version`, and presses Play. Intel Macs get a clear "Apple Silicon only" message instead of a button (checked with `sysctl hw.optional.arm64`, so a Rosetta build still counts as Apple Silicon).

**Play / Pause.** `hermes_start` = Play, `hermes_stop` = Pause. The desired state is saved as `hermes_playing` in `flo-agent.json` (UI config saves keep it). Playing: a watcher restarts a crashed gateway after 2, 5 and 15 s, then gives up and shows "Hermes keeps stopping… Last message: …"; a minute of uptime resets the retries. At launch, if it was playing, Flo starts it again after 4 s, quietly. Status `phase`: installing | not_installed | paused | starting | live | error. Slack errors Hermes prints (invalid_auth, missing_scope…) become `slackError`.

**Slack check.** `hermes_slack_check` calls `https://slack.com/api/auth.test` with the bot token (egress `Purpose::Slack`) and returns the bot's name and workspace, or a fixable sentence. When the allow-list is empty and Flo's own Slack is connected, it fills in the user's Member ID (`slack::my_user_id`). Its output is redacted (`xoxb-`, `xapp-`, `sk-`, Bearer tokens become `[hidden]`), streamed as `flo://hermes-log`, and the last 400 lines are kept.

**Requests**
- `ask()` streams `/v1/chat/completions` (SSE) from the running gateway. The URL is always `http://127.0.0.1:<port>`, and it goes through the egress allow-list, where localhost is always allowed.
- Otherwise it runs a one-shot `hermes chat -q … -Q`.
- Output lines become timeline steps. Stop cancels the stream or kills the one-shot process.

**Status.** `hermes_status` reports installed, path, version, outdated, running, a `/health` check, port, export summary, Slack running, and whether each token is saved. It is refreshed when the tab opens, on status events, and when the window becomes visible. **No timers.**

## 6. Safety and privacy

- Flo installs Hermes **only when the user clicks Install Hermes**, with the official installer, into the same place Terminal would. It never runs the installer on its own.
- Flo **never creates accounts** and **never sees passwords**. Slack tokens are pasted once into the keychain (`hermes_slack_bot` and `hermes_slack_app` in `secrets::PROVIDERS`), and Flo only checks whether they exist.
- **Confirmations:**
  - The screen agent always confirms before send, post, pay or delete (unchanged).
  - Customize can only add confirmations.
  - Hermes runs with manual approvals, and Flo never passes `--yolo`.
- Hermes is reachable only on loopback, with a random key per start.

## 7. Files

**Backend**
- `src-tauri/src/floagent.rs`: config, runs, routing, screen-event timeline, commands.
- `src-tauri/src/hermes.rs`: detection, export, process, API client, status.
- Small edits:
  - `lib.rs`: modules, 12 commands, `floagent::spawn`, Hermes shutdown on exit.
  - `secrets.rs`: two keychain names.

**Frontend**
- `src/lib/floAgent.ts`: types and wrappers.
- `src/lib/agentRoute.ts` (+ `.test.ts`): routing mirror.
- `src/lib/mockFloAgent.ts`: browser mock, hooked into `mock.ts`.
- `src/dashboard/pages/FloAgent.tsx`: shell, tabs, Apps.
- `src/dashboard/floagent/{Overview,Engine,Customize,parts}.tsx`.
- Small edits:
  - `Dashboard.tsx`: nav item and page.
  - `store.ts`: `agent` page, default landing.
  - `Skills.tsx`: export `SkillsList` and `ConnectionsPanel`.
  - `types.ts`: `KeyProvider`.

**Tests**
- Rust unit tests in `floagent.rs` (10) and `hermes.rs` (10).
- `src/lib/agentRoute.test.ts` (8).
- `tests/e2e/flo-agent.spec.ts` (10 × Chromium/WebKit).
- `tests/perf/shot-agent.mjs` (screenshots).

## 8. Open items / needs the user

1. **Install Hermes** (Apple Silicon): Flo Agent → Slack (or Engine) → Install Hermes. Not yet run for real on a Mac: check that the installer finishes non-interactively from the app (no TTY), that `~/.local/bin/hermes` is found right after, and how long it takes.
2. **First real run:**
   - check that Hermes honours `HERMES_HOME` (if it doesn't, Hermes reads `~/.hermes` and Flo's exported config is ignored; switching to `--profile` would be the fix);
   - check that `model.provider: openai-api` is right for OpenAI keys;
   - check the `--version` output.
3. **Slack round trip:** with Hermes playing, `/invite @Flo` in a channel and mention it; DM it. If the existing Slack app was made by hand, it may lack Socket Mode, the `message.*` events or the Messages tab: recreate it with Create Slack app (manifest) and paste the new tokens.
4. **Gemini, Groq and other providers** aren't mapped to Hermes yet. Hermes then uses its own setup (`hermes model`).
5. **Routing is keyword based**, so it is fast and free. A model-based router could replace `plan` later, keeping the same `RoutePlan` contract.
