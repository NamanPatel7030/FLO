# Flo Flow — Architecture & Build Plan (draft for review)

Goal: one local-first, BYOK app that replaces Wispr Flow + Lemon on macOS and Windows, adding
an **Attention → To-do** engine neither has.

## 1. The four modes

| Mode | Trigger | What happens |
|---|---|---|
| **Dictation** (you called it "detection") | hold `Fn` (mac) / `Right Ctrl`/`Ctrl+Win` (Windows) — push-to-talk; double-tap = hands-free | mic → VAD → local STT → LLM cleanup (filler removal, punctuation, per-app tone, personal dictionary) → paste into focused field |
| **Assistant** | hold `Fn+Space` (configurable) | **Command:** text selected → "make this shorter" → replaces selection. **Ask:** no selection → answers using screen + focused-app context in a floating card. **Act (later):** open app/URL, draft reply, create to-do — always with a confirm step |
| **Attention** | runs passively (pausable, per-app denylist) | event-driven capture of what's on screen (AX text first, OCR fallback) → local index → feeds To-dos |
| **To-dos** | menu-bar / `⌥Space` window, daily digest | items extracted by Attention ("Reply to Rahul about invoice — Slack, 2:14 pm"), plus voice ("remind me to…"). Each links back to its source; auto-closes when it sees you did it |

## 2. Privacy model (the core promise)

- **Everything is stored locally**: encrypted SQLite (SQLCipher), key in macOS Keychain /
  Windows Credential Manager. No account, no sync, no telemetry.
- **Egress guard:** every network call goes through one Rust module with an allow-list and an
  in-app **network log**. Modes:
  - `Local-only` (default for Attention, always): only `localhost` (Ollama/LM Studio) allowed.
  - `BYOK cloud` (opt-in per mode): your key → direct to the provider you chose. No middle server.
- ⚠️ Honest trade-off: if you pick a cloud LLM for Assistant, the text you send goes to that
  provider under your account. Screen captures from Attention **never** leave the device.
- **Keyboard:** no raw keylogging. Typed text is read from the focused field via Accessibility
  when you leave it, skipping secure/password fields, Secure Input, and denylisted apps
  (password managers, banking). Raw screenshots are deleted after text extraction (configurable).

## 3. Tech stack (recommendation)

**Tauri 2 (Rust core) + React/TypeScript UI.** Reasons: one codebase for Mac and Windows,
~10× lighter than Electron, Rust gives direct native access (no stdio helper like Wispr's), and
the MIT-licensed **Handy** app proves this exact stack works for local dictation.

| Layer | macOS | Windows | Crate / lib |
|---|---|---|---|
| Global hotkey | CGEventTap (Fn) + IOHID fallback | `WH_KEYBOARD_LL` hook | `objc2`, `core-graphics`, `windows` |
| Audio | CoreAudio | WASAPI | `cpal`, Opus not needed (local) |
| VAD / end-of-turn | Silero VAD, Smart-Turn (ONNX) | same | `ort` (onnxruntime) |
| STT local | whisper.cpp large-v3-turbo (Metal) / Parakeet TDT v3 | whisper.cpp (Vulkan/CUDA) / Parakeet (CPU) | `whisper-rs`, `sherpa-onnx`/`ort` |
| STT BYOK (optional) | Groq, OpenAI, Deepgram, ElevenLabs | same | `reqwest` |
| LLM | Ollama / LM Studio (local), OpenAI, Anthropic, Gemini, Groq, OpenRouter (BYOK) | same | one provider trait; OpenAI-compatible covers most |
| Focused text / selection | AXUIElement | UI Automation | `objc2-app-kit`, `accessibility-sys`, `windows` |
| Text insertion | AXValue → clipboard + ⌘V (restore + verify) | UIA ValuePattern → clipboard + `SendInput` Ctrl+V | `arboard`, `enigo`/native |
| Screen capture | ScreenCaptureKit | Windows.Graphics.Capture | `screencapturekit`, `windows-capture`/`xcap` |
| OCR | Apple Vision | Windows.Media.Ocr | `objc2-vision`, `windows` |
| Storage | SQLite + SQLCipher + FTS5 + `sqlite-vec` | same | `rusqlite` |
| Embeddings | small local model (bge-small class) | same | `ort` |
| Secrets | Keychain | Credential Manager | `keyring` |
| UI | React 19, Tailwind, **Motion** (framer-motion), Rive for the voice orb | same | |
| Overlay | non-activating NSPanel (`tauri-nspanel`) | `WS_EX_NOACTIVATE` topmost window | |

Default local models on an Apple Silicon Mac: Parakeet v3 (fast, English/EU languages) or
whisper large-v3-turbo (multilingual, incl. Hindi/Gujarati); a ~4–8B local instruct model via
Ollama for cleanup and to-do extraction; a local vision model only when OCR+AX text isn't enough.

## 4. Process architecture

```
┌──────────────── Tauri app (single process + webviews) ────────────────┐
│ UI (React): Overlay pill · Assistant card · To-do window · Settings  │
│        ▲ events (tauri IPC)                                           │
│ Rust core                                                             │
│  hotkey ─► recorder ─► VAD ─► STT ─► cleanup LLM ─► inserter ─► verify│
│  context: focused app, selection, AX tree, screenshot (on demand)     │
│  attention: capture scheduler ─► AX/OCR text ─► diff ─► store (FTS)  │
│  todo engine: prefilter ─► local LLM extract (JSON) ─► dedup ─► inbox │
│  providers (STT/LLM) ─► egress guard (allow-list + network log)      │
│  db: SQLCipher (history, dictionary, snapshots, todos, settings)     │
└───────────────────────────────────────────────────────────────────────┘
```

## 5. Attention → To-do pipeline

1. **Capture triggers:** app/window switch, scroll stop, typing pause, every ~10 s while content
   changes (perceptual-hash to skip identical frames). Denylist + "pause 1h" in menu bar.
2. **Text:** AX tree text (preferred, exact) → OCR fallback. Store only *new* text (diff vs last snapshot of that window).
3. **Prefilter (cheap, local):** messaging/email apps, direct questions to you, your name,
   "can you / please / by Friday / EOD", dates, unread markers.
4. **Extract:** local LLM → strict JSON `{title, reason, person, app, source_ref, due, confidence}`.
5. **Dedup & close:** embedding similarity merges repeats; if later snapshots show you replied
   or did it, mark done automatically.
6. **Inbox UX:** accept / snooze / dismiss — dismissals train the prefilter (stored locally).
7. **Later:** WhatsApp & Slack connectors as additional sources (v2).

## 6. Phased plan

| Phase | Deliverable | Done when |
|---|---|---|
| 0. Skeleton | Tauri app, tray, settings, BYOK key vault, egress guard + network log, encrypted DB | app launches on Mac, keys in Keychain |
| 1. Dictation (mac) | Fn push-to-talk, overlay pill with live waveform, local whisper/Parakeet, LLM cleanup, paste+restore+verify, history, personal dictionary | daily use replaces Wispr for dictation, < 700 ms release-to-text for short phrases |
| 2. Assistant | Command on selection, Ask with screen context, per-app styles | can rewrite in any app and answer "what's on my screen" |
| 3. Attention + To-dos | capture → index → extraction → inbox + digest | ≥ 70% of accepted items useful in a week of real use |
| 4. Windows parity | hooks, UIA, capture, OCR, installer | same flows pass on Windows 11 |
| 5. Extras | hands-free + wake word, edit-learning, meeting notes, WhatsApp/Slack | — |

Testing: Rust unit tests per pipeline stage (TDD), golden-audio fixtures for STT/cleanup,
fixture screenshots/AX dumps for to-do extraction evals, Playwright for UI.

## 7. Open decisions
1. Start fresh vs. fork Handy (MIT, must rebrand) for the dictation core.
2. Languages you dictate in (English only? Hindi/Gujarati/code-mixed?) → model choice.
3. Assistant: allow BYOK cloud LLM for screen-context questions, or strictly local?
4. Windows push-to-talk key (no Fn on Windows).

## 8. Decisions taken for the MVP (2026-11-05)
- Built from scratch on Tauri 2 (Handy used only as a reference).
- STT default: whisper.cpp Large v3 Turbo q5 (multilingual: English/Hindi/Gujarati/Hinglish), Metal on Mac; BYOK OpenAI/Groq optional.
- Assistant may use a cloud LLM only when "Assistant may use cloud AI" is on; Attention text stays local unless its own toggle is on; images never leave the device.
- Windows push-to-talk: Right Ctrl (dictation), Right Alt (assistant). macOS: fn, fn+ctrl.
- UI: Dynamic Island grown out of the MacBook notch (window sized exactly to the notch when idle so the menu bar stays clickable); bottom-right frosted capsule on Windows; glassmorphism dashboard with native vibrancy (macOS sidebar material / Windows Mica).
- Added: meeting note-taker (live transcript + rolling summary + action items → to-dos), analytics dashboard (words, WPM, time saved, streak, per-app, per-hour, meetings, to-dos), projects controllable by voice.
- Claude Code integration: Stop/Notification hooks → `curl` → `127.0.0.1:47621/claude/hook?token=…` → island reminder + "Claude sessions" inbox; unseen reminders re-pop once after 10 min.
