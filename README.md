# Flo Flow

Local-first voice layer for macOS & Windows — an alternative to Wispr Flow + Lemon.
Lives in the **MacBook notch** (bottom-right corner on Windows). Bring your own keys, or run 100% on-device.

| Mode | How | What happens |
|---|---|---|
| **Dictation** | hold `fn` (Mac) · hold `Right Ctrl` (Win) | speech → on-device Whisper → AI cleanup → pasted where your cursor is |
| **Assistant** | hold `fn + ctrl` (Mac) · hold `Right Alt` (Win) | "Add a to-do to Apollo: send the deck Friday", "What's blocked?", "Make this shorter" (selected text), "Start meeting notes for design sync", "Open Figma" |
| **Meeting notes** | island → Meeting, tray, or ask the assistant | live transcript every ~10 s, rolling summary, final summary + action items → to-dos |
| **Attention** | Settings → Privacy (off by default) | reads the focused window on-device (Apple Vision OCR), finds "reply to X / send Y by Friday" → To-dos |
| **Claude Code** | Settings → Integrations → Connect | when a Claude Code session finishes or needs you, the notch pops a reminder |
| **Dashboard** | tray → Open, or click the island | Home, Assistant, To-dos, Projects, Notes, Analytics, History, Settings |

## Privacy model
- Everything is stored locally in an **encrypted SQLite (SQLCipher)** DB; the key lives in the macOS Keychain / Windows Credential Manager.
- **No account, no telemetry, no sync.** Every network call goes through one egress guard
  (`src-tauri/src/egress.rs`) and shows up in Settings → Privacy → Network log.
- Localhost (Ollama / LM Studio) is always allowed. Cloud providers are used **only** with your key and only
  for the features you allow (Assistant cloud toggle, Attention cloud toggle — off by default).
- Screenshots for Attention / Assistant context are OCR'd in memory and never written to disk.
- No raw keylogging: only the push-to-talk keys are observed.

## Setup (macOS)
```bash
npm install
npm run tauri build -- --bundles app      # → src-tauri/target/release/bundle/macos/Flo Flow.app
open "src-tauri/target/release/bundle/macos/Flo Flow.app"
```
First run:
1. **Settings → Permissions**: grant Microphone, Accessibility (for fn key + paste) and Screen Recording (assistant screen context / Attention). Restart Flo Flow after granting Accessibility.
2. Click **Free the fn key** (sets “Press 🌐 key to: Do Nothing”).
3. **Settings → Voice**: download *Whisper Large v3 Turbo* (574 MB, multilingual incl. Hindi/Gujarati) — or pick OpenAI/Groq STT with your key.
4. **Settings → AI**: pick a model. Fully local: install [Ollama](https://ollama.com) and `ollama pull qwen3:8b`.
   BYOK: paste an OpenAI / Anthropic / Gemini / Groq / OpenRouter key (stored in Keychain).
5. **Settings → Integrations → Connect Claude Code** to get notch reminders when sessions finish.

Dev loop: `npm run tauri dev`. UI-only (mock backend in a browser): `npm run dev` → `http://localhost:1420/#/` and
`http://localhost:1420/#/island?demo=1`.

## Windows
Same codebase. Island = frosted capsule bottom-right. Build on a Windows machine with `npm run tauri build`
(needs MSVC build tools + Perl for SQLCipher's vendored OpenSSL). Not yet built/tested on Windows — see “Known gaps”.

## Tests
```bash
cd src-tauri && cargo test --lib     # 48 Rust tests (egress, prompts/parsers, db, analytics, hotkeys, Claude hooks…)
npm test                             # 17 UI tests
```

## Architecture
`docs/01-reverse-engineering.md` — how Wispr Flow & Lemon work (static analysis of the installed apps).
`docs/02-flo-flow-architecture.md` — design. Code map:

```
src-tauri/src/
  lib.rs        app setup: island window, tray, hotkeys, listeners
  session.rs    push-to-talk: record → STT → cleanup → paste / assistant
  assistant.rs  context (projects, to-dos, notes, selection, screen) → JSON actions → execute
  meeting.rs    live note-taker
  attention.rs  focused-window OCR → new text → to-do extraction
  claude.rs     Claude Code hook install + localhost listener
  egress.rs     network allow-list + log      llm.rs / stt.rs  providers
  db.rs         SQLCipher storage + analytics  platform/       macOS + Windows native code
src/island      notch / capsule UI            src/dashboard  glass dashboard
```

## Known gaps (next)
- Meeting notes record the **microphone only**; system-audio capture (ScreenCaptureKit / WASAPI loopback) is next.
- Windows: native OCR (Windows.Media.Ocr) not implemented → Attention is macOS-only for now; Windows build untested.
- WhatsApp / Slack connectors (planned v2), wake word, hands-free mode, edit-tracking.
- App is unsigned: on first open use right-click → Open, or sign with your Developer ID.
