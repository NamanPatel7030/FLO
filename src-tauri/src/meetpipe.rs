//! The meeting audio pipeline, free of app state so the live recorder (`meeting.rs`) and the
//! simulator (`meeting_sim.rs`) run exactly the same code.
//!
//! ```text
//!   mic / call slices ──► Capture (per track: sample clock, 300 ms VAD units, energy envelope)
//!                              │ Job = speech chunk + the other track's envelope at that time
//!                              ▼
//!                         Processor (one worker thread: echo gate → STT → dedupe → speaker)
//!                              │ Change = add / remove a transcript line, live partial
//! ```
//!
//! Why it is built this way (bugs seen in real meetings, see the tests):
//! - Speech-to-text used to run inside the capture loop. A slow chunk (cold model, 8 s clip,
//!   accurate retry) stalled it for up to 18 s, the next slice then held 18 s of audio with ONE
//!   loudness value, so pauses were invisible, whole minutes became one segment stamped "0.0 s",
//!   and the two tracks' giant segments overlapped. Now capture never waits for STT, and any
//!   amount of drained audio is cut into the same 300 ms VAD units.
//! - Timestamps come from each track's sample count (anchored to the wall clock), not from
//!   "when the loop got around to it".
//! - Echo handling is directional: when the call audio leads, the mic heard the call through the
//!   speakers (drop the mic copy); when the mic leads, the call app is playing *your* voice back
//!   (drop the call copy, keep "You"). It never drops a line when the other track was silent,
//!   and text matches are ordered word matches, not a bag of common words.
use crate::audio::{self, TARGET_RATE};
use crate::livetx::{Action, Segmenter, SLICE_MS, SPEECH_RMS};
use crate::meeting::{OTHERS, YOU};
use crate::model::MeetingSegment;
use crate::speakers::{self, Cluster, Embedder, Voice};
use crate::{stt, text};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Arc;

pub const RATE: f64 = TARGET_RATE as f64;
/// samples drained per round of the live loop (300 ms)
pub const SLICE: usize = (TARGET_RATE as u64 * SLICE_MS / 1000) as usize;
/// VAD unit: 100 ms, so a 0.7 s pause is seen as one (with 300 ms units it took ~1.2 s)
pub const UNIT_MS: u64 = 100;
pub const UNIT: usize = (TARGET_RATE as u64 * UNIT_MS / 1000) as usize;
/// 20 ms energy frames
pub const FRAME: usize = (TARGET_RATE / 50) as usize;
pub const FRAME_SECS: f64 = FRAME as f64 / RATE;
/// frames of the other track kept on each side of a chunk (0.5 s), so a delayed copy still lines up
pub const PAD: usize = 25;
/// echo / playback delays searched: ±300 ms
pub const MAX_LAG: i32 = 15;
/// a track whose clock is this far off the wall clock lost audio (device switch, sleep) → re-anchor
const GAP_SECS: f64 = 1.0;
/// envelope history (60 s): enough for any chunk (≤ 8 s) plus capture jitter
const ENV_FRAMES: usize = 3000;
/// audio kept from before the VAD noticed speech (0.6 s)
const PREROLL: usize = 6 * UNIT;
/// silence kept around the speech in a chunk
const EDGE_PAD: usize = (TARGET_RATE / 5) as usize;
/// call audio kept for later embedding while the voice model downloads: at most 10 min (≈ 38 MB)
pub const MAX_KEPT_AUDIO_SECS: f32 = 600.0;
/// two tracks' contours "move together" above this (Pearson on log energy)
const SAME_CONTOUR: f32 = 0.6;
/// the other track is active during (nearly) all of this chunk's speech
const COVERED: f32 = 0.9;
const MIC: usize = 0;
const CALL: usize = 1;

// ── timeline ───────────────────────────────────────────────────────────────

/// One track's timeline: the time of each sample, from the number of samples received (exact,
/// jitter-free), anchored to the wall clock on the first delivery and again after a gap.
#[derive(Debug, Default, Clone)]
pub struct Clock {
    end: Option<f64>,
}

impl Clock {
    /// Start time of `n` samples drained at wall time `now` (seconds since the meeting began).
    pub fn place(&mut self, n: usize, now: f64) -> f64 {
        if n == 0 {
            return self.end.unwrap_or(now.max(0.0));
        }
        let dur = n as f64 / RATE;
        let wall = (now - dur).max(0.0);
        let start = match self.end {
            Some(e) if (wall - e).abs() <= GAP_SECS => e,
            Some(e) => {
                log::info!("meeting: track clock re-anchored ({:+.1}s)", wall - e);
                wall
            }
            None => wall,
        };
        self.end = Some(start + dur);
        start
    }
}

/// Rolling 20 ms energy envelope with timestamps (last 60 s).
#[derive(Default)]
pub struct Envelope {
    frames: VecDeque<(f64, f32)>,
}

impl Envelope {
    pub fn push(&mut self, t0: f64, samples: &[f32]) {
        for (i, c) in samples.chunks(FRAME).enumerate() {
            self.frames.push_back((t0 + (i * FRAME) as f64 / RATE, audio::rms(c)));
        }
        while self.frames.len() > ENV_FRAMES {
            self.frames.pop_front();
        }
    }

    /// Frame energies on the grid [t0, t0 + n frames); missing audio reads as silence.
    pub fn window(&self, t0: f64, n: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; n];
        let end = t0 + n as f64 * FRAME_SECS;
        for (t, e) in self.frames.iter().rev() {
            if *t < t0 - FRAME_SECS {
                break;
            }
            if *t >= end {
                continue;
            }
            let k = ((t - t0) / FRAME_SECS).round();
            if k >= 0.0 && (k as usize) < n {
                out[k as usize] = out[k as usize].max(*e);
            }
        }
        out
    }
}

pub fn frames(samples: &[f32]) -> Vec<f32> {
    samples.chunks(FRAME).map(audio::rms).collect()
}

/// Speech decision per 300 ms unit, relative to the track's own noise floor (lowest unit level
/// in the last 30 s). Never stricter than the old fixed `SPEECH_RMS`, but a quiet or distant mic
/// (~-45 dBFS) still counts as speech instead of being silently thrown away.
#[derive(Debug, Default)]
struct Floor {
    recent: VecDeque<f32>,
}

impl Floor {
    fn speech(&mut self, rms: f32) -> bool {
        self.recent.push_back(rms);
        if self.recent.len() > 300 {
            self.recent.pop_front();
        }
        let floor = self.recent.iter().copied().fold(f32::MAX, f32::min);
        rms >= (floor * 3.0).clamp(0.003, SPEECH_RMS)
    }
}

/// A piece of one track to transcribe.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub mic: bool,
    /// track time of `samples[0]`
    pub t0: f64,
    pub samples: Vec<f32>,
    /// live preview of a sentence still being spoken (not committed)
    pub partial: bool,
}

impl Chunk {
    pub fn secs(&self) -> f64 {
        self.samples.len() as f64 / RATE
    }
}

/// Cuts one track into sentences: drained audio of any size → fixed 300 ms VAD units.
#[derive(Debug)]
pub struct Chunker {
    pub mic: bool,
    pub clock: Clock,
    seg: Segmenter,
    floor: Floor,
    carry: Vec<f32>,
    carry_t0: f64,
    pending: Vec<f32>,
    pending_t0: f64,
    /// recent 20 ms frames of this track (echo check against the other track)
    hist: VecDeque<f32>,
    /// typical level of your voice while the call is quiet (mic track)
    you_level: Option<f32>,
    /// first and last voiced unit of the pending segment (track time)
    voiced_span: Option<(f64, f64)>,
}

/// mic frames compared with the call when deciding whether a VAD unit is echo (0.8 s)
const HIST_FRAMES: usize = 40;

impl Chunker {
    pub fn new(mic: bool) -> Self {
        Self {
            mic,
            clock: Clock::default(),
            seg: Segmenter::default(),
            floor: Floor::default(),
            carry: vec![],
            carry_t0: 0.0,
            pending: vec![],
            pending_t0: 0.0,
            hist: VecDeque::new(),
            you_level: None,
            voiced_span: None,
        }
    }

    /// Feed samples whose first one is at track time `t0`. At most one partial per call (the newest).
    #[cfg(test)]
    pub fn feed(&mut self, t0: f64, samples: &[f32]) -> Vec<Chunk> {
        self.feed_ref(t0, samples, None)
    }

    /// Is this 300 ms mic unit only the call heard through the speakers? Its loudness follows the
    /// call's (0–300 ms later) while the call is talking, and it isn't as loud as your own voice.
    /// Echo units don't count as speech, so a pause in *your* speech still ends your sentence
    /// even while the call keeps talking (otherwise your line and the echo become one segment).
    fn unit_is_echo(&mut self, unit_t0: f64, unit_rms: f32, speech: bool, r: &Envelope) -> bool {
        let h: Vec<f32> = self.hist.iter().copied().collect();
        let n = h.len();
        if n < 15 {
            return false;
        }
        let h_t0 = unit_t0 + UNIT as f64 / RATE - n as f64 * FRAME_SECS;
        let c = r.window(h_t0 - MAX_LAG as f64 * FRAME_SECS, n + MAX_LAG as usize);
        let at = |k: usize, lag: i32| c[(k as i32 + MAX_LAG - lag) as usize];
        let lh: Vec<f32> = h.iter().map(|e| (e + 1e-5).ln()).collect();
        let (mut best, mut best_lag) = (f32::MIN, 0);
        for lag in 0..=MAX_LAG {
            let pairs: Vec<(f32, f32)> = (0..n).map(|k| (lh[k], (at(k, lag) + 1e-5).ln())).collect();
            let corr = pearson(&pairs);
            if corr > best {
                (best, best_lag) = (corr, lag);
            }
        }
        let call_now = (n - 15..n).map(|k| at(k, best_lag)).fold(0.0f32, f32::max);
        let call_any = c.iter().copied().fold(0.0f32, f32::max);
        if call_any < 0.004 && speech {
            // the call is quiet: this is your voice; learn how loud it is
            self.you_level = Some(self.you_level.map_or(unit_rms, |y| y * 0.9 + unit_rms * 0.1));
        }
        call_now > 0.01 && (best >= 0.75 || (best >= 0.5 && self.you_level.is_some_and(|y| unit_rms < 0.5 * y)))
    }

    /// `feed`, with the other track's envelope for the echo check (mic track during a call).
    pub fn feed_ref(&mut self, t0: f64, samples: &[f32], reference: Option<&Envelope>) -> Vec<Chunk> {
        if samples.is_empty() {
            return vec![];
        }
        if self.carry.is_empty() {
            self.carry_t0 = t0;
        }
        self.carry.extend_from_slice(samples);
        let mut out: Vec<Chunk> = vec![];
        let mut off = 0;
        while self.carry.len() - off >= UNIT {
            let unit_t0 = self.carry_t0 + off as f64 / RATE;
            if self.pending.is_empty() {
                self.pending_t0 = unit_t0;
            }
            let unit = &self.carry[off..off + UNIT];
            off += UNIT;
            self.pending.extend_from_slice(unit);
            let rms = audio::rms(unit);
            let mut voiced = self.floor.speech(rms);
            if let Some(r) = reference {
                let f = frames(unit);
                self.hist.extend(f);
                while self.hist.len() > HIST_FRAMES {
                    self.hist.pop_front();
                }
                if self.unit_is_echo(unit_t0, rms, voiced, r) {
                    voiced = false;
                }
            }
            if voiced {
                self.voiced_span = Some(match self.voiced_span {
                    Some((a, _)) => (a, unit_t0 + UNIT_MS as f64 / 1000.0),
                    None => (unit_t0, unit_t0 + UNIT_MS as f64 / 1000.0),
                });
            }
            match self.seg.push_voiced(UNIT_MS, voiced) {
                Action::Final => out.extend(self.take_final()),
                Action::Partial => {
                    out.retain(|c| !c.partial);
                    let (t, s) = trimmed(self.pending_t0, &self.pending);
                    out.push(Chunk { mic: self.mic, t0: t, samples: s, partial: true });
                }
                Action::Discard => {
                    // keep 0.6 s of pre-roll: a soft first word just before the VAD noticed
                    // the speech must not be cut off with the silence
                    let cut = self.pending.len().saturating_sub(PREROLL);
                    self.pending.drain(..cut);
                    self.pending_t0 += cut as f64 / RATE;
                    self.voiced_span = None;
                }
                Action::None => {}
            }
        }
        self.carry.drain(..off);
        self.carry_t0 += off as f64 / RATE;
        out
    }

    /// End of the meeting: commit whatever speech is still pending (incl. the last < 300 ms).
    pub fn flush(&mut self) -> Option<Chunk> {
        if !self.carry.is_empty() {
            if self.pending.is_empty() {
                self.pending_t0 = self.carry_t0;
            }
            let rest = std::mem::take(&mut self.carry);
            let ms = (rest.len() as u64 * 1000 / TARGET_RATE as u64).max(1);
            let voiced = self.floor.speech(audio::rms(&rest));
            if voiced {
                let t = self.carry_t0;
                let end = t + rest.len() as f64 / RATE;
                self.voiced_span = Some(self.voiced_span.map_or((t, end), |(a, _)| (a, end)));
            }
            self.pending.extend_from_slice(&rest);
            if self.seg.push_voiced(ms, voiced) == Action::Final {
                return self.take_final();
            }
        }
        match self.seg.flush() {
            Action::Final => self.take_final(),
            _ => {
                self.pending.clear();
                None
            }
        }
    }

    fn take_final(&mut self) -> Option<Chunk> {
        let s = std::mem::take(&mut self.pending);
        let span = self.voiced_span.take();
        if s.is_empty() {
            return None;
        }
        // only around the units the VAD heard as speech (0.3 s margin): sound before / after
        // them that wasn't speech, like the call's echo, isn't part of this line
        let (a, b) = match span {
            Some((v0, v1)) => {
                let a = (((v0 - 0.3 - self.pending_t0) * RATE).round().max(0.0) as usize).min(s.len());
                let b = (((v1 + 0.3 - self.pending_t0) * RATE).round().max(0.0) as usize).clamp(a, s.len());
                (a, b)
            }
            None => (0, s.len()),
        };
        let (t0, samples) = trimmed(self.pending_t0 + a as f64 / RATE, &s[a..b]);
        Some(Chunk { mic: self.mic, t0, samples, partial: false })
    }
}

/// Drop the silence before and after the speech (keeps 0.2 s), so a line's time is when the
/// person started talking, not when the previous pause began.
fn trimmed(t0: f64, s: &[f32]) -> (f64, Vec<f32>) {
    let e = frames(s);
    if e.len() < 4 {
        return (t0, s.to_vec());
    }
    let mut sorted = e.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let thresh = (sorted[sorted.len() / 5] * 3.0).clamp(0.004, SPEECH_RMS);
    match (e.iter().position(|x| *x > thresh), e.iter().rposition(|x| *x > thresh)) {
        (Some(a), Some(b)) => {
            let start = (a * FRAME).saturating_sub(EDGE_PAD);
            let end = ((b + 1) * FRAME + EDGE_PAD).min(s.len());
            (t0 + start as f64 / RATE, s[start..end].to_vec())
        }
        _ => (t0, s.to_vec()),
    }
}

/// A chunk to process, with the other track's energy around it (PAD frames each side).
#[derive(Debug, Clone)]
pub struct Job {
    pub chunk: Chunk,
    pub other: Vec<f32>,
}

/// Both tracks' capture side: clocks, VAD, envelopes. Call before mic in each round.
pub struct Capture {
    pub dual: bool,
    ch: [Chunker; 2],
    env: [Envelope; 2],
}

impl Capture {
    pub fn new(dual: bool) -> Self {
        Self { dual, ch: [Chunker::new(true), Chunker::new(false)], env: [Envelope::default(), Envelope::default()] }
    }

    /// Audio drained from both devices at wall time `now` → jobs.
    pub fn push(&mut self, mic: &[f32], call: &[f32], now: f64) -> Vec<Job> {
        let mut chunks = vec![];
        if self.dual {
            chunks.extend(self.place_feed(CALL, call, now));
        }
        chunks.extend(self.place_feed(MIC, mic, now));
        chunks.into_iter().map(|c| self.job(c)).collect()
    }

    pub fn flush(&mut self) -> Vec<Job> {
        let mut chunks = vec![];
        if self.dual {
            chunks.extend(self.ch[CALL].flush());
        }
        chunks.extend(self.ch[MIC].flush());
        chunks.into_iter().map(|c| self.job(c)).collect()
    }

    fn place_feed(&mut self, i: usize, s: &[f32], now: f64) -> Vec<Chunk> {
        let Capture { dual, ch, env } = self;
        let t = ch[i].clock.place(s.len(), now);
        env[i].push(t, s);
        let reference = (*dual && i == MIC).then(|| &env[CALL]);
        ch[i].feed_ref(t, s, reference)
    }

    fn job(&self, c: Chunk) -> Job {
        let other = if self.dual {
            let n = c.samples.len().div_ceil(FRAME) + 2 * PAD;
            self.env[if c.mic { CALL } else { MIC }].window(c.t0 - PAD as f64 * FRAME_SECS, n)
        } else {
            vec![]
        };
        Job { chunk: c, other }
    }
}

// ── echo: which track did the sound come from? ─────────────────────────────

/// How a chunk's loudness contour `x` lines up with the other track's `y` (where `y[k + PAD]` is
/// the same instant as `x[k]`), at the best of ±MAX_LAG frame delays.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Align {
    /// > 0: `x` is `lag` frames *later* than `y` (x is a delayed copy of y)
    pub lag: i32,
    /// Pearson correlation of log energy at that lag
    pub corr: f32,
    /// share of x's speech frames during which y is active, at that lag
    pub coverage: f32,
}

pub fn align(x: &[f32], y: &[f32]) -> Option<Align> {
    let n = x.len();
    if n < 15 {
        return None;
    }
    let mut sorted = x.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[n / 5];
    let voiced: Vec<usize> = (0..n).filter(|k| x[*k] > (floor * 3.0).max(0.004)).collect();
    if voiced.len() < 10 {
        return None;
    }
    let y_at = |k: usize, lag: i32| -> f32 {
        let j = k as i64 + PAD as i64 - lag as i64;
        if j >= 0 { y.get(j as usize).copied().unwrap_or(0.0) } else { 0.0 }
    };
    let lx: Vec<f32> = x.iter().map(|e| (e + 1e-5).ln()).collect();
    let mut best: Option<Align> = None;
    for lag in -MAX_LAG..=MAX_LAG {
        let pairs: Vec<(f32, f32)> = (0..n).map(|k| (lx[k], (y_at(k, lag) + 1e-5).ln())).collect();
        let corr = pearson(&pairs);
        let better = match best {
            None => true,
            Some(b) => corr > b.corr + 1e-4 || ((corr - b.corr).abs() <= 1e-4 && lag.abs() < b.lag.abs()),
        };
        if better {
            let on = voiced.iter().filter(|k| y_at(**k, lag) > 0.004).count();
            best = Some(Align { lag, corr, coverage: on as f32 / voiced.len() as f32 });
        }
    }
    best
}

fn pearson(p: &[(f32, f32)]) -> f32 {
    let n = p.len() as f32;
    if n < 2.0 {
        return 0.0;
    }
    let (mx, my) = (p.iter().map(|x| x.0).sum::<f32>() / n, p.iter().map(|x| x.1).sum::<f32>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (x, y) in p {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) * (x - mx);
        syy += (y - my) * (y - my);
    }
    if sxx <= 1e-9 || syy <= 1e-9 {
        return 0.0;
    }
    sxy / (sxx.sqrt() * syy.sqrt())
}

/// Whose voice a chunk is, judged from the timing of the two tracks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Owner {
    /// the sound came from the call (the mic heard it through the speakers)
    Call,
    /// the sound came from the mic (the call app played your own voice back)
    Mic,
    /// the tracks don't move together: unrelated sound, or one side silent
    Unclear,
}

/// `a` = this chunk (on the mic track when `mic`) against the other track.
pub fn owner(mic: bool, a: Option<Align>) -> Owner {
    match a {
        Some(a) if a.corr >= SAME_CONTOUR => {
            let from_call = if mic { a.lag >= 0 } else { a.lag <= 0 };
            if from_call { Owner::Call } else { Owner::Mic }
        }
        _ => Owner::Unclear,
    }
}

/// Before STT: is this chunk only a copy of the other track's sound? Every speech frame must
/// coincide with the other track, the contours must move together, and the copy must come
/// *after* the original. A mic chunk while the call was silent, or you talking over the call,
/// is never a copy. A call chunk needs a clear delay (≥ 20 ms) to count as your voice played back.
pub fn is_copy(mic: bool, a: Option<Align>) -> bool {
    match a {
        Some(a) if a.corr >= SAME_CONTOUR && a.coverage >= COVERED => {
            if mic { a.lag >= 0 } else { a.lag >= 1 }
        }
        _ => false,
    }
}

// ── text matching ──────────────────────────────────────────────────────────

pub fn norm_words(s: &str) -> Vec<String> {
    s.split_whitespace()
        .map(|w| w.chars().filter(|c| !c.is_ascii_punctuation() && !matches!(c, '।' | '॥' | '“' | '”' | '‘' | '’' | '…' | '¿' | '¡')).collect::<String>().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Longest common subsequence of two word lists (in order).
pub fn lcs(a: &[String], b: &[String]) -> usize {
    let (a, b) = (&a[..a.len().min(300)], &b[..b.len().min(300)]);
    let mut prev = vec![0usize; b.len() + 1];
    for x in a {
        let mut cur = vec![0usize; b.len() + 1];
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = if x == y { prev[j] + 1 } else { prev[j + 1].max(cur[j]) };
        }
        prev = cur;
    }
    prev[b.len()]
}

/// Same words in the same order: ≥ 60 % of the shorter text, in sequence (Whisper hears an echo
/// slightly differently, so not equality). Texts under 3 words must match exactly.
pub fn same_words(a: &str, b: &str) -> bool {
    let (x, y) = (norm_words(a), norm_words(b));
    if x.is_empty() || y.is_empty() {
        return false;
    }
    if x.len() < 3 || y.len() < 3 {
        return x == y;
    }
    lcs(&x, &y) as f32 / x.len().min(y.len()) as f32 >= 0.6
}

/// Do two time spans overlap (with `slack` seconds of tolerance)?
pub fn overlaps(a0: f64, a1: f64, b0: f64, b1: f64, slack: f64) -> bool {
    a0 <= b1 + slack && b0 <= a1 + slack
}

/// The words of `text` that are not part of `copy_of`, as written in `text`. The copy is one
/// stretch at the start or the end of the segment (the echo ran into your sentence, or yours
/// into it), so the stretch whose words best match `copy_of` is removed. None when too little is
/// left to be a line of its own (< 3 words or < 25 % of the text).
pub fn leftover(text: &str, copy_of: &str) -> Option<String> {
    let toks: Vec<(&str, String)> = text.split_whitespace().filter_map(|w| norm_words(w).into_iter().next().map(|n| (w, n))).collect();
    let a: Vec<String> = toks.iter().map(|t| t.1.clone()).collect();
    let b = norm_words(copy_of);
    let n = a.len();
    if n == 0 || n > 300 || b.is_empty() {
        return None;
    }
    // score of removing a[r]: words it shares with the copy minus words it would wrongly take
    let score = |r: std::ops::Range<usize>| -> i64 {
        let m = lcs(&a[r.clone()], &b) as i64;
        m - (r.len() as i64 - m)
    };
    let mut best = (0..0, 0i64);
    for k in 1..=n {
        for r in [0..k, n - k..n] {
            let sc = score(r.clone());
            if sc > best.1 {
                best = (r, sc);
            }
        }
    }
    let cut = best.0;
    let rest: Vec<&str> = toks.iter().enumerate().filter(|(i, _)| !cut.contains(i)).map(|(_, t)| t.0).collect();
    if rest.len() < 3 || (rest.len() as f32) < 0.25 * n as f32 {
        return None;
    }
    let out = rest.join(" ");
    let mut cs = out.chars();
    Some(match cs.next() {
        Some(c) if c.is_lowercase() => c.to_uppercase().collect::<String>() + cs.as_str(),
        _ => out,
    })
}

/// Sample ranges of a mic chunk that are your speech: stretches where the call is talking and
/// the mic only follows it (its echo through the speakers) are cut out; stretches where the call
/// is quiet, or where you talk over it, are kept. One range = the whole chunk is yours.
pub fn carve_echo(samples: &[f32], other: &[f32]) -> Vec<std::ops::Range<usize>> {
    let x = frames(samples);
    let n = x.len();
    let whole = vec![0..samples.len()];
    if n < 15 {
        return whole;
    }
    let y = |j: i64| -> f32 {
        if j >= 0 {
            other.get(j as usize).copied().unwrap_or(0.0)
        } else {
            0.0
        }
    };
    let lag = match align(&x, other) {
        Some(a) if a.corr >= 0.5 && a.lag >= 0 => a.lag as i64,
        _ => 2,
    };
    // the call talking near each mic frame (±60 ms)
    let mut on: Vec<bool> = (0..n).map(|k| (-3..=3).any(|d| y(k as i64 + PAD as i64 - lag + d) > 0.004)).collect();
    // bridge the call's short pauses between words; ignore blips
    for (s, e, v) in runs(&on) {
        if !v && e - s < 10 && s > 0 && e < n {
            on[s..e].iter_mut().for_each(|b| *b = true);
        }
    }
    for (s, e, v) in runs(&on) {
        if v && e - s < 10 {
            on[s..e].iter_mut().for_each(|b| *b = false);
        }
    }
    let mut keep = vec![true; n];
    let mut dropped = false;
    for (s, e, v) in runs(&on) {
        if !v || e - s < 15 {
            continue;
        }
        let ys: Vec<f32> = (s as i64..(e + 2 * PAD) as i64).map(y).collect();
        if is_copy(true, align(&x[s..e], &ys)) {
            keep[s..e].iter_mut().for_each(|b| *b = false);
            dropped = true;
        }
    }
    if !dropped {
        return whole;
    }
    let mut out = vec![];
    for (s, e, v) in runs(&keep) {
        if !v {
            continue;
        }
        let a = (s * FRAME).saturating_sub(5 * FRAME);
        let b = ((e + 5) * FRAME).min(samples.len());
        if audio::voiced_ms(&samples[a..b]) >= 250 {
            out.push(a..b);
        }
    }
    out
}

/// Runs of equal values: (start, end, value).
fn runs(v: &[bool]) -> Vec<(usize, usize, bool)> {
    let mut r = vec![];
    let mut s = 0;
    for k in 1..=v.len() {
        if k == v.len() || v[k] != v[s] {
            r.push((s, k, v[s]));
            s = k;
        }
    }
    r
}

// ── language ───────────────────────────────────────────────────────────────

/// Per-track language: a language set in Settings is used as is; with "auto" the track locks
/// only after three clips in a row agree (one "Hello" before a Hindi meeting no longer forces
/// every later Hindi sentence through the English decoder).
#[derive(Debug, Clone, Default)]
pub struct LangLock {
    pub fixed: Option<String>,
    votes: Vec<String>,
}

impl LangLock {
    pub fn new(fixed: Option<String>) -> Self {
        Self { fixed, votes: vec![] }
    }
    pub fn current(&self) -> Option<&str> {
        self.fixed.as_deref()
    }
    pub fn observe(&mut self, detected: Option<String>) {
        if self.fixed.is_some() {
            return;
        }
        let Some(l) = detected else { return };
        self.votes.push(l);
        if self.votes.len() > 3 {
            self.votes.remove(0);
        }
        if self.votes.len() == 3 && self.votes.iter().all(|v| *v == self.votes[0]) {
            log::info!("meeting: language locked to {}", self.votes[0]);
            self.fixed = Some(self.votes[0].clone());
        }
    }
}

// ── processing (one worker thread) ─────────────────────────────────────────

pub trait Transcriber {
    fn transcribe(&mut self, samples: &[f32], context: &str, lang: Option<&str>) -> anyhow::Result<String>;
    /// language of the last clip, when the engine detected one
    fn detected_lang(&self) -> Option<String>;
}

/// A call-track segment kept for the post-call speaker pass.
#[derive(Debug, Clone)]
pub struct CallSeg {
    pub t: f64,
    pub secs: f32,
    pub emb: Option<Vec<f32>>,
    /// audio kept only while no embedding could be computed yet (model still downloading)
    pub audio: Option<Vec<f32>>,
}

#[derive(Debug, Clone)]
struct Recent {
    mic: bool,
    t0: f64,
    t1: f64,
    text: String,
    speaker: String,
    owner: Owner,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    Add(MeetingSegment),
    /// a line committed earlier turned out to be the copy of a line on the other track
    Remove(MeetingSegment),
    Partial { text: String, speaker: String },
    Error(String),
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub chunks: u32,
    pub lines: u32,
    pub silent: u32,
    /// mic chunks skipped before STT: the call's sound heard through the speakers
    pub mic_echo_audio: u32,
    /// call chunks skipped before STT: your own voice played back by the call app
    pub call_echo_audio: u32,
    /// lines dropped after STT as the same words as the other track
    pub mic_dup_text: u32,
    pub call_dup_text: u32,
    pub filtered: u32,
    /// mic chunks where only your part was kept (the call's echo around it dropped)
    pub carved: u32,
    pub stt_errors: u32,
    pub splits: u32,
    pub partials: u32,
    pub stt_ms: u64,
    pub audio_secs: f64,
}

pub struct Processor<T: Transcriber> {
    pub stt: T,
    pub embedder: Option<Arc<Embedder>>,
    pub dual: bool,
    voices: Vec<Voice>,
    pub clusters: Vec<Cluster>,
    pub call_segs: Vec<CallSeg>,
    recent: VecDeque<Recent>,
    last_text: [String; 2],
    pub lang: [LangLock; 2],
    last_call_label: Option<String>,
    kept_audio_secs: f32,
    pub stats: Stats,
}

impl<T: Transcriber> Processor<T> {
    pub fn new(stt: T, dual: bool, voices: Vec<Voice>, lang: Option<String>) -> Self {
        Self {
            stt,
            embedder: None,
            dual,
            voices,
            clusters: vec![],
            call_segs: vec![],
            recent: VecDeque::new(),
            last_text: [String::new(), String::new()],
            lang: [LangLock::new(lang.clone()), LangLock::new(lang)],
            last_call_label: None,
            kept_audio_secs: 0.0,
            stats: Stats::default(),
        }
    }

    fn call_label_fallback(&self) -> String {
        self.last_call_label.clone().unwrap_or_else(|| OTHERS.into())
    }

    pub fn handle(&mut self, job: Job) -> Vec<Change> {
        if job.chunk.partial {
            self.partial(job)
        } else {
            self.final_chunk(job)
        }
    }

    fn partial(&mut self, job: Job) -> Vec<Change> {
        let c = job.chunk;
        if audio::voiced_ms(&c.samples) < 200 {
            return vec![];
        }
        if self.dual && c.mic && is_copy(true, align(&frames(&c.samples), &job.other)) {
            return vec![];
        }
        let tr = if c.mic { MIC } else { CALL };
        let lang = self.lang[tr].current().map(str::to_string);
        let Ok(t) = self.stt.transcribe(&c.samples, &self.last_text[tr], lang.as_deref()) else { return vec![] };
        if t.trim().is_empty() || stt::is_degenerate(&t) {
            return vec![];
        }
        self.stats.partials += 1;
        let speaker = if c.mic { YOU.to_string() } else { self.call_label_fallback() };
        vec![Change::Partial { text: t, speaker }]
    }

    fn final_chunk(&mut self, job: Job) -> Vec<Change> {
        let c = job.chunk;
        self.stats.chunks += 1;
        if audio::voiced_ms(&c.samples) < 250 {
            self.stats.silent += 1;
            return vec![]; // no real speech in this stretch → don't invent text
        }
        let a = if self.dual { align(&frames(&c.samples), &job.other) } else { None };
        if self.dual && is_copy(c.mic, a) {
            if c.mic {
                self.stats.mic_echo_audio += 1;
                log::info!("meeting: mic chunk at {:.1}s is the call heard through the speakers (skipped)", c.t0);
            } else {
                self.stats.call_echo_audio += 1;
                log::info!("meeting: call chunk at {:.1}s is your own voice played back (skipped)", c.t0);
            }
            return vec![];
        }
        let who = owner(c.mic, a);
        let tr = if c.mic { MIC } else { CALL };
        // a quick back-and-forth on the call (no 700 ms pause) is one VAD segment: cut it where
        // the voice changes so each turn is transcribed and labelled
        let pieces: Vec<(f64, Vec<f32>)> = match &self.embedder {
            // your line with the call's echo before / after it: keep only your part
            _ if c.mic && self.dual => {
                let ranges = carve_echo(&c.samples, &job.other);
                if ranges.is_empty() {
                    self.stats.mic_echo_audio += 1;
                    return vec![];
                }
                if ranges.len() > 1 || ranges[0] != (0..c.samples.len()) {
                    self.stats.carved += 1;
                    log::info!("meeting: kept {} part(s) of the mic chunk at {:.1}s, dropped the call's echo", ranges.len(), c.t0);
                }
                ranges.into_iter().map(|r| (c.t0 + r.start as f64 / RATE, c.samples[r].to_vec())).collect()
            }
            Some(e) if !c.mic && c.secs() as f32 >= speakers::MIN_SPLIT_SECS => {
                let ranges = speakers::split_turns(&c.samples, TARGET_RATE, |w| e.embed(w));
                if ranges.len() > 1 {
                    self.stats.splits += 1;
                    log::info!("meeting: split call segment at {:.1}s into {} turns", c.t0, ranges.len());
                    ranges.into_iter().map(|r| (c.t0 + r.start as f64 / RATE, c.samples[r].to_vec())).collect()
                } else {
                    vec![(c.t0, c.samples)]
                }
            }
            _ => vec![(c.t0, c.samples)],
        };
        let mut out = vec![];
        for (t0, samples) in pieces {
            let secs = samples.len() as f32 / TARGET_RATE as f32;
            let t1 = t0 + secs as f64;
            if audio::voiced_ms(&samples) < 250 {
                continue;
            }
            // whose sound is this piece (its own timing against the other track)
            let who = if self.dual {
                let off = ((t0 - c.t0) * RATE).round().max(0.0) as usize / FRAME;
                let n = samples.len().div_ceil(FRAME) + 2 * PAD;
                let other: Vec<f32> = (off..off + n).map(|k| job.other.get(k).copied().unwrap_or(0.0)).collect();
                match owner(c.mic, align(&frames(&samples), &other)) {
                    Owner::Unclear => who,
                    o => o,
                }
            } else {
                who
            };
            let lang = self.lang[tr].current().map(str::to_string);
            let started = std::time::Instant::now();
            let res = self.stt.transcribe(&samples, &self.last_text[tr], lang.as_deref());
            self.stats.stt_ms += started.elapsed().as_millis() as u64;
            self.stats.audio_secs += secs as f64;
            let mut t = match res {
                Ok(t) if !t.trim().is_empty() && !stt::is_hallucination(&t, secs) && !stt::is_degenerate(&t) => t.trim().to_string(),
                Ok(_) => {
                    self.stats.filtered += 1;
                    continue;
                }
                Err(e) => {
                    self.stats.stt_errors += 1;
                    log::warn!("meeting segment STT failed: {e}");
                    out.push(Change::Error(e.to_string()));
                    continue;
                }
            };
            if lang.is_none() {
                self.lang[tr].observe(self.stt.detected_lang());
            }
            self.last_text[tr] = text::truncate_chars(&t, 200);
            // the other track may hold the same words: keep the original, drop the copy
            let mut remove: Vec<(Recent, Option<String>)> = vec![];
            let mut drop_new = false;
            let mut trimmed_new = false;
            let matches: Vec<Recent> = self.recent.iter().filter(|r| r.mic != c.mic && overlaps(t0, t1, r.t0, r.t1, 1.0) && same_words(&t, &r.text)).cloned().collect();
            for r in matches {
                let short = norm_words(&t).len() < 3 || norm_words(&r.text).len() < 3;
                let src = match (who, r.owner) {
                    (Owner::Unclear, o) => o,
                    (o, _) => o,
                };
                let src = match src {
                    // "yes" on both sides with no audio evidence: two people, keep both
                    Owner::Unclear if short => continue,
                    // same sentence, timing unclear: keep your line (a wrong "You" loses no words)
                    Owner::Unclear => Owner::Mic,
                    o => o,
                };
                let new_is_copy = (src == Owner::Call) == c.mic;
                if new_is_copy {
                    // a segment can hold the copy *and* real words (your reply right after the
                    // echo): keep what is left once the other line's words are taken out
                    match leftover(&t, &r.text) {
                        Some(rest) => {
                            t = rest;
                            trimmed_new = true;
                        }
                        None => {
                            drop_new = true;
                            break;
                        }
                    }
                } else {
                    let rest = leftover(&r.text, &t);
                    remove.push((r, rest));
                }
            }
            if trimmed_new && !drop_new {
                log::info!("meeting: kept the {} words at {t0:.1}s that aren't a copy of the other track", if c.mic { "mic" } else { "call" });
            }
            if drop_new {
                if c.mic {
                    self.stats.mic_dup_text += 1;
                    log::info!("meeting: dropped mic line at {t0:.1}s (same words as the call, from the call)");
                } else {
                    self.stats.call_dup_text += 1;
                    log::info!("meeting: dropped call line at {t0:.1}s (your own voice played back)");
                }
                continue;
            }
            for (r, rest) in remove {
                if r.mic {
                    self.stats.mic_dup_text += 1;
                } else {
                    self.stats.call_dup_text += 1;
                    if rest.is_none() {
                        self.call_segs.retain(|s| s.t != r.t0);
                    }
                }
                log::info!("meeting: removed {} line at {:.1}s (copy of the other track)", if r.mic { "mic" } else { "call" }, r.t0);
                self.recent.retain(|x| !(x.mic == r.mic && x.t0 == r.t0 && x.text == r.text));
                out.push(Change::Remove(MeetingSegment { t: r.t0, text: r.text.clone(), speaker: Some(r.speaker.clone()) }));
                match rest {
                    // the old line also had words of its own: keep those
                    Some(rest) => {
                        self.recent.push_back(Recent { text: rest.clone(), ..r.clone() });
                        out.push(Change::Add(MeetingSegment { t: r.t0, text: rest, speaker: Some(r.speaker) }));
                    }
                    None => self.stats.lines = self.stats.lines.saturating_sub(1),
                }
            }
            let speaker = if c.mic { YOU.to_string() } else { self.call_speaker(t0, secs, samples) };
            self.stats.lines += 1;
            self.recent.push_back(Recent { mic: c.mic, t0, t1, text: t.clone(), speaker: speaker.clone(), owner: who });
            while self.recent.front().is_some_and(|r| r.t1 < t0 - 30.0) {
                self.recent.pop_front();
            }
            out.push(Change::Add(MeetingSegment { t: t0, text: t, speaker: Some(speaker) }));
        }
        out
    }

    /// Who on the call: voice embedding → cluster → "Speaker N" / remembered name.
    fn call_speaker(&mut self, t0: f64, secs: f32, samples: Vec<f32>) -> String {
        let emb = self.embedder.as_ref().and_then(|e| e.embed(&samples));
        let label = emb
            .as_ref()
            .and_then(|e| speakers::assign(&mut self.clusters, e, secs, &self.voices))
            .map(|i| self.clusters[i].label.clone())
            .unwrap_or_else(|| self.call_label_fallback());
        let keep_audio = emb.is_none() && speakers::supported() && self.kept_audio_secs + secs <= MAX_KEPT_AUDIO_SECS;
        if keep_audio {
            self.kept_audio_secs += secs;
        }
        self.call_segs.push(CallSeg { t: t0, secs, emb, audio: keep_audio.then_some(samples) });
        self.last_call_label = Some(label.clone());
        label
    }
}

/// Embeddings for call clips recorded before the voice model was ready.
pub fn fill_embeddings(segs: &mut [CallSeg], e: &Embedder) {
    for s in segs.iter_mut() {
        if s.emb.is_none() {
            if let Some(a) = s.audio.take() {
                s.emb = e.embed(&a);
            }
        }
    }
}

/// After the call: re-cluster all call segments (better than the live, greedy assignment) and
/// name clusters from remembered voices. Returns each segment's final label (by start time) and
/// the clusters; None when no clip had a usable embedding.
pub fn recluster(segs: &[CallSeg], voices: &[Voice]) -> Option<(Vec<(f64, Option<String>)>, Vec<Cluster>)> {
    let with: Vec<&CallSeg> = segs.iter().filter(|s| s.emb.is_some() && s.secs >= speakers::MIN_EMBED_SECS).collect();
    if with.is_empty() {
        return None;
    }
    let embs: Vec<Vec<f32>> = with.iter().map(|s| s.emb.clone().unwrap_or_default()).collect();
    let weights: Vec<f32> = with.iter().map(|s| s.secs).collect();
    let ids = speakers::agglomerate(&embs, &weights, speakers::SAME_SPEAKER);
    let k = ids.iter().max().map(|m| m + 1).unwrap_or(0);
    let mut cents: Vec<(Vec<f32>, u32)> = vec![(vec![], 0); k];
    for (e, id) in embs.iter().zip(&ids) {
        let (c, n) = &mut cents[*id];
        *c = speakers::blend(c, *n, e, 1);
        *n += 1;
    }
    let centroids: Vec<Vec<f32>> = cents.iter().map(|c| c.0.clone()).collect();
    let labels = speakers::label_clusters(&centroids, voices);
    let label_for = |s: &CallSeg| -> Option<String> {
        let e = s.emb.as_ref()?;
        centroids.iter().enumerate().map(|(i, c)| (i, speakers::cosine(c, e))).max_by(|a, b| a.1.total_cmp(&b.1)).map(|(i, _)| labels[i].clone())
    };
    let final_labels = segs.iter().map(|s| (s.t, label_for(s))).collect();
    let clusters = centroids.into_iter().zip(labels).zip(cents.iter().map(|c| c.1)).map(|((centroid, label), count)| Cluster { label, centroid, count }).collect();
    Some((final_labels, clusters))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic "speech": bursts of noise-like tone with varying loudness and pauses.
    fn speechy(secs: f32, seed: u32, amp: f32) -> Vec<f32> {
        let n = (secs * 16_000.0) as usize;
        let mut out = vec![0.0f32; n];
        let mut s = seed.wrapping_mul(2654435761).wrapping_add(1);
        let mut i = 0;
        while i < n {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            let burst = 1600 + (s >> 20) as usize % 4800; // 0.1–0.4 s
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            let gap = 800 + (s >> 21) as usize % 3200; // 0.05–0.25 s
            let a = amp * (0.4 + ((s >> 8) & 0xff) as f32 / 255.0 * 0.6);
            for k in 0..burst.min(n - i) {
                out[i + k] = ((i + k) as f32 * 0.31).sin() * a * (1.0 + 0.3 * ((i + k) as f32 * 0.011).sin());
            }
            i += burst + gap;
        }
        out
    }

    fn delayed(s: &[f32], ms: usize, gain: f32) -> Vec<f32> {
        let d = ms * 16;
        let mut out = vec![0.0f32; s.len()];
        for i in d..s.len() {
            out[i] = s[i - d] * gain;
        }
        out
    }

    fn padded_env(other: &[f32], at: usize, n_samples: usize) -> Vec<f32> {
        // the other track's frames over [at - PAD, at + n + PAD) (in samples of the same timeline)
        let e = frames(other);
        let f0 = at / FRAME;
        let n = n_samples.div_ceil(FRAME) + 2 * PAD;
        (0..n).map(|k| (f0 + k).checked_sub(PAD).and_then(|j| e.get(j).copied()).unwrap_or(0.0)).collect()
    }

    #[test]
    fn clock_is_sample_exact_and_reanchors_after_a_gap() {
        let mut c = Clock::default();
        // first drain: 0.3 s of audio at wall 0.3 → starts at 0
        assert!((c.place(4800, 0.3) - 0.0).abs() < 1e-9);
        // a stalled loop drains 18 s at once: still continuous, not "now minus 18 s" drift
        assert!((c.place(16_000 * 18, 18.4) - 0.3).abs() < 1e-9);
        // the device delivered nothing for 5 s → re-anchored to the wall clock
        let t = c.place(4800, 23.6);
        assert!((t - 23.3).abs() < 1e-6, "{t}");
        assert_eq!(c.place(0, 30.0), t + 0.3);
    }

    /// Three sentences with real pauses. Whatever the drain size (300 ms like the live loop, or
    /// 18 s at once after a stall), the cuts and timestamps are the same.
    #[test]
    fn backlog_drains_cut_the_same_sentences_with_true_times() {
        let mut a = vec![0.0f32; 16_000]; // 1 s silence
        for k in 0..3 {
            a.extend(speechy(2.0, k, 0.2));
            a.extend(vec![0.0f32; 16_000 * 2]); // 2 s pause
        }
        let run = |drain: usize| -> Vec<(f64, f64)> {
            let mut ch = Chunker::new(true);
            let mut out = vec![];
            let mut i = 0;
            while i < a.len() {
                let end = (i + drain).min(a.len());
                let t = ch.clock.place(end - i, end as f64 / 16_000.0);
                out.extend(ch.feed(t, &a[i..end]).into_iter().filter(|c| !c.partial).map(|c| (c.t0, c.secs())));
                i = end;
            }
            out.extend(ch.flush().map(|c| (c.t0, c.secs())));
            out
        };
        let live = run(4800);
        let stalled = run(16_000 * 18);
        let odd = run(3_333);
        assert_eq!(live.len(), 3, "{live:?}");
        for (k, (t, secs)) in live.iter().enumerate() {
            let expect = 1.0 + k as f64 * 4.0;
            assert!((t - expect).abs() < 0.35, "sentence {k} at {t}, expected {expect}");
            assert!(*secs < 3.0, "sentence {k} is {secs}s long: pauses were missed");
        }
        let close = |a: &[(f64, f64)], b: &[(f64, f64)]| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x.0 - y.0).abs() < 1e-6 && (x.1 - y.1).abs() < 1e-6);
        assert!(close(&live, &stalled), "{live:?} vs {stalled:?}");
        assert_eq!(live.len(), odd.len());
    }

    #[test]
    fn quiet_mic_still_counts_as_speech() {
        // ~-44 dBFS talker on a very quiet mic (below the old fixed 0.012 VAD level)
        let mut a: Vec<f32> = vec![0.0004; 16_000 * 3];
        a.extend(speechy(3.0, 7, 0.012));
        a.extend(vec![0.0004; 16_000 * 2]);
        let mut ch = Chunker::new(true);
        let mut finals = vec![];
        for (i, s) in a.chunks(4800).enumerate() {
            let t = ch.clock.place(s.len(), (i + 1) as f64 * 0.3);
            finals.extend(ch.feed(t, s).into_iter().filter(|c| !c.partial));
        }
        finals.extend(ch.flush());
        assert_eq!(finals.len(), 1, "quiet speech was dropped");
        assert!((finals[0].t0 - 3.0).abs() < 0.35, "{}", finals[0].t0);
    }

    #[test]
    fn echo_from_the_call_is_detected_and_your_voice_never_is() {
        let call = speechy(4.0, 1, 0.2);
        // laptop speakers: the mic hears the call 60 ms later, 20 dB quieter, over room noise
        let mut mic = delayed(&call, 60, 0.1);
        mic.iter_mut().enumerate().for_each(|(i, x)| *x += ((i * 7919) % 13) as f32 * 0.0002);
        let a = align(&frames(&mic), &padded_env(&call, 0, mic.len())).unwrap();
        assert!(a.lag >= 2 && a.lag <= 4 && a.corr > 0.8, "{a:?}");
        assert!(is_copy(true, Some(a)));
        assert_eq!(owner(true, Some(a)), Owner::Call);

        // you talk while the call is silent → never an echo
        let you = speechy(4.0, 2, 0.2);
        let silent = vec![0.0f32; you.len()];
        let a = align(&frames(&you), &padded_env(&silent, 0, you.len()));
        assert!(!is_copy(true, a));
        assert_eq!(owner(true, a), Owner::Unclear);

        // you talk over the call (double talk): your own contour, not the call's
        let both: Vec<f32> = you.iter().zip(delayed(&call, 60, 0.1)).map(|(a, b)| a + b).collect();
        assert!(!is_copy(true, align(&frames(&both), &padded_env(&call, 0, both.len()))));
    }

    #[test]
    fn your_voice_played_back_by_the_call_belongs_to_you() {
        let you = speechy(4.0, 3, 0.2);
        // the call app plays your voice back 150 ms later (monitoring / sidetone through the tap)
        let call = delayed(&you, 150, 0.5);
        // the mic chunk is NOT an echo (the mic leads)
        let a = align(&frames(&you), &padded_env(&call, 0, you.len())).unwrap();
        assert!(a.lag <= -6, "{a:?}");
        assert!(!is_copy(true, Some(a)));
        assert_eq!(owner(true, Some(a)), Owner::Mic);
        // the call chunk is the copy
        let b = align(&frames(&call), &padded_env(&you, 0, call.len())).unwrap();
        assert!(b.lag >= 6, "{b:?}");
        assert!(is_copy(false, Some(b)));
        assert_eq!(owner(false, Some(b)), Owner::Mic);
        // someone on the call talking while you're silent is theirs
        let them = speechy(4.0, 4, 0.2);
        let quiet_mic = vec![0.0005f32; them.len()];
        let c = align(&frames(&them), &padded_env(&quiet_mic, 0, them.len()));
        assert!(!is_copy(false, c));
    }

    #[test]
    fn ordered_word_match_not_bag_of_words() {
        assert!(same_words("we should ship the build on friday", "We should ship the new build on Friday."));
        assert!(same_words("ship it on friday", "Okay, so ship it on Friday then, right?"));
        // the old bag-of-words check called these an echo (common words, any order)
        assert!(!same_words("I think the plan is to send it to the team", "the team is going to send me the plan I think"));
        assert!(!same_words("I'll send the deck tonight", "Can you share the pricing sheet?"));
        assert!(same_words("Okay.", "okay"));
        assert!(!same_words("Yes", "No"));
        assert!(!same_words("", "anything"));
        // Hindi (Devanagari with virama / matras) compares word by word
        assert!(same_words("कल सुबह दस बजे मीटिंग है", "कल सुबह दस बजे मीटिंग है।"));
        assert!(!same_words("कल सुबह दस बजे मीटिंग है", "मुझे राहुल को इनवॉइस भेजना है"));
    }

    #[test]
    fn language_locks_only_after_three_agreeing_clips() {
        let mut l = LangLock::new(None);
        l.observe(Some("en".into()));
        l.observe(Some("hi".into()));
        l.observe(Some("hi".into()));
        assert_eq!(l.current(), None);
        l.observe(Some("hi".into()));
        assert_eq!(l.current(), Some("hi"));
        l.observe(Some("en".into()));
        assert_eq!(l.current(), Some("hi"));
        let fixed = LangLock::new(Some("gu".into()));
        assert_eq!(fixed.current(), Some("gu"));
    }

    /// Scripted STT: returns the next text.
    struct Script(VecDeque<String>);
    impl Transcriber for Script {
        fn transcribe(&mut self, _s: &[f32], _c: &str, _l: Option<&str>) -> anyhow::Result<String> {
            Ok(self.0.pop_front().unwrap_or_default())
        }
        fn detected_lang(&self) -> Option<String> {
            Some("en".into())
        }
    }

    fn proc(texts: &[&str]) -> Processor<Script> {
        Processor::new(Script(texts.iter().map(|s| s.to_string()).collect()), true, vec![], Some("en".into()))
    }

    fn job(mic: bool, t0_samples: usize, samples: Vec<f32>, other: &[f32]) -> Job {
        let other = padded_env(other, t0_samples, samples.len());
        Job { chunk: Chunk { mic, t0: t0_samples as f64 / 16_000.0, samples, partial: false }, other }
    }

    fn adds(ch: &[Change]) -> Vec<(String, String)> {
        ch.iter().filter_map(|c| if let Change::Add(s) = c { Some((s.speaker.clone().unwrap(), s.text.clone())) } else { None }).collect()
    }

    #[test]
    fn processor_keeps_you_when_the_call_is_silent() {
        let you = speechy(3.0, 5, 0.2);
        let silent = vec![0.0f32; you.len()];
        let mut p = proc(&["Let's ship the build on Friday"]);
        let out = p.handle(job(true, 0, you, &silent));
        assert_eq!(adds(&out), vec![("You".into(), "Let's ship the build on Friday".into())]);
    }

    #[test]
    fn processor_drops_the_speaker_echo_and_keeps_the_call_line() {
        let call = speechy(3.0, 6, 0.2);
        let mic = delayed(&call, 60, 0.1);
        let mut p = proc(&["Can you send the pricing deck by Monday?"]);
        let out = p.handle(job(false, 0, call.clone(), &mic));
        assert_eq!(adds(&out).len(), 1);
        // the mic chunk is skipped before STT (audio says: the call's sound)
        assert!(p.handle(job(true, 0, mic, &call)).is_empty());
        assert_eq!(p.stats.mic_echo_audio, 1);
    }

    #[test]
    fn processor_replaces_a_played_back_call_line_with_yours() {
        // the call track committed your played-back voice first ("Speaker"), then the mic line
        // arrives: the call copy is removed and the line stays "You"
        let you = speechy(3.0, 8, 0.2);
        let call = delayed(&you, 150, 0.5);
        let mut p = proc(&["I will review the PR tonight", "I will review the PR tonight"]);
        // not skipped as audio when the playback is partial (coverage < 90 %): simulate by
        // feeding the call job with a mic envelope that only has the first half of your speech
        let mut half = you.clone();
        half[you.len() / 2..].iter_mut().for_each(|x| *x = 0.0);
        let first = p.handle(job(false, 0, call.clone(), &half));
        assert_eq!(adds(&first).len(), 1);
        let second = p.handle(job(true, 0, you, &call));
        assert!(second.iter().any(|c| matches!(c, Change::Remove(s) if s.text == "I will review the PR tonight")), "{second:?}");
        assert_eq!(adds(&second), vec![("You".into(), "I will review the PR tonight".into())]);
    }

    #[test]
    fn processor_keeps_both_when_people_say_different_things_at_once() {
        let you = speechy(3.0, 9, 0.2);
        let them = speechy(3.0, 10, 0.2);
        let mic: Vec<f32> = you.iter().zip(delayed(&them, 60, 0.1)).map(|(a, b)| a + b).collect();
        let mut p = proc(&["Can we move the launch to Tuesday?", "Sure, Tuesday works for me"]);
        assert_eq!(adds(&p.handle(job(false, 0, them.clone(), &mic))).len(), 1);
        assert_eq!(adds(&p.handle(job(true, 0, mic, &them))).len(), 1);
        // short identical answers from both sides with no audio link: two people, both kept
        let mut p = proc(&["Yes.", "Yes."]);
        let a = speechy(2.0, 11, 0.2);
        let b = speechy(2.0, 12, 0.2);
        assert_eq!(adds(&p.handle(job(false, 0, a.clone(), &vec![0.0; a.len()]))).len(), 1);
        let out = p.handle(job(true, 0, b.clone(), &vec![0.0; b.len()]));
        assert_eq!(adds(&out).len(), 1, "{out:?} {:?}", p.stats);
    }

    #[test]
    fn leftover_keeps_your_words_after_the_echo() {
        // one mic segment caught the call's echo and then your reply
        let mic = "Quarter. I can send the updated deck to everyone by Friday.";
        let call = "Sounds good. I looked at the numbers from last quarter.";
        assert_eq!(leftover(mic, call).as_deref(), Some("I can send the updated deck to everyone by Friday."));
        // a pure copy leaves nothing
        assert_eq!(leftover("I looked at the numbers from last quarter", call), None);
        // two stray words are not a line
        assert_eq!(leftover("Okay so sounds good. I looked at the numbers from last quarter.", call), None);
        assert_eq!(leftover("", call), None);
    }

    #[test]
    fn carving_cuts_the_echo_out_of_your_line() {
        // 2 s of the call's echo, 0.5 s gap, then 2.5 s of you while the call is silent
        let call_speech = speechy(2.0, 13, 0.2);
        let mut call = call_speech.clone();
        call.extend(vec![0.0f32; 16_000 * 3]);
        let mut mic = delayed(&call_speech, 50, 0.3);
        mic.extend(vec![0.0f32; 16_000 / 2]);
        mic.extend(speechy(2.5, 14, 0.2));
        mic.resize(call.len(), 0.0);
        let r = carve_echo(&mic, &padded_env(&call, 0, mic.len()));
        assert_eq!(r.len(), 1, "{r:?}");
        let start = r[0].start as f64 / 16_000.0;
        assert!(start > 1.9 && start < 2.5, "your part starts at {start}");
        // all yours (call silent) → untouched
        let you = speechy(3.0, 15, 0.2);
        assert_eq!(carve_echo(&you, &padded_env(&vec![0.0; you.len()], 0, you.len())), vec![0..you.len()]);
        // you talking over the call → kept whole
        let them = speechy(3.0, 16, 0.2);
        let both: Vec<f32> = you.iter().zip(delayed(&them, 50, 0.1)).map(|(a, b)| a + b).collect();
        assert_eq!(carve_echo(&both, &padded_env(&them, 0, both.len())), vec![0..both.len()]);
    }

    #[test]
    fn the_mic_vad_ends_your_sentence_when_only_the_echo_continues() {
        // you speak 2 s while the call is quiet, then the call talks 3 s (heard at -10 dB)
        let you = speechy(2.0, 17, 0.2);
        let them = speechy(3.0, 18, 0.2);
        let mut call = vec![0.0f32; you.len() + 16_000 / 2];
        call.extend(&them);
        call.extend(vec![0.0f32; 16_000 * 2]);
        let mut mic = you.clone();
        mic.resize(call.len(), 0.0);
        let echo = delayed(&call, 50, 0.316);
        mic.iter_mut().zip(&echo).for_each(|(m, e)| *m += e);
        let mut cap = Capture::new(true);
        let mut jobs = vec![];
        for (i, (m, c)) in mic.chunks(4800).zip(call.chunks(4800)).enumerate() {
            jobs.extend(cap.push(m, c, (i + 1) as f64 * 0.3).into_iter().filter(|j| !j.chunk.partial));
        }
        jobs.extend(cap.flush());
        let mic_jobs: Vec<&Job> = jobs.iter().filter(|j| j.chunk.mic).collect();
        assert!(!mic_jobs.is_empty());
        // your sentence is its own chunk: it ends before the echo has run on for long
        assert!(mic_jobs[0].chunk.t0 < 0.3 && mic_jobs[0].chunk.secs() < 3.6, "{:?}", mic_jobs.iter().map(|j| (j.chunk.t0, j.chunk.secs())).collect::<Vec<_>>());
    }

    #[test]
    fn recluster_needs_embeddings() {
        let segs = vec![CallSeg { t: 0.0, secs: 2.0, emb: None, audio: None }];
        assert!(recluster(&segs, &[]).is_none());
        let e1 = speakers::normalize(vec![1.0, 0.0, 0.0]);
        let e2 = speakers::normalize(vec![0.0, 1.0, 0.0]);
        let segs = vec![
            CallSeg { t: 0.0, secs: 2.0, emb: Some(e1.clone()), audio: None },
            CallSeg { t: 3.0, secs: 2.0, emb: Some(e2), audio: None },
            CallSeg { t: 6.0, secs: 2.0, emb: Some(e1), audio: None },
        ];
        let (labels, clusters) = recluster(&segs, &[]).unwrap();
        assert_eq!(clusters.len(), 2);
        assert_eq!(labels[0].1, labels[2].1);
        assert_ne!(labels[0].1, labels[1].1);
    }
}
