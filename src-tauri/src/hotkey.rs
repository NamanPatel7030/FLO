//! Push-to-talk state machine (platform-agnostic, unit tested).
//!
//! macOS: hold Fn → dictation; hold Fn + Control → assistant.
//! Windows: hold Right Ctrl → dictation; hold Right Alt → assistant.
use crate::model::Mode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyEvent {
    Press(Mode),
    /// Mode changed while still held (e.g. Ctrl added after Fn)
    Switch(Mode),
    Release,
}

#[derive(Default, Debug)]
pub struct Machine {
    held: bool,
    mode: Option<Mode>,
}

impl Machine {
    /// Feed the current state of (primary key held, modifier held).
    pub fn update(&mut self, primary: bool, assistant_mod: bool) -> Option<HotkeyEvent> {
        match (self.held, primary) {
            (false, true) => {
                self.held = true;
                let m = if assistant_mod { Mode::Assistant } else { Mode::Dictation };
                self.mode = Some(m);
                Some(HotkeyEvent::Press(m))
            }
            (true, false) => {
                self.held = false;
                self.mode = None;
                Some(HotkeyEvent::Release)
            }
            (true, true) if assistant_mod && self.mode == Some(Mode::Dictation) => {
                self.mode = Some(Mode::Assistant);
                Some(HotkeyEvent::Switch(Mode::Assistant))
            }
            _ => None,
        }
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    /// Windows variant: two independent keys, either starts a session.
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

    #[test]
    fn fn_hold_release() {
        let mut m = Machine::default();
        assert_eq!(m.update(true, false), Some(HotkeyEvent::Press(Mode::Dictation)));
        assert_eq!(m.update(true, false), None);
        assert_eq!(m.update(false, false), Some(HotkeyEvent::Release));
        assert_eq!(m.update(false, false), None);
    }

    #[test]
    fn ctrl_upgrades_to_assistant() {
        let mut m = Machine::default();
        m.update(true, false);
        assert_eq!(m.update(true, true), Some(HotkeyEvent::Switch(Mode::Assistant)));
        assert_eq!(m.update(true, false), None); // releasing ctrl keeps assistant
        assert_eq!(m.update(false, false), Some(HotkeyEvent::Release));
    }

    #[test]
    fn fn_ctrl_together_is_assistant() {
        let mut m = Machine::default();
        assert_eq!(m.update(true, true), Some(HotkeyEvent::Press(Mode::Assistant)));
    }

    #[test]
    fn ctrl_alone_does_nothing() {
        let mut m = Machine::default();
        assert_eq!(m.update(false, true), None);
    }

    #[test]
    fn windows_two_keys() {
        let mut m = Machine::default();
        assert_eq!(m.update_two_keys(false, true), Some(HotkeyEvent::Press(Mode::Assistant)));
        assert_eq!(m.update_two_keys(false, false), Some(HotkeyEvent::Release));
    }
}
