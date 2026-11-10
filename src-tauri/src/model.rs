//! IPC data model. Mirrors `src/lib/types.ts` (serde camelCase).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Dictation,
    Assistant,
    Meeting,
}

impl Mode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Dictation => "dictation",
            Mode::Assistant => "assistant",
            Mode::Meeting => "meeting",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Listening,
    Transcribing,
    Thinking,
    Done,
    Error,
}

pub const SETTINGS_VERSION: u32 = 7;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// schema version for migrations (missing in old files → 0)
    #[serde(default)]
    pub settings_version: u32,
    pub hotkey_dictation: String,
    pub hotkey_assistant: String,
    pub meeting_detection: bool,
    pub learn_corrections: bool,
    pub system_prompt: String,
    /// turn unanswered Slack DMs / mentions into to-dos (when a Slack token is saved)
    pub slack_sync: bool,
    /// first-run setup wizard completed
    pub onboarded: bool,
    /// Flo account server (sign-in only)
    pub account_url: String,
    /// cached signed-in user (offline start)
    pub account_user: Option<AccountUser>,
    pub stt_provider: String,
    pub stt_model: String,
    pub language: String,
    /// with language "auto": only these languages are considered (stops Hindi being heard as
    /// Urdu/Marathi/Nepali, or short English clips as Welsh or Finnish). Empty = English + Hindi
    /// (stt::allowed_languages).
    pub auto_languages: Vec<String>,
    pub llm_provider: String,
    pub llm_model: String,
    pub local_llm_url: String,
    pub cleanup_enabled: bool,
    pub assistant_cloud_allowed: bool,
    pub assistant_screen_context: bool,
    pub attention_enabled: bool,
    pub attention_interval_sec: u64,
    pub attention_denylist: Vec<String>,
    pub attention_cloud_allowed: bool,
    pub play_sounds: bool,
    pub typing_wpm: u32,
    pub user_name: String,
    /// "dark" | "light" | "system"
    pub theme: String,
    /// accent hex, e.g. "#3dbbff"
    pub accent: String,
    /// notch animation: "ribbon" | "wave" | "bars" | "pulse" | "orb" | "aurora"
    pub notch_style: String,
    /// how big hover panels (to-dos, Claude sessions, widgets) open: small | big | bigger | biggest
    pub notch_size: String,
    /// sound character: chime | glass | soft | pop
    pub sound_pack: String,
    /// 0–100
    pub sound_volume: u8,
    /// a soft chime when a reminder or a Claude card appears in the notch
    pub notify_sound: bool,
    /// per-sound style ("chime" | "glass" | "soft" | "pop"); empty = use sound_pack
    pub sound_start: String,
    pub sound_stop: String,
    pub sound_notify: String,
    /// the "started listening" sound
    pub start_sound_on: bool,
    /// the "done / stopped / error" sounds
    pub stop_sound_on: bool,
    /// macOS notification banners (reminders); the notch card shows either way
    pub system_notifications: bool,
    /// answer Claude Code's permission prompts (Allow / Deny) from the notch
    pub claude_approvals: bool,
    /// resume a Claude Code session by itself once its usage limit resets (autocontinue.rs)
    pub claude_auto_continue: bool,
    /// what the resumed session is told ("Continue where you left off.")
    pub claude_continue_prompt: String,
    /// two-stop gradient for the notch accent [from, to]; empty = derive from accent
    pub notch_gradient: Vec<String>,
    /// Flo Vault: automatically grow a local knowledge graph from your activity
    pub vault_auto: bool,
    /// "active" (at the Mac) | "away" (AFK: summaries go to paired phones). Changed only via
    /// set_presence (see push.rs); save_settings keeps the current value.
    pub presence: String,
    /// go Away automatically when the screen locks or after `auto_away_minutes` idle (macOS)
    pub auto_away: bool,
    pub auto_away_minutes: u32,
    /// Notchling, Flo's mascot in the notch (Settings → Appearance → Your notch avatar)
    pub avatar: NotchAvatar,
    /// "Sync your data" (end-to-end encrypted). Changed only through the sync_* commands
    /// (see sync.rs); save_settings keeps the current value.
    pub sync: SyncSettings,
    /// keep the on-device speech model loaded this many minutes after the last dictation
    /// (instant first word); then free its RAM. 0 = unload right away.
    pub stt_keep_warm_mins: u32,
    /// answer an identical question (same model, context and screen) from a 10-minute cache
    pub reuse_answers: bool,
}

/// End-to-end encrypted sync. Off by default; categories are what the user chose to sync.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncSettings {
    pub enabled: bool,
    /// any of "todos", "notes", "settings", "history"
    pub categories: Vec<String>,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self { enabled: false, categories: vec!["todos".into(), "notes".into(), "settings".into(), "history".into()] }
    }
}

/// How the Notchling looks. Defaults are "Classic · Lucid". Unknown values fall back on the UI side.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NotchAvatar {
    /// show the face in the notch
    pub enabled: bool,
    /// "pill" | "round" | "happy" | "anime" | "visor"
    pub eyes: String,
    /// eye glow: "lucid" | "aurora" | "mint" | "sunset" | "accent"
    pub glow: String,
    /// "wave" | "smile" | "cat"
    pub mouth: String,
    pub blush: bool,
    /// "none" | "headphones" | "halo" | "sparkle"
    pub accessory: String,
}

impl Default for NotchAvatar {
    fn default() -> Self {
        Self { enabled: true, eyes: "pill".into(), glow: "lucid".into(), mouth: "wave".into(), blush: true, accessory: "none".into() }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: SETTINGS_VERSION,
            hotkey_dictation: "ctrl".into(),
            hotkey_assistant: "fn".into(),
            meeting_detection: true,
            learn_corrections: true,
            system_prompt: String::new(),
            slack_sync: true,
            onboarded: false,
            account_url: option_env!("FLO_ACCOUNT_URL").unwrap_or("https://flo.hellonaman.com").to_string(),
            account_user: None,
            stt_provider: "local".into(),
            stt_model: "large-v3-turbo-q5_0".into(),
            language: "auto".into(),
            auto_languages: vec!["en".into(), "hi".into(), "gu".into()],
            llm_provider: "ollama".into(),
            llm_model: "qwen3:8b".into(),
            local_llm_url: "http://127.0.0.1:11434".into(),
            cleanup_enabled: true,
            assistant_cloud_allowed: true,
            assistant_screen_context: true,
            attention_enabled: false,
            attention_interval_sec: 20,
            attention_denylist: vec![
                "1Password".into(),
                "Keychain Access".into(),
                "Bitwarden".into(),
                "System Settings".into(),
            ],
            attention_cloud_allowed: false,
            play_sounds: true,
            typing_wpm: 40,
            user_name: String::new(),
            theme: "light".into(),
            accent: "#3dbbff".into(),
            notch_style: "ribbon".into(),
            notch_size: "big".into(),
            sound_pack: "chime".into(),
            sound_volume: 70,
            notify_sound: true,
            sound_start: String::new(),
            sound_stop: String::new(),
            sound_notify: String::new(),
            start_sound_on: true,
            stop_sound_on: true,
            system_notifications: true,
            claude_approvals: true,
            claude_auto_continue: false,
            claude_continue_prompt: "Continue where you left off.".into(),
            notch_gradient: vec![],
            vault_auto: true,
            presence: "active".into(),
            auto_away: false,
            auto_away_minutes: 10,
            avatar: NotchAvatar::default(),
            sync: SyncSettings::default(),
            stt_keep_warm_mins: 10,
            reuse_answers: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandGeometry {
    pub platform: String,
    pub has_notch: bool,
    pub notch_width: f64,
    pub notch_height: f64,
    pub screen_width: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StateEvent {
    pub phase: Phase,
    pub mode: Mode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LevelEvent {
    pub rms: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptEvent {
    pub text: String,
    #[serde(rename = "final")]
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AssistantAction {
    AddTodo {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        due: Option<String>,
    },
    CompleteTodo {
        #[serde(rename = "match")]
        matcher: String,
    },
    CreateProject {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    SetProjectStatus {
        project: String,
        status: String,
    },
    AddProjectNote {
        project: String,
        text: String,
    },
    StartMeeting {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        project: Option<String>,
    },
    StopMeeting,
    OpenUrl {
        url: String,
    },
    OpenApp {
        name: String,
    },
    InsertText {
        text: String,
    },
    /// staged only — the user confirms in the notch before anything is sent
    SlackSend {
        to: String,
        text: String,
    },
    /// media / volume: volume_up | volume_down | mute | playpause | next | previous
    Media {
        action: String,
    },
    /// control the computer by screen to accomplish a multi-step goal (voice "open X and do Y")
    Automate {
        goal: String,
    },
    /// "connect to Mobbin MCP": open Flo Agent > Apps with an Add MCP server form filled in
    ConnectMcp {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResponse {
    pub id: String,
    pub query: String,
    pub reply: String,
    pub actions: Vec<AssistantAction>,
    pub results: Vec<String>,
    pub created_at: String,
    /// quick | deep | web
    #[serde(default = "quick_mode")]
    pub mode: String,
    /// web sources when mode = web
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<Source>,
    /// the conversation thread this exchange belongs to (set when it is logged; see db.rs)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// where the request came from: notch | typed | phone | agent | skill (None on old rows)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// One conversation thread on the Assistant page (derived from assistant_log rows).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantThread {
    pub id: String,
    /// the thread's first question
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub count: u32,
}

fn quick_mode() -> String {
    "quick".into()
}

/// A user-added platform or MCP server that skills can use.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Connection {
    pub id: String,
    pub name: String,
    /// "platform" (a site or app skills can target) | "mcp" (a Model Context Protocol server)
    pub kind: String,
    /// mcp: "stdio" (a local command) | "http" (a URL)
    pub transport: String,
    /// stdio: the program to run ("npx") …
    pub command: String,
    /// … and its arguments (["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"])
    pub args: Vec<String>,
    /// http MCP server URL, or the platform's website
    pub url: String,
    /// stdio: environment variables; http: extra request headers (e.g. Authorization)
    pub env: std::collections::BTreeMap<String, String>,
    pub description: String,
    pub enabled: bool,
    pub created_at: String,
}

/// A tool an MCP server offers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Something the user taught Flo to do on request ("write my Upwork proposals").
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Skill {
    pub id: String,
    pub name: String,
    /// comma-separated phrases that invoke it ("upwork proposal, proposal for this job")
    pub triggers: String,
    /// how the user wants it done, in their own words
    pub instructions: String,
    /// where it works: "upwork", "slack", "gmail", "linkedin", "browser", "any"
    pub platforms: Vec<String>,
    /// "write" = compose text into the focused field · "do" = operate the screen
    pub mode: String,
    pub enabled: bool,
    pub uses: u32,
    pub created_at: String,
    /// the canvas (nodes + edges) the skill was built on, as JSON
    pub graph: String,
    /// ids of the MCP servers / custom platforms (Connections) this skill uses
    pub connections: Vec<String>,
    /// 5-field cron ("0 9 * * 1-5"): run it on its own at these local times
    pub schedule: Option<String>,
    /// when the scheduler (or "Run now") last ran it (RFC3339)
    pub last_run: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    /// current temperature in °C
    pub temp_c: f64,
    /// WMO weather-interpretation code (0 = clear, 3 = overcast, 61 = rain, …)
    pub code: i64,
    /// is it currently daytime at the location
    pub is_day: bool,
    /// nearest place name ("Ahmedabad")
    pub place: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed: Option<f64>,
    /// track length in seconds
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// unix ms when `elapsed` was sampled (the UI advances the progress bar from here while playing)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    /// data: URL of the playing app's icon
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon: Option<String>,
    /// data: URL of the track artwork, when the player exposes it
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Source {
    pub title: String,
    pub url: String,
}

// ── Flo Vault (Obsidian-style local knowledge graph) ─────────────────────────
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNode {
    pub id: String,
    pub title: String,
    /// person | project | topic | note | daily | doc
    pub kind: String,
    pub summary: String,
    pub updated_at: String,
    /// number of links (for sizing in the graph)
    pub degree: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultLink {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultGraph {
    pub nodes: Vec<VaultNode>,
    pub links: Vec<VaultLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNote {
    pub id: String,
    pub title: String,
    pub kind: String,
    /// markdown with [[wikilinks]]
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub outlinks: Vec<VaultNode>,
    pub backlinks: Vec<VaultNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeetingSegment {
    pub t: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingEvent {
    pub note_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment: Option<MeetingSegment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub elapsed_sec: f64,
    pub live: bool,
    /// live, still-changing line (replaced by the next partial or a final segment)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelProgressEvent {
    pub id: String,
    pub received: u64,
    pub total: u64,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToastEvent {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictation {
    pub id: String,
    pub created_at: String,
    pub app: String,
    pub mode: Mode,
    pub raw_text: String,
    pub final_text: String,
    pub words: u32,
    pub duration_ms: u64,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    pub source: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// when to notify (RFC3339), set to due-minus-5-minutes so reminders are always 5 min early
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remind_at: Option<String>,
    /// the meeting note this to-do came from (Details opens that conversation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: String,
    pub color: String,
    pub open_todos: u32,
    pub done_todos: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_note: Option<String>,
    pub updated_at: String,
    /// client / company this project is for ("Northwind")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
    /// free text: contact person, email, phone, website, anything useful
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_details: Option<String>,
    /// comma-separated words that mean this project (people, channels, domains, aliases);
    /// captured to-dos and notes mentioning them are filed here automatically
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<String>,
    /// linked code (Projects → Code): GitHub URL / remote, and the local folder
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub transcript: Vec<MeetingSegment>,
    pub summary: String,
    pub action_items: Vec<String>,
    pub duration_sec: f64,
    pub created_at: String,
    pub live: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyStat {
    pub day: String,
    pub words: u64,
    pub dictations: u64,
    pub assistant: u64,
    pub meeting_min: f64,
    pub todos_done: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppWords {
    pub app: String,
    pub words: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub total_words: u64,
    pub total_dictations: u64,
    pub avg_wpm: f64,
    pub minutes_saved: f64,
    pub streak_days: u32,
    pub todos_open: u64,
    pub todos_done: u64,
    pub meeting_minutes: f64,
    pub daily: Vec<DailyStat>,
    pub top_apps: Vec<AppWords>,
    pub hourly: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: String,
    pub word: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkLogEntry {
    pub at: String,
    pub host: String,
    pub purpose: String,
    pub allowed: bool,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_in: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_out: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: String,
    pub label: String,
    pub size_mb: u64,
    pub languages: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttentionStatus {
    pub enabled: bool,
    pub paused: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_capture_at: Option<String>,
    pub captures_today: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_app: Option<String>,
    /// why Attention is idle even though it's on (e.g. no AI model it may use)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub microphone: bool,
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub screen: bool,
    pub hotkey_active: bool,
    /// trusted under an earlier build, not this one: an update left a stale Accessibility switch
    pub accessibility_stale: bool,
    /// why the push-to-talk key can't be read (Linux: "add yourself to the input group")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotkey_problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEvent {
    pub id: String,
    /// "stop" | "notification" | "subagent_stop"
    pub kind: String,
    pub session_id: String,
    pub project: String,
    pub cwd: String,
    pub message: String,
    pub at: String,
    pub seen: bool,
    /// macOS bundle id of the app that launched Claude Code (e.g. com.microsoft.VSCode)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_bundle: Option<String>,
    /// $TERM_PROGRAM of the session (vscode, iTerm.app, Apple_Terminal, WarpTerminal, ghostty…)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
    /// Claude Code transcript (JSONL) — used to tell "still working" from "finished"
    #[serde(skip)]
    pub transcript_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub session_id: String,
    pub project: String,
    pub cwd: String,
    /// working | done | waiting_reply | needs_approval
    pub status: String,
    pub message: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_bundle: Option<String>,
    #[serde(skip)]
    pub terminal: Option<String>,
    #[serde(skip)]
    pub transcript_path: Option<String>,
    /// claude | codex | cursor | <webhook source>
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountUser {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextDoc {
    pub id: String,
    pub title: String,
    pub chars: u64,
    pub tokens: u64,
    pub enabled: bool,
    pub pinned: bool,
    pub created_at: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CorrectionEvent {
    pub id: String,
    pub heard: String,
    pub corrected: String,
    pub app: String,
    /// already saved to the dictionary (the notch offers Undo instead of Save)
    #[serde(default)]
    pub saved: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetectedEvent {
    pub app: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHookStatus {
    pub installed: bool,
    pub config_path: String,
    pub port: u16,
    pub listening: bool,
}

pub mod ev {
    pub const STATE: &str = "flo://state";
    pub const LEVEL: &str = "flo://level";
    pub const TRANSCRIPT: &str = "flo://transcript";
    pub const ASSISTANT: &str = "flo://assistant";
    /// an exchange was added to the Assistant history (any source; the notch card listens to
    /// ASSISTANT, the dashboard's Assistant page to both)
    pub const ASSISTANT_LOG: &str = "flo://assistant-log";
    pub const MEETING: &str = "flo://meeting";
    pub const TODOS: &str = "flo://todos-changed";
    pub const PROJECTS: &str = "flo://projects-changed";
    pub const NOTES: &str = "flo://notes-changed";
    pub const MODEL_PROGRESS: &str = "flo://model-progress";
    pub const TOAST: &str = "flo://toast";
    pub const CLAUDE: &str = "flo://claude";
    pub const VAULT: &str = "flo://vault";
    pub const REMINDER: &str = "flo://reminder";
    pub const AGENT: &str = "flo://agent";
    pub const HOVER: &str = "flo://hover";
    pub const CLAUDE_SESSIONS: &str = "flo://claude-sessions";
    pub const CORRECTION: &str = "flo://correction";
    pub const MEETING_DETECTED: &str = "flo://meeting-detected";
    pub const ACCOUNT: &str = "flo://account";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assistant_action_matches_ts_contract() {
        let a: AssistantAction =
            serde_json::from_str(r#"{"type":"complete_todo","match":"deck"}"#).unwrap();
        assert_eq!(a, AssistantAction::CompleteTodo { matcher: "deck".into() });
        let s = serde_json::to_string(&AssistantAction::AddTodo {
            title: "x".into(),
            project: None,
            due: None,
        })
        .unwrap();
        assert_eq!(s, r#"{"type":"add_todo","title":"x"}"#);
    }

    #[test]
    fn settings_partial_json_uses_defaults() {
        let s: Settings = serde_json::from_str(r#"{"typingWpm":55}"#).unwrap();
        assert_eq!(s.typing_wpm, 55);
        assert_eq!(s.stt_provider, "local");
    }

    #[test]
    fn transcript_event_final_key() {
        let s = serde_json::to_string(&TranscriptEvent { text: "a".into(), is_final: true }).unwrap();
        assert_eq!(s, r#"{"text":"a","final":true}"#);
    }
}
