//! OS integration facade. Each function has a macOS and a Windows implementation.
use crate::hotkey::HotkeyEvent;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use other::*;

/// Focused application at the moment a session starts.
#[derive(Debug, Clone, Default)]
pub struct FrontApp {
    pub name: String,
    pub pid: i32,
}

pub type HotkeyCallback = Box<dyn Fn(HotkeyEvent) + Send + Sync + 'static>;

/// Save clipboard, put `text`, paste, restore after a delay (runs restore on a helper thread).
pub fn paste_text(text: &str) -> anyhow::Result<()> {
    let mut cb = arboard::Clipboard::new()?;
    let previous = cb.get_text().ok();
    cb.set_text(text.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(40));
    send_paste_shortcut()?;
    let pasted = text.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        if let (Some(prev), Ok(mut cb)) = (previous, arboard::Clipboard::new()) {
            // only restore if the clipboard still holds what we pasted (user didn't copy meanwhile)
            if cb.get_text().ok().as_deref() == Some(pasted.as_str()) {
                let _ = cb.set_text(prev);
            }
        }
    });
    Ok(())
}

/// Copy the current selection via simulated copy; restores the clipboard.
pub fn copy_selection() -> Option<String> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let previous = cb.get_text().ok();
    let sentinel = format!("__flo_{}__", uuid::Uuid::new_v4().simple());
    cb.set_text(sentinel.clone()).ok()?;
    send_copy_shortcut().ok()?;
    let mut got = None;
    for _ in 0..12 {
        std::thread::sleep(std::time::Duration::from_millis(25));
        if let Ok(t) = cb.get_text() {
            if t != sentinel {
                got = Some(t);
                break;
            }
        }
    }
    match previous {
        Some(p) => {
            let _ = cb.set_text(p);
        }
        None => {
            let _ = cb.clear();
        }
    }
    got.filter(|s| !s.trim().is_empty())
}
