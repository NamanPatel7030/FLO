//! Meeting simulator: feeds recorded mic + call tracks through the exact live pipeline
//! (`meetpipe::Capture` → `Processor` → speaker re-clustering) with the installed Whisper and
//! voice models, instead of live capture.
//!
//! - `Flo --meeting-sim mic.wav call.wav|- out.json`: run on any two 16 kHz-or-other WAV files.
//! - `FLO_SIM_OUT=report.json cargo test --release --lib meeting_sim -- --ignored --nocapture`:
//!   the scenario harness. It speaks a scripted meeting with macOS `say` (several voices, English
//!   and Hindi), mixes the two tracks the way real calls sound (headphones, laptop-speaker echo at
//!   -10/-20 dB, the call app playing your voice back, overlaps, long silences, a 20-minute run)
//!   and checks text, speaker labels, ordering, timestamps, lost speech and duplicates.
// the scenario tools are used by the harness test only
#![cfg_attr(not(test), allow(dead_code))]
use crate::meeting::{apply_call_labels, insert_sorted, YOU};
use crate::meetpipe::{self, Capture, Change, Processor, Stats, Transcriber, RATE, SLICE};
use crate::model::MeetingSegment;
use crate::speakers::Embedder;
use crate::{audio, stt};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// On-device Whisper as the meeting's speech engine.
pub struct SimStt {
    pub w: stt::LocalWhisper,
    pub path: PathBuf,
    pub lang: String,
}

impl Transcriber for SimStt {
    fn transcribe(&mut self, samples: &[f32], context: &str, lang: Option<&str>) -> anyhow::Result<String> {
        let s = audio::trim_silence(samples);
        let r = self.w.transcribe(&self.path, &s, lang.unwrap_or(&self.lang), context);
        if std::env::var_os("FLO_SIM_DEBUG").is_some() {
            eprintln!("STT {:.2}s lang {:?} ctx {:?} → {:?} (detected {:?})", s.len() as f32 / 16_000.0, lang, context, r, self.w.detected_lang());
        }
        r
    }
    fn detected_lang(&self) -> Option<String> {
        self.w.detected_lang()
    }
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_default().join("com.flo.flow")
}

/// The user's speech engine and voice model, as the app would use them.
pub fn engine() -> anyhow::Result<(SimStt, Option<Arc<Embedder>>)> {
    let dir = data_dir();
    // read-only (settings::load may migrate and rewrite the file)
    let s: crate::model::Settings = std::fs::read_to_string(dir.join("settings.json")).ok().and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    let models = dir.join("models");
    let path = stt::model_path(&models, &s.stt_model).ok_or_else(|| anyhow::anyhow!("unknown speech model {}", s.stt_model))?;
    anyhow::ensure!(path.exists(), "speech model {} isn't downloaded", s.stt_model);
    let w = stt::LocalWhisper::default();
    *w.auto_langs.lock() = stt::allowed_languages(&s.auto_languages);
    w.warm(&path);
    let lang = if s.language.is_empty() { "auto".into() } else { s.language.clone() };
    Ok((SimStt { w, path, lang }, Embedder::load(&models).map(Arc::new)))
}

#[derive(Debug, Clone)]
pub struct SimOpts {
    /// VAD units drained per loop round: 1 = the live 300 ms loop; 30 = a loop stalled for 9 s
    pub drain_slices: usize,
    /// language for both tracks (None = auto, as with Settings → Language "auto")
    pub lang: Option<String>,
}

impl Default for SimOpts {
    fn default() -> Self {
        Self { drain_slices: 1, lang: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimOut {
    pub transcript: Vec<MeetingSegment>,
    pub stats: Stats,
    pub wall_secs: f64,
    pub audio_secs: f64,
    pub removed: usize,
}

/// Run both tracks through the meeting pipeline, as the live loop does (same order, same code).
pub fn simulate<T: Transcriber>(stt: T, embedder: Option<Arc<Embedder>>, mic: &[f32], call: Option<&[f32]>, o: &SimOpts) -> SimOut {
    let t = std::time::Instant::now();
    let dual = call.is_some();
    let mut cap = Capture::new(dual);
    let mut p = Processor::new(stt, dual, vec![], o.lang.clone());
    p.embedder = embedder.clone();
    let mut transcript: Vec<MeetingSegment> = vec![];
    let mut removed = 0;
    let total = mic.len().max(call.map(|c| c.len()).unwrap_or(0));
    let step = SLICE * o.drain_slices.max(1);
    let part = |s: &[f32], a: usize, b: usize| -> Vec<f32> { (a..b).map(|i| s.get(i).copied().unwrap_or(0.0)).collect() };
    let mut apply = |changes: Vec<Change>, transcript: &mut Vec<MeetingSegment>| {
        for c in changes {
            match c {
                Change::Add(s) => insert_sorted(transcript, s),
                Change::Remove(s) => {
                    removed += 1;
                    transcript.retain(|x| !(x.t == s.t && x.text == s.text));
                }
                _ => {}
            }
        }
    };
    let mut i = 0;
    while i < total {
        let end = (i + step).min(total);
        let m = part(mic, i, end);
        let c = call.map(|c| part(c, i, end)).unwrap_or_default();
        for job in cap.push(&m, &c, end as f64 / RATE) {
            // previews don't change the note; skip them (the live loop also skips them when busy)
            if !job.chunk.partial {
                if std::env::var_os("FLO_SIM_DEBUG").is_some() {
                    eprintln!("JOB {} t0 {:.2} secs {:.2}", if job.chunk.mic { "mic " } else { "call" }, job.chunk.t0, job.chunk.secs());
                }
                let ch = p.handle(job);
                apply(ch, &mut transcript);
            }
        }
        i = end;
    }
    for job in cap.flush() {
        let ch = p.handle(job);
        apply(ch, &mut transcript);
    }
    // post-call speaker pass (as meeting::speaker_pass)
    if let Some(e) = &embedder {
        meetpipe::fill_embeddings(&mut p.call_segs, e);
    }
    if let Some((labels, _)) = meetpipe::recluster(&p.call_segs, &[]) {
        apply_call_labels(&mut transcript, &labels);
    }
    SimOut { transcript, stats: p.stats.clone(), wall_secs: t.elapsed().as_secs_f64(), audio_secs: total as f64 / RATE, removed }
}

fn read_wav(path: &str) -> anyhow::Result<Vec<f32>> {
    let mut r = hound::WavReader::open(path)?;
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().filter_map(|s| s.ok()).collect(),
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().filter_map(|s| s.ok()).map(|s| s as f32 / max).collect()
        }
    };
    let mono: Vec<f32> = raw.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect();
    Ok(audio::resample(&mono, spec.sample_rate, audio::TARGET_RATE))
}

/// `--meeting-sim mic.wav call.wav|- out.json`
pub fn run_files(mic: &str, call: &str, out: &str) {
    let out = if out.is_empty() { "/tmp/flo-meeting-sim.json" } else { out };
    let report = (|| -> anyhow::Result<serde_json::Value> {
        let m = read_wav(mic)?;
        let c = if call.is_empty() || call == "-" { None } else { Some(read_wav(call)?) };
        let (stt, emb) = engine()?;
        let r = simulate(stt, emb, &m, c.as_deref(), &SimOpts::default());
        Ok(serde_json::to_value(&r)?)
    })()
    .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }));
    let txt = serde_json::to_string_pretty(&report).unwrap_or_default();
    println!("{txt}");
    let _ = std::fs::write(out, txt);
}

// ── scenario harness ───────────────────────────────────────────────────────

/// One spoken line of a scripted meeting.
#[derive(Debug, Clone)]
pub struct Line {
    pub you: bool,
    pub voice: &'static str,
    pub text: &'static str,
    /// pause before this line (from the end of the previous one; negative = overlap)
    pub gap: f64,
}

pub const fn you(text: &'static str, gap: f64) -> Line {
    Line { you: true, voice: "Rishi", text, gap }
}
/// you, speaking Hindi (the Indian English voice can't read Devanagari)
pub const fn you_hi(text: &'static str, gap: f64) -> Line {
    Line { you: true, voice: "Lekha", text, gap }
}
pub const fn them(voice: &'static str, text: &'static str, gap: f64) -> Line {
    Line { you: false, voice, text, gap }
}

#[derive(Debug, Clone, Default)]
pub struct Mix {
    /// call → mic through laptop speakers: (gain dB, delay ms)
    pub echo: Option<(f32, usize)>,
    /// your voice → call track (the call app plays it back): (gain dB, delay ms)
    pub playback: Option<(f32, usize)>,
    /// mic room noise RMS
    pub noise: f32,
    /// mic-only meeting (no call track)
    pub mic_only: bool,
}

/// Where a line ended up in the mix.
#[derive(Debug, Clone)]
pub struct Placed {
    pub line: Line,
    pub start: f64,
    pub end: f64,
}

pub struct Clips {
    dir: PathBuf,
    cache: std::collections::HashMap<(String, String), Vec<f32>>,
}

impl Clips {
    pub fn new(dir: &Path) -> Self {
        let _ = std::fs::create_dir_all(dir);
        Self { dir: dir.to_path_buf(), cache: Default::default() }
    }
    pub fn get(&mut self, voice: &str, text: &str) -> Vec<f32> {
        let key = (voice.to_string(), text.to_string());
        if let Some(c) = self.cache.get(&key) {
            return c.clone();
        }
        let name = format!("c{}", self.cache.len());
        let a = crate::selftest::tts_voice_to_16k(text, Some(voice), &self.dir, &name).map(|a| audio::trim_silence(&a)).unwrap_or_default();
        for ext in ["aiff", "wav"] {
            let _ = std::fs::remove_file(self.dir.join(format!("{name}.{ext}")));
        }
        self.cache.insert(key, a.clone());
        a
    }
}

fn db(g: f32) -> f32 {
    10f32.powf(g / 20.0)
}

fn add(dst: &mut Vec<f32>, at: usize, src: &[f32], gain: f32) {
    if dst.len() < at + src.len() {
        dst.resize(at + src.len(), 0.0);
    }
    for (i, x) in src.iter().enumerate() {
        dst[at + i] += x * gain;
    }
}

/// A small room: the direct copy plus one reflection 30 ms later.
fn add_room(dst: &mut Vec<f32>, src: &[f32], gain: f32, delay_ms: usize) {
    let d = delay_ms * 16;
    let mut copy = vec![0.0f32; d];
    copy.extend_from_slice(src);
    add(dst, 0, &copy, gain);
    let mut refl = vec![0.0f32; d + 480];
    refl.extend_from_slice(src);
    add(dst, 0, &refl, gain * 0.4);
}

/// Lay the lines out in time and mix the two tracks. Returns (mic, call, placed lines).
pub fn mix(clips: &mut Clips, lines: &[Line], m: &Mix, lead_in: f64, tail: f64) -> (Vec<f32>, Vec<f32>, Vec<Placed>) {
    let mut you_clean: Vec<f32> = vec![];
    let mut call_clean: Vec<f32> = vec![];
    let mut placed = vec![];
    let mut t = lead_in;
    for l in lines {
        let a = clips.get(l.voice, l.text);
        let start = (t + l.gap).max(0.0);
        let at = (start * RATE) as usize;
        add(if l.you { &mut you_clean } else { &mut call_clean }, at, &a, 1.0);
        let end = start + a.len() as f64 / RATE;
        placed.push(Placed { line: l.clone(), start, end });
        t = t.max(end);
    }
    let n = ((t + tail) * RATE) as usize;
    you_clean.resize(n, 0.0);
    call_clean.resize(n, 0.0);
    let mut mic = you_clean.clone();
    if let Some((g, d)) = m.echo {
        add_room(&mut mic, &call_clean, db(g), d);
    }
    let mut s: u32 = 12345;
    for x in mic.iter_mut() {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        *x += ((s >> 9) as f32 / (1u32 << 23) as f32 - 0.5) * 2.0 * m.noise * 1.73;
    }
    let mut call = call_clean;
    if let Some((g, d)) = m.playback {
        add_room(&mut call, &you_clean, db(g), d);
    }
    mic.truncate(n);
    call.truncate(n);
    placed.sort_by(|a, b| a.start.total_cmp(&b.start));
    (mic, call, placed)
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Eval {
    pub lines: usize,
    pub found: usize,
    pub you_lines: usize,
    pub you_found: usize,
    /// your lines that are missing or not labelled "You"
    pub you_lost: usize,
    pub others_lines: usize,
    pub others_found: usize,
    /// found lines with the wrong side ("You" for someone else, or the reverse)
    pub wrong_side: usize,
    /// share of each other voice's lines carrying that voice's main label (1.0 = perfect)
    pub label_purity: f64,
    /// distinct other voices that got distinct labels
    pub voices_separated: bool,
    /// extra copies of a line (echo duplicates)
    pub duplicates: usize,
    /// transcript lines matching no spoken line
    pub extras: usize,
    pub ts_err_mean: f64,
    pub ts_err_max: f64,
    pub order_inversions: usize,
    pub word_recall: f64,
    pub missing: Vec<String>,
}

fn coverage(expected: &str, got: &str) -> f64 {
    let e = meetpipe::norm_words(expected);
    let g = meetpipe::norm_words(got);
    if e.is_empty() {
        return 0.0;
    }
    meetpipe::lcs(&e, &g) as f64 / e.len() as f64
}

/// Score a transcript against the lines that were spoken.
pub fn evaluate(placed: &[Placed], transcript: &[MeetingSegment]) -> Eval {
    let mut ev = Eval { lines: placed.len(), ..Default::default() };
    let mut used = vec![false; transcript.len()];
    let mut matched: Vec<Option<usize>> = vec![None; placed.len()];
    let mut ts = vec![];
    let mut words_total = 0.0;
    let mut words_got = 0.0;
    // longest lines first, so a short line can't steal a long line's segment
    let mut order: Vec<usize> = (0..placed.len()).collect();
    order.sort_by_key(|i| std::cmp::Reverse(placed[*i].line.text.len()));
    for &i in &order {
        let p = &placed[i];
        let best = transcript
            .iter()
            .enumerate()
            .filter(|(j, s)| !used[*j] && s.t >= p.start - 1.0 && s.t <= p.end)
            .map(|(j, s)| (j, coverage(p.line.text, &s.text)))
            .filter(|(_, c)| *c >= 0.5)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((j, c)) = best {
            used[j] = true;
            matched[i] = Some(j);
            ts.push((transcript[j].t - p.start).abs());
            words_got += c * meetpipe::norm_words(p.line.text).len() as f64;
        }
        words_total += meetpipe::norm_words(p.line.text).len() as f64;
    }
    let mut labels: std::collections::BTreeMap<&str, Vec<String>> = Default::default();
    for (i, p) in placed.iter().enumerate() {
        let is_you = |j: usize| transcript[j].speaker.as_deref() == Some(YOU);
        if p.line.you {
            ev.you_lines += 1;
            match matched[i] {
                Some(j) if is_you(j) => ev.you_found += 1,
                _ => ev.you_lost += 1,
            }
        } else {
            ev.others_lines += 1;
            if let Some(j) = matched[i] {
                ev.others_found += 1;
                labels.entry(p.line.voice).or_default().push(transcript[j].speaker.clone().unwrap_or_default());
            }
        }
        match matched[i] {
            Some(j) => {
                ev.found += 1;
                if is_you(j) != p.line.you {
                    ev.wrong_side += 1;
                }
            }
            None => ev.missing.push(p.line.text.to_string()),
        }
    }
    // labels: each other voice's majority label, purity, and distinct voices → distinct labels
    let mut majors = vec![];
    let (mut pure, mut all) = (0usize, 0usize);
    for ls in labels.values() {
        let mut counts: std::collections::BTreeMap<&str, usize> = Default::default();
        for l in ls {
            *counts.entry(l.as_str()).or_default() += 1;
        }
        if let Some((l, n)) = counts.iter().max_by_key(|(_, n)| **n) {
            majors.push(l.to_string());
            pure += n;
        }
        all += ls.len();
    }
    ev.label_purity = if all == 0 { 1.0 } else { pure as f64 / all as f64 };
    let mut uniq = majors.clone();
    uniq.sort();
    uniq.dedup();
    ev.voices_separated = uniq.len() == majors.len();
    // duplicates: an unused segment that repeats a spoken line at the same time
    for (j, s) in transcript.iter().enumerate() {
        if used[j] {
            continue;
        }
        let dup = placed.iter().any(|p| s.t >= p.start - 1.0 && s.t <= p.end + 1.0 && coverage(p.line.text, &s.text) >= 0.6);
        if dup {
            ev.duplicates += 1;
        } else if meetpipe::norm_words(&s.text).len() >= 2 {
            ev.extras += 1;
        }
    }
    // ordering: matched segments appear in the transcript in the order the lines started
    let seq: Vec<usize> = matched.iter().flatten().copied().collect();
    ev.order_inversions = seq.windows(2).filter(|w| w[1] < w[0]).count();
    if !ts.is_empty() {
        ev.ts_err_mean = ts.iter().sum::<f64>() / ts.len() as f64;
        ev.ts_err_max = ts.iter().copied().fold(0.0, f64::max);
    }
    ev.word_recall = if words_total > 0.0 { words_got / words_total } else { 0.0 };
    ev
}

pub fn rss_mb() -> f64 {
    let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output();
    out.ok().and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().ok()).map(|kb| kb / 1024.0).unwrap_or(0.0)
}

#[cfg(all(test, feature = "local-stt", target_os = "macos"))]
mod harness {
    use super::*;
    use serde_json::json;

    const Y: [&str; 6] = [
        "Okay, let's get started with the pricing review for the launch.",
        "I can send the updated deck to everyone by Friday.",
        "Can we move the design review to Tuesday afternoon?",
        "Great, I will book the meeting room for that.",
        "Let me check the analytics dashboard and get back to you.",
        "Thanks everyone, that was a really useful discussion.",
    ];
    const A: [&str; 5] = [
        "Sounds good. I looked at the numbers from last quarter.",
        "Our conversion rate went up by about twelve percent.",
        "Tuesday works for me, but not before two o'clock.",
        "Please also share the customer feedback summary.",
        "I think we should talk to the sales team about this.",
    ];
    const B: [&str; 4] = [
        "I agree with that plan. Marketing needs the final copy next week.",
        "I will draft the announcement email tomorrow morning.",
        "Let's keep the budget under fifty thousand dollars.",
        "Can someone send me the contract before the weekend?",
    ];
    const H: [&str; 3] = ["कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।", "मुझे राहुल को इनवॉइस भेजना है।", "आज का काम पूरा हो गया, अब घर जा रहा हूँ।"];

    fn alternating() -> Vec<Line> {
        vec![
            you(Y[0], 0.0),
            them("Samantha", A[0], 0.8),
            you(Y[1], 0.9),
            them("Daniel", B[0], 0.8),
            them("Samantha", A[1], 1.2),
            you(Y[2], 0.7),
            them("Daniel", B[1], 1.0),
            them("Samantha", A[2], 1.3),
            you(Y[3], 0.8),
        ]
    }

    struct Case {
        name: &'static str,
        lines: Vec<Line>,
        mix: Mix,
        opts: SimOpts,
        tail: f64,
    }

    fn cases() -> Vec<Case> {
        let headphones = Mix { noise: 0.001, ..Default::default() };
        let speakers = |g: f32| Mix { echo: Some((g, 45)), noise: 0.002, ..Default::default() };
        vec![
            Case { name: "only_you", lines: Y[..4].iter().enumerate().map(|(i, t)| you(t, if i == 0 { 0.0 } else { 1.5 })).collect(), mix: headphones.clone(), opts: SimOpts::default(), tail: 2.0 },
            Case { name: "only_you_mic_only", lines: Y[..3].iter().map(|t| you(t, 1.5)).collect(), mix: Mix { mic_only: true, noise: 0.001, ..Default::default() }, opts: SimOpts::default(), tail: 2.0 },
            Case {
                name: "only_call",
                lines: vec![them("Samantha", A[0], 0.0), them("Samantha", A[1], 1.2), them("Daniel", B[0], 1.0), them("Daniel", B[1], 1.2)],
                mix: headphones.clone(),
                opts: SimOpts::default(),
                tail: 2.0,
            },
            Case { name: "alternating_headphones", lines: alternating(), mix: headphones.clone(), opts: SimOpts::default(), tail: 2.0 },
            Case { name: "echo_-10dB", lines: alternating(), mix: speakers(-10.0), opts: SimOpts::default(), tail: 2.0 },
            Case { name: "echo_-20dB", lines: alternating(), mix: speakers(-20.0), opts: SimOpts::default(), tail: 2.0 },
            Case {
                name: "overlap_echo_-20dB",
                lines: vec![
                    them("Samantha", A[1], 0.0),
                    you(Y[1], -1.5), // you start talking 1.5 s before she finishes
                    them("Daniel", B[2], 0.8),
                    you(Y[2], -2.0),
                    them("Samantha", A[3], 1.0),
                ],
                mix: speakers(-20.0),
                opts: SimOpts::default(),
                tail: 2.0,
            },
            Case { name: "your_voice_played_back_in_call", lines: alternating(), mix: Mix { playback: Some((-6.0, 180)), noise: 0.001, ..Default::default() }, opts: SimOpts::default(), tail: 2.0 },
            Case {
                name: "silence_gaps",
                lines: vec![you(Y[0], 0.0), them("Samantha", A[0], 20.0), you(Y[1], 15.0), them("Daniel", B[0], 25.0)],
                mix: speakers(-20.0),
                opts: SimOpts::default(),
                tail: 6.0,
            },
            Case {
                name: "hindi_you_english_call",
                lines: vec![you_hi(H[0], 0.0), them("Samantha", A[0], 0.9), you_hi(H[1], 0.9), them("Daniel", B[0], 0.9), you_hi(H[2], 0.9)],
                mix: headphones.clone(),
                opts: SimOpts::default(),
                tail: 2.0,
            },
            Case { name: "stalled_loop_9s_drains_echo_-10dB", lines: alternating(), mix: speakers(-10.0), opts: SimOpts { drain_slices: 30, ..Default::default() }, tail: 2.0 },
        ]
    }

    /// ~20 minutes of alternating turns, with the odd long pause, laptop speakers at -20 dB.
    fn long_lines(target: f64, clips: &mut Clips) -> Vec<Line> {
        let mut out = vec![];
        let mut t = 0.0;
        let mut k = 0usize;
        while t < target {
            let gap = [0.8, 1.1, 0.9, 1.6, 0.7, 2.4][k % 6] + if k % 23 == 22 { 12.0 } else { 0.0 };
            let l = match k % 3 {
                0 => you(Y[(k / 3) % Y.len()], gap),
                1 => them("Samantha", A[(k / 3) % A.len()], gap),
                _ => them("Daniel", B[(k / 3) % B.len()], gap),
            };
            t += gap + clips.get(l.voice, l.text).len() as f64 / RATE;
            out.push(l);
            k += 1;
        }
        out
    }

    fn run_case(name: &str, lines: &[Line], m: &Mix, o: &SimOpts, tail: f64, clips: &mut Clips) -> (serde_json::Value, Eval, SimOut) {
        let (mic, call, placed) = mix(clips, lines, m, 1.0, tail);
        let (stt, emb) = engine().expect("speech model");
        let call = if m.mic_only { None } else { Some(call.as_slice()) };
        let r = simulate(stt, emb, &mic, call, o);
        let ev = evaluate(&placed, &r.transcript);
        let lines_out: Vec<String> = r.transcript.iter().take(40).map(|s| format!("[{:6.1}] {}: {}", s.t, s.speaker.clone().unwrap_or_default(), s.text)).collect();
        let v = json!({ "name": name, "eval": ev, "stats": r.stats, "removed": r.removed, "wallSecs": r.wall_secs, "audioSecs": r.audio_secs,
            "rtf": r.wall_secs / r.audio_secs.max(1.0), "transcript": lines_out });
        eprintln!("{name}: found {}/{} you_lost {} wrong_side {} dups {} extras {} purity {:.2} ts_max {:.2}s wall {:.1}s",
            ev.found, ev.lines, ev.you_lost, ev.wrong_side, ev.duplicates, ev.extras, ev.label_purity, ev.ts_err_max, r.wall_secs);
        (v, ev, r)
    }

    fn report_path() -> String {
        std::env::var("FLO_SIM_OUT").unwrap_or_else(|_| "/tmp/flo-meeting-sim.json".into())
    }

    #[test]
    #[ignore = "needs the installed Whisper + voice models and macOS `say`; run with --ignored"]
    fn meeting_sim_scenarios() {
        let tmp = std::env::temp_dir().join(format!("flo-meetsim-{}", std::process::id()));
        let mut clips = Clips::new(&tmp);
        let only = std::env::var("FLO_SIM_ONLY").ok();
        let mut rows = vec![];
        let mut failures = vec![];
        for c in cases() {
            if only.as_deref().is_some_and(|o| !c.name.contains(o)) {
                continue;
            }
            let (v, ev, r) = run_case(c.name, &c.lines, &c.mix, &c.opts, c.tail, &mut clips);
            let mut check = |ok: bool, what: &str| {
                if !ok {
                    failures.push(format!("{}: {what}", c.name));
                }
            };
            check(ev.you_lost == 0, &format!("{} of your lines lost or mislabelled ({:?})", ev.you_lost, ev.missing));
            check(ev.found == ev.lines, &format!("{} of {} lines missing: {:?}", ev.lines - ev.found, ev.lines, ev.missing));
            check(ev.wrong_side == 0, &format!("{} lines on the wrong side", ev.wrong_side));
            check(ev.duplicates == 0, &format!("{} duplicate lines", ev.duplicates));
            check(ev.order_inversions == 0, &format!("{} ordering inversions", ev.order_inversions));
            check(ev.ts_err_max <= 0.8, &format!("timestamp off by {:.2}s", ev.ts_err_max));
            if c.name.starts_with("hindi") {
                let deva = r.transcript.iter().filter(|s| s.speaker.as_deref() == Some(YOU) && s.text.chars().any(|ch| ('\u{0900}'..='\u{097F}').contains(&ch))).count();
                check(deva == 3, &format!("{deva}/3 Hindi lines in Devanagari"));
                let eng = r.transcript.iter().filter(|s| s.speaker.as_deref() != Some(YOU) && s.text.is_ascii()).count();
                check(eng == 2, &format!("{eng}/2 English call lines in Latin script"));
            }
            if c.lines.iter().any(|l| l.voice == "Daniel") && c.lines.iter().any(|l| l.voice == "Samantha") {
                check(ev.voices_separated && ev.label_purity >= 0.8, &format!("speakers not separated (purity {:.2})", ev.label_purity));
            }
            rows.push(v);
            let _ = std::fs::write(report_path(), serde_json::to_string_pretty(&json!({ "scenarios": rows, "failures": failures })).unwrap_or_default());
        }
        if only.as_deref().is_none_or(|o| "long_20min".contains(o)) {
            let mins: f64 = std::env::var("FLO_SIM_LONG_MIN").ok().and_then(|v| v.parse().ok()).unwrap_or(20.0);
            let lines = long_lines(mins * 60.0, &mut clips);
            if std::env::var_os("FLO_SIM_DEBUG").is_some() {
                let (_, _, placed) = mix(&mut clips, &lines, &Mix::default(), 1.0, 3.0);
                for p in &placed {
                    eprintln!("LINE {:7.2}-{:7.2} {} {}", p.start, p.end, p.line.voice, p.line.text);
                }
            }
            let rss0 = rss_mb();
            let (mut v, ev, r) = run_case("long_20min", &lines, &Mix { echo: Some((-20.0, 45)), noise: 0.002, ..Default::default() }, &SimOpts::default(), 3.0, &mut clips);
            let rss1 = rss_mb();
            v["rssMbBefore"] = json!(rss0);
            v["rssMbAfter"] = json!(rss1);
            let ratio = ev.found as f64 / ev.lines as f64;
            if ratio < 0.97 || ev.you_lost as f64 > ev.you_lines as f64 * 0.03 || ev.duplicates > 2 || ev.order_inversions > 0 || r.wall_secs > r.audio_secs {
                failures.push(format!("long_20min: found {:.3}, you_lost {}, dups {}, inversions {}, wall {:.0}s for {:.0}s audio", ratio, ev.you_lost, ev.duplicates, ev.order_inversions, r.wall_secs, r.audio_secs));
            }
            rows.push(v);
        }
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::write(report_path(), serde_json::to_string_pretty(&json!({ "scenarios": rows, "failures": failures })).unwrap_or_default());
        assert!(failures.is_empty(), "meeting sim failures:\n{}", failures.join("\n"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluation_counts_lost_duplicate_and_mislabelled_lines() {
        let placed = vec![
            Placed { line: you("I can send the updated deck by Friday", 0.0), start: 1.0, end: 3.5 },
            Placed { line: them("Samantha", "Our conversion rate went up by twelve percent", 0.0), start: 4.0, end: 6.5 },
            Placed { line: them("Daniel", "Let's keep the budget under fifty thousand", 0.0), start: 7.0, end: 9.5 },
        ];
        let seg = |t: f64, who: &str, text: &str| MeetingSegment { t, text: text.into(), speaker: Some(who.into()) };
        let tr = vec![
            seg(1.1, "You", "I can send the updated deck by Friday."),
            seg(4.1, "Speaker 1", "Our conversion rate went up by 12 percent."),
            seg(4.2, "You", "Our conversion rate went up by twelve percent"), // echo copy
            seg(7.1, "You", "Let's keep the budget under fifty thousand."), // wrong side
        ];
        let e = evaluate(&placed, &tr);
        assert_eq!((e.found, e.you_found, e.you_lost), (3, 1, 0));
        // the closer copy wins Samantha's line, the other one counts as a duplicate
        assert_eq!(e.duplicates, 1, "{e:?}");
        assert_eq!(e.wrong_side, 2, "{e:?}");
        let e = evaluate(&placed[..1], &[]);
        assert_eq!((e.found, e.you_lost, e.missing.len()), (0, 1, 1));
    }

    #[test]
    fn mixing_places_lines_and_echo() {
        let mut clips = Clips { dir: std::env::temp_dir(), cache: Default::default() };
        clips.cache.insert(("Rishi".into(), "a".into()), vec![0.5; 16_000]);
        clips.cache.insert(("Samantha".into(), "b".into()), vec![0.5; 16_000]);
        let (mic, call, placed) = mix(&mut clips, &[you("a", 0.0), them("Samantha", "b", 1.0)], &Mix { echo: Some((-20.0, 50)), ..Default::default() }, 1.0, 1.0);
        assert_eq!(placed[0].start, 1.0);
        assert_eq!(placed[1].start, 3.0);
        assert_eq!(mic.len(), call.len());
        // the call line leaks into the mic 50 ms later at -20 dB
        assert!((mic[(3.1 * RATE) as usize] - 0.05).abs() < 0.03);
        assert_eq!(mic[(3.02 * RATE) as usize], 0.0);
        assert_eq!(call[(1.5 * RATE) as usize], 0.0);
    }
}
