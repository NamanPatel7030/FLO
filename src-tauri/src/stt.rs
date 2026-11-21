//! Speech-to-text: on-device whisper.cpp, or BYOK OpenAI / Groq.
use crate::audio;
use crate::egress::{Egress, Purpose};
use crate::model::{LocalModel, ModelProgressEvent};
use anyhow::{anyhow, bail, Result};
use futures_util::StreamExt;
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

/// Starter = the small model setup downloads first; Advanced = bigger, more precise downloads
/// offered afterwards; Light = other choices (English only, or no real gain over the starter).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Starter,
    Advanced,
    Light,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Starter => "starter",
            Tier::Advanced => "advanced",
            Tier::Light => "light",
        }
    }
}

/// The runtime a model needs: whisper.cpp (ggml), or sherpa-onnx (`asr_onnx`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Whisper,
    Onnx(crate::asr_onnx::Family),
}

/// One file of a multi-file (ONNX) model, pinned by size and SHA-256.
pub struct Part {
    pub name: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

pub struct ModelSpec {
    pub id: &'static str,
    /// the file (whisper.cpp) or folder (ONNX) in the models folder
    pub file: &'static str,
    pub label: &'static str,
    /// download size in MB (10^6 bytes, as the server reports it)
    pub size_mb: u64,
    pub languages: &'static str,
    pub tier: Tier,
    pub speed: &'static str,
    pub accuracy: &'static str,
    pub engine: Engine,
    /// Hugging Face repo and pinned revision the files come from
    pub repo: &'static str,
    pub rev: &'static str,
    /// the files of an ONNX model (empty: the single file `file`)
    pub parts: &'static [Part],
    /// what it's the best pick for ("English", "Hinglish"); empty = general
    pub best_for: &'static str,
    /// the only languages it's used for ("en", "hi-en"); empty = every language it hears. Clips in
    /// other languages go to a Whisper model (`route_model`).
    pub only_langs: &'static [&'static str],
    /// published only as a Hugging Face Whisper fine-tune: `parts` are its safetensors, turned into
    /// the ggml file `file` after download (`ggml_convert`)
    pub hf_convert: bool,
}

impl ModelSpec {
    #[allow(clippy::too_many_arguments)]
    const fn whisper(id: &'static str, file: &'static str, label: &'static str, size_mb: u64, languages: &'static str, tier: Tier, speed: &'static str, accuracy: &'static str) -> Self {
        Self { id, file, label, size_mb, languages, tier, speed, accuracy, engine: Engine::Whisper, repo: "ggerganov/whisper.cpp", rev: "main", parts: &[], best_for: "", only_langs: &[], hf_convert: false }
    }

    /// Where `name` (a part, or the single file) is downloaded from.
    pub fn url(&self, name: &str) -> String {
        // desktop E2E test builds only (inert in release builds; see e2e.rs)
        crate::e2e::model_url(name).unwrap_or_else(|| format!("https://huggingface.co/{}/resolve/{}/{}", self.repo, self.rev, name))
    }

    /// Runs in this build (ONNX models need sherpa-onnx: macOS only for now).
    pub fn available(&self) -> bool {
        matches!(self.engine, Engine::Whisper) || crate::asr_onnx::supported()
    }
}

/// What a fresh install uses: Whisper Small, 5-bit quantized (190 MB). Multilingual, so English,
/// Hindi and Hinglish work offline from the first minute; the big models are an opt-in upgrade.
pub const DEFAULT_MODEL: &str = "small-q5_1";

pub const MODELS: &[ModelSpec] = &[
    ModelSpec::whisper("small-q5_1", "ggml-small-q5_1.bin", "Whisper Small (starter)", 190, "99 languages incl. Hindi", Tier::Starter, "Fast", "Good for everyday dictation"),
    ModelSpec::whisper("large-v3-turbo-q5_0", "ggml-large-v3-turbo-q5_0.bin", "Whisper Large v3 Turbo", 574, "99 languages incl. Hindi, Gujarati", Tier::Advanced, "A little slower", "Much better with accents, Hindi and names"),
    ModelSpec::whisper("large-v3-turbo", "ggml-large-v3-turbo.bin", "Whisper Large v3 Turbo (full precision)", 1624, "99 languages", Tier::Advanced, "Slowest, uses the most memory", "Best. Only slightly ahead of Turbo"),
    ModelSpec::whisper("small", "ggml-small.bin", "Whisper Small (full precision)", 488, "99 languages", Tier::Light, "Fast", "About the same as the starter, more space"),
    ModelSpec::whisper("base.en", "ggml-base.en.bin", "Whisper Base English", 148, "English", Tier::Light, "Instant", "English only"),
    ModelSpec::whisper("large-v3-q5_0", "ggml-large-v3-q5_0.bin", "Whisper Large v3", 1081, "99 languages incl. Hindi, Gujarati", Tier::Advanced, "Slower: about 1 s per sentence", "Most accurate: a third fewer Hindi errors than Turbo"),
    // NVIDIA Parakeet TDT 0.6B v2 (CC-BY-4.0), int8 ONNX export by the sherpa-onnx project. English
    // only: other languages go to the Whisper model next to it.
    ModelSpec {
        id: "parakeet-tdt-0.6b-v2",
        file: "parakeet-tdt-0.6b-v2-int8",
        label: "NVIDIA Parakeet v2",
        size_mb: 661,
        languages: "English. Hindi, Hinglish and Gujarati go to Whisper",
        tier: Tier::Light,
        speed: "Runs on the CPU, about 0.9 s per sentence",
        accuracy: "English only. On par with Turbo in Flo's tests",
        engine: Engine::Onnx(crate::asr_onnx::Family::NemoTransducer),
        repo: "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        rev: "84b478d541cdbf0c296a7ab5f1e20a6f8f998114",
        parts: &[
            Part { name: "encoder.int8.onnx", bytes: 652_282_309, sha256: "92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b" },
            Part { name: "decoder.int8.onnx", bytes: 7_257_753, sha256: "4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41" },
            Part { name: "joiner.int8.onnx", bytes: 1_739_080, sha256: "77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428" },
            Part { name: "tokens.txt", bytes: 9_384, sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d" },
        ],
        best_for: "English",
        only_langs: &["en"],
        hf_convert: false,
    },
    // Oriserve Whisper-Hindi2Hinglish-Apex (Apache-2.0): Large v3 Turbo fine-tuned on Indian-accented
    // Hindi, written in Roman letters. Used for the Hinglish setting only.
    ModelSpec {
        id: "hinglish-apex",
        file: "ggml-hinglish-apex.bin",
        label: "Whisper Hinglish (Oriserve Apex)",
        size_mb: 1618,
        languages: "Hinglish: Hindi and English in Roman letters",
        tier: Tier::Advanced,
        speed: "Like Turbo, uses more memory",
        accuracy: "Best for Hinglish: a third of Turbo's errors",
        engine: Engine::Whisper,
        repo: "Oriserve/Whisper-Hindi2Hinglish-Apex",
        rev: "f3214eed20b4e4d4144e739982d911f87b9cb223",
        parts: &[
            Part { name: "config.json", bytes: 1_194, sha256: "14209b98fb68fc127201bbfebd57cc9f834b0f1a0d0d463a561c8051800af9f4" },
            Part { name: "model.safetensors", bytes: 1_617_825_448, sha256: "5560830fe8fa09b8cdf1b5926d0cc39a2586eadaad685d809e156432c4ebca80" },
        ],
        best_for: "Hinglish",
        only_langs: &["hi-en"],
        hf_convert: true,
    },
];

pub fn spec(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

/// The model setup downloads first.
pub fn starter() -> &'static ModelSpec {
    spec(DEFAULT_MODEL).expect("DEFAULT_MODEL is in MODELS")
}

/// The opt-in upgrades, smallest first.
pub fn advanced() -> Vec<&'static ModelSpec> {
    let mut v: Vec<_> = MODELS.iter().filter(|m| m.tier == Tier::Advanced).collect();
    v.sort_by_key(|m| m.size_mb);
    v
}

/// The model setup should get ready: the chosen one when it's already on disk (setup run again),
/// otherwise the small starter (a fresh install, or an old default that was never downloaded).
pub fn setup_model(selected: &str, models_dir: &Path) -> &'static str {
    match spec(selected) {
        Some(m) if models_dir.join(m.file).exists() => m.id,
        _ => DEFAULT_MODEL,
    }
}

/// The model a fresh install moves to once it has downloaded in the background: in Flo's
/// dictation benchmark (`dictation_bench`) it cuts the word error rate of the small starter by
/// about a third overall and by half on Hindi, at ~0.45 s instead of ~0.2 s per sentence on
/// Apple Silicon.
pub const UPGRADE_MODEL: &str = "large-v3-turbo-q5_0";

/// Languages "Auto" chooses from on a fresh install (and when Auto is picked again in Settings).
pub const DEFAULT_AUTO_LANGUAGES: &[&str] = &["en", "hi"];

/// Can this computer run Large v3 Turbo for dictation without it feeling slow? Apple Silicon
/// (Metal, unified memory) always; otherwise at least 8 GB of RAM (the model takes ~0.6 GB).
pub fn can_run_large(ram_gb: f64, apple_silicon: bool) -> bool {
    apple_silicon || ram_gb >= 7.5
}

/// Total RAM in GB (0 when unknown).
pub fn total_ram_gb() -> f64 {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/sbin/sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().ok())
            .map(|b| b / 1e9)
            .unwrap_or(0.0)
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|m| m.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|k| k.parse::<f64>().ok()))
            .map(|kb| kb * 1024.0 / 1e9)
            .unwrap_or(0.0)
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        // SAFETY: m is a properly sized MEMORYSTATUSEX with dwLength set, as the API requires
        if unsafe { GlobalMemoryStatusEx(&mut m) }.is_ok() {
            m.ullTotalPhys as f64 / 1e9
        } else {
            0.0
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        0.0
    }
}

/// This computer, for `can_run_large`.
pub fn this_machine_runs_large() -> bool {
    can_run_large(total_ram_gb(), cfg!(all(target_os = "macos", target_arch = "aarch64")))
}

/// The model Flo should move to by itself, if any. The starter is only there so setup's try-out
/// works within a minute; once setup is done, on a computer that runs it well, an on-device user
/// who never picked a model themselves gets Large v3 Turbo (downloaded in the background, switched
/// to when it's on disk). Installs from before this existed have `stt_model_explicit` false too,
/// so they move up as well; picking any model in Settings stops it for good.
pub fn upgrade_target(s: &crate::model::Settings, runs_large: bool) -> Option<&'static str> {
    upgrade_target_for(s, runs_large, total_ram_gb())
}

/// The most accurate model for people who speak Hindi or Hinglish, on machines that run it well.
/// On the dictation bench it made ~24% fewer errors than Turbo overall and ~37% fewer in Hindi,
/// at about twice the decode time, so English-only users stay on Turbo.
pub const UPGRADE_MODEL_INDIC: &str = "large-v3-q5_0";

fn speaks_hindi(s: &crate::model::Settings) -> bool {
    let l = s.language.as_str();
    l.starts_with("hi") || (l == "auto" && s.auto_languages.iter().any(|a| a.starts_with("hi")))
}

pub(crate) fn upgrade_target_for(s: &crate::model::Settings, runs_large: bool, ram_gb: f64) -> Option<&'static str> {
    if s.stt_provider != "local" || !s.onboarded || s.stt_model_explicit || !runs_large {
        return None;
    }
    let target = if ram_gb >= 15.5 && speaks_hindi(s) && spec(UPGRADE_MODEL_INDIC).is_some() { UPGRADE_MODEL_INDIC } else { UPGRADE_MODEL };
    let starter = spec(&s.stt_model).map(|m| m.tier == Tier::Starter).unwrap_or(false);
    // an automatic Turbo upgrade moves on to Large v3 when that is the better fit
    let auto_turbo = s.stt_model == UPGRADE_MODEL && target == UPGRADE_MODEL_INDIC;
    (starter || auto_turbo).then_some(target)
}

/// Models meeting notes use besides the chosen one ("Free up space" keeps them): the Hinglish
/// model while Hindi meetings are written in Hinglish.
pub fn meeting_models(s: &crate::model::Settings) -> Vec<&'static str> {
    if s.stt_provider == "local" && speaks_hindi(s) && HindiScript::from_setting(&s.meeting_hindi) == HindiScript::Hinglish {
        vec![HINGLISH_MODEL]
    } else {
        vec![]
    }
}

/// Marker in the models folder: the user deleted the Hinglish model, so Flo doesn't fetch it again.
pub const NO_AUTO_HINGLISH: &str = ".no-auto-hinglish";

/// Should Flo download the Hinglish model by itself, in the background? For on-device users who
/// speak Hindi and want Hinglish meeting transcripts, on a machine that keeps it loaded next to
/// the main model (16 GB, `models_kept`), after setup, under the same rule as the model upgrade
/// (never when the user picked a model themselves), and never again once they deleted it.
pub fn hinglish_auto_fetch(s: &crate::model::Settings, runs_large: bool, ram_gb: f64, installed: bool, declined: bool) -> bool {
    s.stt_provider == "local" && s.onboarded && !s.stt_model_explicit && runs_large && ram_gb >= 15.5 && !meeting_models(s).is_empty() && !installed && !declined && spec(HINGLISH_MODEL).is_some_and(|m| m.available())
}

/// Free space a background download of the Hinglish model needs: its 1.6 GB download and the
/// 1.6 GB converted file exist side by side for a moment, plus room to spare.
pub const HINGLISH_FREE_GB: f64 = 5.0;

/// Free disk space (GB) at `path`, from `df -Pk`; None when unknown.
pub fn free_disk_gb(path: &Path) -> Option<f64> {
    let out = std::process::Command::new("df").arg("-Pk").arg(path).output().ok()?;
    parse_df_free_gb(&String::from_utf8_lossy(&out.stdout))
}

/// The "Available" column (1K blocks) of `df -Pk` output, in GB.
pub fn parse_df_free_gb(df: &str) -> Option<f64> {
    let line = df.lines().nth(1)?;
    let kb: f64 = line.split_whitespace().nth(3)?.parse().ok()?;
    Some(kb * 1024.0 / 1e9)
}

/// Where a retried download continues: after the bytes already on disk, but only when the server
/// answered the Range request with 206 Partial Content.
pub fn resume_offset(part_len: u64, status: u16) -> u64 {
    if status == 206 {
        part_len
    } else {
        0
    }
}

/// A download that stopped short of the advertised size is not a model.
pub fn download_complete(received: u64, expected: Option<u64>) -> bool {
    match expected {
        Some(t) => received == t,
        None => received > 0,
    }
}

/// Progress events: every 250 ms or 2 MB, so the UI can show a live speed.
pub fn should_emit(received: u64, last_bytes: u64, ms_since_last: u128) -> bool {
    ms_since_last >= 250 || received.saturating_sub(last_bytes) >= 2 * 1024 * 1024
}

pub fn model_path(models_dir: &Path, id: &str) -> Option<PathBuf> {
    spec(id).map(|s| models_dir.join(s.file))
}

pub fn list_models(models_dir: &Path) -> Vec<LocalModel> {
    MODELS
        .iter()
        .filter(|m| m.available())
        .map(|m| LocalModel {
            id: m.id.into(),
            label: m.label.into(),
            size_mb: m.size_mb,
            languages: m.languages.into(),
            installed: models_dir.join(m.file).exists(),
            tier: m.tier.as_str().into(),
            speed: m.speed.into(),
            accuracy: m.accuracy.into(),
            engine: if m.engine == Engine::Whisper { "whisper" } else { "onnx" }.into(),
            best_for: m.best_for.into(),
        })
        .collect()
}

/// Download a model into `models_dir`. A failed or cut-off download leaves its `.part` file, and
/// the next try continues from there (HTTP Range) instead of starting over.
pub async fn download_model(egress: &Egress, models_dir: &Path, id: &str, progress: impl Fn(ModelProgressEvent)) -> Result<()> {
    let s = spec(id).ok_or_else(|| anyhow!("unknown model {id}"))?;
    if !s.available() {
        bail!("This model doesn't run on this computer yet.");
    }
    if !s.parts.is_empty() {
        return download_parts(egress, models_dir, s, progress).await;
    }
    let url = crate::e2e::model_url(s.file).unwrap_or_else(|| s.url(s.file));
    egress.check(&url, Purpose::ModelDownload, false)?;
    tokio::fs::create_dir_all(models_dir).await?;
    let client = egress.client(Purpose::ModelDownload, false);
    let tmp = models_dir.join(format!("{}.part", s.file));
    let part_len = tokio::fs::metadata(&tmp).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(&url);
    if part_len > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={part_len}-"));
    }
    let resp = req.send().await?;
    if resp.status().as_u16() == 416 {
        // the leftover part doesn't fit the file on the server any more: start clean next time
        let _ = tokio::fs::remove_file(&tmp).await;
        bail!("The download stopped early. Check your connection and try again.");
    }
    let resp = resp.error_for_status()?;
    let offset = resume_offset(part_len, resp.status().as_u16());
    let expected = resp.content_length().map(|n| n + offset);
    let total = expected.unwrap_or(s.size_mb * 1_000_000);
    let mut f = if offset > 0 {
        tokio::fs::OpenOptions::new().append(true).open(&tmp).await?
    } else {
        tokio::fs::File::create(&tmp).await?
    };
    let mut received: u64 = offset;
    let mut last_bytes = received;
    let mut last_at = std::time::Instant::now();
    progress(ModelProgressEvent { id: id.into(), received, total, done: false, error: None });
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        f.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if should_emit(received, last_bytes, last_at.elapsed().as_millis()) {
            last_bytes = received;
            last_at = std::time::Instant::now();
            progress(ModelProgressEvent { id: id.into(), received, total, done: false, error: None });
        }
    }
    f.flush().await?;
    drop(f);
    if !download_complete(received, expected) {
        bail!("The download stopped early. Check your connection and try again.");
    }
    tokio::fs::rename(&tmp, models_dir.join(s.file)).await?;
    egress.record(&url, Purpose::ModelDownload, received - offset);
    progress(ModelProgressEvent { id: id.into(), received, total, done: true, error: None });
    Ok(())
}

/// Total download size of a multi-file model.
pub fn parts_bytes(parts: &[Part]) -> u64 {
    parts.iter().map(|p| p.bytes).sum()
}

/// SHA-256 of a file, hex.
pub fn sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// A multi-file (ONNX) model: every part into `<folder>.part/` (each one resumable, checked
/// against its pinned size and SHA-256), then the folder renamed into place, so a model folder
/// that exists is always complete.
async fn download_parts(egress: &Egress, models_dir: &Path, s: &ModelSpec, progress: impl Fn(ModelProgressEvent)) -> Result<()> {
    let id = s.id;
    let staging = models_dir.join(format!("{}.part", s.file));
    tokio::fs::create_dir_all(&staging).await?;
    let client = egress.client(Purpose::ModelDownload, false);
    let total = parts_bytes(s.parts);
    let mut done_before: u64 = 0;
    let mut last_bytes = 0u64;
    let mut last_at = std::time::Instant::now();
    progress(ModelProgressEvent { id: id.into(), received: 0, total, done: false, error: None });
    for part in s.parts {
        let url = crate::e2e::model_url(&format!("{}/{}", s.file, part.name)).unwrap_or_else(|| s.url(part.name));
        egress.check(&url, Purpose::ModelDownload, false)?;
        let dest = staging.join(part.name);
        if let Some(dir) = dest.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        let have = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);
        if have != part.bytes {
            let mut req = client.get(&url);
            if have > 0 && have < part.bytes {
                req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
            }
            let resp = req.send().await?;
            if resp.status().as_u16() == 416 {
                let _ = tokio::fs::remove_file(&dest).await;
                bail!("The download stopped early. Check your connection and try again.");
            }
            let resp = resp.error_for_status()?;
            let offset = if have < part.bytes { resume_offset(have, resp.status().as_u16()) } else { 0 };
            let mut f = if offset > 0 { tokio::fs::OpenOptions::new().append(true).open(&dest).await? } else { tokio::fs::File::create(&dest).await? };
            let mut received = offset;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                f.write_all(&chunk).await?;
                received += chunk.len() as u64;
                let now = done_before + received;
                if should_emit(now, last_bytes, last_at.elapsed().as_millis()) {
                    last_bytes = now;
                    last_at = std::time::Instant::now();
                    progress(ModelProgressEvent { id: id.into(), received: now, total, done: false, error: None });
                }
            }
            f.flush().await?;
            drop(f);
            if received != part.bytes {
                bail!("The download stopped early. Check your connection and try again.");
            }
            egress.record(&url, Purpose::ModelDownload, received - offset);
        }
        let d = dest.clone();
        let sum = tokio::task::spawn_blocking(move || sha256_file(&d)).await??;
        if sum != part.sha256 {
            let _ = tokio::fs::remove_file(&dest).await;
            bail!("The downloaded model didn't check out ({}). Try again.", part.name);
        }
        done_before += part.bytes;
    }
    let target = models_dir.join(s.file);
    if s.hf_convert {
        let (header, hp) = whisper_template(egress, models_dir).await?;
        let config = tokio::fs::read_to_string(staging.join("config.json")).await?;
        crate::ggml_convert::check_config(&config, &hp)?;
        let (st, out) = (staging.join("model.safetensors"), target.clone());
        let t = std::time::Instant::now();
        let n = tokio::task::spawn_blocking(move || crate::ggml_convert::convert(&st, &header, &hp, &out)).await??;
        log::info!("speech model {id}: converted {n} tensors to ggml in {} ms", t.elapsed().as_millis());
        let _ = tokio::fs::remove_dir_all(&staging).await;
    } else {
        if target.exists() {
            let _ = tokio::fs::remove_dir_all(&target).await;
        }
        tokio::fs::rename(&staging, &target).await?;
    }
    progress(ModelProgressEvent { id: id.into(), received: total, total, done: true, error: None });
    Ok(())
}

/// Header (hparams, mel filters, vocabulary) of the official Large v3 Turbo ggml, for converting a
/// Turbo fine-tune: from the copy on disk when there is one, else its first MB from Hugging Face.
async fn whisper_template(egress: &Egress, models_dir: &Path) -> Result<(Vec<u8>, crate::ggml_convert::Hparams)> {
    const HEAD: usize = 1 << 20;
    for f in ["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin"] {
        let p = models_dir.join(f);
        if let Ok(mut file) = std::fs::File::open(&p) {
            use std::io::Read;
            let mut head = vec![0u8; HEAD];
            let n = file.read(&mut head)?;
            if let Ok(t) = crate::ggml_convert::template_header(&head[..n]) {
                return Ok(t);
            }
        }
    }
    let s = spec("large-v3-turbo-q5_0").ok_or_else(|| anyhow!("no template model"))?;
    let url = s.url(s.file);
    egress.check(&url, Purpose::ModelDownload, false)?;
    let resp = egress.client(Purpose::ModelDownload, false).get(&url).header(reqwest::header::RANGE, format!("bytes=0-{}", HEAD - 1)).send().await?.error_for_status()?;
    let head = resp.bytes().await?;
    egress.record(&url, Purpose::ModelDownload, head.len() as u64);
    crate::ggml_convert::template_header(&head)
}

/// Delete a downloaded model: a file (whisper.cpp) or a folder (ONNX).
pub fn remove_model_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// The decoder sometimes emits the whole sentence twice in a row ("A. A."); keep one copy.
/// Only an exact back-to-back repeat of the full text (≥ 3 words) is collapsed.
pub fn collapse_repeat(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let n = words.len();
    if n >= 6 && n % 2 == 0 {
        let norm = |w: &[&str]| w.iter().map(|x| x.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect::<Vec<_>>();
        if norm(&words[..n / 2]) == norm(&words[n / 2..]) {
            return words[..n / 2].join(" ");
        }
    }
    text.to_string()
}

/// Join the sentences decoded at each pause into one transcript. Each one is decoded with the
/// previous sentence as Whisper's prompt, and a short or unclear chunk can come back as a copy of
/// that prompt — those copies used to be joined as is ("…Light Blue color Light Blue color").
/// A chunk that repeats the previous one is dropped, and loops spanning chunks are collapsed.
pub fn join_chunks(chunks: &[String]) -> String {
    let mut kept: Vec<&str> = vec![];
    for c in chunks {
        let c = c.trim();
        if c.is_empty() {
            continue;
        }
        if let Some(prev) = kept.last() {
            let (w, pw) = (norm_words(c), norm_words(prev));
            if w.len() >= 3 && (w == pw || (pw.len() > w.len() && pw.ends_with(&w))) {
                continue;
            }
        }
        kept.push(c);
    }
    let mut out = String::new();
    for c in kept {
        if !out.is_empty() && !glued(&out, c) {
            out.push(' ');
        }
        out.push_str(c);
    }
    collapse_loops(&out)
}

/// A pause inside a number or address splits it into two chunks, each closed with a period by the
/// model: "version 2." + "4 on Monday", "priya.sharma@gmail." + "com". Those are one token again.
fn glued(prev: &str, next: &str) -> bool {
    let Some(head) = prev.strip_suffix('.') else { return false };
    let before = head.chars().last();
    let first = next.chars().next();
    if before.is_some_and(|c| c.is_ascii_digit()) && first.is_some_and(|c| c.is_ascii_digit()) {
        return true;
    }
    // a lowercase domain ending right after the period ("gmail." + "com and…"); a new sentence
    // would start with a capital
    // ("in", "co" and "ai" left out: "…there." + "in the morning" is a sentence, not a domain)
    const TLDS: &[&str] = &["com", "org", "net", "io", "dev", "edu", "gov"];
    let word: String = next.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    before.is_some_and(|c| c.is_ascii_alphanumeric()) && TLDS.contains(&word.as_str())
}

fn norm_words(t: &str) -> Vec<String> {
    t.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).filter(|w| !w.is_empty()).collect()
}

/// "A, A-cut-off": the whole text followed by the start of another copy, cut off mid-word by the
/// token cap, with no full stop in between (so the sentence-level check can't see it).
fn collapse_cut_copy(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let key = norm_words(text);
    let n = words.len();
    if key.len() != n || n < 7 || text.trim_end().ends_with(['.', '?', '!', '।']) {
        return text.to_string();
    }
    for a in n.div_ceil(2)..n.saturating_sub(2) {
        let rest = &key[a..];
        let k = rest.len();
        if k >= 3 && k < a && rest[..k - 1] == key[..k - 1] && key[k - 1].starts_with(rest[k - 1].as_str()) {
            return words[..a].join(" ");
        }
    }
    text.to_string()
}

/// Remove the decoder's repetition loops: the same sentence (or its tail) emitted again and again,
/// a short phrase repeated three or more times in a row, and the cut-off start of yet another
/// copy at the end. Ordinary speech ("very very good", "No, no, I meant…") is left alone.
pub fn collapse_loops(text: &str) -> String {
    let text = collapse_cut_copy(&collapse_repeat(text.trim()));
    // 1) sentence level
    let mut sentences: Vec<String> = vec![];
    let mut cur = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        cur.push(ch);
        // a sentence ends at the mark only when a space (or the end) follows: "2.4", "gmail.com"
        // and "p.m." are one word (they used to come out as "2. 4", "gmail. com")
        if matches!(ch, '.' | '?' | '!' | '।' | '॥') && chars.peek().is_none_or(|c| c.is_whitespace()) {
            sentences.push(std::mem::take(&mut cur));
        }
    }
    if !cur.trim().is_empty() {
        sentences.push(cur);
    }
    let mut kept: Vec<String> = vec![];
    for (i, sent) in sentences.iter().enumerate() {
        let w = norm_words(sent);
        if w.is_empty() {
            continue;
        }
        if let Some(prev) = kept.last() {
            let pw = norm_words(prev);
            let last = i == sentences.len() - 1;
            // the same sentence again, or the tail of the previous one again ("…लाब शो. अने शात भाजी लाब शो.")
            let repeat = w == pw || (pw.len() > w.len() && pw.ends_with(&w) && w.len() >= 2 && w.len() * 2 <= pw.len() + 1);
            // an unfinished final copy: the beginning of the previous sentence, cut off
            let cut_copy = last && !sent.trim_end().ends_with(['.', '?', '!', '।']) && pw.len() >= w.len() && {
                let n = w.len();
                pw[..n - 1] == w[..n - 1] && pw[n - 1].starts_with(w[n - 1].as_str())
            };
            if repeat || cut_copy {
                continue;
            }
        }
        kept.push(sent.trim().to_string());
    }
    collapse_phrase_loops(&kept.join(" "))
}

/// 1–6 words repeated ≥3 times in a row (≥4 for a single word) → once, including a cut-off
/// partial copy at the very end. Keeps the punctuation the loop ended with ("at 11 at 11." → "at 11.").
fn collapse_phrase_loops(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let key: Vec<String> = words.iter().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect();
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    'outer: while i < words.len() {
        for n in 1..=6usize {
            if i + n * 2 > words.len() || key[i..i + n].iter().any(|k| k.is_empty()) {
                continue;
            }
            let mut reps = 1;
            while i + n * (reps + 1) <= words.len() && key[i + n * reps..i + n * (reps + 1)] == key[i..i + n] {
                reps += 1;
            }
            let mut end = i + n * reps;
            // the decoder was cut off mid-copy: "प्राव प्राव प्राव प्र"
            let rest = &key[end..];
            let partial = !rest.is_empty() && rest.len() <= n && rest.iter().zip(&key[i..i + n]).all(|(a, b)| b.starts_with(a.as_str()));
            let need = if n == 1 { 4 } else { 3 };
            if reps + usize::from(partial) < need {
                continue;
            }
            // the loop was found one or more words early: "…Yellow color | Light, Thim and Light
            // Blue color | Light, Thim …" read as copies of "color Light … Blue" swallows the last
            // "color". When the copies really start at a capitalised word, start there instead.
            if partial && n >= 3 {
                let k = rest.len();
                let starts_upper = |w: &str| w.chars().next().map(char::is_uppercase).unwrap_or(false);
                let rest_whole = rest.iter().zip(&key[i..i + n]).all(|(a, b)| a == b);
                if rest_whole && k < n && starts_upper(words[i + k]) && !starts_upper(words[i]) {
                    out.extend(words[i..i + k].iter().map(|w| w.to_string()));
                    i += k;
                    continue 'outer;
                }
            }
            if partial {
                end = words.len();
            }
            let last_full_word = words[i + n * reps - 1];
            let punct: String = last_full_word.chars().rev().take_while(|c| !c.is_alphanumeric()).collect::<Vec<_>>().into_iter().rev().collect();
            out.extend(words[i..i + n].iter().map(|w| w.to_string()));
            if let Some(lw) = out.last_mut() {
                *lw = format!("{}{punct}", lw.trim_end_matches(|c: char| !c.is_alphanumeric()));
            }
            i = end;
            continue 'outer;
        }
        out.push(words[i].to_string());
        i += 1;
    }
    out.join(" ")
}

/// Mean token probability at or above which a decode in the remembered language is kept.
/// Measured with `--bench-stt` on large-v3-turbo: right-language decodes 0.90–0.98, wrong-language
/// ones 0.24–0.81 — the high wrong ones were empty or one word repeated, which `plausible` rejects.
/// Too high only costs a detection pass (~0.6 s), never a wrong transcript.
pub const CONFIDENT: f32 = 0.7;

/// Minimum mean token probability for a fast decode in a language the user picked (or that was
/// just detected). Below it the full window decodes again. From the benchmark: garbage fast decodes
/// scored 0.03–0.53, correct ones 0.68–1.0.
pub const ACCEPT: f32 = 0.6;

/// Is a fast decode of a `secs`-long clip good enough to keep? Besides confidence, script and
/// loops: a long clip must not come back with a few words only — the clip-sized window sometimes
/// stops after the first sentence (12.7 s of Hindi → one sentence, in the benchmark).
pub fn accepted(r: &(String, f32), lang: &str, min_conf: f32, secs: f32) -> bool {
    let letters = r.0.chars().filter(|c| c.is_alphanumeric()).count() as f32;
    let too_little = secs >= 4.0 && letters < secs * 3.0;
    r.1 >= min_conf && plausible(&r.0, lang) && !is_degenerate(&r.0) && !too_little
}

/// The prompt Whisper should see for a decode in `lang`. The prompt is the personal dictionary plus
/// the previous sentence; a previous sentence in another script drags the decode into it (Hindi
/// after an English sentence came out as "KAL SUBAH 10 BAJE MEETING HAY"), so such sentences are
/// dropped. Short items (dictionary words, names) always stay.
pub fn prompt_for(lang: &str, prompt: &str) -> String {
    let script_ok = |t: &str| {
        let deva = t.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
        let guj = t.chars().any(|c| ('\u{0A80}'..='\u{0AFF}').contains(&c));
        match lang {
            "en" => !deva && !guj,
            "hi" | "mr" | "ne" => deva,
            "gu" => guj,
            _ => true,
        }
    };
    let mut pieces: Vec<String> = vec![];
    let mut cur = String::new();
    for ch in prompt.chars() {
        cur.push(ch);
        if matches!(ch, '.' | '?' | '!' | '।') {
            pieces.push(std::mem::take(&mut cur));
        }
    }
    pieces.push(cur);
    pieces
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| {
            // a dictionary list ("Flo, Rahul, Dhanteras, …") or a short phrase always stays
            let list = p.contains(',') && p.split(',').all(|item| item.split_whitespace().count() <= 3);
            !p.is_empty() && (list || p.split_whitespace().count() < 5 || script_ok(p))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Does `text` look like a real transcript in `lang`? Rejects empty output, a single word repeated
/// ("झाल झाल झाल झाल"), and text in the wrong script (Hindi decoded as English letters or vice versa).
pub fn plausible(text: &str, lang: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    let words: Vec<String> = t.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).filter(|w| !w.is_empty()).collect();
    if words.len() >= 3 && words.iter().all(|w| *w == words[0]) {
        return false;
    }
    let devanagari = t.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
    let gujarati = t.chars().any(|c| ('\u{0A80}'..='\u{0AFF}').contains(&c));
    match lang {
        "hi" | "mr" | "ne" => devanagari,
        "gu" => gujarati,
        "en" => !devanagari && !gujarati,
        _ => true,
    }
}

/// Timing / confidence of the last `transcribe` (diagnostics + benchmark).
#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeTiming {
    pub detect_ms: u128,
    pub total_ms: u128,
    /// language detection ran for this clip
    pub detected: bool,
    pub confidence: f32,
}

/// Mean of token probabilities (0 when there are none — an empty decode is never "confident").
pub fn mean_confidence(probs: &[f32]) -> f32 {
    if probs.is_empty() {
        0.0
    } else {
        probs.iter().sum::<f32>() / probs.len() as f32
    }
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4)
}

/// Whisper needs ≥1 s of audio.
fn padded(samples: &[f32]) -> Vec<f32> {
    let mut buf = samples.to_vec();
    if buf.len() < audio::TARGET_RATE as usize {
        buf.resize(audio::TARGET_RATE as usize + 1600, 0.0);
    }
    buf
}

/// Highest-scoring language from (code, logit) pairs.
#[cfg_attr(not(test), allow(dead_code))]
pub fn pick_language(scored: &[(String, f32)]) -> Option<String> {
    scored.iter().filter(|(_, l)| l.is_finite()).max_by(|a, b| a.1.total_cmp(&b.1)).map(|(c, _)| c.clone())
}

/// Languages "auto" may pick from: the configured ones (Settings `auto_languages`), or English +
/// Hindi when none are configured. Never all 99: a short or unclear English clip otherwise comes
/// out as Finnish or Welsh ("Suurin suurin kautta.").
pub fn allowed_languages(configured: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for l in configured.iter().map(|l| l.trim().to_lowercase()) {
        if !l.is_empty() && l != "auto" && !out.contains(&l) {
            out.push(l);
        }
    }
    if out.is_empty() {
        out = vec!["en".into(), "hi".into()];
    }
    out
}

/// The decoder Whisper runs for `lang`. Its Gujarati decoder is unusable: forced to "gu",
/// large-v3-turbo (and large-v3) writes Romanian- or Lithuanian-looking Latin text, Urdu script
/// or nothing (CER 0.4–1.8 on the language bench). Its Hindi decoder writes Gujarati speech
/// phonetically in Devanagari, which rescripts letter for letter to Gujarati (CER 0.05–0.23).
pub fn decoder_lang(lang: &str) -> &str {
    if lang == "gu" {
        "hi"
    } else {
        lang
    }
}

/// The initial prompt for a decode in `lang`: `prompt_for` on the decoder's language, with any
/// Gujarati in the prompt (dictionary words, the previous sentence) rewritten in Devanagari when
/// the Hindi decoder hears Gujarati, so it keeps steering the decode.
pub fn whisper_prompt(lang: &str, prompt: &str) -> String {
    if decoder_lang(lang) == "hi" {
        prompt_for("hi", &crate::text::gujarati_to_devanagari(prompt))
    } else {
        prompt_for(lang, prompt)
    }
}

/// Words that only Gujarati uses, as Whisper's Hindi decoder spells them ("छे" is, "तमे" you,
/// "अने" and, "नथी" isn't…), and Hindi-only words ("है", "और", "नहीं"…).
const GUJARATI_WORDS: &[&str] = &[
    "छे", "छें", "छुं", "छूं", "छू", "छो", "छीए", "छीये", "नथी", "हतो", "हती", "हतुं", "हतु", "हता", "तमे", "तमें", "अमे", "मारे",
    "मारुं", "मारू", "मने", "तने", "अने", "पण", "शुं", "शू", "केम", "हवे", "आजे", "सवारे", "थई", "थाई", "गयुं", "गयू",
    "ग्यूं", "जाउं", "जाऊं", "हुं", "आवजो", "तमारुं", "तमारी", "आपणे", "एटले", "बधा", "बधाने", "बध्धाने", "कयुं", "लावशो", "करशो",
    "जोईए", "जोइए", "सारुं", "बहु", "क्यां", "अहीं", "त्यां",
];
const HINDI_WORDS: &[&str] = &[
    "है", "हैं", "था", "थे", "और", "नहीं", "नही", "मैं", "मुझे", "क्या", "रहा", "रही", "रहे", "हूँ", "हूं", "को", "का", "की", "के", "से",
    "में", "यह", "वह", "भी", "आप", "हम", "क्यों", "कैसे", "गया", "गई", "करना", "चाहिए",
];

/// Is this Devanagari transcript (Whisper's Hindi decode) really Gujarati speech? Counts
/// Gujarati-only words and suffixes (-वानुं "to do", -नुं "of", -मां "in") against Hindi-only ones.
pub fn looks_gujarati(devanagari: &str) -> bool {
    let words: Vec<&str> = devanagari.split(|c: char| !(c.is_alphanumeric() || ('\u{0900}'..='\u{097F}').contains(&c))).filter(|w| !w.is_empty()).collect();
    let (mut gu, mut hi) = (0, 0);
    for w in &words {
        let n = w.chars().count();
        if GUJARATI_WORDS.contains(w) || (n >= 4 && (w.ends_with("वानुं") || w.ends_with("वानू") || w.ends_with("वानु") || w.ends_with("नुं") || w.ends_with("मां"))) {
            gu += 1;
        } else if HINDI_WORDS.contains(w) {
            hi += 1;
        }
    }
    gu > 0 && gu > hi
}

/// The language a clip ends up in. `lid` is what Whisper's detector picked among `allowed`,
/// `text` the decode. The detector calls Gujarati speech Hindi (0.3–0.8 "hi" vs 0.0–0.2 "gu" on
/// the language bench), so when Gujarati is allowed, a Hindi-decoder transcript is settled by
/// its words: Gujarati-only words → "gu", otherwise "hi" (if allowed).
pub fn final_language(lid: &str, text: &str, allowed: &[String]) -> String {
    if decoder_lang(lid) != "hi" {
        return lid.to_string();
    }
    let has = |l: &str| allowed.iter().any(|a| a == l);
    if has("gu") && looks_gujarati(text) {
        "gu".into()
    } else if has("hi") {
        "hi".into()
    } else {
        lid.to_string()
    }
}

/// The transcript in the script of `lang`: Gujarati comes out of the Hindi decoder in
/// Devanagari and is rewritten in Gujarati script; everything else is left as it is.
pub fn in_script(text: &str, lang: &str) -> String {
    if lang == "gu" {
        crate::text::devanagari_to_gujarati(text)
    } else {
        text.to_string()
    }
}

/// The language sent to a cloud engine. Groq serves Whisper large-v3(-turbo), whose Gujarati
/// decoder is as broken as the local one, so it hears Gujarati through Hindi like on-device.
pub fn cloud_language<'a>(provider: &str, language: &'a str) -> &'a str {
    if provider == "groq" && language == "gu" {
        "hi"
    } else {
        language
    }
}

/// A cloud transcript in the right script: Gujarati that came back in Devanagari (Groq's Hindi
/// decode, or an "auto" request where `allowed` includes Gujarati) is rewritten in Gujarati.
pub fn cloud_script(text: &str, language: &str, allowed: &[String]) -> String {
    let deva = text.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
    if !deva {
        return text.to_string();
    }
    match language {
        "gu" => in_script(text, "gu"),
        "auto" | "" if allowed.iter().any(|a| a == "gu") && looks_gujarati(text) => in_script(text, "gu"),
        _ => text.to_string(),
    }
}

/// Pure (unit-tested): the detected language restricted to `allowed`. `scored` are (code, logit or
/// probability) for any languages, e.g. all 99; when Whisper's top pick isn't allowed, the best
/// allowed one wins, and when no allowed language was scored, the first allowed one. The live path
/// now ranks all allowed candidates instead (`lang_probs`, `by_decoder`), with the same fallback.
#[cfg_attr(not(test), allow(dead_code))]
pub fn pick_allowed_language(scored: &[(String, f32)], allowed: &[String]) -> Option<String> {
    if allowed.is_empty() {
        return pick_language(scored);
    }
    let within: Vec<(String, f32)> = scored.iter().filter(|(c, _)| allowed.contains(c)).cloned().collect();
    pick_language(&within).or_else(|| allowed.first().cloned())
}

/// Below this share of the probability, language detection on a dictation-sized clip is a guess
/// (`lid_probe`: the clip-sized window gives English speech 1.00 "en" and Hindi 0.83–0.96 "hi",
/// but a short Hindi command 0.44 "hi" and Romanized Hinglish 0.56–0.83 "hi").
pub const LID_SURE: f32 = 0.8;

/// Language probabilities grouped by the decoder that would run (Gujarati is decoded by the Hindi
/// decoder, so "hi" and "gu" are one choice): most likely first, each group named after its most
/// likely language, with the group's total share.
pub fn by_decoder(probs: &[(String, f32)]) -> Vec<(String, f32)> {
    let mut out: Vec<(String, f32)> = vec![];
    let mut sorted = probs.to_vec();
    sorted.sort_by(|a, b| b.1.total_cmp(&a.1));
    for (l, p) in sorted {
        match out.iter_mut().find(|(o, _)| decoder_lang(o) == decoder_lang(&l)) {
            Some(g) => g.1 += p,
            None => out.push((l, p)),
        }
    }
    out.sort_by(|a, b| b.1.total_cmp(&a.1));
    out
}

/// How much surer (mean token probability) a decode in another language must be to replace the
/// language of the previous dictation, when the detector can't tell. A translation of Hindi into
/// English can score 0.94 against the transcript's 0.86 (Hinglish with its first word cut off).
pub const STICKY_MARGIN: f32 = 0.1;

/// Of decodes of one clip in different languages (language, (text, mean token probability)),
/// the one to keep: a real transcript in that language's script, without loops, before anything
/// else; then the one the model is surer of, with `STICKY_MARGIN` in favour of `previous` (the
/// language of the last dictation). A decode in the wrong language is a translation or gibberish
/// and usually scores lower (`lid_probe`: Hindi speech 0.88–0.96 as Hindi, 0.47–0.90 as English).
pub fn pick_decode(options: &[(String, (String, f32))], previous: Option<&str>) -> usize {
    let key = |(l, (t, c)): &(String, (String, f32))| {
        let bonus = if previous.is_some_and(|p| decoder_lang(p) == decoder_lang(l)) { STICKY_MARGIN } else { 0.0 };
        (plausible(t, decoder_lang(l)) && !is_degenerate(t), *c + bonus)
    };
    (0..options.len()).max_by(|&a, &b| key(&options[a]).partial_cmp(&key(&options[b])).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0)
}

/// A detector share for English below this sends the clip through the Hindi decoder too (when
/// Hindi is one of the languages), in dictation and meetings alike: English speech scores
/// 0.99–1.00 on a clip-sized window, Hindi that the detector mistakes for English rarely does.
pub const MEET_EN_SURE: f32 = 0.97;

/// The decodes an "auto" clip gets (`LocalWhisper::auto_guarded`), from the detector's best
/// language `top` and its share `p`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoPlan {
    /// Hindi (or Gujarati) for sure: the Hindi decoder only
    Hindi,
    /// another language for sure (English at `MEET_EN_SURE`): that decoder only; an English
    /// result with Hindi words in it is Hinglish and gets the Hindi decoder after all
    Other,
    /// unsure: the Hindi decode and the best other one, compared by `pick_meeting_decode`
    Both,
}

/// Below this mean token probability a confident-detector English decode is checked against the
/// Hindi decode too. Low on purpose: English in a noisy room decodes at 0.6–0.7 and the Hindi
/// decoder's take on it can carry a Hindi word or two ("Add a to-do to call Priya tomorrow" →
/// "और … क्या तुमोरो" won at 0.7 in the benchmark).
pub const EN_DOUBT: f32 = 0.5;

/// Is an English decode, with the detector sure of English, possibly Hindi speech after all?
/// Hindi words in Roman letters ("kal", "mein": Hinglish), an unsure decode, or mostly words that
/// aren't English: Hinglish read with an English accent comes out as "Cal Meeting Mindec Bejdina."
/// at detector share 1.0; or far too few words for the clip (`secs` of speech): "Haan bhai, main
/// abhi office pahunch gaya hoon" came out as "I'm sorry." at 0.999 "en". Plain English is none
/// of these and stays one decode.
pub fn english_in_doubt(text: &str, confidence: f32, secs: f32) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    if crate::hinglish::looks_hinglish(text) {
        return true;
    }
    // a word cut off at the end of a dictation ("zero.") is unsure but not worth a Hindi decode
    if confidence < EN_DOUBT && secs >= 1.0 {
        return true;
    }
    let words: Vec<&str> = text.split(|c: char| !c.is_alphabetic() && c != '\'').filter(|w| w.chars().count() > 1).collect();
    if secs >= 2.0 && (text.split_whitespace().count() as f32) < secs * 0.8 {
        return true;
    }
    let unknown = words.iter().filter(|w| !crate::learning::is_common(w)).count();
    unknown >= 2 && unknown * 2 >= words.len()
}

/// Which decodes an "auto" clip needs. Never trusts the detector's "English" for Hindi speech
/// unless it is near certain: decoding Hindi as English yields a fluent, confident *translation*
/// ("Send the deck in the meeting tomorrow.") instead of what was said. `hindi_allowed`: Hindi
/// (or Gujarati) is one of the languages Auto picks from.
pub fn auto_plan(top: &str, p: f32, hindi_allowed: bool) -> AutoPlan {
    if !hindi_allowed {
        return AutoPlan::Other;
    }
    if decoder_lang(top) == "hi" {
        return if p >= LID_SURE { AutoPlan::Hindi } else { AutoPlan::Both };
    }
    if p >= if top == "en" { MEET_EN_SURE } else { LID_SURE } {
        AutoPlan::Other
    } else {
        AutoPlan::Both
    }
}

/// Hindi-only function words that also appear in the general model's Devanagari spelling of
/// Hinglish ("है", "को", "का"…). English speech forced through the Hindi decoder comes out as
/// English words in Devanagari ("आई विल सेंड द डेक") and has (almost) none of them.
const HINDI_FUNCTION_WORDS: &[&str] = &[
    "है", "हैं", "था", "थी", "थे", "और", "नहीं", "नही", "मैं", "मुझे", "क्या", "रहा", "रही", "रहे", "हूँ", "हूं", "को", "का", "की", "के",
    "से", "में", "यह", "वह", "भी", "आप", "हम", "गया", "गई", "करना", "चाहिए", "कि", "तो", "ने", "पर", "हो", "कर", "दिया", "किया",
    "लेकिन", "अब", "कल", "आज", "तक", "होगा", "हमें", "आपसे", "बात", "देना", "जा", "ये", "वो", "कुछ", "अभी", "सब", "सबको",
];

/// Share of a Devanagari transcript's words that are Hindi function words.
pub fn hindi_word_share(text: &str) -> f32 {
    let words: Vec<String> = text
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | '?' | '!' | '।' | '"'))
        .filter(|w| !w.is_empty())
        .map(|w| w.chars().filter(|c| !matches!(c, '\u{200C}' | '\u{200D}')).collect())
        .collect();
    if words.is_empty() {
        return 0.0;
    }
    words.iter().filter(|w| HINDI_FUNCTION_WORDS.contains(&w.as_str())).count() as f32 / words.len() as f32
}

/// Least share of Hindi function words for a Devanagari decode to count as real Hindi speech.
pub const HINDI_WORDS_MIN: f32 = 0.12;

/// Of a meeting clip's decodes [(Hindi-family language, …), (other language, …)], the one to keep.
/// The Hindi decode wins when it is real Hindi (enough Hindi function words) or when the other
/// decode is Hindi in Roman letters; otherwise `pick_decode` (script, loops, confidence with the
/// sticky bonus). A fluent English decode of Hindi speech is a translation, whatever its score.
pub fn pick_meeting_decode(options: &[(String, (String, f32))], previous: Option<&str>) -> usize {
    let hi = options.iter().position(|(l, _)| decoder_lang(l) == "hi");
    if let Some(i) = hi {
        let (t, _) = &options[i].1;
        let other_romanized = options.iter().enumerate().any(|(j, (_, (o, _)))| j != i && crate::hinglish::looks_hinglish(o));
        if real_hindi(t) || (other_romanized && plausible(t, "hi") && !is_degenerate(t)) {
            return i;
        }
    }
    pick_decode(options, previous)
}

/// A Hindi-decoder transcript that is real Hindi speech: Devanagari, no loop, enough Hindi
/// function words (English speech through the Hindi decoder has almost none).
pub fn real_hindi(t: &str) -> bool {
    plausible(t, "hi") && !is_degenerate(t) && hindi_word_share(t) >= HINDI_WORDS_MIN
}

/// Softmax of language logits over the candidates: each language's share of the probability.
pub fn lang_probs(scored: &[(String, f32)]) -> Vec<(String, f32)> {
    let max = scored.iter().map(|(_, l)| *l).filter(|l| l.is_finite()).fold(f32::NEG_INFINITY, f32::max);
    if !max.is_finite() {
        return vec![];
    }
    let exps: Vec<f32> = scored.iter().map(|(_, l)| if l.is_finite() { (l - max).exp() } else { 0.0 }).collect();
    let sum: f32 = exps.iter().sum();
    scored.iter().zip(exps).map(|((c, _), e)| (c.clone(), e / sum)).collect()
}

/// Pure helper (unit-tested): highest-probability candidate whose language id is known.
pub fn best_candidate(probs: &[f32], cands: &[String], id_of: impl Fn(&str) -> Option<usize>) -> Option<String> {
    cands
        .iter()
        .filter_map(|c| Some((c, *probs.get(id_of(c)?)?)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, _)| c.clone())
}

/// Known whisper hallucinations on near-silence.
/// A degenerate repetition loop (e.g. "it's it's it's…") — the failure mode of greedy decoding
/// without temperature fallback. Returns true when one short phrase dominates the output.
pub fn is_degenerate(text: &str) -> bool {
    // Character-level loop: catches glued/hyphenated repeats like "a-tri-tri-tri-tri…" that have
    // no spaces, so the word-based checks below would never see them.
    if has_char_loop(text) {
        return true;
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 12 {
        return false;
    }
    // longest run of a repeating 1–3 word phrase
    for span in 1..=3 {
        let mut run = 1;
        let mut i = span;
        while i + span <= words.len() {
            if words[i..i + span].eq_ignore_ascii_case_slice(&words[i - span..i]) {
                run += 1;
                if run * span >= 10 && (run * span) as f32 >= words.len() as f32 * 0.6 {
                    return true;
                }
            } else {
                run = 1;
            }
            i += span;
        }
    }
    // unique-word ratio: heavy repetition → few distinct words
    let distinct: std::collections::HashSet<String> = words.iter().map(|w| w.to_lowercase()).collect();
    distinct.len() * 4 <= words.len()
}

/// A short character pattern repeating consecutively and dominating the text — the signature of a
/// decoder stuck in a loop (e.g. "tritritritri…" after hyphens/spaces are stripped).
fn has_char_loop(text: &str) -> bool {
    let c: Vec<char> = text.chars().filter(|ch| ch.is_alphanumeric()).flat_map(|ch| ch.to_lowercase()).take(2000).collect();
    let n = c.len();
    if n < 24 {
        return false;
    }
    for p in 1..=12usize {
        if p * 6 > n {
            break;
        }
        let mut i = 0;
        while i + p * 2 <= n {
            let mut run = 1;
            let mut j = i + p;
            while j + p <= n && c[j..j + p] == c[i..i + p] {
                run += 1;
                j += p;
            }
            // ≥6 consecutive repeats of the block, covering ≥60% of the whole string
            if run >= 6 && (run * p * 5) >= (n * 3) {
                return true;
            }
            i = if run > 1 { j } else { i + 1 };
        }
    }
    false
}

trait EqIgnoreAsciiCaseSlice {
    fn eq_ignore_ascii_case_slice(&self, other: &Self) -> bool;
}
impl EqIgnoreAsciiCaseSlice for [&str] {
    fn eq_ignore_ascii_case_slice(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().zip(other).all(|(a, b)| a.eq_ignore_ascii_case(b))
    }
}

pub fn is_hallucination(text: &str, seconds: f32) -> bool {
    const H: &[&str] = &[
        "thank you.", "thanks for watching!", "thank you for watching.", "you", "bye.", "[blank_audio]",
        "[music]", "(music)", "subtitles by the amara.org community", "[silence]", ".",
    ];
    let t = text.trim().to_lowercase();
    t.is_empty() || (seconds < 3.0 && H.contains(&t.as_str())) || t == "[blank_audio]"
}

/// Free the model's RAM (~0.6–1.6 GB) after this long without dictation (Settings → Voice,
/// "Keep the speech model ready"; default 10 minutes).
pub static IDLE_UNLOAD_SECS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(600);

pub fn set_keep_warm_mins(mins: u32) {
    IDLE_UNLOAD_SECS.store(u64::from(mins) * 60, std::sync::atomic::Ordering::Relaxed);
}

pub fn spawn_idle_unloader(w: Arc<LocalWhisper>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            w.unload_if_idle();
        }
    });
}

/// Encoder window for a clip: whisper always encodes 30 s (1500 frames) unless told otherwise;
/// a 3 s sentence only needs ~200. 50 frames/s, +1 s margin, rounded up to 64, clamped.
pub fn audio_ctx_for(secs: f32) -> i32 {
    let frames = ((secs + 1.0) * 50.0).ceil() as i32;
    (((frames + 63) / 64) * 64).clamp(384, 1500)
}

/// whisper.cpp decoder settings (see `LocalWhisper::decode_with`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DecodeOpts {
    /// encoder window sized to the clip instead of a fixed 30 s (clips under 20 s)
    pub clip_ctx: bool,
    /// fixed encoder window in frames (50/s; 0 = Whisper's 30 s). Ignored when `clip_ctx`.
    pub audio_ctx: i32,
    /// Whisper's temperature fallback: re-decode (encoder output reused) when the greedy pass
    /// fails its entropy / log-probability checks — what breaks repetition loops
    pub fallback: bool,
    /// stop a runaway decode at a length no real clip of this duration reaches
    pub cap_tokens: bool,
    pub single_segment: bool,
    pub no_timestamps: bool,
}

impl DecodeOpts {
    /// the pre-fix fast path: one greedy pass, no fallback, clip-sized window
    pub const LEGACY_FAST: Self = Self { clip_ctx: true, audio_ctx: 0, fallback: false, cap_tokens: false, single_segment: true, no_timestamps: true };
    /// Flo's first pass: clip-sized window (fast), loops broken by the temperature fallback and a
    /// token cap. In the benchmark this alone took WER from 4.7 (loops) to 0.52 at the same speed.
    pub const FAST: Self = Self { clip_ctx: true, audio_ctx: 0, fallback: true, cap_tokens: true, single_segment: true, no_timestamps: true };
    /// the full 30 s window, used when the fast pass isn't trusted (WER 0.40 in the benchmark)
    pub const ACCURATE: Self = Self { clip_ctx: false, audio_ctx: 0, fallback: true, cap_tokens: true, single_segment: true, no_timestamps: true };
    /// Whisper's defaults: 30 s window, timestamps, temperature fallback
    pub const SAFE: Self = Self { clip_ctx: false, audio_ctx: 0, fallback: true, cap_tokens: false, single_segment: false, no_timestamps: false };
}

/// Upper bound on tokens for a clip: generous for real speech (Devanagari/Gujarati script costs
/// several tokens per word) yet far below the 224-token loops a stuck greedy decoder runs into.
pub fn max_tokens_for(secs: f32, lang: &str) -> i32 {
    let per_sec = if lang == "en" { 8.0 } else { 20.0 };
    ((secs * per_sec) as i32 + 24).min(224)
}

#[derive(Default)]
pub struct LocalWhisper {
    last_used: Mutex<Option<std::time::Instant>>,
    /// language Whisper detected on the last "auto" decode (e.g. "hi", "gu", "en")
    detected: Mutex<Option<String>>,
    /// use the pre-tuning decode settings (benchmark baseline only)
    pub baseline: std::sync::atomic::AtomicBool,
    /// language "auto" only chooses among these (set from `allowed_languages`, never empty in the
    /// app; empty = Whisper's own pick out of 99, benchmark only)
    pub auto_langs: Mutex<Vec<String>>,
    /// last transcribe: timing + confidence (diagnostics / benchmark)
    pub last_timing: Mutex<DecodeTiming>,
    /// language the last `transcribe` was written in ("en", "hi", "gu", "hi-en"; diagnostics)
    last_lang: Mutex<String>,
    /// clips the fast decoder lost (re-decoded with the safe one) — diagnostics / benchmark
    pub fast_retries: std::sync::atomic::AtomicU32,
    /// benchmark knobs: skip the input gain normalization; beam size (0/1 = greedy)
    no_normalize: std::sync::atomic::AtomicBool,
    beam: std::sync::atomic::AtomicU32,
    /// loaded models, most recently used first (`models_kept` of them)
    #[cfg(feature = "local-stt")]
    ctx: Mutex<Vec<(String, Arc<whisper_rs::WhisperContext>)>>,
    #[cfg(not(feature = "local-stt"))]
    _p: Mutex<Option<Arc<()>>>,
    /// the ONNX engines (Parakeet, Qwen3-ASR); a model folder goes here instead of whisper.cpp
    onnx: crate::asr_onnx::OnnxAsr,
}

/// Whisper models a clip falls back to, best first, when the chosen model can't hear its language.
pub const FALLBACK_MODELS: &[&str] = &["large-v3-q5_0", "large-v3-turbo-q5_0", "large-v3-turbo", "small-q5_1", "small"];

/// Can the model at `model_file` transcribe `language`? "auto" needs every language Auto picks
/// from (`auto_langs`; empty = Whisper's 99). Whisper models hear everything (base.en: English).
pub fn model_hears(model_file: &Path, language: &str, auto_langs: &[String]) -> bool {
    let name = model_file.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if let Some(m) = MODELS.iter().find(|m| m.file == name && !m.only_langs.is_empty()) {
        return match language {
            "" | "auto" => !auto_langs.is_empty() && auto_langs.iter().all(|l| m.only_langs.contains(&l.as_str())),
            l => m.only_langs.contains(&l),
        };
    }
    let Some(f) = onnx_family(model_file) else {
        let english_only = model_file.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains(".en"));
        return !english_only || language == "en";
    };
    match language {
        "" | "auto" => !auto_langs.is_empty() && auto_langs.iter().all(|l| crate::asr_onnx::hears(f, l)),
        l => crate::asr_onnx::hears(f, l),
    }
}

/// The model that transcribes a clip: the chosen one when it hears the language, otherwise the best
/// Whisper model downloaded next to it. That's the per-language routing: pick Parakeet (English)
/// and Hindi, Hinglish or Gujarati still go to Whisper; None when nothing downloaded can.
pub fn route_model(chosen: &Path, language: &str, auto_langs: &[String]) -> Option<PathBuf> {
    let dir = chosen.parent()?;
    // a model made for exactly this language (Hinglish), once downloaded, takes its clips
    if let Some(p) = MODELS.iter().filter(|m| m.only_langs == [language] && m.engine == Engine::Whisper).map(|m| dir.join(m.file)).find(|p| p.exists()) {
        return Some(p);
    }
    if model_hears(chosen, language, auto_langs) {
        return Some(chosen.to_path_buf());
    }
    FALLBACK_MODELS.iter().filter_map(|id| spec(id)).map(|m| dir.join(m.file)).find(|p| p.exists())
}

/// Does a clip for a Whisper model need `route_model`? Only when a language-specific model is
/// involved (the chosen one is one, or one for this language is downloaded); otherwise the chosen
/// Whisper model always transcribes, with no file checks per clip.
fn needs_routing(model_file: &Path, language: &str) -> bool {
    let name = model_file.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let dir = model_file.parent();
    MODELS.iter().any(|m| !m.only_langs.is_empty() && (m.file == name || (m.only_langs == [language] && dir.is_some_and(|d| d.join(m.file).exists()))))
}

/// The ONNX family of the model at `model_file`, or None for a whisper.cpp model. Known models by
/// their catalogue entry; any other folder (benchmarks) by its files.
pub fn onnx_family(model_file: &Path) -> Option<crate::asr_onnx::Family> {
    use crate::asr_onnx::Family;
    let name = model_file.file_name()?.to_str()?;
    if let Some(m) = MODELS.iter().find(|m| m.file == name) {
        return match m.engine {
            Engine::Onnx(f) => Some(f),
            Engine::Whisper => None,
        };
    }
    if !model_file.is_dir() {
        return None;
    }
    Some(if model_file.join("tokenizer").is_dir() { Family::Qwen3 } else { Family::NemoTransducer })
}

/// Language of an ONNX transcript: Hindi when it's written in Devanagari, else English, unless
/// the user fixed one. "auto" settles Hindi vs Gujarati like the Whisper path (`final_language`).
pub fn onnx_language(language: &str, text: &str, allowed: &[String]) -> String {
    let devanagari = text.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
    match language {
        "" | "auto" => final_language(if devanagari { "hi" } else { "en" }, text, allowed),
        l => l.to_string(),
    }
}

impl LocalWhisper {
    /// Free the model now (e.g. a different model or a cloud engine was chosen).
    pub fn unload(&self) {
        #[cfg(feature = "local-stt")]
        {
            if !std::mem::take(&mut *self.ctx.lock()).is_empty() {
                log::info!("unloaded speech model");
            }
        }
        if self.onnx.unload() {
            log::info!("unloaded onnx speech model");
        }
        *self.last_used.lock() = None;
    }

    pub fn unload_if_idle(&self) {
        let keep = IDLE_UNLOAD_SECS.load(std::sync::atomic::Ordering::Relaxed);
        let idle = self.last_used.lock().map(|t| t.elapsed().as_secs() >= keep).unwrap_or(false);
        if idle {
            #[cfg(feature = "local-stt")]
            {
                if !std::mem::take(&mut *self.ctx.lock()).is_empty() {
                    log::info!("unloaded speech model after idle");
                }
            }
            if self.onnx.unload() {
                log::info!("unloaded onnx speech model after idle");
            }
            *self.last_used.lock() = None;
        }
    }

    /// Load (or reuse) the model. Called on key press so it's ready by the time you release.
    #[cfg(feature = "local-stt")]
    fn context(&self, model_file: &Path) -> Result<Arc<whisper_rs::WhisperContext>> {
        use whisper_rs::{WhisperContext, WhisperContextParameters};
        if !model_file.exists() {
            bail!("Speech model not downloaded yet. Open Settings → Voice and download it.");
        }
        *self.last_used.lock() = Some(std::time::Instant::now());
        let key = model_file.to_string_lossy().to_string();
        let mut g = self.ctx.lock();
        if let Some(i) = g.iter().position(|(k, _)| *k == key) {
            let hit = g.remove(i);
            let c = hit.1.clone();
            g.insert(0, hit);
            return Ok(c);
        }
        let mut cp = WhisperContextParameters::default();
        // flash attention: faster decoding on Metal (no word-level DTW needed for dictation)
        cp.flash_attn(!self.baseline.load(std::sync::atomic::Ordering::Relaxed));
        let c = Arc::new(WhisperContext::new_with_params(&key, cp).map_err(|e| anyhow!("load model: {e:?}"))?);
        g.insert(0, (key, c.clone()));
        g.truncate(models_kept());
        Ok(c)
    }

    #[cfg(feature = "local-stt")]
    pub fn warm(&self, model_file: &Path) {
        let t = std::time::Instant::now();
        let was_loaded = self.is_loaded();
        if self.load(model_file).is_ok() {
            log::info!("speech model ready in {} ms ({})", t.elapsed().as_millis(), if was_loaded { "warm" } else { "cold load" });
        }
    }

    /// The model is in memory (the next dictation skips loading it).
    #[cfg(feature = "local-stt")]
    pub fn is_loaded(&self) -> bool {
        !self.ctx.lock().is_empty() || self.onnx.is_loaded()
    }

    #[cfg(not(feature = "local-stt"))]
    pub fn warm(&self, _model_file: &Path) {}

    #[cfg(not(feature = "local-stt"))]
    pub fn is_loaded(&self) -> bool {
        false
    }

    /// Load the model now and say whether it worked (setup waits on this before the first
    /// dictation, so the try-out never meets a cold or missing model).
    #[cfg(feature = "local-stt")]
    pub fn load(&self, model_file: &Path) -> Result<()> {
        if let Some(f) = onnx_family(model_file) {
            // a Whisper model already loaded stays: clips Parakeet can't hear are routed to it
            *self.last_used.lock() = Some(std::time::Instant::now());
            return self.onnx.load(model_file, f);
        }
        // a Whisper model chosen: an ONNX one isn't needed any more
        self.onnx.unload();
        self.context(model_file).map(|_| ())
    }

    #[cfg(not(feature = "local-stt"))]
    pub fn load(&self, model_file: &Path) -> Result<()> {
        if !model_file.exists() {
            bail!("Speech model not downloaded yet.");
        }
        Ok(())
    }

    /// Accuracy harness only: turn the input normalization off / decode with a beam search.
    #[cfg(test)]
    pub fn set_bench_knobs(&self, normalize: bool, beam: u32) {
        self.no_normalize.store(!normalize, std::sync::atomic::Ordering::Relaxed);
        self.beam.store(beam, std::sync::atomic::Ordering::Relaxed);
    }

    /// The Flo key's on-device speech-to-text: the audio front end (silence trimmed, a soft or
    /// distant voice brought up to a normal level), then `transcribe`. Dictation, the assistant,
    /// hands-free mode and the accuracy harness all come through here. Hindi speech comes out as
    /// Hinglish (`dictate_as` with `HindiScript::Hinglish`).
    pub fn dictate(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
        Ok(self.dictate_as(model_file, samples, language, prompt, HindiScript::Hinglish)?.text)
    }

    /// `dictate` with Hindi written as `hindi` (Settings → Voice, `dictation_hindi`). The same
    /// decision as meeting notes (`meeting_clip`): Hindi speech is never typed as the speech
    /// model's English translation. `HindiScript::English` gives the Hinglish transcript here; the
    /// cleanup AI translates it (a Whisper translation drops words). An explicitly chosen Hindi
    /// language keeps Devanagari unless Hinglish was asked for some other way.
    pub fn dictate_as(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str, hindi: HindiScript) -> Result<Heard> {
        let script = dictation_script(language, hindi);
        let sticky = self.detected.lock().clone();
        let heard = self.meeting_clip(model_file, samples, language, prompt, sticky.as_deref(), script, false)?;
        if matches!(language, "" | "auto") && !heard.lang.is_empty() {
            *self.detected.lock() = Some(heard.lang.clone());
        }
        Ok(Heard { text: crate::meetpipe::render_hindi(&heard, script), ..heard })
    }

    /// `dictate` with the previous language given (`transcribe_hinted`) instead of the one this
    /// engine remembers, which stays untouched: meeting notes keep one per track. Returns the text
    /// and the language it was written in (no Hinglish rendering: see `meeting_clip`).
    pub fn dictate_hinted(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str, sticky: Option<&str>) -> Result<(String, String)> {
        let trimmed = audio::trim_silence(samples);
        let level = audio::speech_level(&trimmed);
        let (audio_in, gain) = if self.no_normalize.load(std::sync::atomic::Ordering::Relaxed) { (trimmed, 1.0) } else { audio::normalize_speech(&trimmed) };
        let t = std::time::Instant::now();
        let r = self.transcribe_hinted(model_file, &audio_in, language, prompt, sticky);
        // what a report needs to be diagnosable, never the words themselves (those only at debug)
        let model = model_file.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        log::info!(
            "dictate: model={model} lang={language}→{} audio={:.1}s (of {:.1}s) speech={:.0} dBFS gain={:.1}x decode={} ms conf={:.2} prompt={} chars",
            self.last_lang.lock().clone(),
            audio_in.len() as f32 / audio::TARGET_RATE as f32,
            samples.len() as f32 / audio::TARGET_RATE as f32,
            audio::dbfs(level),
            gain,
            t.elapsed().as_millis(),
            self.last_timing.lock().confidence,
            prompt.chars().count(),
        );
        if let Ok((text, _)) = &r {
            log::debug!("dictate text: {text}");
        }
        r
    }

    /// Transcribe a clip, with the language of the last "auto" clip as the tie-breaker (and
    /// remembered for the next one).
    pub fn transcribe(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
        let sticky = self.detected.lock().clone();
        let (text, lang) = self.transcribe_hinted(model_file, samples, language, prompt, sticky.as_deref())?;
        if matches!(language, "" | "auto") {
            *self.detected.lock() = Some(lang);
        }
        Ok(text)
    }

    /// The Hinglish model next to `model_file`, when it's downloaded and this computer can keep it
    /// loaded next to the main model (meeting notes switch between the two clip by clip).
    pub fn hinglish_model(&self, model_file: &Path) -> Option<PathBuf> {
        let m = spec(HINGLISH_MODEL)?;
        let p = model_file.parent()?.join(m.file);
        (p.exists() && (p == model_file || models_kept() >= 2)).then_some(p)
    }

    /// One meeting clip (`meetpipe::Transcriber`), and one dictation clip (`dictate_as`):
    /// `language` from Settings ("auto" = identified clip by clip, `hint` = the track's recent
    /// language as the tie-breaker; never forced). Never translates unless `hindi` asks for
    /// English: Hindi speech is written in Devanagari by the general model, then in Roman letters
    /// by the Hinglish model when it's downloaded (`HindiScript::Hinglish`; otherwise
    /// `meetpipe::render_hindi` transliterates), or translated by a decode in English
    /// (`HindiScript::English`, meetings only). `preview` (live partials) skips the second decode.
    pub fn meeting_clip(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str, hint: Option<&str>, hindi: HindiScript, preview: bool) -> Result<Heard> {
        let (raw, lang) = self.dictate_hinted(model_file, samples, language, prompt, hint)?;
        let heard = |text: String| Heard { text, lang: lang.clone(), raw: raw.clone() };
        if lang != "hi" || preview || hindi == HindiScript::Devanagari {
            return Ok(heard(raw.clone()));
        }
        let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
        let usable = |t: &str| !t.trim().is_empty() && !is_degenerate(t) && !is_hallucination(t, secs);
        let second = match hindi {
            HindiScript::Hinglish => match self.hinglish_model(model_file) {
                // the Hinglish model gets the previous line only when it's in Roman letters
                Some(apex) => Some(self.dictate_hinted(&apex, samples, HINGLISH, prompt, None)?.0),
                None => None,
            },
            HindiScript::English => Some(self.dictate_hinted(model_file, samples, "en", "", None)?.0),
            HindiScript::Devanagari => None,
        };
        Ok(match second {
            Some(t) if usable(&t) => heard(t.trim().to_string()),
            _ => heard(raw.clone()),
        })
    }

    /// Transcribe a clip.
    ///
    /// Every decode starts on the fast path: an encoder window sized to the clip (~0.3 s). That
    /// window is not what Whisper was trained on, and on short or non-English clips it sometimes
    /// loops ("Yes. Yes. Yes…"), switches script or invents text. Loops are cut out
    /// (`collapse_loops`); anything still implausible or unconfident is decoded once more with the
    /// full 30 s window (accurate, ~1 s) — instead of the old retry that only caught loops and
    /// re-ran Whisper's slowest settings.
    ///
    /// `language` "auto": decode in the language used last, identify the language among
    /// `auto_langs` from the same clip-sized encoder state (~0.2 s instead of a 30 s window) and
    /// decode again only when needed, never keeping an English translation of Hindi speech
    /// (`auto_guarded`). "hi-en" (Hinglish) is decoded as English steered to Roman-letter Hindi.
    ///
    /// `sticky` is the language of the previous clip (the first guess and the tie-breaker when
    /// detection is unsure). Returns the text and its language.
    #[cfg(feature = "local-stt")]
    pub fn transcribe_hinted(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str, sticky: Option<&str>) -> Result<(String, String)> {
        if onnx_family(model_file).is_some() || needs_routing(model_file, language) {
            let langs = self.auto_langs.lock().clone();
            match route_model(model_file, language, &langs) {
                Some(p) if p.as_path() != model_file => {
                    log::info!("stt: {} can't hear {language}; using {}", model_file.display(), p.display());
                    return self.transcribe_hinted(&p, samples, language, prompt, sticky);
                }
                Some(_) => {
                    if let Some(f) = onnx_family(model_file) {
                        return self.transcribe_onnx(model_file, f, samples, language);
                    }
                }
                None => bail!("This speech model can't hear that language. Download Whisper Large v3 Turbo in Settings → Voice."),
            }
        }
        let t0 = std::time::Instant::now();
        let mut timing = DecodeTiming::default();
        let lang_in = if language.is_empty() { "auto" } else { language };
        let (text, confidence, out_lang) = if lang_in == HINGLISH {
            let p = if prompt.is_empty() { HINGLISH_PROMPT.to_string() } else { format!("{HINGLISH_PROMPT} {}", prompt_for("en", prompt)) };
            *self.last_lang.lock() = HINGLISH.into();
            let (text, conf) = self.decode_checked(model_file, samples, "en", &p, ACCEPT)?.0;
            (text, conf, HINGLISH.to_string())
        } else if lang_in != "auto" {
            *self.last_lang.lock() = lang_in.into();
            // Gujarati: the Hindi decoder, rewritten in Gujarati script (see `decoder_lang`)
            let (text, conf) = self.decode_checked(model_file, samples, decoder_lang(lang_in), &whisper_prompt(lang_in, prompt), ACCEPT)?.0;
            (in_script(&text, lang_in), conf, lang_in.to_string())
        } else {
            let (text, conf, lang) = self.auto_guarded(model_file, samples, prompt, sticky, &mut timing)?;
            *self.last_lang.lock() = lang.clone();
            (in_script(&text, &lang), conf, lang)
        };
        timing.total_ms = t0.elapsed().as_millis();
        timing.confidence = confidence;
        *self.last_timing.lock() = timing;
        log::info!(
            "stt: {} ms (detect {} ms) lang={} conf={:.2}",
            timing.total_ms,
            timing.detect_ms,
            self.last_lang.lock(),
            confidence
        );
        Ok((text, out_lang))
    }

    /// Language identification for an "auto" clip (dictation, the assistant and meeting notes),
    /// built so Hindi never comes out translated. Among the "auto" languages, with `sticky` (the
    /// previous clip's language) only as the first guess and tie-breaker. A decode in English of
    /// Hindi speech is a fluent, confident translation ("I was talking to you."), so English is
    /// trusted alone only when the detector is near certain (`auto_plan`); otherwise both are
    /// decoded and the Hindi one wins when its words are Hindi (`hindi_word_share`) or the English
    /// one is Hindi in Roman letters (`hinglish::looks_hinglish`). Clearly English speech costs one
    /// decode, as before. Returns (text, confidence, language).
    #[cfg(feature = "local-stt")]
    fn auto_guarded(&self, model_file: &Path, samples: &[f32], prompt: &str, sticky: Option<&str>, timing: &mut DecodeTiming) -> Result<(String, f32, String)> {
        let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
        let cands = self.auto_langs.lock().clone();
        let sticky = sticky.map(String::from).filter(|l| cands.is_empty() || cands.contains(l));
        let first_lang = sticky.clone().or_else(|| cands.first().cloned()).unwrap_or_else(|| "en".into());
        let first_dec = decoder_lang(&first_lang).to_string();
        let (first, mut state) = self.decode_with(model_file, samples, &first_dec, &whisper_prompt(&first_lang, prompt), DecodeOpts::FAST)?;
        let td = std::time::Instant::now();
        let probs = by_decoder(&self.lang_probs_from_state(model_file, &mut state, &cands));
        timing.detect_ms = td.elapsed().as_millis();
        timing.detected = true;
        let (top, p) = probs.first().cloned().unwrap_or((first_lang.clone(), 0.0));
        let hindi = probs.iter().find(|(l, _)| decoder_lang(l) == "hi").map(|(l, _)| l.clone());
        // a decode in `l`: the first one when it's the same decoder and good enough, else again
        let decode = |l: &str| -> Result<(String, f32)> {
            let d = decoder_lang(l);
            if d == first_dec && accepted(&first, d, ACCEPT, secs) {
                return Ok(first.clone());
            }
            let fast = if d == first_dec { first.clone() } else { self.decode_with(model_file, samples, d, &whisper_prompt(l, prompt), DecodeOpts::FAST)?.0 };
            if accepted(&fast, d, ACCEPT, secs) {
                Ok(fast)
            } else {
                self.decode_accurate(model_file, samples, d, &whisper_prompt(l, prompt))
            }
        };
        #[cfg(test)]
        let debug = std::env::var_os("FLO_DICT_DEBUG").is_some();
        let plan = auto_plan(&top, p, hindi.is_some());
        let Some(hi) = hindi else {
            // no Hindi among the languages: the detector's pick
            let r = decode(&top)?;
            return Ok((r.0, r.1, top));
        };
        let (text, conf, lid) = if plan == AutoPlan::Hindi {
            let r = decode(&top)?;
            (r.0, r.1, top.clone())
        } else if plan == AutoPlan::Other {
            let r = decode(&top)?;
            if top == "en" && english_in_doubt(&r.0, r.1, secs) {
                // Hinglish speech the detector calls English (Hindi words in Roman letters, an
                // unsure decode, or words that aren't English): the Hindi decode settles it
                let h = decode(&hi)?;
                #[cfg(test)]
                if debug {
                    eprintln!("   english in doubt {r:?} hi {h:?}");
                }
                let options = vec![(hi.clone(), h), (top.clone(), r)];
                let i = pick_meeting_decode(&options, sticky.as_deref());
                let (l, r) = options.into_iter().nth(i).unwrap_or_default();
                (r.0, r.1, l)
            } else {
                (r.0, r.1, top.clone())
            }
        } else {
            // unsure: the Hindi decode and the detector's best other language, compared
            let other = probs.iter().find(|(l, _)| decoder_lang(l) != "hi").map(|(l, _)| l.clone()).unwrap_or_else(|| "en".into());
            let h = decode(&hi)?;
            if real_hindi(&h.0) {
                // `pick_meeting_decode` keeps real Hindi whatever the other decode says: skip it
                (h.0, h.1, hi.clone())
            } else {
                let o = decode(&other)?;
                #[cfg(test)]
                if debug {
                    eprintln!("   auto unsure {probs:?} sticky {sticky:?} hi {h:?} {other} {o:?}");
                }
                let options = vec![(hi.clone(), h), (other.clone(), o)];
                let i = pick_meeting_decode(&options, sticky.as_deref());
                let (l, r) = options.into_iter().nth(i).unwrap_or_default();
                (r.0, r.1, l)
            }
        };
        #[cfg(test)]
        if debug {
            eprintln!("   auto lid {probs:?} sticky {sticky:?} → {lid} {text:?}");
        }
        Ok((text.clone(), conf, final_language(&lid, &text, &cands)))
    }

    /// Fast decode in a known language; when the result isn't `accepted`, decode again with the
    /// full window. Returns ((text, confidence), escalated).
    #[cfg(feature = "local-stt")]
    fn decode_checked(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str, min_conf: f32) -> Result<((String, f32), bool)> {
        if self.baseline.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok((self.decode_with(model_file, samples, lang, prompt, DecodeOpts::SAFE)?.0, false));
        }
        let (fast, _) = self.decode_with(model_file, samples, lang, prompt, DecodeOpts::FAST)?;
        if accepted(&fast, lang, min_conf, samples.len() as f32 / audio::TARGET_RATE as f32) {
            return Ok((fast, false));
        }
        let accurate = self.decode_accurate(model_file, samples, lang, prompt)?;
        // the full window found nothing although the fast pass had plausible text: keep that
        if accurate.0.trim().is_empty() && plausible(&fast.0, lang) && !is_degenerate(&fast.0) {
            return Ok((fast, true));
        }
        Ok((accurate, true))
    }

    /// The full 30 s encoder window Whisper was trained on.
    #[cfg(feature = "local-stt")]
    fn decode_accurate(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str) -> Result<(String, f32)> {
        log::info!("stt: fast decode not trusted; decoding with the full window");
        self.fast_retries.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(self.decode_with(model_file, samples, lang, prompt, DecodeOpts::ACCURATE)?.0)
    }

    /// Language among `cands` (all if empty) for the clip a state just decoded: one decoder step
    /// after <|startoftranscript|> on the encoder output that decode left in the state. This is
    /// Whisper's own language detector minus its encoder pass (~1 s on a 30 s window).
    #[cfg(all(test, feature = "local-stt"))]
    fn lang_from_state(&self, model_file: &Path, state: &mut whisper_rs::WhisperState, cands: &[String]) -> Option<String> {
        self.lang_probs_from_state(model_file, state, cands).into_iter().next().map(|(l, _)| l)
    }

    /// Same, as (language, share of probability) for every candidate, most likely first.
    #[cfg(feature = "local-stt")]
    fn lang_probs_from_state(&self, model_file: &Path, state: &mut whisper_rs::WhisperState, cands: &[String]) -> Vec<(String, f32)> {
        let Ok(ctx) = self.context(model_file) else { return vec![] };
        if state.decode(&[ctx.token_sot()], 0, threads()).is_err() {
            return vec![];
        }
        let Ok(logits) = state.get_logits() else { return vec![] };
        let all: Vec<String>;
        let cands = if cands.is_empty() {
            all = (0..=whisper_rs::get_lang_max_id()).filter_map(|i| whisper_rs::get_lang_str(i).map(String::from)).collect();
            &all
        } else {
            cands
        };
        let scored: Vec<(String, f32)> = cands
            .iter()
            .filter_map(|c| {
                let id = whisper_rs::get_lang_id(c)?;
                logits.get(ctx.token_lang(id) as usize).map(|l| (c.clone(), *l))
            })
            .collect();
        #[cfg(test)]
        if std::env::var_os("FLO_DICT_DEBUG").is_some() {
            eprintln!("   lid {:?}", lang_probs(&scored));
        }
        let mut probs = lang_probs(&scored);
        probs.sort_by(|a, b| b.1.total_cmp(&a.1));
        if probs.is_empty() {
            if let Some(first) = cands.first() {
                probs.push((first.clone(), 0.0));
            }
        }
        probs
    }

    /// Most likely language among `cands` from a full 30 s window (the old detector; ~1 s).
    /// Kept for the benchmark comparison with `lang_from_state`.
    #[cfg(all(test, feature = "local-stt"))]
    fn detect_language(&self, model_file: &Path, samples: &[f32], cands: &[String]) -> Result<String> {
        let ctx = self.context(model_file)?;
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let threads = threads();
        let buf = padded(samples);
        state.pcm_to_mel(&buf, threads).map_err(|e| anyhow!("mel: {e:?}"))?;
        let (top, probs) = state.lang_detect(0, threads).map_err(|e| anyhow!("language detect: {e:?}"))?;
        let picked = if cands.is_empty() {
            whisper_rs::get_lang_str(top).map(|s| s.to_string())
        } else {
            best_candidate(&probs, cands, |c| whisper_rs::get_lang_id(c).map(|i| i as usize))
        };
        Ok(picked.unwrap_or_else(|| "en".into()))
    }

    /// One whisper.cpp pass with explicit decoder settings. Also hands back the state, whose
    /// encoder window matches the clip (language detection on it costs one short encode).
    #[cfg(feature = "local-stt")]
    fn decode_with(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str, o: DecodeOpts) -> Result<((String, f32), whisper_rs::WhisperState)> {
        use whisper_rs::{FullParams, SamplingStrategy};
        let ctx = self.context(model_file)?;
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let buf = padded(samples);
        let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
        let beam = self.beam.load(std::sync::atomic::Ordering::Relaxed) as i32;
        let mut p = FullParams::new(if beam > 1 { SamplingStrategy::BeamSearch { beam_size: beam, patience: -1.0 } } else { SamplingStrategy::Greedy { best_of: 1 } });
        p.set_language(Some(lang));
        p.set_translate(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        p.set_suppress_blank(true);
        p.set_no_context(true);
        let short = secs < 20.0;
        if o.no_timestamps {
            p.set_no_timestamps(true);
        }
        if short && o.single_segment {
            p.set_single_segment(true);
        }
        if short && o.clip_ctx {
            p.set_audio_ctx(audio_ctx_for(secs));
        } else if o.audio_ctx > 0 && secs + 1.0 < o.audio_ctx as f32 / 50.0 {
            p.set_audio_ctx(o.audio_ctx);
        }
        if !o.fallback {
            p.set_temperature_inc(0.0);
        }
        if o.cap_tokens {
            p.set_max_tokens(max_tokens_for(secs, lang));
        }
        p.set_n_threads(threads() as i32);
        if !prompt.is_empty() {
            p.set_initial_prompt(prompt);
        }
        state.full(p, &buf).map_err(|e| anyhow!("whisper: {e:?}"))?;
        let eot = ctx.token_eot();
        let n = state.full_n_segments().map_err(|e| anyhow!("{e:?}"))?;
        let mut out = String::new();
        let mut probs = vec![];
        for i in 0..n {
            if let Ok(t) = state.full_get_segment_text(i) {
                // segments don't always start with a space ("colors." + "Like" → "colors.Like")
                if !out.is_empty() && !out.ends_with(char::is_whitespace) && !t.starts_with(char::is_whitespace) {
                    out.push(' ');
                }
                out.push_str(&t);
            }
            for j in 0..state.full_n_tokens(i).unwrap_or(0) {
                if let Ok(d) = state.full_get_token_data(i, j) {
                    if d.id < eot {
                        probs.push(d.p);
                    }
                }
            }
        }
        Ok(((collapse_loops(&out), mean_confidence(&probs)), state))
    }

    /// A clip through an ONNX engine (`asr_onnx`): one pass, no prompt (these models take none),
    /// the language read off the transcript, Gujarati rewritten in its own script.
    fn transcribe_onnx(&self, dir: &Path, f: crate::asr_onnx::Family, samples: &[f32], language: &str) -> Result<(String, String)> {
        // a Whisper model loaded for routed clips (Hindi while Parakeet is chosen) stays loaded
        // next to it; the idle unloader frees both
        let t0 = std::time::Instant::now();
        *self.last_used.lock() = Some(t0);
        let text = collapse_loops(&self.onnx.transcribe(dir, f, samples)?);
        let lang = onnx_language(language, &text, &self.auto_langs.lock().clone());
        *self.last_lang.lock() = lang.clone();
        let timing = DecodeTiming { total_ms: t0.elapsed().as_millis(), confidence: 1.0, ..Default::default() };
        *self.last_timing.lock() = timing;
        log::info!("stt: {} ms (onnx {f:?}) lang={lang}", timing.total_ms);
        Ok((in_script(&text, &lang), lang))
    }

    /// Language Whisper last auto-detected ("hi", "gu", "en", …), if any.
    pub fn detected_lang(&self) -> Option<String> {
        self.detected.lock().clone()
    }

    /// Forget the remembered language: the next "auto" clip runs detection.
    pub fn forget_language(&self) {
        *self.detected.lock() = None;
    }

    #[cfg(not(feature = "local-stt"))]
    pub fn transcribe_hinted(&self, m: &Path, s: &[f32], l: &str, _p: &str, _sticky: Option<&str>) -> Result<(String, String)> {
        if let Some(f) = onnx_family(m) {
            return self.transcribe_onnx(m, f, s, l);
        }
        bail!("This build has no on-device speech model. Choose OpenAI or Groq in Settings → Voice.")
    }
}

pub async fn transcribe_cloud(egress: &Egress, provider: &str, model: &str, key: &str, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
    if provider == "sarvam" {
        return transcribe_sarvam(egress, model, key, samples, language).await;
    }
    let language = cloud_language(provider, language);
    // Whisper-style APIs take ISO-639-1 codes; Hinglish is Hindi speech written in Roman letters,
    // which they produce from an English-language decode steered by a romanized prompt
    let (language, prompt) = match language {
        HINGLISH => ("en", if prompt.is_empty() { HINGLISH_PROMPT.to_string() } else { format!("{HINGLISH_PROMPT} {prompt}") }),
        l => (l, prompt.to_string()),
    };
    let prompt = prompt.as_str();
    let (base, default_model) = match provider {
        "openai" => ("https://api.openai.com/v1", "gpt-4o-mini-transcribe"),
        "groq" => ("https://api.groq.com/openai/v1", "whisper-large-v3-turbo"),
        p => bail!("unsupported STT provider {p}"),
    };
    let model = if model.is_empty() || spec(model).is_some() { default_model } else { model };
    let url = format!("{base}/audio/transcriptions");
    egress.check(&url, Purpose::Stt, true)?;
    let wav = audio::encode_wav(samples, audio::TARGET_RATE)?;
    let bytes = wav.len() as u64;
    let mut form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav")?)
        .text("model", model.to_string())
        .text("response_format", "json");
    if !language.is_empty() && language != "auto" {
        form = form.text("language", language.to_string());
    }
    if !prompt.is_empty() {
        form = form.text("prompt", prompt.to_string());
    }
    let resp = egress
        .client(Purpose::Stt, true)
        .post(&url)
        .bearer_auth(key)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().await?;
    egress.record(&url, Purpose::Stt, bytes);
    if !status.is_success() {
        bail!("{provider} STT error {status}: {}", v["error"]["message"].as_str().unwrap_or("unknown"));
    }
    Ok(v["text"].as_str().unwrap_or_default().trim().to_string())
}


#[cfg(all(test, feature = "local-stt"))]
#[path = "stt_bench.rs"]
pub(crate) mod bench;

/// The model that writes Hindi in Roman letters (meeting notes use it next to the main model).
pub const HINGLISH_MODEL: &str = "hinglish-apex";

/// How meeting notes write Hindi speech (Settings → Voice → Meeting notes, `meeting_hindi`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HindiScript {
    /// Roman letters, English words kept in English ("main kal meeting mein bataunga")
    #[default]
    Hinglish,
    Devanagari,
    /// translated into English (opt-in; less precise)
    English,
}

impl HindiScript {
    pub fn from_setting(s: &str) -> Self {
        match s {
            "devanagari" => HindiScript::Devanagari,
            "english" => HindiScript::English,
            _ => HindiScript::Hinglish,
        }
    }
}

/// How a dictation clip's Hindi is written, from the language setting and `dictation_hindi`:
/// "English" is the Hinglish transcript (the cleanup AI translates it, never the speech model),
/// and the language "Hindi" (हिन्दी) picked explicitly keeps Devanagari, as it always did (Auto
/// and Hinglish follow the setting; "devanagari" applies to all).
pub fn dictation_script(language: &str, hindi: HindiScript) -> HindiScript {
    match hindi {
        HindiScript::English => HindiScript::Hinglish,
        HindiScript::Hinglish if language == "hi" => HindiScript::Devanagari,
        h => h,
    }
}

/// What a meeting clip said.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Heard {
    /// the line as it should be shown (Hindi possibly still in Devanagari: `meetpipe` writes it
    /// in Roman letters when the Hinglish model wasn't used)
    pub text: String,
    /// the language spoken ("en", "hi", "gu", "hi-en"); empty when the engine doesn't say
    pub lang: String,
    /// the general model's own transcript (the next clip's prompt)
    pub raw: String,
}

/// How many speech models stay loaded at once: two on machines with 16 GB or more (meeting notes
/// switch between the main model and the Hinglish one clip by clip), else one.
pub fn models_kept() -> usize {
    static RAM: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    if *RAM.get_or_init(total_ram_gb) >= 15.5 {
        2
    } else {
        1
    }
}

/// The "Hinglish" language choice: Hindi/English mixed speech, written in Roman letters.
pub const HINGLISH: &str = "hi-en";
/// Romanized example text that steers Whisper to write Hinglish in Latin script.
pub const HINGLISH_PROMPT: &str = "Haan, main kal office aaunga. Meeting 10 baje hai, please sabko yaad dila dena.";

/// Sarvam AI's longest clip for one synchronous request is 30 s; send slightly less.
const SARVAM_CHUNK_SECS: usize = 28;

/// Flo language setting → Sarvam (`language_code`, `mode`). Hinglish asks for Roman-letter output.
pub fn sarvam_params(language: &str) -> (&'static str, &'static str) {
    match language {
        "hi" => ("hi-IN", "transcribe"),
        "gu" => ("gu-IN", "transcribe"),
        "en" => ("en-IN", "transcribe"),
        "mr" => ("mr-IN", "transcribe"),
        "bn" => ("bn-IN", "transcribe"),
        "ta" => ("ta-IN", "transcribe"),
        "te" => ("te-IN", "transcribe"),
        "kn" => ("kn-IN", "transcribe"),
        "ml" => ("ml-IN", "transcribe"),
        "pa" => ("pa-IN", "transcribe"),
        HINGLISH => ("unknown", "translit"),
        _ => ("unknown", "transcribe"),
    }
}

/// Sarvam AI speech-to-text (Saaras): built for Indian languages and code-mixed speech.
/// https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
async fn transcribe_sarvam(egress: &Egress, model: &str, key: &str, samples: &[f32], language: &str) -> Result<String> {
    let url = "https://api.sarvam.ai/speech-to-text";
    egress.check(url, Purpose::Stt, true)?;
    let model = if model.is_empty() || spec(model).is_some() { "saaras:v3" } else { model };
    let (code, mode) = sarvam_params(language);
    let mut parts = vec![];
    for chunk in samples.chunks(SARVAM_CHUNK_SECS * audio::TARGET_RATE as usize) {
        let wav = audio::encode_wav(chunk, audio::TARGET_RATE)?;
        let bytes = wav.len() as u64;
        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav")?)
            .text("model", model.to_string())
            .text("mode", mode)
            .text("language_code", code);
        let resp = egress
            .client(Purpose::Stt, true)
            .post(url)
            .header("api-subscription-key", key)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await?;
        let status = resp.status();
        let v: serde_json::Value = resp.json().await.unwrap_or_default();
        egress.record(url, Purpose::Stt, bytes);
        if !status.is_success() {
            let msg = v["error"]["message"].as_str().or(v["message"].as_str()).unwrap_or("unknown");
            bail!("Sarvam STT error {status}: {msg}");
        }
        parts.push(v["transcript"].as_str().unwrap_or_default().trim().to_string());
    }
    Ok(parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" "))
}

/// Installed speech models other than `in_use` and `keep` — what "Free up space" removes.
pub fn unused_installed(models_dir: &Path, in_use: &str, keep: &[&str]) -> Vec<&'static ModelSpec> {
    MODELS.iter().filter(|m| m.id != in_use && !keep.contains(&m.id) && models_dir.join(m.file).exists()).collect()
}

/// Delete every installed model except `in_use` and `keep` (`meeting_models`); returns MB freed.
pub fn remove_unused(models_dir: &Path, in_use: &str, keep: &[&str]) -> u64 {
    unused_installed(models_dir, in_use, keep)
        .into_iter()
        .filter(|m| remove_model_path(&models_dir.join(m.file)).is_ok())
        .map(|m| {
            log::info!("removed unused speech model {}", m.id);
            m.size_mb
        })
        .sum()
}

/// The quantized large-v3-turbo transcribes like the full-precision one at about a third of the
/// memory and disk. When it's the model in use, a leftover full-precision copy is dead weight.
pub fn remove_redundant(models_dir: &Path, in_use: &str) -> u64 {
    if in_use != "large-v3-turbo-q5_0" || !models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists() {
        return 0;
    }
    let full = models_dir.join("ggml-large-v3-turbo.bin");
    if full.exists() && std::fs::remove_file(&full).is_ok() {
        log::info!("removed the full-precision large-v3-turbo (the quantized copy is in use)");
        return spec("large-v3-turbo").map(|s| s.size_mb).unwrap_or(0);
    }
    0
}

/// One-time switch from the full-precision large-v3-turbo to the quantized one when it's already
/// downloaded (same accuracy in Flo's benchmark, 560 MB instead of 1.56 GB of RAM). Runs once per
/// install (a marker file in the models folder), so choosing full precision again later sticks.
/// Returns true when it changed the setting.
pub fn prefer_quantized(s: &mut crate::model::Settings, models_dir: &Path) -> bool {
    let marker = models_dir.join(".prefer-quantized");
    if marker.exists() || !models_dir.exists() {
        return false;
    }
    let _ = std::fs::write(&marker, b"1");
    if s.stt_model == "large-v3-turbo" && models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists() {
        s.stt_model = "large-v3-turbo-q5_0".into();
        return true;
    }
    false
}

/// First-word latency with a cold vs a warm model: `cargo test --release --lib warm_model_latency -- --ignored --nocapture`.
#[cfg(all(test, feature = "local-stt"))]
mod latency {
    use super::*;
    #[test]
    #[ignore]
    fn warm_model_latency() {
        let dir = dirs::data_dir().unwrap().join("com.flo.flow/models");
        let model = ["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin", "ggml-base.en.bin"].iter().map(|f| dir.join(f)).find(|p| p.exists());
        let Some(model) = model else { return };
        let w = LocalWhisper::default();
        let clip = vec![0.0f32; 16_000 * 2];
        let t = std::time::Instant::now();
        let _ = w.transcribe(&model, &clip, "en", "");
        let cold = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let _ = w.transcribe(&model, &clip, "en", "");
        let warm = t.elapsed().as_millis();
        println!("model {}: first transcription cold {cold} ms, warm {warm} ms", model.file_name().unwrap().to_string_lossy());
        assert!(w.is_loaded());
    }
}

#[cfg(test)]
mod language_tests {
    use super::*;

    fn s(v: &[(&str, f32)]) -> Vec<(String, f32)> {
        v.iter().map(|(l, p)| (l.to_string(), *p)).collect()
    }

    #[test]
    fn probabilities_from_logits() {
        let p = lang_probs(&s(&[("en", 2.0), ("hi", 2.0), ("gu", f32::NEG_INFINITY)]));
        assert!((p[0].1 - 0.5).abs() < 1e-6 && (p[1].1 - 0.5).abs() < 1e-6 && p[2].1 == 0.0);
        assert!(lang_probs(&[]).is_empty());
    }

    #[test]
    fn hindi_and_gujarati_are_one_decoder_choice() {
        let g = by_decoder(&s(&[("en", 0.45), ("hi", 0.35), ("gu", 0.2)]));
        assert_eq!(g[0].0, "hi");
        assert!((g[0].1 - 0.55).abs() < 1e-6);
        assert_eq!(g[1], ("en".to_string(), 0.45));
        // Hindi + Gujarati is a sure Indic decode, even though neither alone is
        let g = by_decoder(&s(&[("hi", 0.5), ("gu", 0.4), ("en", 0.1)]));
        assert!(g[0].1 >= LID_SURE);
    }

    #[test]
    fn a_confident_translation_loses_to_the_real_transcript() {
        // cmd6 in the dictation benchmark: Hindi speech the detector called English
        let opts = vec![
            ("en".to_string(), ("I love you.".to_string(), 0.73)),
            ("hi".to_string(), ("कल सुबह नौ बजे मुझे याद दिलाना।".to_string(), 0.92)),
        ];
        assert_eq!(opts[pick_decode(&opts, None)].0, "hi");
        // ... even right after an English dictation (the margin for the previous language is small)
        assert_eq!(opts[pick_decode(&opts, Some("en"))].0, "hi");
        // English speech: the Hindi decoder's gibberish is less sure, or not in Devanagari at all
        let opts = vec![
            ("en".to_string(), ("Add a to do to call Priya tomorrow.".to_string(), 0.70)),
            ("hi".to_string(), ("".to_string(), 0.84)),
        ];
        assert_eq!(opts[pick_decode(&opts, Some("hi"))].0, "en");
        let opts = vec![
            ("hi".to_string(), ("Hey team, quick update.".to_string(), 0.94)),
            ("en".to_string(), ("Hey team, quick update.".to_string(), 0.90)),
        ];
        assert_eq!(opts[pick_decode(&opts, None)].0, "en");
        // a loop never wins
        let opts = vec![("en".to_string(), ("tri".repeat(30), 0.99)), ("hi".to_string(), ("ठीक है।".to_string(), 0.6))];
        assert_eq!(opts[pick_decode(&opts, Some("en"))].0, "hi");
    }

    #[test]
    fn a_close_call_stays_in_the_previous_language() {
        // Hinglish with its first word cut off, after Hindi: the English translation scored higher
        let opts = vec![
            ("en".to_string(), ("This is the presentation of the day.".to_string(), 0.94)),
            ("hi".to_string(), ("आपको बोलो की प्रेजेंटेशन कल तक भेज दे.".to_string(), 0.86)),
        ];
        assert_eq!(opts[pick_decode(&opts, Some("hi"))].0, "hi");
        // Gujarati counts as the Hindi decoder's language
        assert_eq!(opts[pick_decode(&opts, Some("gu"))].0, "hi");
        // without a previous language the surer one wins
        assert_eq!(opts[pick_decode(&opts, None)].0, "en");
    }

    #[test]
    fn dictation_trusts_english_alone_only_when_the_detector_is_near_certain() {
        // the user's report: Hinglish dictations typed in English, the detector at 0.8–0.96 "en"
        for p in [0.42, 0.66, 0.8, 0.9, 0.96] {
            assert_eq!(auto_plan("en", p, true), AutoPlan::Both, "en at {p}");
        }
        // clearly English stays one decode (fast)
        assert_eq!(auto_plan("en", 0.97, true), AutoPlan::Other);
        assert_eq!(auto_plan("en", 0.999, true), AutoPlan::Other);
        assert_eq!(auto_plan("hi", 0.85, true), AutoPlan::Hindi);
        assert_eq!(auto_plan("gu", 0.9, true), AutoPlan::Hindi);
        assert_eq!(auto_plan("hi", 0.6, true), AutoPlan::Both);
        // no Hindi among the languages: nothing to guard
        assert_eq!(auto_plan("en", 0.5, false), AutoPlan::Other);
    }

    #[test]
    fn a_sure_english_decode_of_hinglish_is_checked_against_hindi() {
        // Hinglish read with an English accent (the detector at 1.0 "en"), from the benchmark
        assert!(english_in_doubt("Cal Meeting Mindec Bejdina.", 0.9, 2.0));
        assert!(english_in_doubt("Mujhe kal subah daas baje yaad dilah deena.", 0.9, 3.0));
        assert!(english_in_doubt("Send the deck.", 0.4, 1.0));
        assert!(!english_in_doubt("zero.", 0.37, 0.8));
        // noisy English with an unsure decoder but English words: one decode, kept
        assert!(!english_in_doubt("I have to do to call FIA tomorrow.", 0.64, 2.8));
        // 3.7 s of Hinglish heard as two English words
        assert!(english_in_doubt("I'm sorry.", 0.9, 3.7));
        assert!(!english_in_doubt("I'm sorry.", 0.9, 1.0));
        // plain English, names and all, stays one decode
        for t in [
            "Send the updated deck to Rahul by Friday evening.",
            "Okay, mark the invoice task as done and open Slack.",
            "Can we move the stand-up to 10:30? Also, Sneha from Bengaluru is joining the call.",
            "Thanks for the update. I'll review the Figma designs tonight and share feedback on Slack.",
            "Please review the pull request before lunch and leave comments on the authentication changes.",
            "",
        ] {
            assert!(!english_in_doubt(t, 0.9, 4.0), "{t}");
        }
    }

    #[test]
    fn a_dictated_english_translation_of_hindi_never_wins() {
        // Hinglish dictation ("kal meeting mein deck bhej dena"): the English decode is a
        // translation, more confident than the transcript, after an English dictation
        let o = vec![
            ("hi".to_string(), ("कल मीटिंग में डेक भेज देना।".to_string(), 0.81)),
            ("en".to_string(), ("Send the deck in tomorrow's meeting.".to_string(), 0.95)),
        ];
        assert_eq!(pick_meeting_decode(&o, Some("en")), 0);
        // a quiet clip: both decodes less sure, the translation still loses
        let o = vec![
            ("hi".to_string(), ("आज शाम को मैं थोड़ा बिज़ी हूँ, कल बात करते हैं।".to_string(), 0.52)),
            ("en".to_string(), ("I'm a bit busy this evening, let's talk tomorrow.".to_string(), 0.66)),
        ];
        assert_eq!(pick_meeting_decode(&o, Some("en")), 0);
        // the English decoder kept the Hindi words (Hinglish in Roman letters): Hindi it is
        let o = vec![
            ("hi".to_string(), ("यार मुझे लगता है फीचर नेक्स्ट वीक शिप करना चाहिए".to_string(), 0.7)),
            ("en".to_string(), ("Yaar mujhe lagta hai feature next week ship karna chahiye".to_string(), 0.8)),
        ];
        assert_eq!(pick_meeting_decode(&o, Some("en")), 0);
        // English speech: the Hindi decoder writes English words in Devanagari, English wins
        let o = vec![
            ("hi".to_string(), ("सेंड द अपडेटेड डेक टू राहुल बाय फ्राइडे।".to_string(), 0.7)),
            ("en".to_string(), ("Send the updated deck to Rahul by Friday.".to_string(), 0.9)),
        ];
        assert_eq!(pick_meeting_decode(&o, Some("en")), 1);
    }

    #[test]
    fn dictation_writes_hindi_the_way_the_setting_says() {
        assert_eq!(HindiScript::from_setting(&crate::model::Settings::default().dictation_hindi), HindiScript::Hinglish);
        assert_eq!(dictation_script("auto", HindiScript::Hinglish), HindiScript::Hinglish);
        // translation is the AI's job: the speech model gives the accurate Hinglish transcript
        assert_eq!(dictation_script("auto", HindiScript::English), HindiScript::Hinglish);
        assert_eq!(dictation_script("auto", HindiScript::Devanagari), HindiScript::Devanagari);
        assert_eq!(dictation_script(HINGLISH, HindiScript::Hinglish), HindiScript::Hinglish);
        // the explicitly picked Hindi language keeps Devanagari
        assert_eq!(dictation_script("hi", HindiScript::Hinglish), HindiScript::Devanagari);
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    use crate::model::Settings;

    fn installed() -> Settings {
        Settings { onboarded: true, stt_provider: "local".into(), stt_model: DEFAULT_MODEL.into(), ..Default::default() }
    }

    #[test]
    fn the_hinglish_model_is_fetched_for_hindi_speakers_unless_they_chose_otherwise() {
        let hindi = Settings { language: "auto".into(), auto_languages: vec!["en".into(), "hi".into()], ..installed() };
        assert!(hinglish_auto_fetch(&hindi, true, 24.0, false, false));
        // already there, deleted by the user, a model picked by hand, too little memory
        assert!(!hinglish_auto_fetch(&hindi, true, 24.0, true, false));
        assert!(!hinglish_auto_fetch(&hindi, true, 24.0, false, true));
        assert!(!hinglish_auto_fetch(&Settings { stt_model_explicit: true, ..hindi.clone() }, true, 24.0, false, false));
        assert!(!hinglish_auto_fetch(&hindi, true, 8.0, false, false));
        assert!(!hinglish_auto_fetch(&hindi, false, 24.0, false, false));
        // English only, Devanagari / English transcripts, a cloud engine, setup not done
        assert!(!hinglish_auto_fetch(&Settings { auto_languages: vec!["en".into()], ..hindi.clone() }, true, 24.0, false, false));
        assert!(!hinglish_auto_fetch(&Settings { meeting_hindi: "devanagari".into(), ..hindi.clone() }, true, 24.0, false, false));
        assert!(!hinglish_auto_fetch(&Settings { stt_provider: "sarvam".into(), ..hindi.clone() }, true, 24.0, false, false));
        assert!(!hinglish_auto_fetch(&Settings { onboarded: false, ..hindi.clone() }, true, 24.0, false, false));
        // Hinglish chosen as the language counts as speaking Hindi
        assert!(hinglish_auto_fetch(&Settings { language: "hi-en".into(), ..installed() }, true, 16.0, false, false));
        assert_eq!(meeting_models(&hindi), vec![HINGLISH_MODEL]);
        let df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 482797652 407798532 3906250 100% /System/Volumes/Data\n";
        assert!((parse_df_free_gb(df).unwrap() - 4.0).abs() < 0.01);
        assert_eq!(parse_df_free_gb(""), None);
        assert!(meeting_models(&Settings { meeting_hindi: "english".into(), ..hindi }).is_empty());
    }

    #[test]
    fn hindi_speakers_on_16gb_get_large_v3_and_english_only_stays_on_turbo() {
        let hindi = Settings { language: "auto".into(), auto_languages: vec!["en".into(), "hi".into()], ..installed() };
        assert_eq!(upgrade_target_for(&hindi, true, 16.0), Some(UPGRADE_MODEL_INDIC));
        assert_eq!(upgrade_target_for(&hindi, true, 8.0), Some(UPGRADE_MODEL));
        let hinglish = Settings { language: "hi-en".into(), ..installed() };
        assert_eq!(upgrade_target_for(&hinglish, true, 32.0), Some(UPGRADE_MODEL_INDIC));
        let english = Settings { language: "en".into(), ..installed() };
        assert_eq!(upgrade_target_for(&english, true, 32.0), Some(UPGRADE_MODEL));
        // an automatic Turbo upgrade moves on; a model the user picked never does
        let auto_turbo = Settings { stt_model: UPGRADE_MODEL.into(), ..hindi.clone() };
        assert_eq!(upgrade_target_for(&auto_turbo, true, 16.0), Some(UPGRADE_MODEL_INDIC));
        assert_eq!(upgrade_target_for(&Settings { stt_model_explicit: true, ..auto_turbo.clone() }, true, 16.0), None);
        assert_eq!(upgrade_target_for(&Settings { language: "en".into(), ..auto_turbo }, true, 16.0), None);
        assert!(spec(UPGRADE_MODEL_INDIC).is_some());
    }

    #[test]
    fn starter_moves_up_after_setup_on_a_capable_machine() {
        assert_eq!(upgrade_target_for(&installed(), true, 8.0), Some(UPGRADE_MODEL));
        assert!(spec(UPGRADE_MODEL).is_some_and(|m| m.tier == Tier::Advanced));
    }

    #[test]
    fn no_upgrade_during_setup_on_weak_machines_or_for_cloud_engines() {
        assert_eq!(upgrade_target_for(&Settings { onboarded: false, ..installed() }, true, 8.0), None);
        assert_eq!(upgrade_target_for(&installed(), false, 8.0), None);
        assert_eq!(upgrade_target_for(&Settings { stt_provider: "groq".into(), ..installed() }, true, 8.0), None);
    }

    #[test]
    fn a_model_the_user_picked_is_never_replaced() {
        assert_eq!(upgrade_target_for(&Settings { stt_model_explicit: true, ..installed() }, true, 8.0), None);
        for m in ["large-v3-turbo-q5_0", "large-v3-turbo", "base.en", "small"] {
            assert_eq!(upgrade_target_for(&Settings { stt_model: m.into(), ..installed() }, true, 8.0), None, "{m}");
        }
    }

    #[test]
    fn existing_installs_on_the_starter_are_migrated() {
        // a settings file from 0.1.7 / 0.1.8: no sttModelExplicit key
        let s: Settings = serde_json::from_str(r#"{"settingsVersion":7,"onboarded":true,"sttProvider":"local","sttModel":"small-q5_1"}"#).unwrap();
        assert!(!s.stt_model_explicit);
        assert_eq!(upgrade_target_for(&s, true, 8.0), Some(UPGRADE_MODEL));
    }

    #[test]
    fn machine_check() {
        assert!(can_run_large(8.0, false));
        assert!(can_run_large(4.0, true));
        assert!(!can_run_large(4.0, false));
        assert!(!can_run_large(0.0, false)); // unknown RAM on an Intel Mac / PC: stay on the starter
        assert!(total_ram_gb() > 1.0);
    }

    #[test]
    fn auto_defaults_to_english_and_hindi() {
        assert_eq!(Settings::default().auto_languages, vec!["en".to_string(), "hi".to_string()]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hallucinations_filtered_only_when_short() {
        assert!(is_hallucination("Thank you.", 1.0));
        assert!(!is_hallucination("Thank you.", 6.0));
        assert!(is_hallucination("  ", 10.0));
        assert!(!is_hallucination("Send the deck", 1.0));
    }

    #[test]
    fn audio_ctx_scales_with_clip_length() {
        assert_eq!(audio_ctx_for(1.0), 384); // floor keeps very short clips accurate
        assert_eq!(audio_ctx_for(6.0), 384);
        assert_eq!(audio_ctx_for(10.0), 576);
        assert_eq!(audio_ctx_for(40.0), 1500);
        assert_eq!(audio_ctx_for(20.0) % 64, 0);
    }

    #[test]
    fn detects_degenerate_repetition() {
        assert!(is_degenerate(&"it's ".repeat(40)));
        assert!(is_degenerate("the end of the world, it's the end of the world, it's the end of the world, it's the end"));
        assert!(is_degenerate("a-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri")); // glued, no spaces
        assert!(is_degenerate(&"tri".repeat(30))); // fully glued loop
        assert!(!is_degenerate("Send the deck to Rahul by Friday and let's meet at six tomorrow afternoon."));
        assert!(!is_degenerate("The quarterly report covers revenue, retention and the roadmap for next year.")); // normal long speech
        assert!(!is_degenerate("okay")); // too short to judge
    }

    #[test]
    fn collapses_a_sentence_said_twice() {
        assert_eq!(
            collapse_repeat("आज का काम पूरा हो गया, अब घर जा रहा हूं. आज का काम पूरा हो गया, अब घर जा रहा हूं."),
            "आज का काम पूरा हो गया, अब घर जा रहा हूं."
        );
        // a real repeated phrase inside a longer sentence is left alone
        assert_eq!(collapse_repeat("very very good idea"), "very very good idea");
        assert_eq!(collapse_repeat("Send the deck to Rahul by Friday."), "Send the deck to Rahul by Friday.");
    }

    #[test]
    fn collapses_decoder_loops_seen_in_the_benchmark() {
        // real outputs of the clip-sized decoder (stt_bench sweep)
        assert_eq!(collapse_loops("Yes. Yes. Yes. Yes. Yes. Yes. Yes."), "Yes.");
        assert_eq!(collapse_loops("Okay, send it. Send it. Send it. Send it."), "Okay, send it.");
        assert_eq!(collapse_loops("Send the deck to Rahul by Friday. Send the deck to Rahul by Friday. Send"), "Send the deck to Rahul by Friday.");
        assert_eq!(
            collapse_loops("आज का काम पूरा हो गया, अब घर जा रहा हूं. आज का काम पूरा हो गया, अब घर जा रहा हू"),
            "आज का काम पूरा हो गया, अब घर जा रहा हूं."
        );
        assert_eq!(collapse_loops("आपाईनी है। आपाईनी है। आपाईनी है। आपाईनी है।"), "आपाईनी है।");
        assert_eq!(collapse_loops("तमे साजी बजारमान थी दूद अने शात भाजी लाब शो. अने शात भाजी लाब शो."), "तमे साजी बजारमान थी दूद अने शात भाजी लाब शो.");
        assert_eq!(collapse_loops("आपको प्राव प्राव प्राव प्राव प्र"), "आपको प्राव");
        assert_eq!(collapse_loops("Chayat call the bank tomorrow at 11 at 11 at 11 at 11."), "Chayat call the bank tomorrow at 11.");
    }

    #[test]
    fn prompt_keeps_dictionary_but_drops_context_in_another_script() {
        let p = "Flo, Rahul, Dhanteras, Slack. Hey team, quick update on the release before Thursday.";
        assert_eq!(prompt_for("hi", p), "Flo, Rahul, Dhanteras, Slack.");
        assert_eq!(prompt_for("en", p), p);
        let hi = "Flo, Rahul. कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।";
        assert_eq!(prompt_for("hi", hi), hi);
        assert_eq!(prompt_for("en", hi), "Flo, Rahul.");
        assert_eq!(prompt_for("gu", hi), "Flo, Rahul.");
        assert_eq!(prompt_for("hi", ""), "");
        let long_dict = "Flo, Rahul Mehta, Dhanteras, Slack, Anthropic, Notion. Send the deck to the whole team today.";
        assert_eq!(prompt_for("hi", long_dict), "Flo, Rahul Mehta, Dhanteras, Slack, Anthropic, Notion.");
    }

    #[test]
    fn acceptance_needs_confidence_script_and_no_loop() {
        assert!(accepted(&("Send the deck to Rahul by Friday.".into(), 0.95), "en", ACCEPT, 3.0));
        assert!(!accepted(&("Send the deck to Rahul by Friday.".into(), 0.4), "en", ACCEPT, 3.0));
        // real fast-path garbage from the benchmark: Gujarati audio decoded as Polish
        assert!(!accepted(&("Z- była jsem mi-tinyng o moze index of milie czytaki.".into(), 0.84), "gu", ACCEPT, 3.0));
        assert!(!accepted(&("KAL SUBAH 10 BAJE MEETING HAY".into(), 0.84), "hi", ACCEPT, 3.0));
        assert!(!accepted(&("it's ".repeat(30), 0.9), "en", ACCEPT, 3.0));
        // 12.7 s of Hindi that came back as its first sentence only
        assert!(!accepted(&("इस हफटे हमें तीन काम पूरे करने हैं।".into(), 0.95), "hi", ACCEPT, 12.7));
        assert!(accepted(&("इस हफटे हमें तीन काम पूरे करने हैं।".into(), 0.95), "hi", ACCEPT, 3.0));
    }

    #[test]
    fn token_cap_leaves_room_for_real_speech() {
        assert_eq!(max_tokens_for(1.0, "en"), 32);
        assert!(max_tokens_for(3.0, "hi") >= 80); // ~10 words of Devanagari
        assert_eq!(max_tokens_for(60.0, "hi"), 224);
    }

    #[test]
    fn real_repetition_in_speech_survives() {
        for t in [
            "Send the deck to Rahul by Friday.",
            "very very good idea",
            "No, no, I meant the other file.",
            "I said yes. Then she said yes.",
            "Thank you. Thank you so much.",
            "कल सुबह 10 बजे मीटिंग है, सब को याद दिला देना.",
        ] {
            assert_eq!(collapse_loops(t), t);
        }
    }

    #[test]
    fn plausibility_catches_wrong_language_decodes() {
        // real wrong-language outputs from the benchmark
        assert!(!plausible("झाल झाल झाल झाल", "hi"));
        assert!(!plausible("", "hi"));
        assert!(!plausible("Today's work is full of people. I'm going to go home.", "hi"));
        assert!(!plausible("जो द्राफ एक टेम विशिंग एक बाप्पी धनते रस?", "en"));
        // right-language outputs pass, including Hinglish (English words inside Hindi)
        assert!(plausible("मुझी राहुल को invoice भेजना है।", "hi"));
        assert!(plausible("Send the deck to Rahul by Friday", "en"));
        assert!(plausible("કાલે મીટિંગ છે", "gu"));
        assert!(plausible("ok", "en"));
    }

    #[test]
    fn empty_decode_is_never_confident() {
        assert_eq!(mean_confidence(&[]), 0.0);
        assert!((mean_confidence(&[0.9, 0.7]) - 0.8).abs() < 1e-6);
        assert!(mean_confidence(&[0.2, 0.3]) < CONFIDENT);
    }

    #[test]
    fn finnish_detected_falls_back_to_an_allowed_language() {
        // regression: "Suurin suurin kautta." — Whisper's top pick was Finnish for English speech
        let scored = vec![("fi".to_string(), 4.1), ("en".to_string(), 3.0), ("hi".to_string(), 1.2), ("cy".to_string(), 3.5)];
        let allowed = allowed_languages(&["en".into(), "hi".into(), "gu".into()]);
        assert_eq!(pick_allowed_language(&scored, &allowed).as_deref(), Some("en"));
        // Hindi still wins when it scores best among the allowed
        let scored = vec![("fi".to_string(), 4.1), ("en".to_string(), 1.0), ("hi".to_string(), 3.2)];
        assert_eq!(pick_allowed_language(&scored, &allowed).as_deref(), Some("hi"));
        // nothing allowed was scored → the first allowed language, never Finnish
        assert_eq!(pick_allowed_language(&[("fi".to_string(), 4.1)], &allowed).as_deref(), Some("en"));
    }

    #[test]
    fn allowed_languages_default_to_english_and_hindi() {
        assert_eq!(allowed_languages(&[]), vec!["en", "hi"]);
        assert_eq!(allowed_languages(&["auto".into(), " ".into()]), vec!["en", "hi"]);
        assert_eq!(allowed_languages(&["EN".into(), "gu".into(), "en".into()]), vec!["en", "gu"]);
    }

    #[test]
    fn language_pick_skips_non_finite_logits() {
        let s = vec![("en".to_string(), 1.5), ("hi".to_string(), 3.2), ("gu".to_string(), f32::NAN)];
        assert_eq!(pick_language(&s).as_deref(), Some("hi"));
        assert_eq!(pick_language(&[]), None);
    }

    #[test]
    fn best_candidate_ignores_languages_outside_the_set() {
        // ids: en=0, hi=1, ur=2, gu=3 — Urdu scores highest but isn't a candidate → Hindi wins
        let probs = [0.10, 0.30, 0.55, 0.05];
        let id = |c: &str| ["en", "hi", "ur", "gu"].iter().position(|x| *x == c);
        let cands: Vec<String> = ["en", "hi", "gu"].iter().map(|s| s.to_string()).collect();
        assert_eq!(best_candidate(&probs, &cands, id).as_deref(), Some("hi"));
        // unknown codes are skipped, not a panic
        let odd: Vec<String> = vec!["xx".into(), "en".into()];
        assert_eq!(best_candidate(&probs, &odd, id).as_deref(), Some("en"));
        assert_eq!(best_candidate(&probs, &[], id), None);
    }

    #[test]
    fn a_sentence_followed_by_its_own_cut_off_copy_is_kept_once() {
        // real Hindi-decoder output for a Gujarati clip (ElevenLabs "gu3"): one copy and the
        // start of another, without a full stop between them
        let raw = "तमें सांजे बजारमाथी दूद अने शाक भाजी लाऊशो, तमें सांजे बजारमाथी दूद अने शाक भ";
        assert_eq!(collapse_loops(raw), "तमें सांजे बजारमाथी दूद अने शाक भाजी लाऊशो,");
        // ordinary speech that happens to repeat a few words stays
        let t = "I want to go home, I want to go now";
        assert_eq!(collapse_loops(t), t);
    }

    #[test]
    fn gujarati_is_decoded_by_the_hindi_decoder() {
        assert_eq!(decoder_lang("gu"), "hi");
        assert_eq!(decoder_lang("hi"), "hi");
        assert_eq!(decoder_lang("en"), "en");
        // Gujarati context reaches the Hindi decoder in Devanagari instead of being dropped
        let p = whisper_prompt("gu", "Flo, Rahul. આજે મીટિંગ છે અને હું ઘરે જાઉં છું.");
        assert!(p.contains("आजे मीटिंग छे"), "{p}");
        assert!(!p.chars().any(|c| ('\u{0A80}'..='\u{0AFF}').contains(&c)), "{p}");
        assert_eq!(whisper_prompt("en", "Flo, Rahul"), "Flo, Rahul");
    }

    #[test]
    fn hindi_decodes_of_gujarati_speech_are_recognised() {
        // real Hindi-decoder outputs for Gujarati clips (ElevenLabs + macOS say, language bench)
        for t in [
            "काले सवारे दस वागे मीटिंग छे बधाने याद करावी दे जो",
            "चली सवारी 10 वागे मीतिंग छे.",
            "मारे राहुलने इन्वोईस मोकलवानू छे।",
            "आजनु काम पूरुं थैग्यूं, हवे हुं घरे जांग छूं.",
            "तमे साजी बजारमान थी दूद अने शात भाजी लाब शो?",
        ] {
            assert!(looks_gujarati(t), "{t}");
        }
        // Hindi and Hinglish stay Hindi; English isn't Gujarati
        for t in [
            "मुझे राहुल को आज शाम तक इन्वोईस भेजना है।",
            "कल meeting है, please सबको याद दिला देना और report भी भेज देना.",
            "काले बादल आ गए हैं।",
            "आज का काम पूरा हो गया, अब घर जा रहा हूँ।",
            "Please send the invoice.",
        ] {
            assert!(!looks_gujarati(t), "{t}");
        }
    }

    #[test]
    fn auto_settles_hindi_vs_gujarati_from_what_was_said() {
        let all: Vec<String> = vec!["en".into(), "hi".into(), "gu".into()];
        let en_hi: Vec<String> = vec!["en".into(), "hi".into()];
        let gu_text = "काले सवारे दस वागे मीटिंग छे";
        let hi_text = "मुझे राहुल को इनवॉइस भेजना है।";
        // Whisper's detector calls Gujarati "hi": the words decide
        assert_eq!(final_language("hi", gu_text, &all), "gu");
        assert_eq!(final_language("hi", hi_text, &all), "hi");
        assert_eq!(final_language("gu", hi_text, &all), "hi");
        // Gujarati not among the user's languages: Hindi stays Hindi
        assert_eq!(final_language("hi", gu_text, &en_hi), "hi");
        // English is never re-labelled
        assert_eq!(final_language("en", "Please send it.", &all), "en");
        // a Gujarati-only setup keeps Gujarati even without marker words
        assert_eq!(final_language("gu", "राहुल", &["en".to_string(), "gu".to_string()]), "gu");
    }

    #[test]
    fn transcripts_come_out_in_the_script_of_their_language() {
        assert_eq!(in_script("काले सवारे 10 वागे meeting छे.", "gu"), "કાલે સવારે 10 વાગે meeting છે.");
        assert_eq!(in_script("मुझे इनवॉइस भेजना है।", "hi"), "मुझे इनवॉइस भेजना है।");
        assert_eq!(in_script("Send it.", "en"), "Send it.");
        assert_eq!(in_script("કાલે મીટિંગ છે", "gu"), "કાલે મીટિંગ છે");
    }

    #[test]
    fn cloud_gujarati_ends_in_gujarati_script() {
        let all: Vec<String> = vec!["en".into(), "hi".into(), "gu".into()];
        // Groq runs Whisper large-v3: same broken Gujarati decoder, so it hears Gujarati via Hindi
        assert_eq!(cloud_language("groq", "gu"), "hi");
        assert_eq!(cloud_language("openai", "gu"), "gu");
        assert_eq!(cloud_language("sarvam", "gu"), "gu");
        assert_eq!(cloud_language("groq", "en"), "en");
        // whatever comes back in Devanagari for Gujarati is rescripted; native output is untouched
        assert_eq!(cloud_script("काले मीटिंग छे", "gu", &all), "કાલે મીટિંગ છે");
        assert_eq!(cloud_script("કાલે મીટિંગ છે", "gu", &all), "કાલે મીટિંગ છે");
        assert_eq!(cloud_script("काले सवारे मीटिंग छे", "auto", &all), "કાલે સવારે મીટિંગ છે");
        assert_eq!(cloud_script("मुझे भेजना है", "auto", &all), "मुझे भेजना है");
        assert_eq!(cloud_script("Send it.", "auto", &all), "Send it.");
        assert_eq!(cloud_script("काले सवारे मीटिंग छे", "hi", &all), "काले सवारे मीटिंग छे");
    }

    #[test]
    fn sarvam_language_mapping() {
        assert_eq!(sarvam_params("gu"), ("gu-IN", "transcribe"));
        assert_eq!(sarvam_params("hi"), ("hi-IN", "transcribe"));
        assert_eq!(sarvam_params("auto"), ("unknown", "transcribe"));
        assert_eq!(sarvam_params(HINGLISH), ("unknown", "translit"));
    }

    fn model_dir(files: &[&str]) -> PathBuf {
        let d = std::env::temp_dir().join(format!("flo-models-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        for f in files {
            std::fs::write(d.join(f), b"x").unwrap();
        }
        d
    }

    #[test]
    fn redundant_full_precision_copy_goes_only_when_quantized_is_in_use() {
        let d = model_dir(&["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin"]);
        // full precision in use → never deleted
        assert_eq!(remove_redundant(&d, "large-v3-turbo"), 0);
        assert!(d.join("ggml-large-v3-turbo.bin").exists());
        assert_eq!(remove_redundant(&d, "large-v3-turbo-q5_0"), 1624);
        assert!(!d.join("ggml-large-v3-turbo.bin").exists());
        assert!(d.join("ggml-large-v3-turbo-q5_0.bin").exists());
        std::fs::remove_dir_all(d).ok();
        // quantized selected but not downloaded → keep the full one (it's all there is)
        let d = model_dir(&["ggml-large-v3-turbo.bin"]);
        assert_eq!(remove_redundant(&d, "large-v3-turbo-q5_0"), 0);
        assert!(d.join("ggml-large-v3-turbo.bin").exists());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn free_up_space_keeps_the_meeting_hinglish_model() {
        let d = model_dir(&["ggml-large-v3-turbo-q5_0.bin", "ggml-hinglish-apex.bin", "ggml-small-q5_1.bin"]);
        let ids: Vec<&str> = unused_installed(&d, "large-v3-turbo-q5_0", &[HINGLISH_MODEL]).iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["small-q5_1"]);
        assert_eq!(remove_unused(&d, "large-v3-turbo-q5_0", &[HINGLISH_MODEL]), 190);
        assert!(d.join("ggml-hinglish-apex.bin").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn meeting_decodes_never_keep_a_translation_of_hindi() {
        // "मैं आपसे बात कर रही थी" decoded in English is a fluent translation, more confident
        let opts = |hi: &str, hc: f32, en: &str, ec: f32| vec![("hi".to_string(), (hi.to_string(), hc)), ("en".to_string(), (en.to_string(), ec))];
        let o = opts("मैं आपसे बात कर रही थी, लेकिन कॉल कट गया।", 0.82, "I was talking to you, but the call got cut.", 0.93);
        assert_eq!(pick_meeting_decode(&o, Some("en")), 0);
        // English decoded as Hinglish in Roman letters: the speech was Hindi
        let o = opts("मुझे राहुल इनवॉइस", 0.6, "Mujhe Rahul ko invoice bhejna hai", 0.9);
        assert_eq!(pick_meeting_decode(&o, Some("en")), 0);
        // English speech forced through the Hindi decoder: English words in Devanagari lose
        let o = opts("आई विल सेंड द अपडेटेड डेक टू एवरीवन बाय फ्राइडे", 0.8, "I will send the updated deck to everyone by Friday.", 0.95);
        assert_eq!(pick_meeting_decode(&o, Some("hi")), 1);
        // an empty or looping Hindi decode never wins on words alone
        let o = opts("है है है है है है है है है है है है", 0.9, "Okay.", 0.7);
        assert_eq!(pick_meeting_decode(&o, None), 1);
        assert!(hindi_word_share("कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।") >= HINDI_WORDS_MIN);
        assert!(hindi_word_share("आई विल सेंड द डेक") < HINDI_WORDS_MIN);
        assert_eq!(hindi_word_share(""), 0.0);
    }

    #[test]
    fn hindi_script_setting() {
        assert_eq!(HindiScript::from_setting("hinglish"), HindiScript::Hinglish);
        assert_eq!(HindiScript::from_setting(""), HindiScript::Hinglish);
        assert_eq!(HindiScript::from_setting("devanagari"), HindiScript::Devanagari);
        assert_eq!(HindiScript::from_setting("english"), HindiScript::English);
        assert_eq!(crate::model::Settings::default().meeting_hindi, "hinglish");
        assert_eq!(crate::model::Settings::default().meeting_summary_language, "auto");
    }

    #[test]
    fn free_up_space_keeps_the_model_in_use() {
        let d = model_dir(&["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin", "ggml-base.en.bin"]);
        assert_eq!(unused_installed(&d, "base.en", &[]).len(), 2);
        assert_eq!(remove_unused(&d, "base.en", &[]), 574 + 1624);
        assert!(d.join("ggml-base.en.bin").exists());
        assert!(unused_installed(&d, "base.en", &[]).is_empty());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn prefers_the_quantized_model_only_when_downloaded() {
        let mut s = crate::model::Settings { stt_model: "large-v3-turbo".into(), ..Default::default() };
        let none = model_dir(&["ggml-large-v3-turbo.bin"]);
        assert!(!prefer_quantized(&mut s, &none));
        assert_eq!(s.stt_model, "large-v3-turbo");
        let both = model_dir(&["ggml-large-v3-turbo.bin", "ggml-large-v3-turbo-q5_0.bin"]);
        assert!(prefer_quantized(&mut s, &both));
        assert_eq!(s.stt_model, "large-v3-turbo-q5_0");
        // only once: picking full precision again afterwards is respected
        s.stt_model = "large-v3-turbo".into();
        assert!(!prefer_quantized(&mut s, &both));
        assert_eq!(s.stt_model, "large-v3-turbo");
        std::fs::remove_dir_all(none).ok();
        std::fs::remove_dir_all(both).ok();
    }

    #[test]
    fn catalogue_paths() {
        let d = Path::new("/tmp/m");
        assert_eq!(model_path(d, "base.en").unwrap(), Path::new("/tmp/m/ggml-base.en.bin"));
        assert!(list_models(d).iter().all(|m| !m.installed));
    }
}

#[cfg(test)]
mod join_tests {
    use super::*;

    const REAL: &str = "Create attractive PDF with round corners with green radians of proper combination of colors.Like light theme I want,Light, Thim and Yellow color Light, Thim and Light Blue color Light, Thim and Light Blue color Light, Thim and Light Blue color";

    #[test]
    fn head_already_collapses_a_loop_inside_one_decode() {
        let out = collapse_loops(REAL);
        assert_eq!(out.matches("Light Blue color").count(), 1, "{out}");
    }

    #[test]
    fn a_pause_inside_a_number_or_address_is_not_a_sentence_break() {
        let j = |v: &[&str]| join_chunks(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        // seen in the dictation bench: "version 2 point 4", "gmail dot com" with a pause
        assert_eq!(j(&["We shipped version 2.", "4 on Monday."]), "We shipped version 2.4 on Monday.");
        assert_eq!(j(&["Write to priya.sharma@gmail.", "com today."]), "Write to priya.sharma@gmail.com today.");
        // numbers, addresses and abbreviations inside one decode survive the loop check
        let t = "Version 2.4 is out. Mail priya.sharma@gmail.com by 3 p.m. today, see flo.app/docs.";
        assert_eq!(collapse_loops(t), t);
        assert_eq!(collapse_loops("Send it. Send it."), "Send it.");
        // real sentence breaks stay
        assert_eq!(j(&["I have 2.", "Four more are coming."]), "I have 2. Four more are coming.");
        assert_eq!(j(&["I'll be there.", "in the morning"]), "I'll be there. in the morning");
        assert_eq!(j(&["Send it.", "Then call."]), "Send it. Then call.");
    }

    #[test]
    fn pause_chunks_that_echo_the_previous_one_are_dropped() {
        // each sentence is decoded on its own with the previous one as Whisper's prompt; a short or
        // unclear chunk comes back as a copy of that prompt, and the copies were simply joined
        let chunks: Vec<String> = [
            "Create attractive PDF with round corners with green radians of proper combination of colors.",
            "Like light theme I want,",
            "Light, Thim and Yellow color",
            "Light, Thim and Light Blue color",
            "Light, Thim and Light Blue color",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let out = join_chunks(&chunks);
        assert_eq!(out.matches("Light Blue color").count(), 1, "{out}");
        assert!(out.contains("Yellow color"));
        // ordinary speech stays
        assert_eq!(join_chunks(&["It is very very good.".into(), "Thanks.".into()]), "It is very very good. Thanks.");
    }
}

#[cfg(test)]
mod tier_tests {
    use super::*;

    fn dir_with(files: &[&str]) -> PathBuf {
        let d = std::env::temp_dir().join(format!("flo-tiers-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        for f in files {
            std::fs::write(d.join(f), b"x").unwrap();
        }
        d
    }

    #[test]
    fn the_default_is_the_small_multilingual_starter() {
        let s = starter();
        assert_eq!(s.id, DEFAULT_MODEL);
        assert_eq!(s.tier, Tier::Starter);
        assert!(s.languages.contains("Hindi"), "the starter must hear Hindi / Hinglish");
        // smaller than every advanced model, and under 200 MB so setup is quick
        assert!(s.size_mb < 200);
        assert!(advanced().iter().all(|m| m.size_mb > s.size_mb));
        assert_eq!(MODELS.iter().filter(|m| m.tier == Tier::Starter).count(), 1);
        assert_eq!(crate::model::Settings::default().stt_model, DEFAULT_MODEL);
    }

    #[test]
    fn advanced_models_are_bigger_and_listed_smallest_first() {
        let adv = advanced();
        assert!(adv.len() >= 2);
        assert!(adv.iter().any(|m| m.id == "large-v3-turbo-q5_0"));
        assert!(adv.windows(2).all(|w| w[0].size_mb <= w[1].size_mb));
        assert!(adv.iter().all(|m| !m.speed.is_empty() && !m.accuracy.is_empty()));
    }

    #[test]
    fn every_model_has_a_unique_id_and_file_and_plain_copy() {
        let mut ids: Vec<_> = MODELS.iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), MODELS.len());
        for m in MODELS {
            match m.engine {
                Engine::Whisper => assert!(m.file.starts_with("ggml-") && m.file.ends_with(".bin") && m.parts.is_empty() != m.hf_convert),
                Engine::Onnx(_) => assert!(!m.hf_convert),
            }
            if !m.parts.is_empty() {
                {
                    // a pinned revision (never a moving branch) and every part pinned by size + hash
                    assert!(m.rev.len() == 40 && m.rev.chars().all(|c| c.is_ascii_hexdigit()), "{}", m.id);
                    assert!(!m.file.ends_with(".part"));
                    for p in m.parts {
                        assert!(p.bytes > 0 && p.sha256.len() == 64 && p.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{}", p.name);
                    }
                    let mb = parts_bytes(m.parts) as f64 / 1e6;
                    assert!((mb - m.size_mb as f64).abs() < 2.0, "{} size {} vs parts {mb:.0}", m.id, m.size_mb);
                    assert!(!m.best_for.is_empty());
                }
            }
            // downloads only from the model hub on the egress allow-list
            let url = url::Url::parse(&m.url(m.file)).unwrap();
            assert!(crate::egress::is_allowed(url.host_str().unwrap(), crate::egress::Purpose::ModelDownload, false), "{url}");
            for t in [m.label, m.speed, m.accuracy, m.languages] {
                assert!(!t.contains('—') && !t.contains('–'), "no em dashes in app copy: {t}");
            }
        }
    }

    #[test]
    fn onnx_models_are_folders_routed_by_language() {
        let d = dir_with(&["ggml-small-q5_1.bin"]);
        let parakeet = model_path(&d, "parakeet-tdt-0.6b-v2").unwrap();
        std::fs::create_dir_all(&parakeet).unwrap();
        assert_eq!(onnx_family(&parakeet), Some(crate::asr_onnx::Family::NemoTransducer));
        assert_eq!(onnx_family(&d.join("ggml-small-q5_1.bin")), None);
        let langs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // English goes to Parakeet
        assert_eq!(route_model(&parakeet, "en", &[]), Some(parakeet.clone()));
        assert_eq!(route_model(&parakeet, "auto", &langs(&["en"])), Some(parakeet.clone()));
        // Hindi, Hinglish, Gujarati, and Auto with Hindi in it go to the best Whisper on disk
        let small = d.join("ggml-small-q5_1.bin");
        for l in ["hi", "hi-en", "gu"] {
            assert_eq!(route_model(&parakeet, l, &[]), Some(small.clone()), "{l}");
        }
        assert_eq!(route_model(&parakeet, "auto", &langs(&["en", "hi"])), Some(small.clone()));
        std::fs::write(d.join("ggml-large-v3-turbo-q5_0.bin"), b"x").unwrap();
        assert_eq!(route_model(&parakeet, "hi", &[]), Some(d.join("ggml-large-v3-turbo-q5_0.bin")));
        // Whisper models hear everything (base.en only English)
        assert_eq!(route_model(&small, "hi", &[]), Some(small.clone()));
        assert!(!model_hears(&d.join("ggml-base.en.bin"), "hi", &[]));
        std::fs::remove_dir_all(&d).ok();
        // nothing that hears Hindi downloaded
        let lone = dir_with(&[]);
        let p = model_path(&lone, "parakeet-tdt-0.6b-v2").unwrap();
        assert_eq!(route_model(&p, "hi", &[]), None);
        std::fs::remove_dir_all(lone).ok();
    }

    #[test]
    fn hinglish_goes_to_the_hinglish_model_once_downloaded() {
        let d = dir_with(&["ggml-large-v3-turbo-q5_0.bin"]);
        let turbo = d.join("ggml-large-v3-turbo-q5_0.bin");
        let apex = d.join("ggml-hinglish-apex.bin");
        assert_eq!(route_model(&turbo, "hi-en", &[]), Some(turbo.clone()));
        assert!(!needs_routing(&turbo, "hi-en"));
        std::fs::write(&apex, b"x").unwrap();
        // Hinglish clips go to it, whichever model is chosen
        assert!(needs_routing(&turbo, "hi-en"));
        assert_eq!(route_model(&turbo, "hi-en", &[]), Some(apex.clone()));
        assert_eq!(route_model(&apex, "hi-en", &[]), Some(apex.clone()));
        // everything else stays with Whisper (it writes Hindi in Roman letters and is weaker at English)
        assert!(!needs_routing(&turbo, "en") && !needs_routing(&turbo, "auto"));
        for l in ["en", "hi", "auto", "gu"] {
            assert_eq!(route_model(&apex, l, &["en".to_string(), "hi".to_string()]), Some(turbo.clone()), "{l}");
        }
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn a_model_folder_is_installed_only_once_complete_and_is_removed_whole() {
        let d = dir_with(&[]);
        // a half-finished download sits in "<folder>.part" and doesn't count
        std::fs::create_dir_all(d.join("parakeet-tdt-0.6b-v2-int8.part")).unwrap();
        let row = |d: &Path| list_models(d).into_iter().find(|m| m.id == "parakeet-tdt-0.6b-v2");
        if crate::asr_onnx::supported() {
            assert!(!row(&d).unwrap().installed);
            std::fs::create_dir_all(d.join("parakeet-tdt-0.6b-v2-int8")).unwrap();
            std::fs::write(d.join("parakeet-tdt-0.6b-v2-int8").join("tokens.txt"), b"x").unwrap();
            let r = row(&d).unwrap();
            assert!(r.installed && r.engine == "onnx" && r.best_for == "English");
            assert_eq!(remove_unused(&d, DEFAULT_MODEL, &[]), 661);
            assert!(!d.join("parakeet-tdt-0.6b-v2-int8").exists());
        } else {
            assert!(row(&d).is_none(), "not offered where it can't run");
        }
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn sha256_of_a_file() {
        let d = dir_with(&[]);
        std::fs::write(d.join("f"), b"abc").unwrap();
        assert_eq!(sha256_file(&d.join("f")).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn list_models_reports_tier_and_notes() {
        let d = dir_with(&["ggml-small-q5_1.bin"]);
        let list = list_models(&d);
        let s = list.iter().find(|m| m.id == DEFAULT_MODEL).unwrap();
        assert!(s.installed);
        assert_eq!(s.tier, "starter");
        assert!(list.iter().any(|m| m.tier == "advanced" && !m.installed));
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn setup_keeps_an_installed_choice_and_otherwise_falls_back_to_the_starter() {
        let d = dir_with(&["ggml-large-v3-turbo-q5_0.bin"]);
        assert_eq!(setup_model("large-v3-turbo-q5_0", &d), "large-v3-turbo-q5_0");
        // chosen but never downloaded (an old default) → start with the small one
        assert_eq!(setup_model("large-v3-turbo", &d), DEFAULT_MODEL);
        assert_eq!(setup_model("nonsense", &d), DEFAULT_MODEL);
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn a_retry_resumes_only_when_the_server_honours_the_range() {
        assert_eq!(resume_offset(0, 200), 0);
        assert_eq!(resume_offset(1000, 206), 1000);
        // the server ignored the Range header and sent the whole file → start over
        assert_eq!(resume_offset(1000, 200), 0);
    }

    #[test]
    fn a_cut_off_download_is_not_complete() {
        assert!(download_complete(100, Some(100)));
        assert!(!download_complete(60, Some(100)));
        assert!(download_complete(100, None));
        assert!(!download_complete(0, None));
    }

    #[test]
    fn progress_is_emitted_often_enough_for_a_live_speed() {
        // every 250 ms or every 2 MB, whichever comes first
        assert!(should_emit(3 * 1024 * 1024, 0, 10));
        assert!(should_emit(1024, 0, 300));
        assert!(!should_emit(1024, 0, 50));
    }
}
