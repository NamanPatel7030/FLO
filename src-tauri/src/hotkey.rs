//! Push-to-talk state machine (platform-agnostic, unit tested).
//!
//! macOS: two configurable modifier combos (defaults: hold ctrl → dictation, hold fn → assistant).
//! Pressing any other key while holding cancels (so ctrl+C etc. keep working).
//! Windows: hold Right Ctrl → dictation; hold Right Alt → assistant.
use crate::model::Mode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyEvent {
    Press(Mode),
    /// Mode changed while still held (e.g. ctrl added to fn)
    Switch(Mode),
    Release,
    /// another key was pressed while holding → it was a shortcut, not push-to-talk
    Cancel,
}

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

#[derive(Default, Debug)]
pub struct Machine {
    held: bool,
    mode: Option<Mode>,
    /// the combo that started the session — releasing it ends the session
    base: Mods,
}

impl Machine {
    /// Feed the full current modifier state.
    pub fn update_mods(&mut self, m: Mods, cfg: &HotkeyConfig) -> Option<HotkeyEvent> {
        match self.mode {
            None => {
                let mode = if m == cfg.assistant {
                    Mode::Assistant
                } else if m == cfg.dictation {
                    Mode::Dictation
                } else {
                    return None;
                };
                self.mode = Some(mode);
                self.held = true;
                self.base = m;
                Some(HotkeyEvent::Press(mode))
            }
            Some(mode) => {
                let combo = if mode == Mode::Assistant { cfg.assistant } else { cfg.dictation };
                if !m.contains(&self.base) {
                    self.mode = None;
                    self.held = false;
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

    /// A non-modifier key went down.
    pub fn key_down(&mut self) -> Option<HotkeyEvent> {
        if self.mode.take().is_some() {
            self.held = false;
            return Some(HotkeyEvent::Cancel);
        }
        None
    }

    /// Legacy single-combo API (fn + optional ctrl), kept for tests/back-compat.
    #[cfg(test)]
    pub fn update(&mut self, primary: bool, assistant_mod: bool) -> Option<HotkeyEvent> {
        let cfg = HotkeyConfig { dictation: Mods { fn_: true, ..Default::default() }, assistant: Mods { fn_: true, ctrl: true, ..Default::default() } };
        self.update_mods(Mods { fn_: primary, ctrl: assistant_mod, ..Default::default() }, &cfg)
    }

    /// Windows variant: two independent keys, either starts a session.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
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

    #[test]
    fn windows_two_keys() {
        let mut mc = Machine::default();
        assert_eq!(mc.update_two_keys(false, true), Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(mc.update_two_keys(false, false), Some(HotkeyEvent::Release));
    }
}
