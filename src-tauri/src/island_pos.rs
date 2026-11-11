//! Windows / Linux: where the floating pill sits. There is no notch to hang from, so the pill can
//! be dragged anywhere. On drop it snaps to the top centre, a screen edge or a corner when it is
//! close, and the spot is remembered per monitor (island-position.json in the app data dir).
//! macOS never uses this: the island always hangs from the notch.
//!
//! Everything here is in logical px relative to a monitor's work area (the screen minus panels /
//! the taskbar), so the same spot works at any scale factor.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Gap between the pill and a screen edge it is docked to.
pub const GAP: f64 = 6.0;
/// Dropped this close to an edge (or the top centre line), it snaps there.
pub const SNAP: f64 = 28.0;

/// Where the island sits on one monitor. The island grows away from its anchor edge, so a pill
/// near the bottom opens upwards and one docked to the right opens to the left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    /// horizontal centre (used when not docked to a side)
    pub cx: f64,
    /// the top edge (grows down) or, with `grow_up`, the bottom edge
    pub y: f64,
    pub grow_up: bool,
    /// -1 docked to the left edge, 1 to the right edge, 0 free (centred on `cx`)
    #[serde(default)]
    pub dock: i8,
}

impl Anchor {
    /// The default: top centre, just below the top edge.
    pub fn top_centre(area_w: f64) -> Anchor {
        Anchor { cx: area_w / 2.0, y: GAP, grow_up: false, dock: 0 }
    }
}

/// Top-left of a `w`×`h` island at `a` on an `area_w`×`area_h` work area, always fully on screen.
pub fn frame(area_w: f64, area_h: f64, a: Anchor, w: f64, h: f64) -> (f64, f64) {
    let x = match a.dock {
        d if d < 0 => GAP,
        d if d > 0 => area_w - w - GAP,
        _ => a.cx - w / 2.0,
    };
    let y = if a.grow_up { a.y - h } else { a.y };
    (x.clamp(0.0, (area_w - w).max(0.0)), y.clamp(0.0, (area_h - h).max(0.0)))
}

/// Where a pill dropped at (`x`, `y`) with size `w`×`h` settles: snapped to the top centre line,
/// the left / right edge and the top / bottom edge when within [`SNAP`].
pub fn settle(area_w: f64, area_h: f64, x: f64, y: f64, w: f64, h: f64) -> Anchor {
    // keep the dropped frame on screen first (a fling past the edge lands at the edge)
    let x = x.clamp(0.0, (area_w - w).max(0.0));
    let y = y.clamp(0.0, (area_h - h).max(0.0));
    let cx = x + w / 2.0;
    let (cx, dock) = if (cx - area_w / 2.0).abs() < SNAP {
        (area_w / 2.0, 0)
    } else if x < SNAP {
        (GAP + w / 2.0, -1)
    } else if area_w - (x + w) < SNAP {
        (area_w - GAP - w / 2.0, 1)
    } else {
        (cx, 0)
    };
    let grow_up = y + h / 2.0 > area_h / 2.0;
    let ay = if grow_up {
        let bottom = y + h;
        if area_h - bottom < SNAP {
            area_h - GAP
        } else {
            bottom
        }
    } else if y < SNAP {
        GAP
    } else {
        y
    };
    Anchor { cx, y: ay, grow_up, dock }
}

/// A stable name for a monitor: its connector name plus resolution ("HDMI-1 1920x1080").
pub fn monitor_key(name: Option<&str>, w: u32, h: u32, x: i32, y: i32) -> String {
    match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => format!("{n} {w}x{h}"),
        None => format!("display@{x},{y} {w}x{h}"),
    }
}

/// The remembered spots: one per monitor, and the monitor the island was last dropped on.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spots {
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub spots: HashMap<String, Anchor>,
}

fn file(dir: &Path) -> PathBuf {
    dir.join("island-position.json")
}

pub fn load(dir: &Path) -> Spots {
    std::fs::read_to_string(file(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(dir: &Path, s: &Spots) -> std::io::Result<()> {
    std::fs::write(file(dir), serde_json::to_string_pretty(s).unwrap_or_default())
}

// ── window glue (Windows / Linux) ──────────────────────────────────────────────────────────────

static SPOTS: parking_lot::Mutex<Option<Spots>> = parking_lot::Mutex::new(None);
static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// While a drag runs: the window's and the cursor's start positions (physical px).
static DRAG: parking_lot::Mutex<Option<((i32, i32), (f64, f64))>> = parking_lot::Mutex::new(None);

/// A drag is running: resizes keep the window where the cursor has it.
pub fn dragging() -> bool {
    DRAG.lock().is_some()
}

/// Read the remembered spots once at startup.
pub fn init(dir: &Path) {
    let _ = DIR.set(dir.to_path_buf());
    *SPOTS.lock() = Some(load(dir));
}

fn key_of(m: &tauri::Monitor) -> String {
    monitor_key(m.name().map(|s| s.as_str()), m.size().width, m.size().height, m.position().x, m.position().y)
}

/// The monitor to show the island on (the one it was last dropped on, else the primary) and the
/// spot on it (remembered, else the top centre).
pub fn placement(w: &tauri::WebviewWindow) -> tauri::Result<Option<(tauri::Monitor, Anchor)>> {
    let spots = SPOTS.lock().clone().unwrap_or_default();
    let chosen = match &spots.current {
        Some(k) => w.available_monitors()?.into_iter().find(|m| key_of(m) == *k),
        None => None,
    };
    let m = match chosen {
        Some(m) => m,
        None => match w.primary_monitor()?.or(w.current_monitor()?) {
            Some(m) => m,
            None => return Ok(None),
        },
    };
    let area_w = m.work_area().size.width as f64 / m.scale_factor();
    let a = spots.spots.get(&key_of(&m)).copied().unwrap_or_else(|| Anchor::top_centre(area_w));
    Ok(Some((m, a)))
}

/// Linux on native Wayland: the compositor places windows, so the drag is handed to it and the
/// spot can't be read back or remembered.
fn compositor_places_windows() -> bool {
    #[cfg(target_os = "linux")]
    return crate::platform::native_wayland();
    #[cfg(not(target_os = "linux"))]
    false
}

fn island(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    use tauri::Manager;
    app.get_webview_window("island").ok_or_else(|| "island window missing".to_string())
}

/// The pill was pressed and moved past the drag threshold (Windows / Linux; no-op on macOS).
#[tauri::command]
pub fn island_drag_start(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        return Ok(());
    }
    let w = island(&app)?;
    if compositor_places_windows() {
        *DRAG.lock() = None;
        return w.start_dragging().map_err(|e| e.to_string());
    }
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let cur = app.cursor_position().map_err(|e| e.to_string())?;
    *DRAG.lock() = Some(((pos.x, pos.y), (cur.x, cur.y)));
    Ok(())
}

/// The pointer moved during a drag: follow it (one call per animation frame).
#[tauri::command]
pub fn island_drag_move(app: tauri::AppHandle) -> Result<(), String> {
    let Some(((wx, wy), (cx, cy))) = *DRAG.lock() else { return Ok(()) };
    let cur = app.cursor_position().map_err(|e| e.to_string())?;
    let p = tauri::PhysicalPosition::new(wx + (cur.x - cx).round() as i32, wy + (cur.y - cy).round() as i32);
    island(&app)?.set_position(p).map_err(|e| e.to_string())
}

/// Released: snap, remember the spot for the monitor it landed on, and settle there.
#[tauri::command]
pub fn island_drag_end(app: tauri::AppHandle) -> Result<(), String> {
    if DRAG.lock().take().is_none() {
        return Ok(());
    }
    let w = island(&app)?;
    let (pos, size) = (w.outer_position().map_err(|e| e.to_string())?, w.outer_size().map_err(|e| e.to_string())?);
    let (mx, my) = (pos.x + size.width as i32 / 2, pos.y + size.height as i32 / 2);
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let inside = |m: &tauri::Monitor| {
        let (p, s) = (m.position(), m.size());
        mx >= p.x && my >= p.y && mx < p.x + s.width as i32 && my < p.y + s.height as i32
    };
    let Some(m) = monitors.iter().find(|m| inside(m)).cloned().or(w.current_monitor().map_err(|e| e.to_string())?) else { return Ok(()) };
    let s = m.scale_factor();
    let area = m.work_area();
    let (aw, ah) = (area.size.width as f64 / s, area.size.height as f64 / s);
    let (x, y) = ((pos.x - area.position.x) as f64 / s, (pos.y - area.position.y) as f64 / s);
    let (ww, wh) = (size.width as f64 / s, size.height as f64 / s);
    let anchor = settle(aw, ah, x, y, ww, wh);
    let key = key_of(&m);
    {
        let mut g = SPOTS.lock();
        let spots = g.get_or_insert_with(Spots::default);
        spots.current = Some(key.clone());
        spots.spots.insert(key, anchor);
        if let Some(dir) = DIR.get() {
            if let Err(e) = save(dir, spots) {
                log::warn!("remember island position: {e}");
            }
        }
    }
    // settle at the size the island asked for (it may still be the collapsed pill)
    let (rw, rh) = crate::ISLAND_RECT.lock().map(|r| (r.2, r.3)).unwrap_or((ww, wh));
    crate::place_island(&app, rw, rh).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 1920.0;
    const H: f64 = 1040.0;

    #[test]
    fn the_default_is_top_centre() {
        let a = Anchor::top_centre(W);
        assert_eq!(frame(W, H, a, 88.0, 64.0), (916.0, 6.0));
        // a wider panel stays centred on the same line
        assert_eq!(frame(W, H, a, 400.0, 300.0), (760.0, 6.0));
    }

    #[test]
    fn a_drop_near_the_top_centre_snaps_back_to_it() {
        let a = settle(W, H, 930.0, 14.0, 88.0, 64.0);
        assert_eq!(a, Anchor::top_centre(W));
    }

    #[test]
    fn a_drop_near_a_corner_docks_there_and_opens_inwards() {
        // bottom-right corner: docked right, grows up and to the left
        let a = settle(W, H, W - 88.0 - 10.0, H - 64.0 - 12.0, 88.0, 64.0);
        assert_eq!((a.dock, a.grow_up, a.y), (1, true, H - GAP));
        let (x, y) = frame(W, H, a, 400.0, 300.0);
        assert_eq!((x, y), (W - 400.0 - GAP, H - GAP - 300.0));
        // top-left corner: docked left, grows down and to the right
        let a = settle(W, H, 3.0, 20.0, 88.0, 64.0);
        assert_eq!((a.dock, a.grow_up, a.y), (-1, false, GAP));
        assert_eq!(frame(W, H, a, 400.0, 300.0), (GAP, GAP));
    }

    #[test]
    fn a_free_drop_stays_where_it_was_put() {
        let a = settle(W, H, 500.0, 300.0, 88.0, 64.0);
        assert_eq!(a, Anchor { cx: 544.0, y: 300.0, grow_up: false, dock: 0 });
        assert_eq!(frame(W, H, a, 88.0, 64.0), (500.0, 300.0));
        // lower half: anchored by the bottom edge, so it opens upwards
        let a = settle(W, H, 500.0, 800.0, 88.0, 64.0);
        assert!(a.grow_up);
        assert_eq!(frame(W, H, a, 88.0, 64.0), (500.0, 800.0));
        assert_eq!(frame(W, H, a, 400.0, 300.0).1, 864.0 - 300.0);
    }

    #[test]
    fn never_off_screen() {
        // flung past the edges
        let a = settle(W, H, -500.0, 5000.0, 88.0, 64.0);
        let (x, y) = frame(W, H, a, 88.0, 64.0);
        assert!(x >= 0.0 && y >= 0.0 && x + 88.0 <= W && y + 64.0 <= H);
        // a panel bigger than the remembered spot allows is pushed back on screen
        let a = Anchor { cx: W - 10.0, y: 10.0, grow_up: false, dock: 0 };
        assert_eq!(frame(W, H, a, 400.0, 300.0).0, W - 400.0);
        // remembered on a bigger monitor, shown on a small one
        let a = Anchor { cx: 3000.0, y: 2000.0, grow_up: true, dock: 0 };
        let (x, y) = frame(1280.0, 720.0, a, 88.0, 64.0);
        assert_eq!((x, y), (1280.0 - 88.0, 720.0 - 64.0));
    }

    #[test]
    fn monitors_are_told_apart() {
        assert_eq!(monitor_key(Some("HDMI-1"), 1920, 1080, 0, 0), "HDMI-1 1920x1080");
        assert_eq!(monitor_key(Some(" "), 2560, 1440, 1920, 0), "display@1920,0 2560x1440");
        assert_eq!(monitor_key(None, 2560, 1440, 1920, 0), "display@1920,0 2560x1440");
    }

    #[test]
    fn spots_round_trip_and_old_files_load() {
        let dir = std::env::temp_dir().join(format!("flo-island-pos-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(load(&dir), Spots::default());
        let mut s = Spots::default();
        s.current = Some("HDMI-1 1920x1080".into());
        s.spots.insert("HDMI-1 1920x1080".into(), Anchor { cx: 10.0, y: 20.0, grow_up: true, dock: -1 });
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir), s);
        // a file without `dock` (or garbage) still loads
        std::fs::write(file(&dir), r#"{"spots":{"a":{"cx":1,"y":2,"growUp":false}}}"#).unwrap();
        assert_eq!(load(&dir).spots["a"].dock, 0);
        std::fs::write(file(&dir), "nope").unwrap();
        assert_eq!(load(&dir), Spots::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
