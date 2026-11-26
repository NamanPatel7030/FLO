//! Notice calls: when another app starts using the microphone (Zoom, Teams, Meet, Slack huddle,
//! FaceTime…) offer to take notes. Cheap: one CoreAudio property read every 4 s.
//!
//! The same loop drives automatic notes for calendar meetings (`autonotes.rs`): around a meeting
//! whose "Take notes" is on, it also looks at which apps hold the mic and which meeting windows
//! are in a call, and starts / stops the recording. When automatic notes take a call, the
//! "Take notes?" prompt stays quiet.
use crate::model::{ev, MeetingDetectedEvent};
use crate::platform;
use crate::state::Shared;
use std::time::Duration;

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        let mut active: Option<String> = None;
        let mut on_since = 0u32;
        loop {
            tokio::time::sleep(Duration::from_secs(4)).await;
            // automatic notes first: when they start a recording, no prompt is needed
            let auto = crate::autonotes::tick(&st).await;
            if auto {
                if let Some(app) = active.take() {
                    st.emit(ev::MEETING_DETECTED, MeetingDetectedEvent { app, active: false });
                }
                on_since = 0;
                continue;
            }
            if !st.settings().meeting_detection {
                continue;
            }
            // Flo's own microphone use is never a call: dictation, meetings, and the hands-free
            // agent (which listens continuously) all count as ours
            // (any input stream Flo itself holds counts too, so Flo can never "detect" its own mic)
            let ours = st.session.lock().is_some()
                || st.meeting.lock().is_some()
                || crate::handsfree::is_active()
                || crate::agent::is_running()
                || crate::audio::open_streams() > 0;
            let mic = tokio::task::spawn_blocking(platform::mic_in_use).await.unwrap_or(false);
            match (&active, mic && !ours) {
                (None, true) => {
                    // require two consecutive readings (~8 s) so quick voice memos don't trigger
                    on_since += 1;
                    if on_since >= 2 {
                        let app = tokio::task::spawn_blocking(platform::detect_call_app).await.unwrap_or_default();
                        st.emit(ev::MEETING_DETECTED, MeetingDetectedEvent { app: app.clone(), active: true });
                        active = Some(app);
                    }
                }
                (Some(app), false) if !mic => {
                    st.emit(ev::MEETING_DETECTED, MeetingDetectedEvent { app: app.clone(), active: false });
                    active = None;
                    on_since = 0;
                }
                (None, false) => on_since = 0,
                _ => {}
            }
        }
    });
}
