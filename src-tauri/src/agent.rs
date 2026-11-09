//! Voice computer-control agent. Given a goal ("open Chrome, search YouTube for lofi, play the
//! first video"), Flo loops: screenshot the screen → ask a vision model for the single next action
//! → perform it (open app/url, click, type, key, scroll) → repeat, until done or aborted.
//!
//! Safety: the user triggers it by voice; it runs on the configured BYOK cloud vision model (needs
//! `assistant_cloud_allowed`); it is capped at a number of steps; the user can abort any time; and
//! the model is told to STOP and ask before anything irreversible or outward-facing (send, post,
//! buy, delete). Everything it does, the user could do by hand.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::ev;
use crate::state::Shared;
use crate::{platform, settings as cfg, text};
use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const MAX_STEPS: usize = 14;
const IMG_MAX_W: u32 = 1366;
/// After opening a page / app the next screenshot waits for it to load (a stale screen made the
/// model click the wrong thing or stop early).
const AFTER_NAV_MS: u64 = 2200;
const AFTER_ENTER_MS: u64 = 1300;
const AFTER_ACTION_MS: u64 = 550;
/// Give up only after this many failed actions in a row (one misstep no longer ends the run).
const MAX_FAILS_IN_A_ROW: usize = 3;

/// Flo's own notch card sits at the top centre of the screen, exactly where most search boxes
/// are. Hide it while the screen is captured, and let clicks pass through it, so the agent sees and
/// clicks the page underneath.
fn island_window(st: &Shared) -> Option<tauri::WebviewWindow> {
    use tauri::Manager;
    st.app.get_webview_window("island")
}

/// Run `f` on the island's NSWindow on the main thread and wait (briefly) until it has happened,
/// so the next screenshot / click sees the change.
#[cfg(target_os = "macos")]
fn on_island_window(st: &Shared, f: impl FnOnce(*mut std::ffi::c_void) + Send + 'static) {
    let Some(w) = island_window(st) else { return };
    let Ok(ptr) = w.ns_window() else { return };
    let ptr = ptr as usize;
    let (tx, rx) = std::sync::mpsc::channel();
    if w.run_on_main_thread(move || {
        f(ptr as *mut std::ffi::c_void);
        let _ = tx.send(());
    })
    .is_ok()
    {
        let _ = rx.recv_timeout(Duration::from_millis(400));
    }
}

#[cfg(target_os = "macos")]
fn island_alpha(st: &Shared, alpha: f64) {
    on_island_window(st, move |w| platform::set_window_alpha(w, alpha));
}
#[cfg(not(target_os = "macos"))]
fn island_alpha(_st: &Shared, _alpha: f64) {}

/// Let clicks pass through Flo's card. Applied synchronously: Tauri's own setter is queued to the
/// main thread, so a click posted right after it could still land on the card.
#[cfg(target_os = "macos")]
fn island_click_through(st: &Shared, on: bool) {
    on_island_window(st, move |w| platform::set_window_ignores_mouse(w, on));
}
#[cfg(not(target_os = "macos"))]
fn island_click_through(st: &Shared, on: bool) {
    if let Some(w) = island_window(st) {
        let _ = w.set_ignore_cursor_events(on);
    }
}

/// Screenshot of the screen WITHOUT Flo's card on it.
async fn capture_clean(st: &Shared) -> Result<Shot> {
    island_alpha(st, 0.0);
    tokio::time::sleep(Duration::from_millis(70)).await; // let the compositor drop the window
    let shot = tokio::task::spawn_blocking(capture).await;
    island_alpha(st, 1.0);
    shot?
}

/// Can Flo post clicks and keystrokes? (macOS drops them silently without Accessibility.)
#[cfg(target_os = "macos")]
fn can_control() -> bool {
    platform::can_post_events()
}
#[cfg(not(target_os = "macos"))]
fn can_control() -> bool {
    true
}

/// Click through Accessibility when the target is a plain button / link / menu item, else with a
/// real mouse click. Returns how it clicked (for the log).
fn click(x: f64, y: f64, double: bool) -> Result<&'static str> {
    #[cfg(target_os = "macos")]
    if !double {
        if let Some((_role, pid)) = platform::press_at(x, y) {
            // AXPress doesn't bring the app forward; typing that follows must land in it
            platform::activate_app(pid);
            return Ok("accessibility");
        }
    }
    platform::click_at(x, y, double)?;
    Ok("mouse")
}

/// how long a confirm question waits for an answer in agent mode (spoken yes/no), then it's a no
pub const VOICE_CONFIRM_SECS: u64 = 15;
/// … and when answered with the island buttons (push-to-talk run)
pub const BUTTON_CONFIRM_SECS: u64 = 60;
/// a run never asks more than this many confirmations (a model stuck re-asking stops instead)
const MAX_CONFIRMS: usize = 4;

// ── run + confirmation state (one agent at a time) ──────────────────────────
static RUNNING: AtomicBool = AtomicBool::new(false);
static RUNS: AtomicU64 = AtomicU64::new(0);
/// the question the agent is waiting on (Some = paused for a yes/no)
static PENDING: Mutex<Option<String>> = Mutex::new(None);
static ANSWER: Mutex<Option<bool>> = Mutex::new(None);

/// Is the screen agent running right now?
pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

/// How many runs have started (lets a caller wait for a run it just triggered).
pub fn runs_started() -> u64 {
    RUNS.load(Ordering::SeqCst)
}

/// The confirm question the agent is paused on, if any.
pub fn pending_confirm() -> Option<String> {
    PENDING.lock().ok().and_then(|g| g.clone())
}

/// Answer the paused confirm question (voice or island button). Returns false if nothing was pending.
pub fn answer_confirm(yes: bool) -> bool {
    if pending_confirm().is_none() {
        return false;
    }
    if let Ok(mut a) = ANSWER.lock() {
        *a = Some(yes);
    }
    true
}

struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
        if let Ok(mut p) = PENDING.lock() {
            *p = None;
        }
    }
}

/// What the agent does with the user's answer to a confirm step (pure; unit tested).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfirmOutcome {
    /// yes → remember the approval in the history and let the model perform that step next turn
    Proceed { history_line: String },
    /// no / no answer / stopped → stop the run with this message
    Stop { message: String },
}

pub fn confirm_outcome(answer: Option<bool>, question: &str, aborted: bool, confirms_so_far: usize) -> ConfirmOutcome {
    if aborted {
        return ConfirmOutcome::Stop { message: "Stopped.".into() };
    }
    match answer {
        Some(true) if confirms_so_far <= MAX_CONFIRMS => ConfirmOutcome::Proceed {
            history_line: format!("USER CONFIRMED: \"{}\". Perform exactly that step now, without asking again", text::truncate_chars(question, 160)),
        },
        Some(true) => ConfirmOutcome::Stop { message: "Too many confirmations, so I stopped to be safe.".into() },
        Some(false) => ConfirmOutcome::Stop { message: "Cancelled, you said no.".into() },
        None => ConfirmOutcome::Stop { message: "No answer, so I didn't do it.".into() },
    }
}

/// Pause until the user answers `question` (or the timeout / an abort). Never auto-confirms.
async fn wait_for_answer(st: &Shared, question: &str, timeout: Duration) -> (Option<bool>, bool) {
    if let Ok(mut a) = ANSWER.lock() {
        *a = None;
    }
    if let Ok(mut p) = PENDING.lock() {
        *p = Some(question.to_string());
    }
    let start = std::time::Instant::now();
    let res = loop {
        if st.agent_abort.load(Ordering::SeqCst) {
            break (None, true);
        }
        if let Some(a) = ANSWER.lock().ok().and_then(|mut g| g.take()) {
            break (Some(a), false);
        }
        if start.elapsed() >= timeout {
            break (None, false);
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    };
    if let Ok(mut p) = PENDING.lock() {
        *p = None;
    }
    res
}

fn system_prompt() -> String {
    r#"You control a macOS computer to accomplish the user's GOAL, like a person using the mouse and keyboard. Each turn you are given a screenshot of the whole screen (its pixel size is stated) and the actions taken so far. Reply with ONE next action as a single JSON object, nothing else:
{"action":"open_app","name":"Safari"}
{"action":"open_url","url":"https://youtube.com/results?search_query=lofi"}
{"action":"click","x":<px>,"y":<px>,"what":"the first video thumbnail"}
{"action":"double_click","x":<px>,"y":<px>,"what":"..."}
{"action":"type","text":"lofi beats"}            // types wherever the cursor is
{"action":"key","name":"return"}                  // return|tab|space|escape|delete|up|down|left|right|pagedown|pageup|a-z|0-9; add "cmd":true/"shift"/"alt"/"ctrl" (e.g. {"action":"key","name":"l","cmd":true} focuses the address bar)
{"action":"scroll","dy":-4}                        // negative scrolls down
{"action":"wait","ms":800}
{"action":"done","summary":"Playing the lofi video."}
{"action":"confirm","summary":"About to send the email to Rahul. Confirm?"}  // REQUIRED before anything that sends/posts/buys/deletes or is hard to undo

Rules:
- x,y are pixel coordinates IN THE PROVIDED SCREENSHOT (top-left origin). Aim for the centre of the target.
- Prefer open_url over clicking when a direct URL exists (e.g. a YouTube search). Prefer open_app to launch apps.
- Do ONE thing per turn; you will see the result in the next screenshot. Use wait after navigation.
- If a click didn't change anything, don't repeat it: try a different target, a keyboard shortcut or open_url.
- NEVER do anything irreversible or outward-facing (send a message, post, pay, delete, change settings) without first returning a "confirm" action and waiting.
- When "Actions so far" contains USER CONFIRMED for a step, the user approved it: do that step now (e.g. click Send) and don't ask again for the same step.
- When the goal is achieved, return "done". Output only the JSON."#.to_string()
}

// ── bounded, abortable steps ────────────────────────────────────────────────

/// A whole run never takes longer than this (the island must never spin forever).
pub const RUN_DEADLINE: Duration = Duration::from_secs(240);
/// One screenshot.
pub const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
/// One "what next?" answer from the AI (includes a Keychain prompt and the provider's retries).
pub const LLM_STEP_TIMEOUT: Duration = Duration::from_secs(45);
/// One click / keystroke / app launch.
pub const ACTION_TIMEOUT: Duration = Duration::from_secs(10);

/// Why a guarded step didn't produce a value.
#[derive(Debug)]
pub enum Halt {
    /// the user pressed Stop / said "stop"
    Aborted,
    /// the step ran past its time limit
    TimedOut,
    /// the step itself failed
    Failed(anyhow::Error),
}

/// Await `fut`, but give up when `limit` passes or `abort` is set (checked every 100 ms), so Stop
/// works even while waiting on the AI.
pub async fn guarded<T>(abort: &AtomicBool, limit: Duration, fut: impl std::future::Future<Output = Result<T>>) -> Result<T, Halt> {
    let watch = async {
        while !abort.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    };
    tokio::select! {
        biased;
        _ = watch => Err(Halt::Aborted),
        r = tokio::time::timeout(limit, fut) => match r {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(Halt::Failed(e)),
            Err(_) => Err(Halt::TimedOut),
        },
    }
}

/// The time limit for the next step: its own limit, but never past the run's deadline.
pub fn step_limit(own: Duration, elapsed: Duration, deadline: Duration) -> Duration {
    own.min(deadline.saturating_sub(elapsed))
}

// ── what the model asked for (pure; unit tested) ────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    OpenApp(String),
    OpenUrl(String),
    Click { x: f64, y: f64, what: String, double: bool },
    Type(String),
    Key { name: String, cmd: bool, shift: bool, alt: bool, ctrl: bool },
    Scroll(i32),
    Wait(u64),
    Done(String),
    Confirm(String),
}

impl Step {
    /// A short name for logs (never the typed text or a URL).
    pub fn kind(&self) -> &'static str {
        match self {
            Step::OpenApp(_) => "open_app",
            Step::OpenUrl(_) => "open_url",
            Step::Click { double: false, .. } => "click",
            Step::Click { double: true, .. } => "double_click",
            Step::Type(_) => "type",
            Step::Key { .. } => "key",
            Step::Scroll(_) => "scroll",
            Step::Wait(_) => "wait",
            Step::Done(_) => "done",
            Step::Confirm(_) => "confirm",
        }
    }
}

fn num(v: &serde_json::Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok())).filter(|n| n.is_finite())
}

fn str_of<'a>(v: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v[*k].as_str()).map(str::trim).filter(|s| !s.is_empty())
}

fn flag(v: &serde_json::Value, k: &str) -> bool {
    v[k].as_bool().unwrap_or(false)
}

/// Parse the model's reply into one action. Tolerates the shapes models actually return: code
/// fences, prose around the JSON, `{"actions":[…]}`, `"coordinate":[x,y]`, numbers as strings,
/// Anthropic computer-use names (left_click, key "cmd+l"), and missing fields. Never treats an
/// unreadable reply as "done".
pub fn parse_step(raw: &str) -> Result<Step, String> {
    let json = text::extract_json_object(raw).ok_or("your reply wasn't a JSON action")?;
    let mut v: serde_json::Value = serde_json::from_str(&json).map_err(|_| "your reply wasn't valid JSON".to_string())?;
    // {"actions":[{…}]} / {"next_action":{…}} → the first one
    for k in ["actions", "next_action", "action"] {
        let inner = match &v[k] {
            serde_json::Value::Array(a) => a.first().cloned(),
            o @ serde_json::Value::Object(_) => Some(o.clone()),
            _ => None,
        };
        if let Some(i) = inner {
            v = i;
            break;
        }
    }
    let action = str_of(&v, &["action", "type", "kind"]).ok_or("the JSON had no \"action\"")?.to_lowercase();
    let xy = || -> Result<(f64, f64), String> {
        let c = v.get("coordinate").or_else(|| v.get("coordinates")).or_else(|| v.get("position"));
        let (x, y) = match c {
            Some(serde_json::Value::Array(a)) if a.len() >= 2 => (num(&a[0]), num(&a[1])),
            Some(o @ serde_json::Value::Object(_)) => (num(&o["x"]), num(&o["y"])),
            _ => (num(&v["x"]), num(&v["y"])),
        };
        match (x, y) {
            (Some(x), Some(y)) => Ok((x, y)),
            _ => Err(format!("{action} needs x and y")),
        }
    };
    let what = str_of(&v, &["what", "target", "description", "summary"]).unwrap_or("").to_string();
    Ok(match action.as_str() {
        "open_app" | "launch_app" | "launch" | "open_application" => {
            Step::OpenApp(str_of(&v, &["name", "app", "text"]).ok_or("open_app needs a name")?.to_string())
        }
        "open_url" | "navigate" | "goto" | "go_to" | "open_link" | "url" => {
            Step::OpenUrl(str_of(&v, &["url", "href", "text"]).ok_or("open_url needs a url")?.to_string())
        }
        "click" | "left_click" | "tap" | "press_button" => {
            let (x, y) = xy()?;
            Step::Click { x, y, what, double: false }
        }
        "double_click" | "doubleclick" | "dblclick" => {
            let (x, y) = xy()?;
            Step::Click { x, y, what, double: true }
        }
        "type" | "type_text" | "write" | "input" | "enter_text" => {
            let t = v["text"].as_str().or(v["value"].as_str()).unwrap_or("");
            if t.is_empty() {
                return Err("type needs text".into());
            }
            Step::Type(t.to_string())
        }
        "key" | "keypress" | "key_press" | "press" | "hotkey" | "shortcut" => {
            let combo = str_of(&v, &["name", "key", "keys", "text"]).ok_or("key needs a name")?;
            let (name, mods) = split_combo(combo);
            Step::Key {
                name,
                cmd: mods.0 || flag(&v, "cmd") || flag(&v, "command"),
                shift: mods.1 || flag(&v, "shift"),
                alt: mods.2 || flag(&v, "alt") || flag(&v, "option"),
                ctrl: mods.3 || flag(&v, "ctrl") || flag(&v, "control"),
            }
        }
        "scroll" => {
            let dy = num(&v["dy"]).or_else(|| num(&v["amount"]).map(|a| if v["direction"].as_str() == Some("down") { -a.abs() } else { a.abs() }));
            Step::Scroll(dy.unwrap_or(-3.0).clamp(-30.0, 30.0) as i32)
        }
        "wait" | "sleep" | "pause" => Step::Wait(num(&v["ms"]).map(|m| m as u64).or_else(|| num(&v["seconds"]).map(|s| (s * 1000.0) as u64)).unwrap_or(600).min(4000)),
        "done" | "finish" | "finished" | "complete" | "completed" => Step::Done(str_of(&v, &["summary", "text", "message"]).unwrap_or("Done.").to_string()),
        "confirm" | "ask" | "ask_user" => Step::Confirm(str_of(&v, &["summary", "question", "text"]).unwrap_or("Confirm this step?").to_string()),
        other => return Err(format!("unknown action \"{other}\" (use open_app, open_url, click, type, key, scroll, wait, confirm, done)")),
    })
}

/// "cmd+shift+t" / "Command-L" / "Return" → ("t", (cmd, shift, alt, ctrl)).
pub fn split_combo(combo: &str) -> (String, (bool, bool, bool, bool)) {
    let parts: Vec<String> = combo.split(['+', '-']).map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect();
    let (mut cmd, mut shift, mut alt, mut ctrl) = (false, false, false, false);
    let mut key = String::new();
    for p in &parts {
        match p.as_str() {
            "cmd" | "command" | "meta" | "super" | "⌘" => cmd = true,
            "shift" | "⇧" => shift = true,
            "alt" | "option" | "opt" | "⌥" => alt = true,
            "ctrl" | "control" | "⌃" => ctrl = true,
            k => key = k.to_string(),
        }
    }
    let key = match key.as_str() {
        "enter" | "kp_enter" => "return".to_string(),
        "esc" => "escape".to_string(),
        "backspace" => "delete".to_string(),
        "page_down" => "pagedown".to_string(),
        "page_up" => "pageup".to_string(),
        "arrowup" | "arrow_up" => "up".to_string(),
        "arrowdown" | "arrow_down" => "down".to_string(),
        "arrowleft" | "arrow_left" => "left".to_string(),
        "arrowright" | "arrow_right" => "right".to_string(),
        _ => key,
    };
    (key, (cmd, shift, alt, ctrl))
}

// ── screenshot → screen coordinates (pure; unit tested) ─────────────────────

/// Where a screenshot sits on the desktop. Screen values are in points (what CGEvent and
/// Accessibility use, top-left origin of the main display); the image is in its own pixels, after
/// the Retina capture was scaled down for the model.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub origin_x: f64,
    pub origin_y: f64,
    pub width_pt: f64,
    pub height_pt: f64,
    pub img_w: u32,
    pub img_h: u32,
}

/// Map a point in the screenshot to a global screen point. Points a little outside the image
/// (models sometimes overshoot an edge) are clamped onto the display; anything well outside is
/// rejected instead of clicking somewhere unexpected.
pub fn to_screen(f: &Frame, px: f64, py: f64) -> Result<(f64, f64), String> {
    if !px.is_finite() || !py.is_finite() || f.img_w == 0 || f.img_h == 0 {
        return Err("the click position wasn't a number".into());
    }
    let (w, h) = (f.img_w as f64, f.img_h as f64);
    let slack = 0.03;
    if px < -w * slack || py < -h * slack || px > w * (1.0 + slack) || py > h * (1.0 + slack) {
        return Err(format!("({px:.0}, {py:.0}) is outside the {}x{} screenshot", f.img_w, f.img_h));
    }
    let x = (px.clamp(0.0, w - 1.0) * f.width_pt / w).clamp(0.0, f.width_pt - 1.0);
    let y = (py.clamp(0.0, h - 1.0) * f.height_pt / h).clamp(0.0, f.height_pt - 1.0);
    Ok((f.origin_x + x, f.origin_y + y))
}

/// Image size sent to the model: at most IMG_MAX_W wide, aspect kept.
pub fn scaled_size(pw: u32, ph: u32) -> (u32, u32) {
    if pw > IMG_MAX_W && pw > 0 {
        (IMG_MAX_W, ((IMG_MAX_W as u64 * ph as u64 + pw as u64 / 2) / pw as u64) as u32)
    } else {
        (pw, ph)
    }
}

struct Shot {
    b64: String,
    frame: Frame,
}

fn capture() -> Result<Shot> {
    let mons = xcap::Monitor::all().map_err(|e| anyhow!("screen: {e}"))?;
    let m = mons.iter().find(|m| m.is_primary().unwrap_or(false)).or_else(|| mons.first()).ok_or_else(|| anyhow!("no display"))?;
    // the display's frame in points, straight from CoreGraphics: no guessing the Retina scale
    let (ox, oy) = (m.x().unwrap_or(0) as f64, m.y().unwrap_or(0) as f64);
    let (wpt, hpt) = (m.width().map_err(|e| anyhow!("screen: {e}"))? as f64, m.height().map_err(|e| anyhow!("screen: {e}"))? as f64);
    let img = xcap::image::DynamicImage::ImageRgba8(m.capture_image().map_err(|e| anyhow!("capture: {e}"))?);
    let (pw, ph) = (img.width(), img.height());
    let (iw, ih) = scaled_size(pw, ph);
    let img = if (iw, ih) != (pw, ph) { img.resize_exact(iw, ih, xcap::image::imageops::FilterType::Triangle) } else { img };
    let mut buf = Vec::new();
    xcap::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70).encode_image(&img.to_rgb8()).map_err(|e| anyhow!("jpeg: {e}"))?;
    Ok(Shot {
        b64: base64::engine::general_purpose::STANDARD.encode(buf),
        frame: Frame { origin_x: ox, origin_y: oy, width_pt: wpt.max(1.0), height_pt: hpt.max(1.0), img_w: iw, img_h: ih },
    })
}

fn emit(st: &Shared, kind: &str, text: &str) {
    st.emit(ev::AGENT, json!({ "kind": kind, "text": text }));
}

/// Perform one screen action. Returns the history line and how long to let the screen settle.
async fn act(st: &Shared, step: &Step, shot: &Shot) -> Result<(String, u64)> {
    match step {
        Step::OpenApp(name) => {
            let n = name.clone();
            tokio::task::spawn_blocking(move || platform::open_app(&n)).await??;
            emit(st, "step", &format!("Opening {name}"));
            Ok((format!("opened app {name}"), AFTER_NAV_MS))
        }
        Step::OpenUrl(url) => {
            let u = url::Url::parse(url).map_err(|e| anyhow!("bad url \"{url}\": {e}"))?;
            if !matches!(u.scheme(), "http" | "https") {
                bail!("only http(s) links can be opened");
            }
            tauri_plugin_opener::open_url(u.as_str(), None::<&str>)?;
            emit(st, "step", &format!("Opening {}", u.host_str().unwrap_or("page")));
            Ok((format!("opened {url}"), AFTER_NAV_MS))
        }
        Step::Click { x, y, what, double } => {
            let (sx, sy) = to_screen(&shot.frame, *x, *y).map_err(|e| anyhow!(e))?;
            let dbl = *double;
            // the click goes to the page, not to Flo's card sitting on top of it
            island_click_through(st, true);
            let r = tokio::task::spawn_blocking(move || click(sx, sy, dbl)).await;
            tokio::time::sleep(Duration::from_millis(150)).await; // let the window server deliver it
            island_click_through(st, false);
            let via = r??;
            log::info!("agent: clicked at ({sx:.0}, {sy:.0}) pt via {via} (image {x:.0}, {y:.0})");
            let label = if what.is_empty() { "there".to_string() } else { what.clone() };
            emit(st, "step", &format!("Clicking {label}"));
            Ok((format!("clicked {label} at ({x:.0}, {y:.0})"), AFTER_ACTION_MS))
        }
        Step::Type(t) => {
            let tt = t.clone();
            tokio::task::spawn_blocking(move || platform::type_text(&tt)).await??;
            emit(st, "step", &format!("Typing “{}”", text::truncate_chars(t, 40)));
            Ok((format!("typed \"{}\"", text::truncate_chars(t, 40)), AFTER_ACTION_MS))
        }
        Step::Key { name, cmd, shift, alt, ctrl } => {
            let code = platform::keycode_for(name).ok_or_else(|| anyhow!("unknown key \"{name}\" (use return, tab, escape, delete, arrows, space, pageup/pagedown, a-z, 0-9)"))?;
            let (c, sh, al, ct) = (*cmd, *shift, *alt, *ctrl);
            tokio::task::spawn_blocking(move || platform::key_press(code, c, sh, al, ct)).await??;
            let label = format!("{}{}{}{}{name}", if c { "cmd+" } else { "" }, if ct { "ctrl+" } else { "" }, if al { "alt+" } else { "" }, if sh { "shift+" } else { "" });
            emit(st, "step", &format!("Pressing {label}"));
            let settle = if name == "return" && !c { AFTER_ENTER_MS } else { AFTER_ACTION_MS };
            Ok((format!("pressed {label}"), settle))
        }
        Step::Scroll(dy) => {
            let d = *dy;
            tokio::task::spawn_blocking(move || platform::scroll_by(d)).await??;
            Ok(("scrolled".into(), AFTER_ACTION_MS))
        }
        Step::Wait(_) | Step::Done(_) | Step::Confirm(_) => bail!("not a screen action"),
    }
}

/// How a run ended without an error.
enum End {
    Done(String),
    Stopped(String),
}

const NEEDS_ACCESSIBILITY: &str = "Flo can't click or type for you yet. Turn on Flo in System Settings → Privacy & Security → Accessibility. If it's already on, select Flo, remove it with the minus button and add it again (macOS forgets it after an update).";
const NEEDS_SCREEN: &str = "Flo can't see your screen yet. Allow Flo in System Settings → Privacy & Security → Screen Recording, then try again.";
pub const BUSY: &str = "Screen control is already working on something. Say “stop” or press Stop first.";

/// Run the agent toward `goal`. Returns a short result summary. Every run that starts ends with
/// exactly one `done` / `aborted` / `error` event and a log line, within RUN_DEADLINE.
pub async fn run(st: &Shared, goal: &str) -> Result<String> {
    if RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        bail!(BUSY);
    }
    let _guard = RunGuard;
    RUNS.fetch_add(1, Ordering::SeqCst);
    st.agent_abort.store(false, Ordering::SeqCst);
    emit(st, "start", goal);
    let t0 = std::time::Instant::now();
    log::info!("agent: run started");
    let out = run_steps(st, goal, t0).await;
    // never leave Flo's card invisible or click-through (a step may have been cut off mid-way)
    island_alpha(st, 1.0);
    island_click_through(st, false);
    let secs = t0.elapsed().as_secs_f32();
    match out {
        Ok(End::Done(sum)) => {
            log::info!("agent: done in {secs:.1} s");
            emit(st, "done", &sum);
            Ok(sum)
        }
        Ok(End::Stopped(msg)) => {
            log::info!("agent: stopped after {secs:.1} s ({msg})");
            emit(st, "aborted", &msg);
            Ok(msg)
        }
        Err(e) => {
            log::warn!("agent: failed after {secs:.1} s: {e:#}");
            emit(st, "error", &e.to_string());
            Err(e)
        }
    }
}

async fn run_steps(st: &Shared, goal: &str, t0: std::time::Instant) -> Result<End> {
    let s = st.settings();
    if !s.assistant_cloud_allowed || !cfg::is_cloud_llm(&s.llm_provider) {
        bail!("Screen control needs a cloud vision model. Pick OpenAI, Anthropic or Gemini in Settings → AI and allow cloud for the assistant.");
    }
    if !llm::supports_vision(&s.llm_provider) {
        bail!("Your AI provider can't see the screen. Use Anthropic, OpenAI or Gemini for screen control.");
    }
    if !platform::permissions().screen {
        platform::open_permission_settings("screen");
        bail!(NEEDS_SCREEN);
    }
    if !can_control() {
        platform::open_permission_settings("accessibility");
        bail!(NEEDS_ACCESSIBILITY);
    }
    let cfgl = LlmConfig::from_settings(&s);
    let abort = &st.agent_abort;
    let mut history: Vec<String> = vec![];
    let mut confirms = 0usize;
    let mut fails = 0usize;
    let limit = |own: Duration| step_limit(own, t0.elapsed(), RUN_DEADLINE);
    let too_long = || anyhow!("That took longer than {} minutes, so I stopped. Try a shorter request.", RUN_DEADLINE.as_secs() / 60);

    for step in 0..MAX_STEPS {
        if abort.load(Ordering::SeqCst) {
            return Ok(End::Stopped("Stopped.".into()));
        }
        if t0.elapsed() >= RUN_DEADLINE {
            return Err(too_long());
        }
        let shot = match guarded(abort, limit(CAPTURE_TIMEOUT), capture_clean(st)).await {
            Ok(s) => s,
            Err(Halt::Aborted) => return Ok(End::Stopped("Stopped.".into())),
            Err(Halt::TimedOut) => bail!("Taking a screenshot took too long. Try again."),
            Err(Halt::Failed(e)) => bail!("Couldn't take a screenshot ({e}). Check Screen Recording for Flo in System Settings."),
        };
        let user = format!(
            "GOAL: {goal}\nScreenshot size: {}x{} px.\nActions so far:\n{}\n\nReturn the single next action as JSON.",
            shot.frame.img_w,
            shot.frame.img_h,
            if history.is_empty() { "(none)".into() } else { history.join("\n") }
        );
        let system = system_prompt();
        let ask = llm::chat(
            &st.egress,
            &cfgl,
            ChatRequest {
                system: &system,
                user: &user,
                image_b64: Some(("image/jpeg", &shot.b64)),
                json: true,
                purpose: Purpose::Assistant,
                cloud_allowed: true,
                max_tokens: 300,
            },
        );
        let t_llm = std::time::Instant::now();
        let raw = match guarded(abort, limit(LLM_STEP_TIMEOUT), ask).await {
            Ok(r) => r,
            Err(Halt::Aborted) => return Ok(End::Stopped("Stopped.".into())),
            Err(Halt::TimedOut) if t0.elapsed() >= RUN_DEADLINE => return Err(too_long()),
            Err(Halt::TimedOut) => bail!("The AI didn't answer within {} seconds, so I stopped. Try again.", LLM_STEP_TIMEOUT.as_secs()),
            Err(Halt::Failed(e)) => return Err(e),
        };
        let parsed = parse_step(&raw);
        let step_kind = parsed.as_ref().map(Step::kind).unwrap_or("unreadable");
        log::info!("agent step {step}: {step_kind} ({} ms)", t_llm.elapsed().as_millis());
        let next = match parsed {
            Ok(s) => s,
            Err(why) => {
                fails += 1;
                log::warn!("agent step {step}: unusable reply ({why}): {}", text::truncate_chars(&raw, 160));
                history.push(format!("FAILED: {why}. Reply with exactly one JSON object like {{\"action\":\"click\",\"x\":100,\"y\":200,\"what\":\"...\"}}"));
                if fails >= MAX_FAILS_IN_A_ROW {
                    bail!("The AI didn't return an action I could do. Try rephrasing the request.");
                }
                continue;
            }
        };
        let mut pause = AFTER_ACTION_MS;

        match &next {
            Step::Done(sum) => return Ok(End::Done(sum.clone())),
            Step::Confirm(q) => {
                confirms += 1;
                // agent mode answers by voice (short wait); otherwise the island's Yes / No buttons
                let voice = crate::handsfree::is_active();
                st.emit(ev::AGENT, json!({ "kind": "confirm", "text": q, "voice": voice }));
                let wait = Duration::from_secs(if voice { VOICE_CONFIRM_SECS } else { BUTTON_CONFIRM_SECS });
                let (answer, aborted) = wait_for_answer(st, q, wait).await;
                match confirm_outcome(answer, q, aborted, confirms) {
                    ConfirmOutcome::Proceed { history_line } => {
                        history.push(history_line);
                        emit(st, "step", "Confirmed, continuing");
                    }
                    ConfirmOutcome::Stop { message } => return Ok(End::Stopped(message)),
                }
                pause = 0;
            }
            Step::Wait(ms) => {
                history.push(format!("waited {ms} ms"));
                pause = *ms;
            }
            _ => match guarded(abort, limit(ACTION_TIMEOUT), act(st, &next, &shot)).await {
                Ok((line, wait_ms)) => {
                    fails = 0;
                    history.push(line);
                    pause = wait_ms;
                }
                Err(Halt::Aborted) => return Ok(End::Stopped("Stopped.".into())),
                Err(h) => {
                    let e = match h {
                        Halt::Failed(e) => e,
                        _ => anyhow!("it took too long"),
                    };
                    fails += 1;
                    log::warn!("agent step {step}: {step_kind} failed: {e:#}");
                    history.push(format!("FAILED {step_kind}: {e}. Try a different way."));
                    if fails >= MAX_FAILS_IN_A_ROW {
                        bail!("{e}");
                    }
                }
            },
        }
        // let the screen settle (Stop still works)
        if pause > 0 {
            let settle = async {
                tokio::time::sleep(Duration::from_millis(pause)).await;
                Ok(())
            };
            if let Err(Halt::Aborted) = guarded(abort, Duration::from_millis(pause + 50), settle).await {
                return Ok(End::Stopped("Stopped.".into()));
            }
        }
    }
    Ok(End::Done("Reached the step limit, so I stopped here.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yes_continues_with_the_approval_in_history() {
        match confirm_outcome(Some(true), "Send the email to Rahul?", false, 1) {
            ConfirmOutcome::Proceed { history_line } => {
                assert!(history_line.starts_with("USER CONFIRMED"));
                assert!(history_line.contains("Send the email to Rahul?"));
            }
            o => panic!("expected proceed, got {o:?}"),
        }
    }

    #[test]
    fn no_timeout_or_abort_never_acts() {
        assert!(matches!(confirm_outcome(Some(false), "Buy it?", false, 1), ConfirmOutcome::Stop { .. }));
        assert!(matches!(confirm_outcome(None, "Buy it?", false, 1), ConfirmOutcome::Stop { .. }));
        // stop wins even over a yes that raced in
        assert!(matches!(confirm_outcome(Some(true), "Buy it?", true, 1), ConfirmOutcome::Stop { .. }));
    }

    #[test]
    fn a_model_that_keeps_asking_is_stopped() {
        assert!(matches!(confirm_outcome(Some(true), "Post?", false, MAX_CONFIRMS), ConfirmOutcome::Proceed { .. }));
        assert!(matches!(confirm_outcome(Some(true), "Post?", false, MAX_CONFIRMS + 1), ConfirmOutcome::Stop { .. }));
    }

    // ── response parsing ──
    #[test]
    fn parses_the_documented_actions() {
        assert_eq!(parse_step(r#"{"action":"click","x":640,"y":120,"what":"Search"}"#), Ok(Step::Click { x: 640.0, y: 120.0, what: "Search".into(), double: false }));
        assert_eq!(parse_step(r#"{"action":"double_click","x":1,"y":2}"#).map(|s| s.kind()), Ok("double_click"));
        assert_eq!(parse_step(r#"{"action":"open_app","name":"Safari"}"#), Ok(Step::OpenApp("Safari".into())));
        assert_eq!(parse_step(r#"{"action":"type","text":"lofi beats"}"#), Ok(Step::Type("lofi beats".into())));
        assert_eq!(parse_step(r#"{"action":"scroll","dy":-4}"#), Ok(Step::Scroll(-4)));
        assert_eq!(parse_step(r#"{"action":"wait","ms":99999}"#), Ok(Step::Wait(4000)));
        assert_eq!(parse_step(r#"{"action":"done","summary":"Playing."}"#), Ok(Step::Done("Playing.".into())));
        assert_eq!(parse_step(r#"{"action":"confirm","summary":"Send it?"}"#), Ok(Step::Confirm("Send it?".into())));
        assert_eq!(
            parse_step(r#"{"action":"key","name":"l","cmd":true}"#),
            Ok(Step::Key { name: "l".into(), cmd: true, shift: false, alt: false, ctrl: false })
        );
    }

    #[test]
    fn parses_the_shapes_models_really_send() {
        // fenced, with prose around it
        assert_eq!(parse_step("Sure!\n```json\n{\"action\":\"click\",\"x\":\"10\",\"y\":\"20\"}\n```").map(|s| s.kind()), Ok("click"));
        // Anthropic computer-use style
        assert_eq!(
            parse_step(r#"{"action":"left_click","coordinate":[300,400]}"#),
            Ok(Step::Click { x: 300.0, y: 400.0, what: String::new(), double: false })
        );
        assert_eq!(
            parse_step(r#"{"action":"key","text":"cmd+shift+t"}"#),
            Ok(Step::Key { name: "t".into(), cmd: true, shift: true, alt: false, ctrl: false })
        );
        assert_eq!(parse_step(r#"{"action":"key","name":"Enter"}"#).map(|s| match s { Step::Key { name, .. } => name, _ => String::new() }), Ok("return".into()));
        // wrapped in a list
        assert_eq!(parse_step(r#"{"actions":[{"action":"open_url","url":"https://youtube.com"}]}"#), Ok(Step::OpenUrl("https://youtube.com".into())));
        // nested object
        assert_eq!(parse_step(r#"{"action":{"action":"type","text":"hi"}}"#), Ok(Step::Type("hi".into())));
    }

    #[test]
    fn an_unreadable_reply_is_an_error_never_done() {
        assert!(parse_step("I'll click the search box now.").is_err());
        assert!(parse_step(r#"{"thought":"click search"}"#).is_err());
        assert!(parse_step(r#"{"action":"click","what":"no coords"}"#).is_err());
        assert!(parse_step(r#"{"action":"click","x":"left","y":3}"#).is_err());
        assert!(parse_step(r#"{"action":"type","text":""}"#).is_err());
        assert!(parse_step(r#"{"action":"fly"}"#).unwrap_err().contains("unknown action"));
    }

    #[test]
    fn key_combos() {
        assert_eq!(split_combo("Command-L"), ("l".into(), (true, false, false, false)));
        assert_eq!(split_combo("ctrl+alt+Delete"), ("delete".into(), (false, false, true, true)));
        assert_eq!(split_combo("esc"), ("escape".into(), (false, false, false, false)));
        assert_eq!(split_combo("Return").0, "return");
    }

    // ── coordinates ──
    const RETINA: Frame = Frame { origin_x: 0.0, origin_y: 0.0, width_pt: 1512.0, height_pt: 982.0, img_w: 1366, img_h: 887 };

    #[test]
    fn screenshot_pixels_map_to_points_on_retina() {
        // a 3024x1964 px capture of a 1512x982 pt display is sent as 1366x887
        assert_eq!(scaled_size(3024, 1964), (1366, 887));
        let (x, y) = to_screen(&RETINA, 683.0, 443.5).unwrap();
        assert!((x - 756.0).abs() < 0.5 && (y - 491.0).abs() < 0.5, "centre maps to centre: {x},{y}");
        assert_eq!(to_screen(&RETINA, 0.0, 0.0).unwrap(), (0.0, 0.0));
        let (x, y) = to_screen(&RETINA, 1365.0, 886.0).unwrap();
        assert!(x <= 1511.0 && y <= 981.0 && x > 1509.0 && y > 979.0);
    }

    #[test]
    fn non_retina_and_small_screens_are_not_scaled() {
        assert_eq!(scaled_size(1280, 800), (1280, 800));
        let f = Frame { origin_x: 0.0, origin_y: 0.0, width_pt: 1280.0, height_pt: 800.0, img_w: 1280, img_h: 800 };
        assert_eq!(to_screen(&f, 100.0, 200.0).unwrap(), (100.0, 200.0));
    }

    #[test]
    fn a_display_away_from_the_origin_is_offset() {
        // a second display to the left of / above the main one has a negative origin
        let f = Frame { origin_x: -1920.0, origin_y: -300.0, width_pt: 1920.0, height_pt: 1080.0, img_w: 1366, img_h: 768 };
        let (x, y) = to_screen(&f, 683.0, 384.0).unwrap();
        assert!((x - -960.0).abs() < 0.5 && (y - 240.0).abs() < 0.5, "{x},{y}");
    }

    #[test]
    fn overshoot_is_clamped_but_wild_points_are_refused() {
        let (x, y) = to_screen(&RETINA, 1370.0, -5.0).unwrap();
        assert!(x <= 1511.0 && y == 0.0);
        assert!(to_screen(&RETINA, 3024.0, 100.0).is_err(), "a point in Retina pixels instead of screenshot pixels");
        assert!(to_screen(&RETINA, f64::NAN, 1.0).is_err());
        assert!(to_screen(&Frame { img_w: 0, ..RETINA }, 1.0, 1.0).is_err());
    }

    // ── time limits / Stop ──
    #[test]
    fn steps_never_run_past_the_deadline() {
        assert_eq!(step_limit(Duration::from_secs(45), Duration::from_secs(10), RUN_DEADLINE), Duration::from_secs(45));
        assert_eq!(step_limit(Duration::from_secs(45), RUN_DEADLINE - Duration::from_secs(5), RUN_DEADLINE), Duration::from_secs(5));
        assert_eq!(step_limit(Duration::from_secs(45), RUN_DEADLINE + Duration::from_secs(5), RUN_DEADLINE), Duration::ZERO);
    }

    #[tokio::test]
    async fn a_hung_step_times_out() {
        let abort = AtomicBool::new(false);
        let r = guarded(&abort, Duration::from_millis(50), async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(())
        })
        .await;
        assert!(matches!(r, Err(Halt::TimedOut)));
    }

    #[tokio::test]
    async fn stop_interrupts_a_step_in_flight() {
        let abort = std::sync::Arc::new(AtomicBool::new(false));
        let a2 = abort.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            a2.store(true, Ordering::SeqCst);
        });
        let t0 = std::time::Instant::now();
        let r = guarded(&abort, Duration::from_secs(30), async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(())
        })
        .await;
        assert!(matches!(r, Err(Halt::Aborted)));
        assert!(t0.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn results_and_errors_pass_through() {
        let abort = AtomicBool::new(false);
        assert!(matches!(guarded(&abort, Duration::from_secs(1), async { Ok(7) }).await, Ok(7)));
        let r: Result<(), Halt> = guarded(&abort, Duration::from_secs(1), async { Err(anyhow!("boom")) }).await;
        assert!(matches!(r, Err(Halt::Failed(e)) if e.to_string() == "boom"));
    }

    #[test]
    fn user_facing_copy_has_no_em_dashes() {
        for s in [NEEDS_ACCESSIBILITY, NEEDS_SCREEN, BUSY] {
            assert!(!s.contains('—'), "{s}");
        }
        for o in [confirm_outcome(Some(false), "q", false, 1), confirm_outcome(Some(true), "q", false, MAX_CONFIRMS + 1), confirm_outcome(None, "q", false, 1)] {
            if let ConfirmOutcome::Stop { message } = o {
                assert!(!message.contains('—'), "{message}");
            }
        }
    }

    #[test]
    fn answering_with_nothing_pending_is_a_no_op() {
        assert!(!answer_confirm(true));
    }
}
