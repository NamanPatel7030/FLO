//! Live meeting transcription: decide when to show a live partial line and when to lock a
//! sentence in, from short audio slices. Pure logic (unit tested); meeting.rs does the I/O.
//!
//! - speech ends with a natural pause (≥ PAUSE_MS of quiet) → Final (commit the sentence)
//! - speech runs on without a pause for MAX_SEGMENT_MS → Final (keep latency bounded)
//! - while someone is mid-sentence, every PARTIAL_EVERY_MS → Partial (update the live line)

pub const SLICE_MS: u64 = 300;
pub const PAUSE_MS: u64 = 700;
pub const MAX_SEGMENT_MS: u64 = 8_000;
pub const PARTIAL_EVERY_MS: u64 = 1_500;
pub const MIN_SPEECH_MS: u64 = 600;
/// RMS above this counts as speech (16 kHz float audio)
pub const SPEECH_RMS: f32 = 0.012;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    /// transcribe the pending audio and show it as the live (unfinished) line
    Partial,
    /// transcribe the pending audio, commit it as a segment, clear the buffer
    Final,
    /// pending audio was only silence — drop it
    Discard,
}

#[derive(Debug, Default)]
pub struct Segmenter {
    /// ms of audio in the current (uncommitted) segment
    pending_ms: u64,
    /// ms of speech in the current segment
    speech_ms: u64,
    /// ms of trailing quiet
    quiet_ms: u64,
    /// ms since the last partial
    since_partial_ms: u64,
}

impl Segmenter {
    /// Feed one slice (its duration and RMS); returns what to do now.
    pub fn push(&mut self, slice_ms: u64, rms: f32) -> Action {
        self.push_voiced(slice_ms, rms >= SPEECH_RMS)
    }

    /// Same as `push`, with the speech decision made by the caller (meetpipe adapts it to the
    /// track's noise floor, so a quiet mic still counts as speech).
    pub fn push_voiced(&mut self, slice_ms: u64, voiced: bool) -> Action {
        self.pending_ms += slice_ms;
        self.since_partial_ms += slice_ms;
        if voiced {
            self.speech_ms += slice_ms;
            self.quiet_ms = 0;
        } else {
            self.quiet_ms += slice_ms;
        }
        if self.speech_ms == 0 {
            // nothing said yet: don't let silence pile up
            if self.pending_ms >= 2_000 {
                self.reset();
                return Action::Discard;
            }
            return Action::None;
        }
        let enough = self.speech_ms >= MIN_SPEECH_MS;
        if !enough && self.quiet_ms >= PAUSE_MS {
            // a blip (cough, click) and then a pause: drop it now. Waiting for MAX_SEGMENT_MS
            // glued it to the next sentence and cut that sentence in half.
            self.reset();
            return Action::Discard;
        }
        if (enough && self.quiet_ms >= PAUSE_MS) || self.pending_ms >= MAX_SEGMENT_MS {
            let a = if enough { Action::Final } else { Action::Discard };
            self.reset();
            return a;
        }
        if enough && self.quiet_ms == 0 && self.since_partial_ms >= PARTIAL_EVERY_MS {
            self.since_partial_ms = 0;
            return Action::Partial;
        }
        Action::None
    }

    /// Force-commit at the end of the meeting.
    pub fn flush(&mut self) -> Action {
        let a = if self.speech_ms >= MIN_SPEECH_MS { Action::Final } else { Action::Discard };
        self.reset();
        a
    }

    fn reset(&mut self) {
        *self = Segmenter::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(s: &mut Segmenter, slices: &[(u64, f32)]) -> Vec<Action> {
        slices.iter().map(|(ms, r)| s.push(*ms, *r)).filter(|a| *a != Action::None).collect()
    }

    #[test]
    fn sentence_then_pause_commits() {
        let mut s = Segmenter::default();
        let mut v = vec![(300, 0.05); 7]; // 2.1 s speech
        v.extend(vec![(300, 0.0); 3]); // 0.9 s pause
        assert_eq!(run(&mut s, &v), vec![Action::Partial, Action::Final]);
    }

    #[test]
    fn long_monologue_is_cut_at_max_segment() {
        let mut s = Segmenter::default();
        let acts = run(&mut s, &vec![(300, 0.05); 30]); // 9 s, no pause
        assert!(acts.contains(&Action::Final));
        assert!(acts.iter().filter(|a| **a == Action::Partial).count() >= 4);
    }

    #[test]
    fn silence_is_discarded_not_transcribed() {
        let mut s = Segmenter::default();
        assert_eq!(run(&mut s, &vec![(300, 0.0); 7]), vec![Action::Discard]);
    }

    #[test]
    fn cough_is_ignored() {
        let mut s = Segmenter::default();
        let mut v = vec![(300, 0.05); 1]; // 0.3 s blip
        v.extend(vec![(300, 0.0); 30]);
        assert!(!run(&mut s, &v).contains(&Action::Final));
    }

    #[test]
    fn blip_then_pause_is_dropped_before_the_next_sentence() {
        let mut s = Segmenter::default();
        let mut v = vec![(100, 0.05); 2]; // 0.2 s click
        v.extend(vec![(100, 0.0); 8]); // pause
        assert_eq!(run(&mut s, &v), vec![Action::Discard]);
        // the next sentence starts fresh (not glued to the blip, not cut at 8 s)
        let mut v = vec![(100, 0.05); 30];
        v.extend(vec![(100, 0.0); 8]);
        assert_eq!(run(&mut s, &v).last(), Some(&Action::Final));
    }

    #[test]
    fn flush_commits_trailing_speech() {
        let mut s = Segmenter::default();
        run(&mut s, &vec![(300, 0.05); 3]);
        assert_eq!(s.flush(), Action::Final);
        assert_eq!(s.flush(), Action::Discard);
    }
}
