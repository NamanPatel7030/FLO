//! Microphone capture → 16 kHz mono f32, with live level metering.
use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const TARGET_RATE: u32 = 16_000;

struct Shared {
    buf: Vec<f32>,
    rate: u32,
}

pub struct Recorder {
    shared: Arc<Mutex<Shared>>,
    stop_tx: mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Recorder {
    /// Start recording from the default input device. `on_level` receives 0..1 ~30×/s.
    pub fn start(on_level: impl Fn(f32) + Send + 'static) -> Result<Self> {
        let shared = Arc::new(Mutex::new(Shared { buf: Vec::new(), rate: TARGET_RATE }));
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        let sh = shared.clone();
        // cpal::Stream is !Send on macOS → own it on a dedicated thread.
        let thread = std::thread::Builder::new().name("flo-audio".into()).spawn(move || {
            let res = (|| -> Result<cpal::Stream> {
                let host = cpal::default_host();
                let dev = host.default_input_device().ok_or_else(|| anyhow!("No microphone found"))?;
                let cfg = dev.default_input_config()?;
                let channels = cfg.channels() as usize;
                sh.lock().rate = cfg.sample_rate().0;
                let level = Arc::new(Mutex::new(LevelMeter::new(on_level)));
                let err_fn = |e| log::error!("audio stream error: {e}");
                let stream_cfg: cpal::StreamConfig = cfg.clone().into();
                macro_rules! build {
                    ($t:ty, $conv:expr) => {{
                        let sh2 = sh.clone();
                        let lv = level.clone();
                        dev.build_input_stream(
                            &stream_cfg,
                            move |data: &[$t], _| {
                                let mono: Vec<f32> = data
                                    .chunks(channels)
                                    .map(|f| f.iter().map(|s| $conv(*s)).sum::<f32>() / channels as f32)
                                    .collect();
                                lv.lock().feed(&mono);
                                sh2.lock().buf.extend_from_slice(&mono);
                            },
                            err_fn,
                            None,
                        )?
                    }};
                }
                let stream = match cfg.sample_format() {
                    cpal::SampleFormat::F32 => build!(f32, |s: f32| s),
                    cpal::SampleFormat::I16 => build!(i16, |s: i16| s as f32 / i16::MAX as f32),
                    cpal::SampleFormat::U16 => build!(u16, |s: u16| (s as f32 - 32768.0) / 32768.0),
                    cpal::SampleFormat::I32 => build!(i32, |s: i32| s as f32 / i32::MAX as f32),
                    f => return Err(anyhow!("unsupported sample format {f:?}")),
                };
                stream.play()?;
                Ok(stream)
            })();
            match res {
                Ok(stream) => {
                    let _ = ready_tx.send(Ok(()));
                    let _ = stop_rx.recv();
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })?;
        ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| anyhow!("microphone did not start"))??;
        Ok(Self { shared, stop_tx, thread: Some(thread) })
    }

    /// Drain everything captured so far, resampled to 16 kHz.
    pub fn take_samples(&self) -> Vec<f32> {
        let mut s = self.shared.lock();
        let raw = std::mem::take(&mut s.buf);
        resample(&raw, s.rate, TARGET_RATE)
    }

    pub fn stop(mut self) -> Vec<f32> {
        let _ = self.stop_tx.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.take_samples()
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

struct LevelMeter<F: Fn(f32)> {
    cb: F,
    acc: f64,
    n: usize,
    last: Instant,
    smooth: f32,
}

impl<F: Fn(f32)> LevelMeter<F> {
    fn new(cb: F) -> Self {
        Self { cb, acc: 0.0, n: 0, last: Instant::now(), smooth: 0.0 }
    }
    fn feed(&mut self, s: &[f32]) {
        for x in s {
            self.acc += (*x as f64) * (*x as f64);
        }
        self.n += s.len();
        if self.last.elapsed() >= Duration::from_millis(33) && self.n > 0 {
            let rms = (self.acc / self.n as f64).sqrt() as f32;
            // perceptual scaling: speech RMS ~0.02–0.2
            let v = ((rms * 8.0).sqrt()).clamp(0.0, 1.0);
            self.smooth = self.smooth * 0.5 + v * 0.5;
            (self.cb)(self.smooth);
            self.acc = 0.0;
            self.n = 0;
            self.last = Instant::now();
        }
    }
}

/// Linear-interpolation resampler (adequate for speech → STT).
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos.floor() as usize;
            let i1 = (i0 + 1).min(input.len() - 1);
            let frac = (pos - i0 as f64) as f32;
            input[i0] * (1.0 - frac) + input[i1] * frac
        })
        .collect()
}

/// Drop leading/trailing silence (keeps 0.25 s padding). Saves cloud STT seconds and local compute.
pub fn trim_silence(s: &[f32]) -> Vec<f32> {
    let win = (TARGET_RATE / 50) as usize; // 20 ms
    if s.len() < win * 4 {
        return s.to_vec();
    }
    let loud = |c: &[f32]| rms(c) > 0.012;
    let chunks: Vec<&[f32]> = s.chunks(win).collect();
    let first = chunks.iter().position(|c| loud(c));
    let last = chunks.iter().rposition(|c| loud(c));
    match (first, last) {
        (Some(a), Some(b)) => {
            let pad = (TARGET_RATE / 4) as usize;
            let start = (a * win).saturating_sub(pad);
            let end = ((b + 1) * win + pad).min(s.len());
            s[start..end].to_vec()
        }
        _ => s.to_vec(),
    }
}

/// RMS of a buffer — used to skip silent recordings.
/// Milliseconds of speech-level audio (voice-activity detection). We only transcribe clips with
/// real speech so Whisper can't hallucinate a sentence out of silence/background hum.
/// Adapts to the noise floor: a frame counts as "voiced" only if it's clearly above it.
pub fn voiced_ms(s: &[f32]) -> u32 {
    let win = (TARGET_RATE / 50) as usize; // 20 ms frames
    if s.len() < win {
        return 0;
    }
    let energies: Vec<f32> = s.chunks(win).map(rms).collect();
    // noise floor = 20th percentile of frame energy
    let mut sorted = energies.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let floor = sorted[sorted.len() / 5];
    // voiced = clearly above the floor AND above an absolute speech threshold
    let thresh = (floor * 3.0).max(0.015);
    let voiced = energies.iter().filter(|e| **e > thresh).count();
    (voiced as u32) * 20
}

pub fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// 16-bit PCM WAV bytes for cloud STT upload.
pub fn encode_wav(samples: &[f32], rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cur = std::io::Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cur, spec)?;
        for s in samples {
            w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
        }
        w.finalize()?;
    }
    Ok(cur.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_length() {
        let v: Vec<f32> = (0..48_000).map(|i| (i as f32 / 100.0).sin()).collect();
        let r = resample(&v, 48_000, 16_000);
        assert_eq!(r.len(), 16_000);
        assert!((r[100] - v[300]).abs() < 1e-3);
    }

    #[test]
    fn trims_silence_with_padding() {
        let mut v = vec![0.0f32; 16_000]; // 1 s silence
        v.extend((0..8_000).map(|i| (i as f32 / 20.0).sin() * 0.3)); // 0.5 s speech
        v.extend(vec![0.0f32; 32_000]); // 2 s silence
        let t = trim_silence(&v);
        assert!(t.len() <= 16_000 && t.len() > 8_000, "len {}", t.len()); // 0.5 s speech + 2×0.25 s padding
        assert_eq!(trim_silence(&[0.0; 10]).len(), 10);
    }

    #[test]
    fn voiced_ms_detects_speech_not_silence() {
        let sr = TARGET_RATE as usize;
        // 2 s of near-silence (tiny noise) → ~0 voiced
        let mut silence: Vec<f32> = (0..2 * sr).map(|i| ((i as f32 * 0.7).sin()) * 0.002).collect();
        assert!(voiced_ms(&silence) < 120, "silence voiced {}", voiced_ms(&silence));
        // add 0.5 s of loud speech-level tone → clearly voiced
        silence.extend((0..sr / 2).map(|i| (i as f32 / 8.0).sin() * 0.25));
        assert!(voiced_ms(&silence) >= 300, "speech voiced {}", voiced_ms(&silence));
    }

    #[test]
    fn rms_and_wav() {
        assert_eq!(rms(&[]), 0.0);
        assert!((rms(&[0.5, -0.5]) - 0.5).abs() < 1e-6);
        let wav = encode_wav(&[0.0, 0.5, -0.5], 16_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(wav.len(), 44 + 6);
    }
}
