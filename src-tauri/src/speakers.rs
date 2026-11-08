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

/// Average-linkage agglomerative clustering over normalised embeddings: merge while the closest
/// pair of clusters is at least `threshold` similar. Returns a cluster id per input, numbered by
/// first appearance (0, 1, 2…). `weights` = seconds of speech per item (longer clips count more).
pub fn agglomerate(embs: &[Vec<f32>], weights: &[f32], threshold: f32) -> Vec<usize> {
    let n = embs.len();
    if n == 0 {
        return vec![];
    }
    // each cluster: member indices + weighted centroid
    let mut members: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    let mut cents: Vec<Vec<f32>> = embs.to_vec();
    let mut wts: Vec<f32> = (0..n).map(|i| weights.get(i).copied().unwrap_or(1.0).max(0.1)).collect();
    loop {
        let mut best = (0usize, 0usize, f32::MIN);
        for i in 0..cents.len() {
            for j in (i + 1)..cents.len() {
                let s = cosine(&cents[i], &cents[j]);
                if s > best.2 {
                    best = (i, j, s);
                }
            }
        }
        if cents.len() < 2 || best.2 < threshold {
            break;
        }
        let (i, j, _) = best;
        let (wi, wj) = (wts[i], wts[j]);
        let merged: Vec<f32> = cents[i].iter().zip(&cents[j]).map(|(a, b)| (a * wi + b * wj) / (wi + wj)).collect();
        cents[i] = normalize(merged);
        wts[i] = wi + wj;
        let m = members.remove(j);
        members[i].extend(m);
        cents.remove(j);
        wts.remove(j);
    }
    let mut ids = vec![0usize; n];
    // number clusters by their earliest member
    let mut order: Vec<usize> = (0..members.len()).collect();
    order.sort_by_key(|c| members[*c].iter().min().copied().unwrap_or(usize::MAX));
    for (new_id, c) in order.into_iter().enumerate() {
        for m in &members[c] {
            ids[*m] = new_id;
        }
    }
    ids
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

    #[test]
    fn blend_weights() {
        let m = blend(&v(&[1.0, 0.0]), 3, &v(&[0.0, 1.0]), 1);
        assert!(m[0] > m[1] && (m[0] * m[0] + m[1] * m[1] - 1.0).abs() < 1e-5);
        assert_eq!(blend(&[], 0, &[1.0], 1), vec![1.0]);
    }
}
