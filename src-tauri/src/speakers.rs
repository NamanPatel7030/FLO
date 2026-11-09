//! Who said what: speaker embeddings for the call-audio track, clustering into
//! "Speaker 1/2/3", and matching against voices the user has named before.
//!
//! Embeddings come from 3D-Speaker's CAM++ (zh+en "advanced", Apache-2.0, 28 MB ONNX, 16 kHz)
//! run through sherpa-onnx on-device. One embedding per transcript segment (segments already
//! split on pauses ≈ turns), online clustering live, then an agglomerative re-cluster after the
//! call. Everything here except `Embedder` and `download_model` is pure and unit-tested.
use crate::egress::{Egress, Purpose};
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

/// Pinned to a commit of the Hugging Face mirror (huggingface.co is on the egress allow-list).
pub const MODEL_FILE: &str = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
pub const MODEL_URL: &str =
    "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
pub const MODEL_BYTES: u64 = 28_281_164;

/// Same voice within one meeting (online assignment / agglomerative merge).
pub const SAME_SPEAKER: f32 = 0.50;
/// A cluster is labelled with a remembered name only above this (stricter: wrong names are worse
/// than "Speaker 2").
pub const KNOWN_VOICE: f32 = 0.60;
/// Shorter clips give unreliable embeddings: assign them, but don't let them found clusters.
pub const MIN_EMBED_SECS: f32 = 1.2;

pub fn model_path(models_dir: &Path) -> PathBuf {
    models_dir.join(MODEL_FILE)
}

pub fn model_installed(models_dir: &Path) -> bool {
    std::fs::metadata(model_path(models_dir)).map(|m| m.len() == MODEL_BYTES).unwrap_or(false)
}

/// Download the embedding model (on demand, the first time call audio is captured).
pub async fn download_model(egress: &Egress, models_dir: &Path) -> Result<()> {
    if model_installed(models_dir) {
        return Ok(());
    }
    egress.check(MODEL_URL, Purpose::ModelDownload, false)?;
    tokio::fs::create_dir_all(models_dir).await?;
    let client = egress.client(Purpose::ModelDownload, false);
    let resp = client.get(MODEL_URL).send().await?.error_for_status()?;
    let tmp = models_dir.join(format!("{MODEL_FILE}.part"));
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut received = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        f.write_all(&chunk).await?;
        received += chunk.len() as u64;
    }
    f.flush().await?;
    drop(f);
    if received != MODEL_BYTES {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(anyhow!("speaker model download incomplete ({received} of {MODEL_BYTES} bytes)"));
    }
    tokio::fs::rename(&tmp, model_path(models_dir)).await?;
    egress.record(MODEL_URL, Purpose::ModelDownload, received);
    Ok(())
}

// ── embeddings ─────────────────────────────────────────────────────────────

#[cfg(all(target_os = "macos", feature = "diarize"))]
pub struct Embedder(sherpa_onnx::SpeakerEmbeddingExtractor);

#[cfg(all(target_os = "macos", feature = "diarize"))]
impl Embedder {
    pub fn load(models_dir: &Path) -> Option<Self> {
        if !model_installed(models_dir) {
            return None;
        }
        let cfg = sherpa_onnx::SpeakerEmbeddingExtractorConfig {
            model: Some(model_path(models_dir).to_string_lossy().into_owned()),
            num_threads: 2,
            debug: false,
            provider: Some("cpu".into()),
        };
        sherpa_onnx::SpeakerEmbeddingExtractor::create(&cfg).map(Self)
    }

    /// L2-normalised embedding of 16 kHz mono speech; None for too-short / silent clips.
    pub fn embed(&self, samples: &[f32]) -> Option<Vec<f32>> {
        if samples.len() < (crate::audio::TARGET_RATE as f32 * 0.5) as usize {
            return None;
        }
        let s = self.0.create_stream()?;
        s.accept_waveform(crate::audio::TARGET_RATE as i32, samples);
        s.input_finished();
        if !self.0.is_ready(&s) {
            return None;
        }
        self.0.compute(&s).map(normalize)
    }
}

/// Builds without the diarization feature (or off macOS): no embeddings, "Others" stays one label.
#[cfg(not(all(target_os = "macos", feature = "diarize")))]
pub struct Embedder;

#[cfg(not(all(target_os = "macos", feature = "diarize")))]
impl Embedder {
    pub fn load(_models_dir: &Path) -> Option<Self> {
        None
    }
    pub fn embed(&self, _samples: &[f32]) -> Option<Vec<f32>> {
        None
    }
}

/// True when this build can diarize at all (model may still need downloading).
pub const fn supported() -> bool {
    cfg!(all(target_os = "macos", feature = "diarize"))
}

// ── vector math ────────────────────────────────────────────────────────────

pub fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 1e-9 {
        v.iter_mut().for_each(|x| *x /= n);
    }
    v
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na <= 1e-12 || nb <= 1e-12 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Weighted running mean of two (normalised) embeddings.
pub fn blend(a: &[f32], wa: u32, b: &[f32], wb: u32) -> Vec<f32> {
    if a.len() != b.len() || wa == 0 {
        return b.to_vec();
    }
    if wb == 0 {
        return a.to_vec();
    }
    let (fa, fb) = (wa as f32, wb as f32);
    normalize(a.iter().zip(b).map(|(x, y)| (x * fa + y * fb) / (fa + fb)).collect())
}

pub fn embedding_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn blob_to_embedding(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

// ── clustering ─────────────────────────────────────────────────────────────

/// One speaker cluster during a meeting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    /// display label currently used in the transcript ("Speaker 2", or a known name)
    pub label: String,
    pub centroid: Vec<f32>,
    pub count: u32,
}

/// Online assignment: nearest cluster above `SAME_SPEAKER`, else a new one (only for clips long
/// enough to trust; short clips go to the nearest cluster, or None if there is none yet).
/// Returns the cluster index.
pub fn assign(clusters: &mut Vec<Cluster>, emb: &[f32], secs: f32, voices: &[Voice]) -> Option<usize> {
    let best = clusters.iter().enumerate().map(|(i, c)| (i, cosine(&c.centroid, emb))).max_by(|a, b| a.1.total_cmp(&b.1));
    match best {
        Some((i, s)) if s >= SAME_SPEAKER || secs < MIN_EMBED_SECS => {
            let c = &mut clusters[i];
            c.centroid = blend(&c.centroid, c.count, emb, 1);
            c.count += 1;
            Some(i)
        }
        _ if secs < MIN_EMBED_SECS => None,
        _ => {
            let taken: Vec<&str> = clusters.iter().map(|c| c.label.as_str()).collect();
            let label = match_voice(emb, voices, KNOWN_VOICE).filter(|(n, _)| !taken.contains(&n.as_str())).map(|(n, _)| n).unwrap_or_else(|| next_speaker_label(&taken));
            clusters.push(Cluster { label, centroid: emb.to_vec(), count: 1 });
            Some(clusters.len() - 1)
        }
    }
}

/// "Speaker N" with the smallest N not used yet.
pub fn next_speaker_label(taken: &[&str]) -> String {
    (1..).map(|n| format!("Speaker {n}")).find(|l| !taken.contains(&l.as_str())).unwrap_or_default()
}

/// Average-linkage agglomerative clustering over normalised embeddings: merge while the two most
/// similar clusters have a mean pairwise cosine of at least `threshold`. (True average linkage,
/// not centroid cosine: re-normalised centroids of tight clusters look more alike than their
/// members are, which merged two different voices.) Returns a cluster id per input, numbered by
/// first appearance (0, 1, 2…). `weights` = seconds of speech per item (longer clips count more).
/// O(n²) memory, O(n³) worst-case time: fine for the few hundred call segments of a meeting.
pub fn agglomerate(embs: &[Vec<f32>], weights: &[f32], threshold: f32) -> Vec<usize> {
    let n = embs.len();
    if n == 0 {
        return vec![];
    }
    let mut members: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    let mut wts: Vec<f32> = (0..n).map(|i| weights.get(i).copied().unwrap_or(1.0).max(0.1)).collect();
    // sim[i][j] = weighted mean pairwise cosine between clusters i and j (Lance-Williams update)
    let mut sim: Vec<Vec<f32>> = (0..n).map(|i| (0..n).map(|j| cosine(&embs[i], &embs[j])).collect()).collect();
    let mut alive = vec![true; n];
    loop {
        let mut best = (0usize, 0usize, f32::MIN);
        for i in 0..n {
            if !alive[i] {
                continue;
            }
            for j in (i + 1)..n {
                if alive[j] && sim[i][j] > best.2 {
                    best = (i, j, sim[i][j]);
                }
            }
        }
        if best.2 < threshold {
            break;
        }
        let (i, j, _) = best;
        let (wi, wj) = (wts[i], wts[j]);
        for k in 0..n {
            if alive[k] && k != i && k != j {
                let s = (wi * sim[i][k] + wj * sim[j][k]) / (wi + wj);
                sim[i][k] = s;
                sim[k][i] = s;
            }
        }
        wts[i] = wi + wj;
        alive[j] = false;
        let m = std::mem::take(&mut members[j]);
        members[i].extend(m);
    }
    let mut ids = vec![0usize; n];
    // number clusters by their earliest member
    let mut order: Vec<usize> = (0..n).filter(|c| alive[*c]).collect();
    order.sort_by_key(|c| members[*c].iter().min().copied().unwrap_or(usize::MAX));
    for (new_id, c) in order.into_iter().enumerate() {
        for m in &members[c] {
            ids[*m] = new_id;
        }
    }
    ids
}

// ── turns inside one segment ───────────────────────────────────────────────
//
// The VAD segmenter only cuts on pauses ≥ 700 ms (or at 8 s), so a quick back-and-forth on the
// call ("Can you send it?" / "Yes, tonight.") lands in ONE segment. Before transcribing a long
// call segment we embed short overlapping windows, group them by voice and cut at the quietest
// moment near each change, so each piece is transcribed and labelled on its own.

/// Window / hop for change detection (seconds). 1.5 s is the shortest clip CAM++ embeds reliably.
pub const WIN_SECS: f32 = 1.5;
pub const HOP_SECS: f32 = 0.75;
/// Only segments at least this long are checked for a speaker change (two pieces of ≥ MIN_PIECE).
pub const MIN_SPLIT_SECS: f32 = 2.5;
/// Never produce a piece shorter than this (too short to transcribe or embed well).
pub const MIN_PIECE_SECS: f32 = 1.0;
/// Short windows are noisier than whole turns → a looser "same voice" threshold.
pub const WINDOW_SAME: f32 = 0.40;

/// Start offsets (samples) of the analysis windows covering `n` samples at `rate`.
pub fn window_starts(n: usize, rate: u32) -> Vec<usize> {
    let (win, hop) = ((WIN_SECS * rate as f32) as usize, (HOP_SECS * rate as f32) as usize);
    if n < win || hop == 0 {
        return vec![];
    }
    let mut v: Vec<usize> = (0..).map(|k| k * hop).take_while(|s| s + win <= n).collect();
    // cover the tail too
    if v.last().is_some_and(|l| l + win < n) {
        v.push(n - win);
    }
    v
}

/// Voice label per window (agglomerative over the windows), smoothed: a single window whose
/// neighbours agree with each other is noise and takes their label; a single window between two
/// different voices (it straddles the change) joins the neighbour it sounds more like.
pub fn window_labels(embs: &[Vec<f32>], threshold: f32) -> Vec<usize> {
    let mut l = agglomerate(embs, &vec![1.0; embs.len()], threshold);
    for i in 1..l.len().saturating_sub(1) {
        let (a, b) = (l[i - 1], l[i + 1]);
        if l[i] != a && l[i] != b {
            l[i] = if a == b || cosine(&embs[i], &embs[i - 1]) >= cosine(&embs[i], &embs[i + 1]) { a } else { b };
        }
    }
    l
}

/// Index of the quietest 100 ms stretch within `radius` samples of `at` (the gap between turns).
pub fn quietest_near(samples: &[f32], at: usize, radius: usize, rate: u32) -> usize {
    let step = (rate / 100) as usize; // 10 ms grid
    let span = (rate / 10) as usize; // 100 ms energy window
    let lo = at.saturating_sub(radius);
    let hi = (at + radius).min(samples.len().saturating_sub(span));
    if lo >= hi {
        return at.min(samples.len());
    }
    (lo..=hi)
        .step_by(step.max(1))
        .map(|i| (i, crate::audio::rms(&samples[i..(i + span).min(samples.len())])))
        .min_by(|a, b| a.1.total_cmp(&b.1).then(((a.0 as i64 - at as i64).abs()).cmp(&(b.0 as i64 - at as i64).abs())))
        .map(|(i, _)| i + span / 2)
        .unwrap_or(at)
}

/// Split a segment where the voice changes. `embed` = the speaker embedder (any closure in tests).
/// Returns sample ranges covering the whole segment (one range when nothing changes).
pub fn split_turns(samples: &[f32], rate: u32, embed: impl Fn(&[f32]) -> Option<Vec<f32>>) -> Vec<std::ops::Range<usize>> {
    let whole = vec![0..samples.len()];
    if (samples.len() as f32) < MIN_SPLIT_SECS * rate as f32 {
        return whole;
    }
    let win = (WIN_SECS * rate as f32) as usize;
    let mut starts = vec![];
    let mut embs = vec![];
    for s in window_starts(samples.len(), rate) {
        let w = &samples[s..s + win];
        // skip windows that are mostly silence: their embedding is noise
        let frames = w.chunks((rate / 50) as usize);
        let n = frames.len().max(1);
        if frames.filter(|f| crate::audio::rms(f) >= crate::livetx::SPEECH_RMS).count() * 10 < n * 3 {
            continue;
        }
        if let Some(e) = embed(w) {
            starts.push(s);
            embs.push(e);
        }
    }
    if embs.len() < 2 {
        return whole;
    }
    let labels = window_labels(&embs, WINDOW_SAME);
    let min_piece = (MIN_PIECE_SECS * rate as f32) as usize;
    let mut cuts: Vec<usize> = vec![];
    for i in 1..labels.len() {
        if labels[i] == labels[i - 1] {
            continue;
        }
        // the change lies where window i-1 ends and window i begins (their overlap's middle)
        let guess = (starts[i] + starts[i - 1] + win) / 2;
        let cut = quietest_near(samples, guess, rate as usize * 6 / 10, rate);
        let prev = cuts.last().copied().unwrap_or(0);
        if cut >= prev + min_piece && cut + min_piece <= samples.len() {
            cuts.push(cut);
        }
    }
    if cuts.is_empty() {
        return whole;
    }
    let mut out = vec![];
    let mut from = 0;
    for c in cuts {
        out.push(from..c);
        from = c;
    }
    out.push(from..samples.len());
    out
}

// ── known voices ───────────────────────────────────────────────────────────

/// A voice the user named once ("Speaker 2" → "Rahul"); stored in the `voices` table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Voice {
    pub name: String,
    pub embedding: Vec<f32>,
    pub samples: u32,
}

/// Best remembered voice for an embedding, if at least `threshold` similar.
pub fn match_voice(emb: &[f32], voices: &[Voice], threshold: f32) -> Option<(String, f32)> {
    voices
        .iter()
        .map(|v| (v.name.clone(), cosine(&v.embedding, emb)))
        .filter(|(_, s)| *s >= threshold)
        .max_by(|a, b| a.1.total_cmp(&b.1))
}

/// Name clusters: greedy best-first so two clusters never get the same remembered name; the rest
/// become "Speaker N" in order of appearance (N skips nothing: 1, 2, 3…).
pub fn label_clusters(centroids: &[Vec<f32>], voices: &[Voice]) -> Vec<String> {
    let mut labels: Vec<Option<String>> = vec![None; centroids.len()];
    let mut pairs: Vec<(usize, usize, f32)> = vec![];
    for (ci, c) in centroids.iter().enumerate() {
        for (vi, v) in voices.iter().enumerate() {
            let s = cosine(c, &v.embedding);
            if s >= KNOWN_VOICE {
                pairs.push((ci, vi, s));
            }
        }
    }
    pairs.sort_by(|a, b| b.2.total_cmp(&a.2));
    let mut used_v = vec![false; voices.len()];
    for (ci, vi, _) in pairs {
        if labels[ci].is_none() && !used_v[vi] {
            labels[ci] = Some(voices[vi].name.clone());
            used_v[vi] = true;
        }
    }
    let mut n = 0;
    labels
        .into_iter()
        .map(|l| {
            l.unwrap_or_else(|| {
                n += 1;
                format!("Speaker {n}")
            })
        })
        .collect()
}

/// Rename a speaker across a transcript. Returns how many segments changed.
pub fn relabel(segments: &mut [crate::model::MeetingSegment], from: &str, to: &str) -> usize {
    let mut n = 0;
    for s in segments.iter_mut() {
        if s.speaker.as_deref() == Some(from) {
            s.speaker = Some(to.to_string());
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MeetingSegment;

    fn v(xs: &[f32]) -> Vec<f32> {
        normalize(xs.to_vec())
    }

    #[test]
    fn cosine_basics() {
        assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
    }

    #[test]
    fn blob_roundtrip() {
        let e = vec![0.25f32, -1.5, 3.0];
        assert_eq!(blob_to_embedding(&embedding_to_blob(&e)), e);
    }

    #[test]
    fn voice_matcher_respects_threshold_and_picks_best() {
        let voices = vec![
            Voice { name: "Rahul".into(), embedding: v(&[1.0, 0.0, 0.0]), samples: 3 },
            Voice { name: "Priya".into(), embedding: v(&[0.0, 1.0, 0.0]), samples: 3 },
        ];
        // close to Rahul (cos ≈ 0.98)
        assert_eq!(match_voice(&v(&[1.0, 0.2, 0.0]), &voices, KNOWN_VOICE).map(|m| m.0), Some("Rahul".into()));
        // halfway between (cos ≈ 0.707 to both) → whichever is higher, still above 0.6
        let m = match_voice(&v(&[1.0, 1.1, 0.0]), &voices, KNOWN_VOICE).unwrap();
        assert_eq!(m.0, "Priya");
        // a stranger (cos ≈ 0.45 to Rahul) → no name
        assert_eq!(match_voice(&v(&[0.5, 0.0, 1.0]), &voices, KNOWN_VOICE), None);
        assert_eq!(match_voice(&v(&[1.0, 0.0, 0.0]), &[], KNOWN_VOICE), None);
    }

    #[test]
    fn online_assignment_creates_and_reuses_clusters() {
        let mut cl = vec![];
        let a = v(&[1.0, 0.0, 0.0]);
        let b = v(&[0.0, 1.0, 0.0]);
        assert_eq!(assign(&mut cl, &a, 3.0, &[]), Some(0));
        assert_eq!(assign(&mut cl, &v(&[0.95, 0.1, 0.0]), 3.0, &[]), Some(0));
        assert_eq!(assign(&mut cl, &b, 3.0, &[]), Some(1));
        assert_eq!(cl[0].label, "Speaker 1");
        assert_eq!(cl[1].label, "Speaker 2");
        assert_eq!(cl[0].count, 2);
        // a short, ambiguous clip joins the nearest cluster instead of founding a new one
        assert!(matches!(assign(&mut cl, &v(&[0.1, 0.0, 1.0]), 0.6, &[]), Some(0)));
        assert_eq!(cl.len(), 2);
        // no clusters yet + short clip → unassigned
        assert_eq!(assign(&mut vec![], &a, 0.5, &[]), None);
    }

    #[test]
    fn online_assignment_uses_known_voices() {
        let voices = vec![Voice { name: "Rahul".into(), embedding: v(&[0.0, 1.0, 0.0]), samples: 1 }];
        let mut cl = vec![];
        assign(&mut cl, &v(&[1.0, 0.0, 0.0]), 3.0, &voices);
        assign(&mut cl, &v(&[0.05, 1.0, 0.0]), 3.0, &voices);
        assert_eq!(cl.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(), vec!["Speaker 1", "Rahul"]);
    }

    #[test]
    fn agglomerative_groups_by_voice_in_order_of_appearance() {
        let embs = vec![v(&[0.0, 1.0, 0.1]), v(&[1.0, 0.0, 0.0]), v(&[0.1, 1.0, 0.0]), v(&[0.9, 0.1, 0.0]), v(&[0.0, 0.0, 1.0])];
        let ids = agglomerate(&embs, &[2.0; 5], SAME_SPEAKER);
        assert_eq!(ids, vec![0, 1, 0, 1, 2]);
        assert!(agglomerate(&[], &[], 0.5).is_empty());
        // everyone identical → one speaker
        assert_eq!(agglomerate(&[v(&[1.0, 0.0]), v(&[1.0, 0.01])], &[1.0, 1.0], 0.5), vec![0, 0]);
    }

    #[test]
    fn cluster_labels_use_each_known_name_once() {
        let voices = vec![Voice { name: "Rahul".into(), embedding: v(&[1.0, 0.0, 0.0]), samples: 1 }];
        // both clusters resemble Rahul; the closer one gets the name, the other is Speaker 1
        let labels = label_clusters(&[v(&[1.0, 0.5, 0.0]), v(&[1.0, 0.05, 0.0]), v(&[0.0, 0.0, 1.0])], &voices);
        assert_eq!(labels, vec!["Speaker 1", "Rahul", "Speaker 2"]);
    }

    #[test]
    fn relabel_renames_only_that_speaker() {
        let mut t = vec![
            MeetingSegment { t: 0.0, text: "a".into(), speaker: Some("You".into()) },
            MeetingSegment { t: 1.0, text: "b".into(), speaker: Some("Speaker 2".into()) },
            MeetingSegment { t: 2.0, text: "c".into(), speaker: Some("Speaker 2".into()) },
            MeetingSegment { t: 3.0, text: "d".into(), speaker: Some("Speaker 1".into()) },
        ];
        assert_eq!(relabel(&mut t, "Speaker 2", "Rahul"), 2);
        let who: Vec<_> = t.iter().map(|s| s.speaker.clone().unwrap()).collect();
        assert_eq!(who, vec!["You", "Rahul", "Rahul", "Speaker 1"]);
        assert_eq!(relabel(&mut t, "Nobody", "X"), 0);
    }

    /// Real model on synthetic voices (macOS `say`):
    /// `FLO_SPEAKER_MODEL_DIR=/dir/with/model cargo test --release --lib real_model -- --ignored --nocapture`
    #[cfg(all(target_os = "macos", feature = "diarize"))]
    #[test]
    #[ignore]
    fn real_model_separates_voices() {
        let dir = PathBuf::from(std::env::var("FLO_SPEAKER_MODEL_DIR").expect("FLO_SPEAKER_MODEL_DIR"));
        let e = Embedder::load(&dir).expect("model loads");
        let tmp = std::env::temp_dir().join(format!("flo-spk-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let clip = |voice: &str, text: &str, name: &str| -> Vec<f32> {
            let aiff = tmp.join(format!("{name}.aiff"));
            let wav = tmp.join(format!("{name}.wav"));
            assert!(std::process::Command::new("say").args(["-v", voice, "-o"]).arg(&aiff).arg(text).status().unwrap().success());
            assert!(std::process::Command::new("afconvert").args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]).arg(&aiff).arg(&wav).status().unwrap().success());
            hound::WavReader::open(&wav).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect()
        };
        let lines = ["Let's start with the dashboard cards and the launch plan.", "I can have the component library ready by Monday afternoon.", "We should double check the contrast of the charts in dark mode."];
        let voices = ["Samantha", "Daniel", "Rishi"];
        let mut embs = vec![];
        let mut truth = vec![];
        for (li, l) in lines.iter().enumerate() {
            for (vi, v) in voices.iter().enumerate() {
                embs.push(e.embed(&clip(v, l, &format!("{vi}-{li}"))).expect("embedding"));
                truth.push(vi);
            }
        }
        for i in 0..embs.len() {
            let row: Vec<String> = (0..embs.len()).map(|j| format!("{:+.2}", cosine(&embs[i], &embs[j]))).collect();
            println!("{} {}", voices[truth[i]], row.join(" "));
        }
        let ids = agglomerate(&embs, &vec![3.0; embs.len()], SAME_SPEAKER);
        println!("clusters {ids:?} truth {truth:?}");
        // same voice ↔ same cluster, different voice ↔ different cluster
        for i in 0..ids.len() {
            for j in 0..ids.len() {
                assert_eq!(ids[i] == ids[j], truth[i] == truth[j], "{i} vs {j}");
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    const SR: u32 = 16_000;

    /// A "voice" = a tone at `hz` (fake embedder below tells voices apart by pitch).
    fn voice(hz: f32, secs: f32) -> Vec<f32> {
        (0..(secs * SR as f32) as usize).map(|i| (i as f32 * hz * std::f32::consts::TAU / SR as f32).sin() * 0.2).collect()
    }

    fn quiet(secs: f32) -> Vec<f32> {
        vec![0.0; (secs * SR as f32) as usize]
    }

    /// Energy at 200 Hz vs 600 Hz → a 2-d "embedding".
    fn fake_embed(s: &[f32]) -> Option<Vec<f32>> {
        let band = |hz: f32| {
            let (mut re, mut im) = (0.0f32, 0.0f32);
            for (i, x) in s.iter().enumerate() {
                let p = i as f32 * hz * std::f32::consts::TAU / SR as f32;
                re += x * p.cos();
                im += x * p.sin();
            }
            (re * re + im * im).sqrt()
        };
        Some(normalize(vec![band(200.0), band(600.0)]))
    }

    #[test]
    fn windows_cover_the_segment() {
        assert!(window_starts(SR as usize, SR).is_empty()); // 1 s < one window
        let w = window_starts(SR as usize * 3, SR); // 3 s
        assert_eq!(w[0], 0);
        assert_eq!(w[1], 12_000);
        assert_eq!(*w.last().unwrap() + 24_000, 48_000, "tail covered: {w:?}");
    }

    #[test]
    fn window_labels_smooth_single_window_noise() {
        let a = v(&[1.0, 0.0]);
        let b = v(&[0.0, 1.0]);
        // A A B A A → the lone B is noise
        assert_eq!(window_labels(&[a.clone(), a.clone(), b.clone(), a.clone(), a.clone()], WINDOW_SAME), vec![0, 0, 0, 0, 0]);
        // A A mixed B B → the straddling window joins its closer side, one change remains
        let l = window_labels(&[a.clone(), a.clone(), v(&[1.0, 0.8]), b.clone(), b.clone()], WINDOW_SAME);
        assert_eq!(l.windows(2).filter(|p| p[0] != p[1]).count(), 1, "{l:?}");
    }

    #[test]
    fn quietest_point_is_the_gap() {
        let mut s = voice(200.0, 1.0);
        s.extend(quiet(0.2));
        s.extend(voice(200.0, 1.0));
        let at = quietest_near(&s, SR as usize, SR as usize / 2, SR);
        let gap = (SR as usize)..(SR as usize * 12 / 10);
        assert!(gap.contains(&at), "{at} not in {gap:?}");
    }

    #[test]
    fn split_turns_cuts_at_each_voice_change() {
        // A 2 s, 0.25 s gap, B 2 s, 0.25 s gap, A 2 s: one VAD segment, three turns
        let mut s = voice(200.0, 2.0);
        s.extend(quiet(0.25));
        s.extend(voice(600.0, 2.0));
        s.extend(quiet(0.25));
        s.extend(voice(200.0, 2.0));
        let parts = split_turns(&s, SR, fake_embed);
        assert_eq!(parts.len(), 3, "{parts:?}");
        assert_eq!(parts[0].start, 0);
        assert_eq!(parts[2].end, s.len());
        // cuts land in (or right next to) the gaps
        let gap1 = 2.0..2.25;
        let gap2 = 4.25..4.5;
        let c1 = parts[1].start as f32 / SR as f32;
        let c2 = parts[2].start as f32 / SR as f32;
        assert!(c1 > gap1.start - 0.1 && c1 < gap1.end + 0.1, "cut 1 at {c1}");
        assert!(c2 > gap2.start - 0.1 && c2 < gap2.end + 0.1, "cut 2 at {c2}");
        // each piece is one voice
        for (p, hz) in parts.iter().zip([200.0, 600.0, 200.0]) {
            let e = fake_embed(&s[p.clone()]).unwrap();
            assert!(if hz == 200.0 { e[0] > 0.9 } else { e[1] > 0.9 }, "{p:?}: {e:?}");
        }
    }

    #[test]
    fn split_turns_leaves_one_voice_and_short_clips_alone() {
        let one = voice(200.0, 6.0);
        assert_eq!(split_turns(&one, SR, fake_embed), vec![0..one.len()]);
        let short = voice(200.0, 2.0);
        assert_eq!(split_turns(&short, SR, fake_embed), vec![0..short.len()]);
        // a 0.5 s interjection is below MIN_PIECE: not split off on its own
        let mut s = voice(200.0, 3.0);
        s.extend(voice(600.0, 0.4));
        let parts = split_turns(&s, SR, fake_embed);
        assert!(parts.iter().all(|p| p.len() >= (MIN_PIECE_SECS * SR as f32) as usize), "{parts:?}");
        // no embedder → whole segment
        assert_eq!(split_turns(&s, SR, |_| None), vec![0..s.len()]);
    }

    /// End to end on generated speech: two (or three) macOS `say` voices take turns, some with a
    /// long pause (the VAD splits) and some quick (one VAD segment → `split_turns` must cut), in
    /// English and Hindi. Runs the same steps as a meeting: 300 ms slices → Segmenter → split
    /// turns → embed → cluster. Asserts every turn ends up with the right speaker.
    /// Needs the real model: `FLO_SPEAKER_MODEL_DIR=/dir/with/model cargo test --lib turns_on_generated -- --ignored --nocapture`
    #[cfg(all(target_os = "macos", feature = "diarize"))]
    #[test]
    #[ignore]
    fn turns_on_generated_speech() {
        use crate::livetx::{Action, Segmenter, SLICE_MS};
        let dir = PathBuf::from(std::env::var("FLO_SPEAKER_MODEL_DIR").expect("FLO_SPEAKER_MODEL_DIR"));
        let e = Embedder::load(&dir).expect("model loads");
        let tmp = std::env::temp_dir().join(format!("flo-turns-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let clip = |voice: &str, text: &str, name: &str| -> Vec<f32> {
            let aiff = tmp.join(format!("{name}.aiff"));
            let wav = tmp.join(format!("{name}.wav"));
            assert!(std::process::Command::new("say").args(["-v", voice, "-o"]).arg(&aiff).arg(text).status().unwrap().success());
            assert!(std::process::Command::new("afconvert").args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"]).arg(&aiff).arg(&wav).status().unwrap().success());
            let s: Vec<f32> = hound::WavReader::open(&wav).unwrap().samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
            crate::audio::trim_silence(&s)
        };
        // (voice, words, pause after in seconds): 0.3 s = quick reply inside one VAD segment
        let script: [(&str, &str, f32); 8] = [
            ("Rishi", "Good morning everyone, let's go through the launch checklist for the mobile app today.", 1.2),
            ("Lekha", "नमस्ते, मैंने डिज़ाइन की सारी स्क्रीन कल रात पूरी कर दी हैं और टीम को भेज दी हैं।", 0.3),
            ("Rishi", "That is great news, can you also share the final icons with the marketing team?", 0.3),
            ("Lekha", "हाँ, मैं आज शाम तक सारे आइकन और रंग वाली फ़ाइल भेज दूँगी।", 1.2),
            ("Samantha", "I will update the press release and schedule the social posts for Thursday morning.", 0.3),
            ("Rishi", "Perfect, then we are on track for the launch next week.", 1.2),
            ("Samantha", "One more thing, the pricing page still shows the old plans.", 0.3),
            ("Lekha", "ठीक है, मैं वह भी आज ठीक कर दूँगी।", 1.0),
        ];
        let mut stream: Vec<f32> = vec![0.0; SR as usize / 2];
        let mut truth: Vec<(usize, usize, usize)> = vec![]; // (start, end, speaker)
        let names = ["Rishi", "Lekha", "Samantha"];
        for (i, (v, t, pause)) in script.iter().enumerate() {
            let c = clip(v, t, &format!("t{i}"));
            let who = names.iter().position(|n| n == v).unwrap();
            truth.push((stream.len(), stream.len() + c.len(), who));
            stream.extend(c);
            stream.extend(quiet(*pause));
        }
        // 1) VAD segments, exactly as the meeting loop slices them
        let slice = (SR as u64 * SLICE_MS / 1000) as usize;
        let mut seg = Segmenter::default();
        let (mut segs, mut start) = (vec![], 0usize);
        for (k, sl) in stream.chunks(slice).enumerate() {
            let end = (k * slice + sl.len()).min(stream.len());
            match seg.push(SLICE_MS, crate::audio::rms(sl)) {
                Action::Final => {
                    segs.push(start..end);
                    start = end;
                }
                Action::Discard => start = end,
                _ => {}
            }
        }
        if seg.flush() == Action::Final {
            segs.push(start..stream.len());
        }
        // 2) speaker turns inside each segment, 3) embed each piece, 4) cluster (post-call pass)
        let mut pieces = vec![];
        for s in &segs {
            for p in split_turns(&stream[s.clone()], SR, |w| e.embed(w)) {
                pieces.push((s.start + p.start)..(s.start + p.end));
            }
        }
        let embs: Vec<Vec<f32>> = pieces.iter().map(|p| e.embed(&stream[p.clone()]).expect("embedding")).collect();
        let secs: Vec<f32> = pieces.iter().map(|p| p.len() as f32 / SR as f32).collect();
        let ids = agglomerate(&embs, &secs, SAME_SPEAKER);
        for a in &embs {
            println!("{}", embs.iter().map(|b| format!("{:+.2}", cosine(a, b))).collect::<Vec<_>>().join(" "));
        }
        for (a, b, w) in &truth {
            println!("truth {:6.2}-{:6.2}s {}", *a as f32 / SR as f32, *b as f32 / SR as f32, names[*w]);
        }
        // majority true speaker of each piece
        let truth_of = |p: &std::ops::Range<usize>| -> usize {
            let mut ov = [0usize; 3];
            for (a, b, w) in &truth {
                ov[*w] += (*b).min(p.end).saturating_sub((*a).max(p.start));
            }
            (0..3).max_by_key(|w| ov[*w]).unwrap()
        };
        let mut correct = 0usize;
        let mut total = 0usize;
        for (p, id) in pieces.iter().zip(&ids) {
            let t = truth_of(p);
            println!("{:6.2}-{:6.2}s  cluster {id}  truth {}", p.start as f32 / SR as f32, p.end as f32 / SR as f32, names[t]);
        }
        // cluster ↔ speaker must be one-to-one
        for i in 0..pieces.len() {
            for j in 0..pieces.len() {
                assert_eq!(ids[i] == ids[j], truth_of(&pieces[i]) == truth_of(&pieces[j]), "pieces {i} and {j}");
            }
        }
        // every true turn is covered by a piece of its speaker for ≥ 85% of its length
        for (a, b, w) in &truth {
            let good: usize = pieces.iter().filter(|p| truth_of(p) == *w).map(|p| (*b).min(p.end).saturating_sub((*a).max(p.start))).sum();
            correct += good;
            total += b - a;
            assert!(good as f32 >= 0.85 * (b - a) as f32, "turn {}..{} of {} only {:.0}% right", a, b, names[*w], 100.0 * good as f32 / (b - a) as f32);
        }
        println!("{} VAD segments → {} turns; {:.1}% of speech attributed correctly", segs.len(), pieces.len(), 100.0 * correct as f32 / total as f32);
        assert!(segs.len() < script.len(), "the test must include quick replies that the VAD does not split");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn blend_weights() {
        let m = blend(&v(&[1.0, 0.0]), 3, &v(&[0.0, 1.0]), 1);
        assert!(m[0] > m[1] && (m[0] * m[0] + m[1] * m[1] - 1.0).abs() < 1e-5);
        assert_eq!(blend(&[], 0, &[1.0], 1), vec![1.0]);
    }
}
