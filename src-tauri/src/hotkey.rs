//! Push-to-talk state machine (platform-agnostic, unit tested).
//!
//! macOS: two configurable modifier combos (defaults: hold ctrl → dictation, hold fn → assistant).
//! Pressing any other key while holding cancels (so ctrl+C etc. keep working).
//! Windows: hold Right Ctrl → dictation; hold Right Alt → assistant.
use crate::model::Mode;
use std::time::{Duration, Instant};

/// Two taps of the assistant key within this window toggle hands-free agent mode.
pub const DOUBLE_TAP_MS: u64 = 350;
/// A press shorter than this counts as a tap (longer is push-to-talk).
pub const TAP_MAX_MS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyEvent {
    Press(Mode),
    /// Mode changed while still held (e.g. ctrl added to fn)
    Switch(Mode),
    Release,
    /// another key was pressed while holding → it was a shortcut, not push-to-talk
    Cancel,
    /// Space pressed while holding → hands-free: keep listening after the keys are released
    Lock(Mode),
    /// the assistant key was tapped twice quickly → toggle hands-free agent mode
    DoubleTap(Mode),
}

pub const KEY_SPACE: i64 = 49;
pub const KEY_ESC: i64 = 53;

/// Set of held modifiers (also used as a combo definition).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Mods {
    pub fn_: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub cmd: bool,
    pub shift: bool,
}

impl Mods {
    pub fn parse(s: &str) -> Option<Mods> {
        let mut m = Mods::default();
        for part in s.split('+').map(|p| p.trim().to_lowercase()) {
            match part.as_str() {
                "fn" | "globe" => m.fn_ = true,
                "ctrl" | "control" => m.ctrl = true,
                "alt" | "option" | "opt" => m.alt = true,
                "cmd" | "command" => m.cmd = true,
                "shift" => m.shift = true,
                _ => return None,
            }
        }
        (m != Mods::default()).then_some(m)
    }

    /// every modifier in `other` is held in `self`
    pub fn contains(&self, o: &Mods) -> bool {
        (!o.fn_ || self.fn_) && (!o.ctrl || self.ctrl) && (!o.alt || self.alt) && (!o.cmd || self.cmd) && (!o.shift || self.shift)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeyConfig {
    pub dictation: Mods,
    pub assistant: Mods,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self { dictation: Mods { ctrl: true, ..Default::default() }, assistant: Mods { fn_: true, ..Default::default() } }
    }
}

impl HotkeyConfig {
    pub fn from_strings(dictation: &str, assistant: &str) -> Self {
        let d = Self::default();
        let dictation = Mods::parse(dictation).unwrap_or(d.dictation);
        let mut assistant = Mods::parse(assistant).unwrap_or(d.assistant);
        if assistant == dictation {
            assistant = if dictation == d.assistant { d.dictation } else { d.assistant };
        }
        Self { dictation, assistant }
    }
}

/// Should a key press cancel a held push-to-talk session?
/// Not for keystrokes Flo itself synthesises (e.g. Cmd+C to read the selection) and not for the
/// fn / Globe key's own key codes (63 = kVK_Function, 179 = Globe on newer Macs).
pub fn key_cancels(keycode: i64, source_pid: i64, own_pid: i64) -> bool {
    if source_pid == own_pid {
        return false;
    }
    !matches!(keycode, 63 | 179)
}

#[derive(Default, Debug)]
pub struct Machine {
    held: bool,
    mode: Option<Mode>,
    /// the combo that started the session — releasing it ends the session
    base: Mods,
    /// hands-free (ctrl/fn + Space): releasing the keys doesn't stop
    locked: bool,
    /// while locked: is the base combo currently held (to detect the finishing tap)
    base_held: bool,
    /// when the current press started (to tell a tap from a hold)
    pressed_at: Option<Instant>,
    /// when the last quick tap of the assistant key was released (double-tap detection)
    last_tap: Option<Instant>,
    /// the current press is the second tap of a double-tap: its release is silent
    double: bool,
}

impl Machine {
    /// Feed the full current modifier state.
    pub fn update_mods(&mut self, m: Mods, cfg: &HotkeyConfig) -> Option<HotkeyEvent> {
        self.update_mods_at(m, cfg, Instant::now())
    }

    /// Same, at an explicit time (unit tests drive the double-tap clock).
    pub fn update_mods_at(&mut self, m: Mods, cfg: &HotkeyConfig, now: Instant) -> Option<HotkeyEvent> {
        if self.double {
            // second tap of a double-tap: swallow everything until the key is let go
            if !m.contains(&self.base) {
                self.reset();
            }
            return None;
        }
        if self.locked {
            let holding = m.contains(&self.base);
            let was = self.base_held;
            self.base_held = holding;
            if holding && !was {
                // tapped the key again → finish
                self.reset();
                return Some(HotkeyEvent::Release);
            }
            return None;
        }
        match self.mode {
            None => {
                let mode = if m == cfg.assistant {
                    Mode::Assistant
                } else if m == cfg.dictation {
                    Mode::Dictation
                } else {
                    return None;
                };
                let quick_second = mode == Mode::Assistant && self.last_tap.is_some_and(|t| now.saturating_duration_since(t) <= Duration::from_millis(DOUBLE_TAP_MS));
                self.last_tap = None;
                self.mode = Some(mode);
                self.held = true;
                self.base = m;
                self.pressed_at = Some(now);
                if quick_second {
                    self.double = true;
                    return Some(HotkeyEvent::DoubleTap(mode));
                }
                Some(HotkeyEvent::Press(mode))
            }
            Some(mode) => {
                let combo = if mode == Mode::Assistant { cfg.assistant } else { cfg.dictation };
                if !m.contains(&self.base) {
                    let tap = mode == Mode::Assistant && self.pressed_at.is_some_and(|p| now.saturating_duration_since(p) <= Duration::from_millis(TAP_MAX_MS));
                    self.mode = None;
                    self.held = false;
                    self.pressed_at = None;
                    self.last_tap = tap.then_some(now);
                    return Some(HotkeyEvent::Release);
                }
                // growing into the other (superset) combo switches mode, e.g. ctrl → fn+ctrl
                let (other_mode, other) = if mode == Mode::Assistant { (Mode::Dictation, cfg.dictation) } else { (Mode::Assistant, cfg.assistant) };
                if m == other && other.contains(&combo) {
                    self.mode = Some(other_mode);
                    return Some(HotkeyEvent::Switch(other_mode));
                }
                None
            }
        }
    }

    fn reset(&mut self) {
        self.mode = None;
        self.held = false;
        self.locked = false;
        self.base_held = false;
        self.pressed_at = None;
        self.last_tap = None;
        self.double = false;
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// A non-modifier key went down. Returns (event, swallow_the_key).
    pub fn key_down_code(&mut self, keycode: i64) -> (Option<HotkeyEvent>, bool) {
        let Some(mode) = self.mode else {
            // typing between two taps means it wasn't a double-tap
            self.last_tap = None;
            return (None, false);
        };
        if self.double {
            self.reset();
            return (None, false);
        }
        if self.locked {
            return match keycode {
                KEY_ESC => {
                    self.reset();
                    (Some(HotkeyEvent::Cancel), true)
                }
                KEY_SPACE if self.base_held => {
                    self.reset();
                    (Some(HotkeyEvent::Release), true)
                }
                _ => (None, false), // typing while hands-free is fine
            };
        }
        if keycode == KEY_SPACE {
            self.locked = true;
            self.base_held = true;
            return (Some(HotkeyEvent::Lock(mode)), true);
        }
        self.reset();
        (Some(HotkeyEvent::Cancel), false)
    }

    /// A non-modifier key went down (no keycode known → treat as a shortcut).
    #[cfg(test)]
    pub fn key_down(&mut self) -> Option<HotkeyEvent> {
        self.key_down_code(0).0
    }

    /// Legacy single-combo API (fn + optional ctrl), kept for tests/back-compat.
    #[cfg(test)]
    pub fn update(&mut self, primary: bool, assistant_mod: bool) -> Option<HotkeyEvent> {
        let cfg = HotkeyConfig { dictation: Mods { fn_: true, ..Default::default() }, assistant: Mods { fn_: true, ctrl: true, ..Default::default() } };
        self.update_mods(Mods { fn_: primary, ctrl: assistant_mod, ..Default::default() }, &cfg)
    }

    /// Windows variant: two independent keys, either starts a session.
    #[allow(dead_code)]
    pub fn update_two_keys(&mut self, dictate: bool, assistant: bool) -> Option<HotkeyEvent> {
        let any = dictate || assistant;
        match (self.held, any) {
            (false, true) => {
                self.held = true;
                let m = if assistant { Mode::Assistant } else { Mode::Dictation };
                self.mode = Some(m);
                Some(HotkeyEvent::Press(m))
            }
            (true, false) => {
                self.held = false;
                self.mode = None;
                Some(HotkeyEvent::Release)
            }
            (true, true) if assistant && self.mode == Some(Mode::Dictation) => {
                self.mode = Some(Mode::Assistant);
                Some(HotkeyEvent::Switch(Mode::Assistant))
            }
            _ => None,
        }
    }
}

// ── Windows / Linux: raw key events → modifier state (platform-agnostic, unit tested) ──────
// (compiled everywhere so the tests run on every OS)

#[cfg_attr(target_os = "macos", allow(dead_code))]
/// A physical key as the Windows hook, X11 (rdev) and evdev readers report it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PcKey {
    Ctrl(bool), // true = right-hand key
    Alt(bool),
    /// the Windows key / Super
    Win(bool),
    Shift(bool),
    Space,
    Esc,
    /// any other key, by an id unique per key (repeats are recognised by it)
    Other(u32),
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
/// What `fn` means on a PC keyboard (it has no readable fn key): Ctrl + Win / Super.
fn pc_mods(mut m: Mods) -> Mods {
    if m.fn_ {
        m.fn_ = false;
        m.ctrl = true;
        m.cmd = true;
    }
    m
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
impl HotkeyConfig {
    /// The configured combos for a Windows / Linux keyboard: `fn` (macOS) becomes Ctrl + Win, so
    /// the defaults are hold Ctrl → dictation, hold Ctrl + Win → assistant.
    pub fn for_pc(self) -> Self {
        let d = pc_mods(self.dictation);
        let mut a = pc_mods(self.assistant);
        if a == d {
            a = if d == pc_mods(Mods { fn_: true, ..Default::default() }) { Mods { ctrl: true, ..Default::default() } } else { pc_mods(Mods { fn_: true, ..Default::default() }) };
        }
        Self { dictation: d, assistant: a }
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
/// Turns key down / up events into push-to-talk events. Ignores auto-repeat, and swallows the key
/// up of any key whose key down it swallowed (the Space of Ctrl + Space).
#[derive(Default, Debug)]
pub struct PcKeys {
    machine: Machine,
    down: std::collections::HashSet<PcKey>,
    swallowed: std::collections::HashSet<PcKey>,
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
impl PcKeys {
    pub fn mods(&self) -> Mods {
        let has = |f: fn(&PcKey) -> bool| self.down.iter().any(f);
        Mods {
            fn_: false,
            ctrl: has(|k| matches!(k, PcKey::Ctrl(_))),
            alt: has(|k| matches!(k, PcKey::Alt(_))),
            cmd: has(|k| matches!(k, PcKey::Win(_))),
            shift: has(|k| matches!(k, PcKey::Shift(_))),
        }
    }

    /// Feed one key event. Returns (event, swallow this key event).
    pub fn feed(&mut self, key: PcKey, is_down: bool, cfg: &HotkeyConfig) -> (Option<HotkeyEvent>, bool) {
        let modifier = matches!(key, PcKey::Ctrl(_) | PcKey::Alt(_) | PcKey::Win(_) | PcKey::Shift(_));
        if !is_down {
            self.down.remove(&key);
            let swallow = self.swallowed.remove(&key);
            if modifier {
                return (self.machine.update_mods(self.mods(), cfg), swallow);
            }
            return (None, swallow);
        }
        if !self.down.insert(key) {
            // auto-repeat: keep swallowing a swallowed key, otherwise nothing changed
            return (None, self.swallowed.contains(&key));
        }
        if modifier {
            return (self.machine.update_mods(self.mods(), cfg), false);
        }
        let code = match key {
            PcKey::Space => KEY_SPACE,
            PcKey::Esc => KEY_ESC,
            PcKey::Other(n) => 1000 + n as i64,
            _ => unreachable!(),
        };
        let (ev, swallow) = self.machine.key_down_code(code);
        if swallow {
            self.swallowed.insert(key);
        }
        (ev, swallow)
    }

    /// Forget held keys (e.g. after the session was locked / the hook restarted).
    pub fn clear(&mut self) {
        self.down.clear();
        self.swallowed.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(s: &str) -> Mods {
        if s.is_empty() {
            Mods::default()
        } else {
            Mods::parse(s).unwrap()
        }
    }

    #[test]
    fn parses_combos() {
        assert_eq!(m("fn+ctrl"), Mods { fn_: true, ctrl: true, ..Default::default() });
        assert!(Mods::parse("hyper").is_none());
        assert!(m("fn+ctrl").contains(&m("ctrl")));
        assert!(!m("ctrl").contains(&m("fn+ctrl")));
    }

    #[test]
    fn default_ctrl_dictates_fn_assists() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        assert_eq!(mc.update_mods(m("ctrl"), &cfg), Some(HotkeyEvent::Press(Mode::Dictation)));
        assert_eq!(mc.update_mods(m(""), &cfg), Some(HotkeyEvent::Release));
        assert_eq!(mc.update_mods(m("fn"), &cfg), Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(mc.update_mods(m(""), &cfg), Some(HotkeyEvent::Release));
    }

    #[test]
    fn shortcut_cancels() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        mc.update_mods(m("ctrl"), &cfg);
        assert_eq!(mc.key_down(), Some(HotkeyEvent::Cancel)); // ctrl+C
        assert_eq!(mc.update_mods(m(""), &cfg), None); // release after cancel is silent
        assert_eq!(mc.key_down(), None);
    }

    #[test]
    fn own_synthetic_keys_and_globe_dont_cancel() {
        let me = 4242;
        assert!(!key_cancels(8, me, me)); // our own Cmd+C
        assert!(!key_cancels(63, 1, me)); // fn
        assert!(!key_cancels(179, 1, me)); // Globe
        assert!(key_cancels(8, 1, me)); // the user's real C
    }

    #[test]
    fn ctrl_space_goes_hands_free_until_tapped_again() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        assert_eq!(mc.update_mods(m("ctrl"), &cfg), Some(HotkeyEvent::Press(Mode::Dictation)));
        assert_eq!(mc.key_down_code(KEY_SPACE), (Some(HotkeyEvent::Lock(Mode::Dictation)), true)); // swallowed
        assert_eq!(mc.update_mods(m(""), &cfg), None); // let go → keeps listening
        assert_eq!(mc.key_down_code(12), (None, false)); // typing doesn't cancel
        assert_eq!(mc.update_mods(m("ctrl"), &cfg), Some(HotkeyEvent::Release)); // tap ctrl → finish
        assert_eq!(mc.update_mods(m(""), &cfg), None);
        assert_eq!(mc.update_mods(m("ctrl"), &cfg), Some(HotkeyEvent::Press(Mode::Dictation))); // fresh start works
    }

    #[test]
    fn fn_space_hands_free_assistant_and_esc_cancels() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        mc.update_mods(m("fn"), &cfg);
        assert_eq!(mc.key_down_code(KEY_SPACE), (Some(HotkeyEvent::Lock(Mode::Assistant)), true));
        mc.update_mods(m(""), &cfg);
        assert_eq!(mc.key_down_code(KEY_ESC), (Some(HotkeyEvent::Cancel), true));
        assert!(!mc.is_locked());
    }

    #[test]
    fn space_again_while_holding_finishes() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        mc.update_mods(m("ctrl"), &cfg);
        mc.key_down_code(KEY_SPACE);
        assert_eq!(mc.key_down_code(KEY_SPACE), (Some(HotkeyEvent::Release), true)); // still holding ctrl
    }

    #[test]
    fn space_without_hotkey_is_untouched() {
        let mut mc = Machine::default();
        assert_eq!(mc.key_down_code(KEY_SPACE), (None, false));
    }

    #[test]
    fn extra_modifier_doesnt_start() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        assert_eq!(mc.update_mods(m("ctrl+shift"), &cfg), None);
    }

    #[test]
    fn superset_switches_mode() {
        let cfg = HotkeyConfig::from_strings("fn", "fn+ctrl");
        let mut mc = Machine::default();
        assert_eq!(mc.update_mods(m("fn"), &cfg), Some(HotkeyEvent::Press(Mode::Dictation)));
        assert_eq!(mc.update_mods(m("fn+ctrl"), &cfg), Some(HotkeyEvent::Switch(Mode::Assistant)));
        assert_eq!(mc.update_mods(m("fn"), &cfg), None); // keeps assistant while fn held
        assert_eq!(mc.update_mods(m(""), &cfg), Some(HotkeyEvent::Release));
    }

    #[test]
    fn same_combo_for_both_is_repaired() {
        let cfg = HotkeyConfig::from_strings("fn", "fn");
        assert_ne!(cfg.dictation, cfg.assistant);
    }

    #[test]
    fn legacy_fn_api_still_works() {
        let mut mc = Machine::default();
        assert_eq!(mc.update(true, false), Some(HotkeyEvent::Press(Mode::Dictation)));
        assert_eq!(mc.update(true, true), Some(HotkeyEvent::Switch(Mode::Assistant)));
        assert_eq!(mc.update(false, false), Some(HotkeyEvent::Release));
    }

    fn ms(t0: Instant, n: u64) -> Instant {
        t0 + Duration::from_millis(n)
    }

    #[test]
    fn double_tap_fn_toggles_agent_mode() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        let t0 = Instant::now();
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, t0), Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(mc.update_mods_at(m(""), &cfg, ms(t0, 120)), Some(HotkeyEvent::Release));
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 300)), Some(HotkeyEvent::DoubleTap(Mode::Assistant)));
        assert_eq!(mc.update_mods_at(m(""), &cfg, ms(t0, 400)), None); // its release is silent
        // a third tap right after starts fresh (not another toggle)
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 500)), Some(HotkeyEvent::Press(Mode::Assistant)));
    }

    #[test]
    fn slow_second_tap_or_long_hold_is_not_a_double_tap() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        let t0 = Instant::now();
        mc.update_mods_at(m("fn"), &cfg, t0);
        mc.update_mods_at(m(""), &cfg, ms(t0, 100));
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 600)), Some(HotkeyEvent::Press(Mode::Assistant))); // > 350 ms gap
        mc.update_mods_at(m(""), &cfg, ms(t0, 1600)); // held 1 s = push-to-talk, not a tap
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 1700)), Some(HotkeyEvent::Press(Mode::Assistant)));
    }

    #[test]
    fn double_tap_only_for_assistant_and_typing_breaks_it() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        let t0 = Instant::now();
        mc.update_mods_at(m("ctrl"), &cfg, t0);
        mc.update_mods_at(m(""), &cfg, ms(t0, 80));
        assert_eq!(mc.update_mods_at(m("ctrl"), &cfg, ms(t0, 200)), Some(HotkeyEvent::Press(Mode::Dictation)));
        mc.update_mods_at(m(""), &cfg, ms(t0, 260));
        // fn tap, a key typed, fn tap → no toggle
        mc.update_mods_at(m("fn"), &cfg, ms(t0, 1000));
        mc.update_mods_at(m(""), &cfg, ms(t0, 1080));
        assert_eq!(mc.key_down_code(12), (None, false));
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 1200)), Some(HotkeyEvent::Press(Mode::Assistant)));
    }

    #[test]
    fn hands_free_finish_tap_is_not_half_a_double_tap() {
        let cfg = HotkeyConfig::default();
        let mut mc = Machine::default();
        let t0 = Instant::now();
        mc.update_mods_at(m("fn"), &cfg, t0);
        mc.key_down_code(KEY_SPACE);
        mc.update_mods_at(m(""), &cfg, ms(t0, 100));
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 2000)), Some(HotkeyEvent::Release)); // finishing tap
        assert_eq!(mc.update_mods_at(m(""), &cfg, ms(t0, 2080)), None);
        assert_eq!(mc.update_mods_at(m("fn"), &cfg, ms(t0, 2200)), Some(HotkeyEvent::Press(Mode::Assistant)));
    }

    #[test]
    fn windows_two_keys() {
        let mut mc = Machine::default();
        assert_eq!(mc.update_two_keys(false, true), Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(mc.update_two_keys(false, false), Some(HotkeyEvent::Release));
    }

    fn pc() -> HotkeyConfig {
        HotkeyConfig::default().for_pc()
    }

    #[test]
    fn pc_defaults_are_ctrl_and_ctrl_win() {
        let c = pc();
        assert_eq!(c.dictation, m("ctrl"));
        assert_eq!(c.assistant, m("ctrl+cmd"));
        assert_eq!(HotkeyConfig::from_strings("fn+ctrl", "alt").for_pc().dictation, m("ctrl+cmd"));
        // fn and fn+ctrl both become Ctrl+Win: the assistant moves off the dictation combo
        let c = HotkeyConfig::from_strings("fn", "fn+ctrl").for_pc();
        assert_ne!(c.dictation, c.assistant);
    }

    #[test]
    fn pc_hold_ctrl_dictates_and_adding_win_switches() {
        let (c, mut k) = (pc(), PcKeys::default());
        assert_eq!(k.feed(PcKey::Ctrl(true), true, &c), (Some(HotkeyEvent::Press(Mode::Dictation)), false));
        assert_eq!(k.feed(PcKey::Ctrl(true), true, &c), (None, false)); // auto-repeat
        assert_eq!(k.feed(PcKey::Win(false), true, &c), (Some(HotkeyEvent::Switch(Mode::Assistant)), false));
        assert_eq!(k.feed(PcKey::Win(false), false, &c).0, None);
        assert_eq!(k.feed(PcKey::Ctrl(true), false, &c).0, Some(HotkeyEvent::Release));
    }

    #[test]
    fn pc_win_then_ctrl_starts_the_assistant() {
        let (c, mut k) = (pc(), PcKeys::default());
        assert_eq!(k.feed(PcKey::Win(true), true, &c).0, None);
        assert_eq!(k.feed(PcKey::Ctrl(false), true, &c).0, Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(k.feed(PcKey::Ctrl(false), false, &c).0, Some(HotkeyEvent::Release));
    }

    #[test]
    fn pc_shortcut_cancels_and_space_locks_swallowing_its_repeats() {
        let (c, mut k) = (pc(), PcKeys::default());
        k.feed(PcKey::Ctrl(false), true, &c);
        assert_eq!(k.feed(PcKey::Other(67), true, &c), (Some(HotkeyEvent::Cancel), false)); // Ctrl+C
        k.feed(PcKey::Other(67), false, &c);
        assert_eq!(k.feed(PcKey::Ctrl(false), false, &c).0, None);

        k.feed(PcKey::Ctrl(false), true, &c);
        assert_eq!(k.feed(PcKey::Space, true, &c), (Some(HotkeyEvent::Lock(Mode::Dictation)), true));
        assert_eq!(k.feed(PcKey::Space, true, &c), (None, true)); // repeat: still swallowed, no finish
        assert_eq!(k.feed(PcKey::Space, false, &c), (None, true)); // and its key up
        assert_eq!(k.feed(PcKey::Ctrl(false), false, &c).0, None); // hands-free keeps going
        assert_eq!(k.feed(PcKey::Other(1), true, &c), (None, false)); // typing is fine
        assert_eq!(k.feed(PcKey::Ctrl(false), true, &c).0, Some(HotkeyEvent::Release)); // tap to finish
    }

    #[test]
    fn pc_digit_keys_never_look_like_space_or_esc() {
        // VK '1' is 0x31 = 49 (= KEY_SPACE) and VK '5' is 0x35 = 53 (= KEY_ESC) on Windows
        let (c, mut k) = (pc(), PcKeys::default());
        k.feed(PcKey::Ctrl(false), true, &c);
        assert_eq!(k.feed(PcKey::Other(0x31), true, &c), (Some(HotkeyEvent::Cancel), false));
    }
}
