//! Shared application state + event helpers.
use crate::audio::Recorder;
use crate::db::Db;
use crate::egress::Egress;
use crate::model::*;
use crate::platform::FrontApp;
use crate::stt::LocalWhisper;
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub struct ActiveSession {
    pub mode: Mode,
    pub recorder: Recorder,
    pub front: FrontApp,
    pub selection: Option<String>,
    pub started: Instant,
    /// hands-free (ctrl/fn + Space): longer cap, keys released
    pub locked: bool,
    /// dictation: sentences transcribed while still talking (on-device STT)
    pub stream: Option<std::sync::Arc<StreamBuf>>,
    pub stream_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// OCR text of the focused window, captured in the background (assistant only)
    pub screen: Option<tauri::async_runtime::JoinHandle<Option<String>>>,
}

/// Shared between a dictation session and its background transcriber.
#[derive(Default)]
pub struct StreamBuf {
    pub committed: Mutex<Vec<String>>,
    pub pending: Mutex<Vec<f32>>,
    pub stop: AtomicBool,
}

pub struct MeetingHandle {
    pub note_id: String,
    pub stop: Arc<AtomicBool>,
    pub task: tauri::async_runtime::JoinHandle<()>,
}

pub struct AppState {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub db: Db,
    pub settings: RwLock<Settings>,
    pub egress: Egress,
    pub whisper: Arc<LocalWhisper>,
    pub session: Mutex<Option<ActiveSession>>,
    pub meeting: Mutex<Option<MeetingHandle>>,
    pub attention: Mutex<AttentionStatus>,
    pub attention_paused: AtomicBool,
    /// push-to-talk key physically held right now (or hands-free locked)
    pub ptt_down: AtomicBool,
    /// Space arrived before the session finished starting
    pub lock_pending: AtomicBool,
    /// user asked to stop the computer-control agent
    pub agent_abort: AtomicBool,
    /// signed in to a Flo account (gates dictation / assistant)
    pub signed_in: AtomicBool,
    pub attention_captures: AtomicU32,
    pub claude_listening: AtomicBool,
    pub claude_port: u16,
    /// last non-Flo frontmost app (so island clicks still paste into the right app)
    pub last_front: Mutex<FrontApp>,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub fn emit<T: Serialize + Clone>(&self, event: &str, payload: T) {
        let _ = self.app.emit(event, payload);
    }

    pub fn state(&self, phase: Phase, mode: Mode, message: Option<String>) {
        self.emit(ev::STATE, StateEvent { phase, mode, message });
    }

    /// Emit a terminal phase (done / error), then return the island to idle automatically
    /// (1.5 s after done, 5 s after an error) unless a new session started meanwhile.
    pub fn finish(self: &Arc<Self>, phase: Phase, mode: Mode, message: Option<String>) {
        self.state(phase, mode, message);
        let me = self.clone();
        let delay = if phase == Phase::Error { 5000 } else { 1500 };
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            if me.session.lock().is_none() {
                let m = if me.meeting.lock().is_some() { Mode::Meeting } else { mode };
                let p = if m == Mode::Meeting { Phase::Listening } else { Phase::Idle };
                me.state(p, m, None);
            }
        });
    }

    pub fn toast(&self, kind: &str, text: impl Into<String>) {
        self.emit(ev::TOAST, ToastEvent { kind: kind.into(), text: text.into() });
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    /// Frontmost app, ignoring Flo itself.
    pub fn target_app(&self) -> FrontApp {
        let f = crate::platform::frontmost_app();
        if f.pid > 0 && f.pid as u32 != std::process::id() && !f.name.is_empty() {
            *self.last_front.lock() = f.clone();
            f
        } else {
            self.last_front.lock().clone()
        }
    }
}
