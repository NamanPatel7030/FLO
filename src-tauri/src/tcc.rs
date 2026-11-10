//! macOS privacy (TCC) helpers that don't need the OS: which grants the Flo key needs, and spotting
//! a stale Accessibility grant after an update. The platform layer feeds them live values.
//!
//! The Flo key is an *active* CGEventTap (it swallows the Space of ctrl + Space). macOS lets an
//! Accessibility-trusted process create such a tap for key events; Input Monitoring (ListenEvent)
//! only governs listen-only taps and IOHID. So Accessibility alone is enough and Flo never asks for
//! Input Monitoring. A Mac that already granted Input Monitoring keeps working too.
use std::path::{Path, PathBuf};

/// May Flo try to create the key tap now? Only with a grant, so the attempt never triggers a
/// surprise Input Monitoring prompt on a fresh Mac.
pub fn hotkey_tap_allowed(accessibility: bool, listen_event: bool) -> bool {
    accessibility || listen_event
}

/// Flo was Accessibility-trusted under an earlier build (`marker` holds that build) and this build
/// isn't: the switch in System Settings still looks on but no longer applies (a changed signature
/// after an update). Granted now, never trusted before, or trusted under this same build (the
/// person turned it off themselves) are not stale.
pub fn stale_grant(trusted_now: bool, marker: Option<&str>, this_build: &str) -> bool {
    !trusted_now && marker.is_some_and(|m| !m.trim().is_empty() && m.trim() != this_build)
}

/// This build's identity for the marker: the version is enough, updates always bump it.
pub fn this_build() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Where the last trusted build is remembered.
pub fn marker_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.flo.flow").join("ax-trusted-build"))
}

pub fn read_marker(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Remember that this build is trusted (written once per build).
pub fn write_marker(path: &Path, build: &str) {
    if read_marker(path).as_deref().map(str::trim) == Some(build) {
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, build);
}

/// Live check against the marker: records a trusted build, reports a stale one.
pub fn accessibility_stale(trusted_now: bool) -> bool {
    let Some(path) = marker_path() else { return false };
    if trusted_now {
        write_marker(&path, this_build());
        return false;
    }
    stale_grant(false, read_marker(&path).as_deref(), this_build())
}

/// After a reset, forget the old build so the fix isn't offered again.
pub fn clear_marker() {
    if let Some(p) = marker_path() {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_tap_runs_on_accessibility_alone() {
        assert!(hotkey_tap_allowed(true, false));
        assert!(hotkey_tap_allowed(false, true)); // older installs that granted Input Monitoring
        assert!(!hotkey_tap_allowed(false, false));
    }

    #[test]
    fn stale_only_when_an_earlier_build_was_trusted() {
        assert!(stale_grant(false, Some("0.9.0"), "0.9.1"));
        assert!(stale_grant(false, Some("0.9.0\n"), "0.9.1"));
        assert!(!stale_grant(true, Some("0.9.0"), "0.9.1"));
        assert!(!stale_grant(false, None, "0.9.1"));
        assert!(!stale_grant(false, Some(""), "0.9.1"));
        // same build: the person turned it off on purpose
        assert!(!stale_grant(false, Some("0.9.1"), "0.9.1"));
    }

    #[test]
    fn marker_round_trip() {
        let dir = std::env::temp_dir().join(format!("flo-tcc-{}", std::process::id()));
        let p = dir.join("sub").join("ax-trusted-build");
        assert_eq!(read_marker(&p), None);
        write_marker(&p, "1.2.3");
        assert_eq!(read_marker(&p).as_deref(), Some("1.2.3"));
        assert!(stale_grant(false, read_marker(&p).as_deref(), "1.2.4"));
        write_marker(&p, "1.2.4");
        assert!(!stale_grant(false, read_marker(&p).as_deref(), "1.2.4"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
