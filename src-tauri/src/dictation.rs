//! The Flo key's speech pipeline, minus the I/O: what to transcribe while the key is held, what
//! counts as a usable sentence, how the pieces are joined, the speech model's prompt and the free
//! local cleanup. `session.rs` runs it on the live microphone; the accuracy harness
//! (`dictation_bench.rs`) runs the same functions on recorded clips.
use crate::audio;
use crate::livetx::{Action, Segmenter};
use crate::{stt, text};

/// Feed one slice of microphone audio to the background transcriber's segmenter. Returns the audio
/// to transcribe now (a finished sentence), or None. `pending` keeps whatever isn't transcribed yet.
pub fn on_slice(seg: &mut Segmenter, pending: &mut Vec<f32>, slice: &[f32]) -> Option<Vec<f32>> {
    let ms = (slice.len() as u64 * 1000) / audio::TARGET_RATE as u64;
    let rms = audio::rms(slice);
    pending.extend_from_slice(slice);
    match seg.push(ms.max(1), rms) {
        Action::Final => {
            let audio_now = std::mem::take(pending);
            // never transcribe a pause that had no real speech (prevents hallucinated text), but
            // keep the audio: softly spoken words stay for the next sentence
            if audio::voiced_ms(&audio_now) < 200 {
                let newer = std::mem::replace(pending, audio_now);
                pending.extend(newer);
                return None;
            }
            Some(audio_now)
        }
        Action::Discard => {
            // only drop pure silence; a short word before a pause stays for the next sentence
            if audio::voiced_ms(pending) == 0 {
                pending.clear();
            }
            None
        }
        _ => None,
    }
}

/// A sentence decoded while talking is kept when it's real text (not empty, not one of Whisper's
/// stock phrases for silence, not a repetition loop).
pub fn keep_chunk(t: &str, secs: f32) -> bool {
    !t.trim().is_empty() && !stt::is_hallucination(t, secs) && !stt::is_degenerate(t)
}

/// Least speech in the audio left at release for it to be transcribed (ms).
pub const MIN_TAIL_VOICED_MS: u32 = 250;

/// The speech model's prompt: the user's words (dictionary, newest first, bounded: Whisper keeps
/// ~224 prompt tokens) and the previous sentence for continuity.
pub fn stt_prompt(vocab_newest_first: &[String], context: &str) -> String {
    let mut prompt = text::stt_vocab(vocab_newest_first, 300);
    if !context.trim().is_empty() {
        if !prompt.is_empty() {
            prompt.push_str(". ");
        }
        prompt.push_str(context.trim());
    }
    prompt
}

/// Why a dictation produced no text.
#[derive(Debug, Clone, PartialEq)]
pub enum Empty {
    Hallucination,
    Degenerate,
}

/// The sentences decoded while talking plus the tail decoded at release, as one transcript.
pub fn final_transcript(committed: Vec<String>, tail: String, secs: f32) -> Result<String, Empty> {
    let tail = if stt::is_hallucination(&tail, secs) && !committed.is_empty() { String::new() } else { tail };
    let raw = stt::join_chunks(&committed.into_iter().chain(std::iter::once(tail)).collect::<Vec<_>>());
    if stt::is_hallucination(&raw, secs.max(1.0)) {
        return Err(Empty::Hallucination);
    }
    if stt::is_degenerate(&raw) {
        return Err(Empty::Degenerate);
    }
    Ok(raw)
}

/// The free, always-on cleanup (no AI): local fixes, filler words, then the user's dictionary
/// replacements last so nothing can undo them.
pub fn local_cleanup(raw: &str, dict: &[(String, String)]) -> String {
    let base = text::apply_dictionary(&text::tidy_transcript(raw), dict);
    text::apply_dictionary(&text::basic_cleanup(&base), dict)
}

#[cfg(all(test, feature = "local-stt"))]
#[path = "dictation_bench.rs"]
mod bench;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_has_dictionary_then_context() {
        let v = vec!["Priya".to_string(), "Flo".to_string()];
        assert_eq!(stt_prompt(&v, ""), "Priya, Flo");
        assert_eq!(stt_prompt(&v, " Sent it. "), "Priya, Flo. Sent it.");
        assert_eq!(stt_prompt(&[], "Sent it."), "Sent it.");
        assert_eq!(stt_prompt(&[], ""), "");
    }

    #[test]
    fn final_transcript_drops_stock_silence_phrases() {
        assert_eq!(final_transcript(vec![], "Send it.".into(), 2.0), Ok("Send it.".into()));
        assert_eq!(final_transcript(vec!["Send the deck.".into()], "Thank you.".into(), 1.0), Ok("Send the deck.".into()));
        assert_eq!(final_transcript(vec![], "Thank you.".into(), 1.0), Err(Empty::Hallucination));
        assert_eq!(final_transcript(vec![], "tri".repeat(30), 5.0), Err(Empty::Degenerate));
    }

    #[test]
    fn silence_slices_are_dropped_and_speech_is_committed_at_a_pause() {
        let mut seg = Segmenter::default();
        let mut pending = vec![];
        let silence = vec![0.0f32; 4_800];
        for _ in 0..8 {
            assert!(on_slice(&mut seg, &mut pending, &silence).is_none());
        }
        assert!(pending.len() < 16_000 * 2, "silence piles up: {}", pending.len());
        let speech: Vec<f32> = (0..4_800).map(|i| (i as f32 / 6.0).sin() * 0.1).collect();
        let mut got = None;
        for _ in 0..5 {
            assert!(on_slice(&mut seg, &mut pending, &speech).is_none());
        }
        for _ in 0..4 {
            got = got.or(on_slice(&mut seg, &mut pending, &silence));
        }
        assert!(got.is_some_and(|a| a.len() >= 5 * 4_800));
    }
}
