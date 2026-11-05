# Wispr Flow & Lemon — Reverse-Engineering Report

Date: 2026-11-05. Method: read-only static inspection of the installed bundles
(`/Applications/Wispr Flow.app` v1.6.1376, `/Applications/Lemon.app` v1.5.21):
Info.plist, entitlements, ASAR contents, `strings` on binaries, Application Support layout
(file names/sizes only). Neither app was launched or modified. Embedded keys were noted, not extracted.
The `morluto/rea` MCP toolkit automates exactly this kind of analysis (ASAR/Electron, native
binaries, SQLite) and can be used for deeper follow-ups (`npx rea-agents setup`).

## 1. Feature map (corrects a few assumptions)

| Capability | Wispr Flow | Lemon (HeyLemon) |
|---|---|---|
| Dictation (hold key → clean text pasted) | ✅ core product | ✅ (free, unlimited) |
| Assistant / command on selected text | ✅ **Command Mode** + "Instruct Mode" (Pro) | ✅ rewrite/edit selected text |
| Agent that *does* tasks across apps | partial — MCP/Composio connections, "ChatGPT computer use" bridge | ✅ **Agent Mode**: backend plan → open app / AppleScript / write content |
| Screen understanding | screenshots for "extensions" + AX tree | ScreenCaptureKit screenshots → `/api/edit/context`, `/api/memory/extract` |
| Memory / personalization | dictionary, transcript corrections | local memory graph w/ embeddings, vocabulary engine, edit tracking |
| Meeting notetaker | ✅ (Zoom/Meet/Teams/Slack huddle detection, system-audio tap) | ✅ (templates) |
| Wake word | ❌ | ✅ "Hey Lemon" (on-device ONNX) |
| Passive to-do extraction ("attention") | ❌ | ❌ (memory extraction exists, no to-do inbox) |
| BYOK | ❌ | ❌ |
| Fully local / offline | ❌ | ❌ (partial on-device ASR, but cloud by default) |
| Windows | ✅ (Electron) | Mac-first |

So: **Wispr Flow does have an assistant mode (Command Mode)** — it's just narrower than Lemon's agent.
Neither product has an "attention → to-do list" feature. That is Flo Flow's differentiator.

## 2. Wispr Flow internals

- **Shell:** Electron 43 + React 18 + zustand/@zubridge, sqlite3 + sequelize (180 migrations).
  A separate **Swift helper app** does all macOS-native work and talks to Electron over
  **stdin/stdout JSON** (~90 `*Payload` message types). Tiny native module `panel_activation.node`
  makes the overlay a non-activating NSPanel (never steals focus).
- **Hotkey:** Fn captured with a **CGEventTap** (with watchdog/recovery) + **IOHID fallback**;
  detects external keyboards without Fn; checks Secure Input.
- **STT: 100% cloud.** Audio Opus-encoded (WASM) → WebSocket `wss://api.wisprflow.ai`
  (+ gRPC on Modal); endpoint discovered at runtime. Cleanup/formatting on Baseten.
  LLMs: Anthropic, gpt-oss-120b via OpenRouter/Cerebras, Gemini Flash-Lite.
- **Insertion:** clipboard + simulated ⌘V with delayed pasteboard rendering, restore clipboard
  after ~500 ms; tries direct `AXValue` set first; **verifies** paste and tracks later user edits.
  Selected text read via AX or a simulated ⌘C.
- **Context:** focused app/element via AXUIElement/AXObserver, text-box contents, AX tree as HTML,
  screenshots via desktopCapturer/ScreenCaptureKit.
- **Data:** `~/Library/Application Support/Wispr Flow/flow.sqlite` (~300 MB here) — history,
  dictionary, notes, meetings, calendar; "needs uploading" columns ⇒ synced to Supabase.
- **Telemetry:** PostHog, Segment, Sentry, Datadog.

## 3. Lemon internals

- **Shell:** fully **native Swift/SwiftUI/AppKit**, macOS 14.8+. Animations with **Rive**.
  onnxruntime + CoreML + ScreenCaptureKit + Apple Speech + WebKit.
- **On-device models (ONNX):** Silero VAD, **Smart-Turn v3.2** (end-of-turn detection),
  openWakeWord-style "Hey Lemon". WhisperKit `whisper-small` CoreML downloaded (467 MB).
- **Cloud:** `api.heylemon.ai` — live ASR WebSocket that *races* providers (Gemini, Deepgram),
  `/transcription/format|edit|editPro|respond`, `/edit/with-context`. LLMs (Gemini, OpenAI,
  Anthropic) proxied through their backend.
- **Hotkey:** CGEventTap; remaps the Globe key to "Do Nothing" in System Settings and restores it.
- **Insertion:** clipboard paste incl. RTF/HTML; **EditTracking** re-reads the field via AX to learn corrections.
- **Agent:** `AgentExecutor` runs a server-made plan (open app, osascript, write content).
- **Data:** `Application Support/Lemon/Memory/memory_v5_<uid>.db` — memory_objects, links,
  content_vectors, vocabulary, user_profile, interaction_events, **sync_outbox** (synced).
  Screenshots kept in `Images/` (32 MB here), pending audio, meeting audio.
- **Telemetry:** PostHog, Sentry, Gleap.

## 4. Pros / cons

### Wispr Flow
**Pros:** very polished, robust Fn handling (watchdog + HID fallback), paste verification and
edit learning, cross-platform via Electron, fast cloud STT with strong LLM cleanup, meeting notes.
**Cons:** cloud-only (no offline, audio leaves your machine), subscription + word caps on free,
heavy (Electron + Swift helper, ~300 MB DB), lots of telemetry, history synced to their servers,
assistant limited to selected text.

### Lemon
**Pros:** native & light, nice Rive animations, on-device VAD/turn detection/wake word, real agent
mode, memory graph with embeddings, rich-text paste.
**Cons:** cloud-proxied LLM/ASR (no BYOK), stores screenshots and syncs memory, daily task limits,
Mac-first, agent plans generated server-side (opaque), telemetry.

### Shared weaknesses → Flo Flow's opportunities
1. No BYOK, no local-only mode, no network audit.
2. Screen/memory data leaves the device.
3. Nobody turns what you see into **actionable to-dos** ("reply to X", "send Y by Friday").
4. Paywalls/limits on a feature that can run free on an M-series chip.

## 5. Patterns worth copying (re-implemented, not copied)
- Native helper for event tap / AX / paste; non-activating overlay panel.
- Fn via CGEventTap + IOHID fallback + watchdog; Secure-Input detection.
- Paste: try AXValue → clipboard+⌘V (delayed rendering) → restore clipboard → verify.
- Edit tracking after paste to learn the personal dictionary.
- Silero VAD + Smart-Turn for hands-free end-of-utterance.
- Event-driven screen capture with AX text first, OCR as fallback (also Screenpipe's approach).
