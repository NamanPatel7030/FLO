//! Automatic meeting notes, like Fathom but without a bot: for a Google Calendar meeting whose
//! "Take notes" is on, Flo starts recording once the meeting app is really in the call, and stops
//! when the call ends.
//!
//! The decision is a small state machine (`Machine::step`, pure and unit tested) fed every ~4 s by
//! `meeting_detect.rs` with what it can see without listening or looking at content:
//! - which apps hold a microphone (Core Audio process objects / PulseAudio / the Windows consent
//!   store), Flo itself excluded, so the call stays visible while Flo records too;
//! - titles of in-call meeting windows (a Meet tab "Meet - abc-defg-hij", Zoom's "Zoom Meeting",
//!   a Teams meeting window), and whether Zoom's meeting process runs;
//! - while recording: how long ago the call track last had speech.
//!
//! Start: Idle + a notes-on event from 5 min before its start until its end + evidence of a call
//! (a meeting app holds the mic AND a meeting window / Zoom's meeting process / a dedicated call
//! app) on two looks in a row (~8 s). Nothing is recorded before that, and never outside a call.
//! Stop: no sign of the call for 20 s (left the call, window closed), or a meeting window left
//! open with no call app on the mic and no call audio for 3 min (1 min after the event's end +
//! 10 min), or the next meeting begins (back-to-back). The user stopping it is final for that
//! meeting; a call that dropped and is rejoined continues as "part 2".
use crate::google::{self, CalendarEvent};
use crate::state::Shared;
use std::collections::{HashMap, HashSet};

/// looks in a row with call evidence before recording starts (~8 s)
pub const START_TICKS: u32 = 2;
/// a meeting's call may begin this early
pub const LEAD_SECS: i64 = 5 * 60;
/// no sign of the call at all for this long → it ended
pub const ENDED_SECS: i64 = 20;
/// a meeting window still open, but no call app on the mic and no call audio for this long → ended
pub const QUIET_SECS: i64 = 180;
/// after the event's end + `GRACE_SECS`, the quiet limit drops to `AFTER_GRACE_QUIET_SECS`
pub const GRACE_SECS: i64 = 10 * 60;
pub const AFTER_GRACE_QUIET_SECS: i64 = 60;
/// call audio this recent counts as "the call is on"
pub const AUDIO_RECENT_SECS: u64 = 20;

// ── signals (pure classification) ─────────────────────────────────────────────

/// A window that shows a call in progress.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CallWindow {
    pub app: String,
    pub title: String,
    /// meet | zoom | teams | other
    pub kind: &'static str,
    /// Google Meet's meeting code ("abc-defg-hij") when the title shows it
    pub code: Option<String>,
}

/// One look at the computer (no audio, no screen content).
#[derive(Debug, Clone, Default)]
pub struct Signals {
    /// apps (bundle ids / process names) holding a microphone, Flo excluded; None = can't tell
    pub mic_apps: Option<Vec<String>>,
    /// the microphone is in use by anyone (fallback when `mic_apps` is None; Flo not recording)
    pub mic_any: bool,
    /// windows showing a call
    pub windows: Vec<CallWindow>,
    /// Zoom's meeting process runs
    pub zoom_meeting: bool,
    /// seconds since the recording's call track last had speech (None: no call track)
    pub call_audio_ago: Option<u64>,
    /// the call app is on the Attention denylist: never record it
    pub denied: bool,
}

const BROWSERS: &[&str] = &["chrome", "safari", "webkit", "arc", "thebrowser", "edge", "edgemac", "brave", "firefox", "mozilla", "vivaldi", "opera", "dia"];
const CALL_APPS: &[&str] = &["zoom", "teams", "webex", "facetime", "slack", "discord", "whereby", "skype", "around", "gotomeeting", "chime"];

fn has_any(hay: &str, needles: &[&str]) -> bool {
    let h = hay.to_lowercase();
    needles.iter().any(|n| h.contains(n))
}

/// A browser (its name, bundle id or helper process).
pub fn is_browser(app: &str) -> bool {
    has_any(app, BROWSERS)
}

/// A desktop call app (Zoom, Teams, Webex…).
pub fn is_call_app(app: &str) -> bool {
    has_any(app, CALL_APPS)
}

/// "abc-defg-hij" (Google Meet's code shape) anywhere in the text.
pub fn meet_code(text: &str) -> Option<String> {
    let t = text.to_lowercase();
    t.split(|c: char| !(c.is_ascii_lowercase() || c == '-'))
        .find(|w| {
            let p: Vec<&str> = w.split('-').collect();
            p.len() == 3 && p[0].len() == 3 && p[1].len() == 4 && p[2].len() == 3
        })
        .map(String::from)
}

/// Does this window (app name, title) show a call in progress?
pub fn classify_window(app: &str, title: &str) -> Option<CallWindow> {
    let (a, t) = (app.to_lowercase(), title.to_lowercase());
    let mk = |kind: &'static str, code: Option<String>| Some(CallWindow { app: app.to_string(), title: title.to_string(), kind, code });
    if is_browser(&a) {
        // Meet in a call (or its join screen): "Meet - abc-defg-hij" / "Meet – Weekly sync"
        if t.starts_with("meet - ") || t.starts_with("meet – ") || t.starts_with("meet — ") || t.contains("meet.google.com/") {
            return mk("meet", meet_code(&t));
        }
        if t.contains("microsoft teams") && (t.contains("meeting") || t.contains("call")) {
            return mk("teams", None);
        }
        if t.contains("zoom meeting") || t.contains("zoom webinar") {
            return mk("zoom", None);
        }
        return None;
    }
    if a.starts_with("zoom") {
        return (t.contains("zoom meeting") || t.contains("zoom webinar")).then(|| mk("zoom", None)).flatten();
    }
    if a.contains("teams") {
        let views = ["chat |", "activity |", "calendar |", "teams |", "files |", "apps |", "calls |", "onedrive |"];
        return ((t.contains("meeting") || t.contains("call")) && !views.iter().any(|v| t.starts_with(v))).then(|| mk("teams", None)).flatten();
    }
    if a.contains("webex") && t.contains("meeting") {
        return mk("other", None);
    }
    None
}

/// Is a meeting app holding the microphone? None = can't tell (old macOS).
pub fn meeting_app_on_mic(sig: &Signals) -> Option<bool> {
    sig.mic_apps.as_ref().map(|apps| apps.iter().any(|a| is_browser(a) || is_call_app(a)))
}

/// Evidence that a call is in progress right now: a meeting app holds the mic, and a meeting
/// window, Zoom's meeting process or a dedicated call app on the mic says it's a call (a browser
/// using the mic alone is not enough).
pub fn in_call(sig: &Signals) -> bool {
    if sig.denied {
        return false;
    }
    let mic = meeting_app_on_mic(sig).unwrap_or(sig.mic_any);
    let dedicated = sig.mic_apps.as_ref().is_some_and(|apps| apps.iter().any(|a| is_call_app(a) && !is_browser(a)));
    mic && (!sig.windows.is_empty() || sig.zoom_meeting || dedicated)
}

// ── the state machine (pure) ──────────────────────────────────────────────────

/// A notes-on calendar meeting, as the machine needs it.
#[derive(Debug, Clone, PartialEq)]
pub struct Ev {
    /// occurrence id (event id + start)
    pub occ: String,
    pub title: String,
    /// unix seconds
    pub start: i64,
    pub end: i64,
    pub join_url: Option<String>,
    /// Meet code from the join link
    pub code: Option<String>,
}

impl Ev {
    pub fn from_event(e: &CalendarEvent) -> Option<Ev> {
        Some(Ev {
            occ: google::alert_id(e),
            title: e.title.clone(),
            start: google::start_of(e, &chrono::Utc)?.timestamp(),
            end: google::end_of(e, &chrono::Utc)?.timestamp(),
            join_url: e.join_url.clone(),
            code: e.join_url.as_deref().filter(|_| e.join_kind.as_deref() == Some("meet")).and_then(meet_code),
        })
    }
}

/// The meetings auto-notes may record now: agenda meetings with "Take notes" on.
pub fn candidates(events: &[CalendarEvent], prefs: &HashMap<String, bool>) -> Vec<Ev> {
    events.iter().filter(|e| google::is_agenda_meeting(e) && google::notes_on(e, prefs)).filter_map(Ev::from_event).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// the meeting app left the call / the window closed
    CallEnded,
    /// a meeting window stayed open, but nobody's on the call any more
    NoCallAudio,
    /// back-to-back: the next meeting began
    NextMeeting,
}

impl StopReason {
    pub fn text(self) -> &'static str {
        match self {
            StopReason::CallEnded => "the call ended",
            StopReason::NoCallAudio => "the call went quiet",
            StopReason::NextMeeting => "the next meeting started",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    None,
    /// start recording this meeting (`part` > 1: rejoined after the call dropped)
    Start { ev: Ev, part: u32 },
    Stop { occ: String, note_id: String, reason: StopReason },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rec {
    pub ev: Ev,
    pub note_id: String,
    /// no sign of the call since (unix s)
    pub gone_since: Option<i64>,
    /// no call app on the mic and no call audio since
    pub quiet_since: Option<i64>,
}

/// What `step` is told about the world besides the signals.
#[derive(Debug, Clone, Default)]
pub struct Ctx<'a> {
    /// automatic notes on (and agreed to)
    pub enabled: bool,
    /// notes-on meetings (see `candidates`)
    pub events: &'a [Ev],
    /// the note being recorded right now, by anyone (None: nothing records)
    pub recording: Option<&'a str>,
}

#[derive(Debug, Default)]
pub struct Machine {
    pub rec: Option<Rec>,
    ticks: u32,
    /// occurrences not to start again: the user stopped them, or starting failed
    handled: HashSet<String>,
    /// recordings started per occurrence (the next one is "part N")
    parts: HashMap<String, u32>,
}

impl Machine {
    /// The meeting a call now belongs to: the one whose Meet code is on screen, else the most
    /// recently started one (back-to-back: the next has begun), else the next to start within
    /// `LEAD_SECS`.
    pub fn pick<'e>(&self, now: i64, events: &'e [Ev], sig: &Signals, exclude: Option<&str>) -> Option<&'e Ev> {
        let open: Vec<&Ev> = events.iter().filter(|e| e.start - LEAD_SECS <= now && now < e.end && !self.handled.contains(&e.occ) && Some(e.occ.as_str()) != exclude).collect();
        let codes: Vec<&str> = sig.windows.iter().filter_map(|w| w.code.as_deref()).collect();
        if let Some(e) = open.iter().find(|e| e.code.as_deref().is_some_and(|c| codes.contains(&c))) {
            return Some(e);
        }
        if let Some(e) = open.iter().filter(|e| e.start <= now).max_by_key(|e| e.start) {
            return Some(e);
        }
        open.into_iter().min_by_key(|e| e.start)
    }

    /// One look. Returns what to do; the caller then reports back with `started` / `start_failed`.
    pub fn step(&mut self, now: i64, ctx: &Ctx, sig: &Signals) -> Action {
        if let Some(rec) = self.rec.clone() {
            if ctx.recording != Some(rec.note_id.as_str()) {
                // stopped from the notch / Notes / by voice: the user's call, don't start it again
                self.handled.insert(rec.ev.occ.clone());
                self.rec = None;
                self.ticks = 0;
                return Action::None;
            }
            return self.while_recording(now, ctx, sig, rec);
        }
        if !ctx.enabled || ctx.recording.is_some() {
            // off, or the user is already recording by hand: leave it alone
            self.ticks = 0;
            return Action::None;
        }
        let Some(ev) = self.pick(now, ctx.events, sig, None).cloned() else {
            self.ticks = 0;
            return Action::None;
        };
        if !in_call(sig) {
            self.ticks = 0;
            return Action::None;
        }
        self.ticks += 1;
        if self.ticks < START_TICKS {
            return Action::None;
        }
        self.ticks = 0;
        let part = self.parts.get(&ev.occ).copied().unwrap_or(0) + 1;
        Action::Start { ev, part }
    }

    fn while_recording(&mut self, now: i64, ctx: &Ctx, sig: &Signals, mut rec: Rec) -> Action {
        let audio = sig.call_audio_ago.is_some_and(|a| a <= AUDIO_RECENT_SECS);
        let mic = meeting_app_on_mic(sig);
        let window = !sig.windows.is_empty() && !sig.denied;
        // can't see who holds the mic (old macOS): the meeting window counts until the grace ends
        let strong = mic == Some(true) || sig.zoom_meeting || audio || (mic.is_none() && window && now <= rec.ev.end + GRACE_SECS);
        let stop = |m: &mut Machine, reason| {
            m.rec = None;
            m.ticks = 0;
            Action::Stop { occ: rec.ev.occ.clone(), note_id: rec.note_id.clone(), reason }
        };
        // back-to-back: another meeting's Meet code on screen, or the next meeting has begun after
        // this one ended (and the call isn't still this meeting's)
        let codes: Vec<&str> = sig.windows.iter().filter_map(|w| w.code.as_deref()).collect();
        let ours_on_screen = rec.ev.code.as_deref().is_some_and(|c| codes.contains(&c));
        if let Some(next) = self.pick(now, ctx.events, sig, Some(&rec.ev.occ)) {
            let next_on_screen = next.code.as_deref().is_some_and(|c| codes.contains(&c));
            let begun = now >= next.start && now >= rec.ev.end;
            if (next_on_screen && !ours_on_screen) || (begun && !ours_on_screen && next.join_url != rec.ev.join_url) {
                return stop(self, StopReason::NextMeeting);
            }
        }
        if strong || window {
            rec.gone_since = None;
        } else {
            let since = *rec.gone_since.get_or_insert(now);
            if now - since >= ENDED_SECS {
                return stop(self, StopReason::CallEnded);
            }
        }
        if strong {
            rec.quiet_since = None;
        } else {
            let since = *rec.quiet_since.get_or_insert(now);
            let limit = if now > rec.ev.end + GRACE_SECS { AFTER_GRACE_QUIET_SECS } else { QUIET_SECS };
            if now - since >= limit {
                return stop(self, StopReason::NoCallAudio);
            }
        }
        self.rec = Some(rec);
        Action::None
    }

    /// Recording of `ev` began as note `note_id`.
    pub fn started(&mut self, ev: Ev, note_id: String) {
        *self.parts.entry(ev.occ.clone()).or_default() += 1;
        self.rec = Some(Rec { ev, note_id, gone_since: None, quiet_since: None });
    }

    /// Starting failed (no microphone…): don't retry this meeting every 4 s.
    pub fn start_failed(&mut self, occ: &str) {
        self.handled.insert(occ.to_string());
    }

    pub fn recording_occ(&self) -> Option<&str> {
        self.rec.as_ref().map(|r| r.ev.occ.as_str())
    }
}

// ── runtime ───────────────────────────────────────────────────────────────────

static MACHINE: parking_lot::Mutex<Option<Machine>> = parking_lot::Mutex::new(None);

/// The calendar occurrence Flo is recording automatically right now (Home's agenda).
pub fn recording_occurrence() -> Option<String> {
    MACHINE.lock().as_ref().and_then(|m| m.recording_occ().map(String::from))
}

/// Automatic notes are on and agreed to, and the calendar is connected.
pub fn enabled(st: &Shared) -> bool {
    let g = st.settings().google;
    g.auto_notes && g.auto_notes_consent && google::calendar_on(&g)
}

/// Is a look worth taking? Only around a notes-on meeting or while recording one (keeps the 4 s
/// loop free when the day has no meetings).
pub fn wants_look(now: i64, events: &[Ev], recording_auto: bool) -> bool {
    recording_auto || events.iter().any(|e| e.start - LEAD_SECS <= now && now < e.end)
}

/// Meeting windows on screen (titles only; browsers and call apps; never Flo's own, never
/// denylisted apps). Titles come from the window list, or from accessibility when the window list
/// hides them (no Screen Recording permission).
fn call_windows(denylist: &[String]) -> Vec<CallWindow> {
    let me = std::process::id();
    let Ok(all) = xcap::Window::all() else { return vec![] };
    let mut out = vec![];
    let mut ax_done: HashSet<u32> = HashSet::new();
    for w in all {
        let app = w.app_name().unwrap_or_default();
        let pid = w.pid().unwrap_or(0);
        if pid == me || app.is_empty() || !(is_browser(&app) || is_call_app(&app)) || crate::meet_screen::denied(&app, denylist) {
            continue;
        }
        let title = w.title().unwrap_or_default();
        if !title.is_empty() {
            if let Some(c) = classify_window(&app, &title) {
                out.push(c);
            }
        } else if ax_done.insert(pid) {
            for t in crate::platform::app_window_titles(pid as i32) {
                if let Some(c) = classify_window(&app, &t) {
                    out.push(c);
                }
            }
        }
    }
    out
}

/// Take one look (blocking: Core Audio, window list, accessibility).
pub fn look(denylist: &[String], recording: bool) -> Signals {
    let mic_apps = crate::platform::mic_users_others();
    // device-wide "mic in use" only means someone else while Flo itself isn't recording
    let mic_any = mic_apps.is_none() && !recording && crate::platform::mic_in_use();
    let denied_mic = mic_apps.as_ref().is_some_and(|apps| apps.iter().any(|a| !a.is_empty() && crate::meet_screen::denied(a, denylist)));
    Signals {
        windows: call_windows(denylist),
        zoom_meeting: crate::platform::zoom_in_meeting(),
        call_audio_ago: crate::meeting::call_audio_ago(),
        denied: denied_mic,
        mic_apps,
        mic_any,
    }
}

/// One tick of automatic notes (called by `meeting_detect` every ~4 s). Returns true when Flo is
/// recording a meeting automatically (so the "Take notes?" prompt stays quiet).
pub async fn tick(st: &Shared) -> bool {
    let on = enabled(st);
    let recording_auto = recording_occurrence().is_some();
    if !on && !recording_auto {
        return false;
    }
    let events = if on { candidates(&google::cached_events(st), &google::notes_prefs(st)) } else { vec![] };
    let now = chrono::Utc::now().timestamp();
    if !wants_look(now, &events, recording_auto) {
        return false;
    }
    let current = st.meeting.lock().as_ref().map(|h| h.note_id.clone());
    let denylist = st.settings().attention_denylist;
    let rec = current.is_some();
    let sig = tokio::task::spawn_blocking(move || look(&denylist, rec)).await.unwrap_or_default();
    let action = {
        let mut g = MACHINE.lock();
        let m = g.get_or_insert_with(Machine::default);
        m.step(now, &Ctx { enabled: on, events: &events, recording: current.as_deref() }, &sig)
    };
    match action {
        Action::None => {}
        Action::Start { ev, part } => {
            let Some(e) = google::cached_events(st).into_iter().find(|e| google::alert_id(e) == ev.occ) else { return false };
            let st2 = st.clone();
            let e2 = e.clone();
            let res = tokio::task::spawn_blocking(move || crate::meeting::start_for_event(st2, &e2, true, part)).await.unwrap_or_else(|e| Err(anyhow::anyhow!(e.to_string())));
            match res {
                Ok(note) => {
                    log::info!("autonotes: started \"{}\" (part {part})", ev.title);
                    if let Some(m) = MACHINE.lock().as_mut() {
                        m.started(ev.clone(), note.id.clone());
                    }
                    st.emit(google::EV_AGENDA, ());
                    st.toast("info", format!("Taking notes: {}", note.title));
                    if st.settings().system_notifications {
                        crate::reminders::notify("Flo is taking notes", &format!("{}. Stop anytime from the notch.", note.title));
                    }
                }
                Err(err) => {
                    log::warn!("autonotes: couldn't start \"{}\": {err}", ev.title);
                    if let Some(m) = MACHINE.lock().as_mut() {
                        m.start_failed(&ev.occ);
                    }
                    st.toast("error", format!("Couldn't take notes for {}: {err}", ev.title));
                }
            }
        }
        Action::Stop { occ, note_id, reason } => {
            log::info!("autonotes: stopping {occ} ({})", reason.text());
            if st.meeting.lock().as_ref().map(|h| h.note_id == note_id).unwrap_or(false) {
                let _ = crate::meeting::stop(st.clone()).await;
                st.toast("info", format!("Stopped taking notes: {}. Writing them up…", reason.text()));
            }
            st.emit(google::EV_AGENDA, ());
        }
    }
    recording_occurrence().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_800_000_000; // a meeting starts here

    fn ev(occ: &str, start: i64, mins: i64, url: Option<&str>) -> Ev {
        Ev { occ: occ.into(), title: occ.into(), start, end: start + mins * 60, join_url: url.map(String::from), code: url.and_then(meet_code) }
    }
    fn meet_window(code: &str) -> CallWindow {
        classify_window("Google Chrome", &format!("Meet - {code}")).unwrap()
    }
    /// Chrome on the mic with the Meet tab in a call
    fn in_meet(code: &str) -> Signals {
        Signals { mic_apps: Some(vec!["com.google.Chrome.helper".into()]), windows: vec![meet_window(code)], ..Default::default() }
    }
    fn nothing() -> Signals {
        Signals { mic_apps: Some(vec![]), ..Default::default() }
    }
    /// run `sig` from `from` to `to` every 4 s; returns the first non-None action and its time
    fn run(m: &mut Machine, events: &[Ev], rec: &mut Option<String>, from: i64, to: i64, sig: &Signals) -> Option<(i64, Action)> {
        let mut t = from;
        while t <= to {
            let sig = Signals { call_audio_ago: if rec.is_some() { sig.call_audio_ago } else { None }, ..sig.clone() };
            let a = m.step(t, &Ctx { enabled: true, events, recording: rec.as_deref() }, &sig);
            match &a {
                Action::Start { ev, .. } => {
                    let id = format!("note-{}-{}", ev.occ, t);
                    m.started(ev.clone(), id.clone());
                    *rec = Some(id);
                    return Some((t, a));
                }
                Action::Stop { .. } => {
                    *rec = None;
                    return Some((t, a));
                }
                Action::None => {}
            }
            t += 4;
        }
        None
    }

    #[test]
    fn classifies_call_windows() {
        let w = classify_window("Google Chrome", "Meet - abc-defg-hij").unwrap();
        assert_eq!((w.kind, w.code.as_deref()), ("meet", Some("abc-defg-hij")));
        assert_eq!(classify_window("Arc", "Meet – Weekly sync").unwrap().kind, "meet");
        assert!(classify_window("Google Chrome", "Google Meet").is_none(), "the Meet home page is not a call");
        assert!(classify_window("Google Chrome", "Inbox - Gmail").is_none());
        assert_eq!(classify_window("zoom.us", "Zoom Meeting").unwrap().kind, "zoom");
        assert!(classify_window("zoom.us", "Zoom Workplace").is_none());
        assert_eq!(classify_window("Microsoft Teams", "Meeting with Priya | Microsoft Teams").unwrap().kind, "teams");
        assert!(classify_window("Microsoft Teams", "Chat | Microsoft Teams").is_none());
        assert!(classify_window("Xcode", "Meet - abc-defg-hij").is_none());
        assert_eq!(meet_code("https://meet.google.com/abc-defg-hij?authuser=0").as_deref(), Some("abc-defg-hij"));
        assert_eq!(meet_code("https://zoom.us/j/123"), None);
    }

    #[test]
    fn a_call_needs_the_mic_and_a_meeting_window() {
        assert!(in_call(&in_meet("abc-defg-hij")));
        // Chrome on the mic, no meeting window: a voice memo site, not a call
        assert!(!in_call(&Signals { mic_apps: Some(vec!["com.google.Chrome.helper".into()]), ..Default::default() }));
        // a Meet tab open but nobody on the mic: not joined
        assert!(!in_call(&Signals { mic_apps: Some(vec![]), windows: vec![meet_window("abc-defg-hij")], ..Default::default() }));
        // Zoom holding the mic is a call by itself
        assert!(in_call(&Signals { mic_apps: Some(vec!["us.zoom.xos".into()]), ..Default::default() }));
        // old macOS: device-wide mic + window
        assert!(in_call(&Signals { mic_apps: None, mic_any: true, windows: vec![meet_window("abc-defg-hij")], ..Default::default() }));
        // denylisted call app: never
        assert!(!in_call(&Signals { denied: true, ..in_meet("abc-defg-hij") }));
    }

    #[test]
    fn starts_only_in_a_real_call_during_a_notes_on_meeting() {
        let url = "https://meet.google.com/abc-defg-hij";
        let events = vec![ev("standup", T0, 30, Some(url))];
        let mut m = Machine::default();
        let mut rec = None;
        // the meeting time comes, but no call: nothing, ever
        assert_eq!(run(&mut m, &events, &mut rec, T0 - 600, T0 + 1800, &nothing()), None);
        // a call outside any meeting (an hour later): nothing
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 3600, T0 + 3700, &in_meet("abc-defg-hij")), None);
        // a call 20 min before the meeting: too early
        assert_eq!(run(&mut m, &events, &mut rec, T0 - 1200, T0 - 400, &in_meet("abc-defg-hij")), None);
        // joined 2 min early: starts after two looks
        let (t, a) = run(&mut m, &events, &mut rec, T0 - 120, T0, &in_meet("abc-defg-hij")).unwrap();
        assert!(matches!(a, Action::Start { ref ev, part: 1 } if ev.occ == "standup"), "{a:?}");
        assert_eq!(t, T0 - 116);
        // disabled: nothing
        let mut m2 = Machine::default();
        let a = m2.step(T0, &Ctx { enabled: false, events: &events, recording: None }, &in_meet("abc-defg-hij"));
        assert_eq!(a, Action::None);
    }

    #[test]
    fn late_join_starts_and_leaving_stops() {
        let events = vec![ev("review", T0, 60, Some("https://meet.google.com/abc-defg-hij"))];
        let mut m = Machine::default();
        let mut rec = None;
        // joined 25 min late
        let (t, _) = run(&mut m, &events, &mut rec, T0 + 1500, T0 + 1600, &in_meet("abc-defg-hij")).unwrap();
        assert_eq!(t, T0 + 1504);
        // in the call with audio: keeps recording
        let live = Signals { call_audio_ago: Some(2), ..in_meet("abc-defg-hij") };
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 1508, T0 + 3000, &live), None);
        // left the call: tab closed, Chrome off the mic → stops ~20 s later
        let (t, a) = run(&mut m, &events, &mut rec, T0 + 3004, T0 + 3100, &nothing()).unwrap();
        assert!(matches!(a, Action::Stop { reason: StopReason::CallEnded, .. }), "{a:?}");
        assert_eq!(t, T0 + 3024);
        // rejoined (the call dropped): part 2
        let (_, a) = run(&mut m, &events, &mut rec, T0 + 3200, T0 + 3300, &in_meet("abc-defg-hij")).unwrap();
        assert!(matches!(a, Action::Start { part: 2, .. }), "{a:?}");
    }

    #[test]
    fn muted_in_a_quiet_call_keeps_recording_but_a_dead_tab_stops() {
        let events = vec![ev("sync", T0, 60, Some("https://meet.google.com/abc-defg-hij"))];
        let mut m = Machine::default();
        let mut rec = None;
        run(&mut m, &events, &mut rec, T0, T0 + 10, &in_meet("abc-defg-hij")).unwrap();
        // Chrome still holds the mic (muted keeps the device open): stays on through silence
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 12, T0 + 1200, &Signals { call_audio_ago: Some(500), ..in_meet("abc-defg-hij") }), None);
        // the tab still says "Meet - …" but nobody's on the mic and the call is silent: 3 min
        let stale = Signals { mic_apps: Some(vec![]), windows: vec![meet_window("abc-defg-hij")], call_audio_ago: Some(999), ..Default::default() };
        let (t, a) = run(&mut m, &events, &mut rec, T0 + 1204, T0 + 1600, &stale).unwrap();
        assert!(matches!(a, Action::Stop { reason: StopReason::NoCallAudio, .. }), "{a:?}");
        assert_eq!(t, T0 + 1204 + QUIET_SECS);
    }

    #[test]
    fn overrun_keeps_recording_until_the_call_ends() {
        let events = vec![ev("planning", T0, 30, Some("https://meet.google.com/abc-defg-hij"))];
        let mut m = Machine::default();
        let mut rec = None;
        run(&mut m, &events, &mut rec, T0, T0 + 10, &in_meet("abc-defg-hij")).unwrap();
        // 25 minutes over time, still talking: keeps going
        let live = Signals { call_audio_ago: Some(1), ..in_meet("abc-defg-hij") };
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 12, T0 + 1800 + 1500, &live), None);
    }

    #[test]
    fn back_to_back_meetings_split_into_two_notes() {
        let a = ev("first", T0, 30, Some("https://meet.google.com/aaa-bbbb-ccc"));
        let b = ev("second", T0 + 1800, 30, Some("https://meet.google.com/ddd-eeee-fff"));
        let events = vec![a, b];
        let mut m = Machine::default();
        let mut rec = None;
        let (_, s) = run(&mut m, &events, &mut rec, T0, T0 + 10, &in_meet("aaa-bbbb-ccc")).unwrap();
        assert!(matches!(s, Action::Start { ref ev, .. } if ev.occ == "first"));
        // the first runs 2 min over on its own link: still the first
        let live_a = Signals { call_audio_ago: Some(1), ..in_meet("aaa-bbbb-ccc") };
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 12, T0 + 1920, &live_a), None);
        // the user hops straight into the second call
        let (_, stop) = run(&mut m, &events, &mut rec, T0 + 1924, T0 + 1930, &in_meet("ddd-eeee-fff")).unwrap();
        assert!(matches!(stop, Action::Stop { reason: StopReason::NextMeeting, ref occ, .. } if occ == "first"), "{stop:?}");
        let (_, s2) = run(&mut m, &events, &mut rec, T0 + 1932, T0 + 1950, &in_meet("ddd-eeee-fff")).unwrap();
        assert!(matches!(s2, Action::Start { ref ev, part: 1 } if ev.occ == "second"), "{s2:?}");
    }

    #[test]
    fn back_to_back_on_zoom_splits_at_the_next_start() {
        let zoom = |id: &str| format!("https://zoom.us/j/{id}");
        let a = ev("first", T0, 30, Some(&zoom("1")));
        let b = ev("second", T0 + 1800, 30, Some(&zoom("2")));
        let events = vec![a, b];
        let mut m = Machine::default();
        let mut rec = None;
        let z = Signals { mic_apps: Some(vec!["us.zoom.xos".into()]), zoom_meeting: true, call_audio_ago: Some(1), ..Default::default() };
        run(&mut m, &events, &mut rec, T0, T0 + 10, &z).unwrap();
        let (t, a) = run(&mut m, &events, &mut rec, T0 + 12, T0 + 2400, &z).unwrap();
        assert!(matches!(a, Action::Stop { reason: StopReason::NextMeeting, .. }));
        assert!(t >= T0 + 1800 && t < T0 + 1810, "split at the second's start: {t}");
        let (_, s) = run(&mut m, &events, &mut rec, t + 4, t + 20, &z).unwrap();
        assert!(matches!(s, Action::Start { ref ev, .. } if ev.occ == "second"));
    }

    #[test]
    fn the_user_stopping_is_final_and_manual_recordings_are_left_alone() {
        let events = vec![ev("standup", T0, 30, Some("https://meet.google.com/abc-defg-hij"))];
        let mut m = Machine::default();
        let mut rec = None;
        run(&mut m, &events, &mut rec, T0, T0 + 10, &in_meet("abc-defg-hij")).unwrap();
        // the user clicks Stop in the notch
        rec = None;
        assert_eq!(run(&mut m, &events, &mut rec, T0 + 12, T0 + 1700, &in_meet("abc-defg-hij")), None, "never restarts that meeting");
        // a recording the user started by hand during a meeting: no second one, no auto stop
        let mut m = Machine::default();
        let manual = Some("manual".to_string());
        for t in (T0..T0 + 600).step_by(4) {
            assert_eq!(m.step(t, &Ctx { enabled: true, events: &events, recording: manual.as_deref() }, &nothing()), Action::None);
        }
    }

    #[test]
    fn notes_off_meetings_and_declined_events_are_never_candidates() {
        let mk = |id: &str, kind: Option<&str>, declined: bool| CalendarEvent {
            id: id.into(),
            title: id.into(),
            start: "2026-11-26T10:00:00Z".into(),
            end: "2026-11-26T10:30:00Z".into(),
            join_url: kind.map(|_| "https://meet.google.com/abc-defg-hij".into()),
            join_kind: kind.map(String::from),
            declined,
            attendees: vec![crate::google::CalendarAttendee { name: "Priya".into(), email: "p@x.com".into(), response: "accepted".into(), ..Default::default() }],
            ..Default::default()
        };
        let evs = vec![mk("meet", Some("meet"), false), mk("nolink", None, false), mk("declined", Some("meet"), true), mk("off", Some("meet"), false)];
        let prefs = HashMap::from([("off".to_string(), false), ("nolink".to_string(), true)]);
        let c: Vec<String> = candidates(&evs, &prefs).into_iter().map(|e| e.title).collect();
        assert_eq!(c, vec!["meet".to_string(), "nolink".to_string()]);
        assert_eq!(candidates(&evs, &prefs)[0].code.as_deref(), Some("abc-defg-hij"));
    }

    #[test]
    fn looks_only_around_meetings() {
        let events = vec![ev("x", T0, 30, None)];
        assert!(!wants_look(T0 - 3600, &events, false));
        assert!(wants_look(T0 - 200, &events, false));
        assert!(!wants_look(T0 + 1800, &events, false));
        assert!(wants_look(T0 + 99_999, &events, true));
    }
}
