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

pub const SETTINGS_VERSION: u32 = 3;

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
    pub stt_provider: String,
    pub stt_model: String,
    pub language: String,
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
            stt_provider: "local".into(),
            stt_model: "large-v3-turbo-q5_0".into(),
            language: "auto".into(),
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeetingSegment {
    pub t: f64,
    pub text: String,
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
    pub const MEETING: &str = "flo://meeting";
    pub const TODOS: &str = "flo://todos-changed";
    pub const PROJECTS: &str = "flo://projects-changed";
    pub const NOTES: &str = "flo://notes-changed";
    pub const MODEL_PROGRESS: &str = "flo://model-progress";
    pub const TOAST: &str = "flo://toast";
    pub const CLAUDE: &str = "flo://claude";
    pub const HOVER: &str = "flo://hover";
    pub const CLAUDE_SESSIONS: &str = "flo://claude-sessions";
    pub const CORRECTION: &str = "flo://correction";
    pub const MEETING_DETECTED: &str = "flo://meeting-detected";
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
