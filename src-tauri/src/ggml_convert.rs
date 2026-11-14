//! A Hugging Face Whisper fine-tune (safetensors) turned into a whisper.cpp model (ggml, f16) on
//! this computer. Some of the best models for Indian users, like Oriserve's Whisper Hindi2Hinglish
//! (Hindi speech written in Roman letters), are only published in the Hugging Face format, and Flo
//! only downloads from the official repos. The conversion is what whisper.cpp's
//! `convert-h5-to-ggml.py` does, without Python: hyper-parameters, mel filters and vocabulary come
//! from an official ggml file of the same base model (only its first ~0.6 MB is needed), and every
//! tensor is renamed and written as f16 (f32 for biases, norms and positional embeddings).
use anyhow::{anyhow, bail, Context, Result};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

const GGML_MAGIC: u32 = 0x6767_6d6c;

/// Hyper-parameters in a ggml Whisper header, in file order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hparams {
    pub n_vocab: i32,
    pub n_audio_ctx: i32,
    pub n_audio_state: i32,
    pub n_audio_head: i32,
    pub n_audio_layer: i32,
    pub n_text_ctx: i32,
    pub n_text_state: i32,
    pub n_text_head: i32,
    pub n_text_layer: i32,
    pub n_mels: i32,
    pub ftype: i32,
}

impl Hparams {
    /// Tensors a model with these dimensions has (15 per encoder block + 7, 24 per decoder block + 4).
    pub fn tensor_count(&self) -> usize {
        15 * self.n_audio_layer as usize + 7 + 24 * self.n_text_layer as usize + 4
    }
}

fn i32_at(b: &[u8], off: usize) -> Result<i32> {
    b.get(off..off + 4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or_else(|| anyhow!("template header cut short"))
}

/// The header of an official ggml file (magic, hparams, mel filters, vocabulary), with its file
/// type set to f16 for the converted model. `bytes` needs only the start of the file.
pub fn template_header(bytes: &[u8]) -> Result<(Vec<u8>, Hparams)> {
    if i32_at(bytes, 0)? as u32 != GGML_MAGIC {
        bail!("not a whisper.cpp model");
    }
    let mut v = [0i32; 11];
    for (k, x) in v.iter_mut().enumerate() {
        *x = i32_at(bytes, 4 + 4 * k)?;
    }
    let mut off = 48;
    let (n_mel, n_fft) = (i32_at(bytes, off)?, i32_at(bytes, off + 4)?);
    off += 8 + 4 * (n_mel.max(0) as usize) * (n_fft.max(0) as usize);
    let n_words = i32_at(bytes, off)?;
    off += 4;
    for _ in 0..n_words {
        off += 4 + i32_at(bytes, off)?.max(0) as usize;
    }
    if off > bytes.len() {
        bail!("template header cut short");
    }
    let mut header = bytes[..off].to_vec();
    header[44..48].copy_from_slice(&1i32.to_le_bytes()); // ftype: f16
    let hp = Hparams { n_vocab: v[0], n_audio_ctx: v[1], n_audio_state: v[2], n_audio_head: v[3], n_audio_layer: v[4], n_text_ctx: v[5], n_text_state: v[6], n_text_head: v[7], n_text_layer: v[8], n_mels: v[9], ftype: 1 };
    Ok((header, hp))
}

/// The fine-tune's config.json must describe the same network as the template.
pub fn check_config(config_json: &str, hp: &Hparams) -> Result<()> {
    let c: serde_json::Value = serde_json::from_str(config_json)?;
    let g = |k: &str| c[k].as_i64().unwrap_or(-1) as i32;
    let ok = g("vocab_size") == hp.n_vocab
        && g("max_source_positions") == hp.n_audio_ctx
        && g("d_model") == hp.n_audio_state
        && g("encoder_attention_heads") == hp.n_audio_head
        && g("encoder_layers") == hp.n_audio_layer
        && g("max_target_positions") == hp.n_text_ctx
        && g("decoder_attention_heads") == hp.n_text_head
        && g("decoder_layers") == hp.n_text_layer
        && g("num_mel_bins") == hp.n_mels;
    if !ok {
        bail!("the downloaded model isn't the Whisper size Flo expected");
    }
    Ok(())
}

/// Hugging Face tensor name → whisper.cpp (OpenAI) name; None for tensors whisper.cpp doesn't
/// keep (`proj_out.weight`, tied to the token embedding).
pub fn ggml_name(hf: &str) -> Option<String> {
    let fixed = match hf {
        "model.encoder.embed_positions.weight" => Some("encoder.positional_embedding"),
        "model.decoder.embed_positions.weight" => Some("decoder.positional_embedding"),
        "model.decoder.embed_tokens.weight" => Some("decoder.token_embedding.weight"),
        "model.encoder.layer_norm.weight" => Some("encoder.ln_post.weight"),
        "model.encoder.layer_norm.bias" => Some("encoder.ln_post.bias"),
        "model.decoder.layer_norm.weight" => Some("decoder.ln.weight"),
        "model.decoder.layer_norm.bias" => Some("decoder.ln.bias"),
        _ => None,
    };
    if let Some(f) = fixed {
        return Some(f.into());
    }
    let rest = hf.strip_prefix("model.")?;
    let (side, rest) = rest.split_once('.')?;
    if side != "encoder" && side != "decoder" {
        return None;
    }
    if let Some(conv) = rest.strip_prefix("conv") {
        return Some(format!("{side}.conv{conv}"));
    }
    let rest = rest.strip_prefix("layers.")?;
    let (i, part) = rest.split_once('.')?;
    i.parse::<u32>().ok()?;
    const MAP: &[(&str, &str)] = &[
        ("encoder_attn_layer_norm", "cross_attn_ln"),
        ("self_attn_layer_norm", "attn_ln"),
        ("final_layer_norm", "mlp_ln"),
        ("encoder_attn.q_proj", "cross_attn.query"),
        ("encoder_attn.k_proj", "cross_attn.key"),
        ("encoder_attn.v_proj", "cross_attn.value"),
        ("encoder_attn.out_proj", "cross_attn.out"),
        ("self_attn.q_proj", "attn.query"),
        ("self_attn.k_proj", "attn.key"),
        ("self_attn.v_proj", "attn.value"),
        ("self_attn.out_proj", "attn.out"),
        ("fc1", "mlp.0"),
        ("fc2", "mlp.2"),
    ];
    for (a, b) in MAP {
        if let Some(suffix) = part.strip_prefix(a).filter(|s| s.starts_with('.')) {
            return Some(format!("{side}.blocks.{i}.{b}{suffix}"));
        }
    }
    None
}

/// whisper.cpp keeps 1-D tensors, the conv biases and the positional embeddings in f32.
pub fn keeps_f32(name: &str, n_dims: usize) -> bool {
    n_dims < 2 || matches!(name, "encoder.conv1.bias" | "encoder.conv2.bias" | "encoder.positional_embedding" | "decoder.positional_embedding")
}

/// ggml dimensions for a tensor of Hugging Face `shape` (innermost first; conv biases are [1, n]).
pub fn ggml_dims(name: &str, shape: &[usize]) -> Vec<usize> {
    if name.ends_with("conv1.bias") || name.ends_with("conv2.bias") {
        return vec![1, shape.iter().product()];
    }
    shape.iter().rev().copied().collect()
}

/// IEEE half from single, round to nearest even (what numpy's astype(float16) does).
pub fn f32_to_f16(x: f32) -> u16 {
    let b = x.to_bits();
    let sign = ((b >> 16) & 0x8000) as u16;
    let exp = ((b >> 23) & 0xff) as i32;
    let man = b & 0x7f_ffff;
    if exp == 0xff {
        return sign | 0x7c00 | if man != 0 { 0x200 } else { 0 };
    }
    let e = exp - 127 + 15;
    if e >= 0x1f {
        return sign | 0x7c00;
    }
    if e <= 0 {
        if e < -10 {
            return sign;
        }
        let m = man | 0x80_0000;
        let shift = (14 - e) as u32;
        let half = 1u32 << (shift - 1);
        let rest = m & ((1u32 << shift) - 1);
        let mut h = m >> shift;
        if rest > half || (rest == half && (h & 1) == 1) {
            h += 1;
        }
        return sign | h as u16;
    }
    let mut h = ((e as u32) << 10) | (man >> 13);
    let rest = man & 0x1fff;
    if rest > 0x1000 || (rest == 0x1000 && (h & 1) == 1) {
        h += 1; // may carry into the exponent, which is still the right rounding
    }
    sign | h as u16
}

fn to_f32(dtype: &str, raw: &[u8]) -> Result<Vec<f32>> {
    Ok(match dtype {
        "F32" => raw.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect(),
        "BF16" => raw.chunks_exact(2).map(|c| f32::from_bits((u16::from_le_bytes([c[0], c[1]]) as u32) << 16)).collect(),
        "F16" => raw.chunks_exact(2).map(|c| f16_to_f32(u16::from_le_bytes([c[0], c[1]]))).collect(),
        d => bail!("unsupported tensor type {d}"),
    })
}

fn f16_to_f32(h: u16) -> f32 {
    let sign = ((h & 0x8000) as u32) << 16;
    let exp = ((h >> 10) & 0x1f) as u32;
    let man = (h & 0x3ff) as u32;
    let bits = match exp {
        0 if man == 0 => sign,
        0 => {
            // subnormal: normalize
            let mut e = 127 - 15 + 1;
            let mut m = man;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
        0x1f => sign | 0x7f80_0000 | (man << 13),
        _ => sign | ((exp + 127 - 15) << 23) | (man << 13),
    };
    f32::from_bits(bits)
}

/// Convert `safetensors` into a ggml model at `out` with `header` (from `template_header`).
/// Writes to `<out>.tmp` and renames, so `out` only ever exists complete. Returns the tensor count.
pub fn convert(safetensors: &Path, header: &[u8], hp: &Hparams, out: &Path) -> Result<usize> {
    let mut f = std::fs::File::open(safetensors).context("open safetensors")?;
    let mut n8 = [0u8; 8];
    f.read_exact(&mut n8)?;
    let n = u64::from_le_bytes(n8) as usize;
    if n > 64 << 20 {
        bail!("safetensors header too large");
    }
    let mut hb = vec![0u8; n];
    f.read_exact(&mut hb)?;
    let meta: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&hb)?;
    let base = 8 + n as u64;
    let tmp = out.with_extension("bin.tmp");
    let mut w = BufWriter::with_capacity(8 << 20, std::fs::File::create(&tmp)?);
    w.write_all(header)?;
    let mut written = std::collections::HashSet::new();
    let mut entries: Vec<(&String, &serde_json::Value)> = meta.iter().filter(|(k, _)| k.as_str() != "__metadata__").collect();
    entries.sort_by_key(|(_, v)| v["data_offsets"][0].as_u64().unwrap_or(0));
    for (hf, v) in entries {
        let Some(name) = ggml_name(hf) else {
            if hf == "proj_out.weight" {
                continue;
            }
            bail!("unexpected tensor {hf}");
        };
        let shape: Vec<usize> = v["shape"].as_array().ok_or_else(|| anyhow!("no shape for {hf}"))?.iter().filter_map(|d| d.as_u64().map(|d| d as usize)).collect();
        let (a, b) = (v["data_offsets"][0].as_u64().unwrap_or(0), v["data_offsets"][1].as_u64().unwrap_or(0));
        let mut raw = vec![0u8; (b - a) as usize];
        f.seek(SeekFrom::Start(base + a))?;
        f.read_exact(&mut raw)?;
        let vals = to_f32(v["dtype"].as_str().unwrap_or(""), &raw)?;
        drop(raw);
        let count: usize = shape.iter().product();
        if vals.len() != count {
            bail!("tensor {hf} has the wrong size");
        }
        let dims = ggml_dims(&name, &shape);
        let f32_out = keeps_f32(&name, shape.len());
        w.write_all(&(dims.len() as i32).to_le_bytes())?;
        w.write_all(&(name.len() as i32).to_le_bytes())?;
        w.write_all(&(if f32_out { 0i32 } else { 1 }).to_le_bytes())?;
        for d in &dims {
            w.write_all(&(*d as i32).to_le_bytes())?;
        }
        w.write_all(name.as_bytes())?;
        let mut buf = Vec::with_capacity(vals.len() * if f32_out { 4 } else { 2 });
        for x in vals {
            if f32_out {
                buf.extend_from_slice(&x.to_le_bytes());
            } else {
                buf.extend_from_slice(&f32_to_f16(x).to_le_bytes());
            }
        }
        w.write_all(&buf)?;
        written.insert(name);
    }
    w.flush()?;
    drop(w);
    if written.len() != hp.tensor_count() {
        let _ = std::fs::remove_file(&tmp);
        bail!("converted {} tensors, expected {}", written.len(), hp.tensor_count());
    }
    std::fs::rename(&tmp, out)?;
    Ok(written.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_map_like_whisper_cpps_converter() {
        assert_eq!(ggml_name("model.encoder.layers.3.self_attn.k_proj.weight").unwrap(), "encoder.blocks.3.attn.key.weight");
        assert_eq!(ggml_name("model.decoder.layers.0.encoder_attn.q_proj.bias").unwrap(), "decoder.blocks.0.cross_attn.query.bias");
        assert_eq!(ggml_name("model.decoder.layers.1.encoder_attn_layer_norm.weight").unwrap(), "decoder.blocks.1.cross_attn_ln.weight");
        assert_eq!(ggml_name("model.decoder.layers.1.self_attn_layer_norm.bias").unwrap(), "decoder.blocks.1.attn_ln.bias");
        assert_eq!(ggml_name("model.encoder.layers.31.fc2.weight").unwrap(), "encoder.blocks.31.mlp.2.weight");
        assert_eq!(ggml_name("model.encoder.layers.31.final_layer_norm.bias").unwrap(), "encoder.blocks.31.mlp_ln.bias");
        assert_eq!(ggml_name("model.encoder.conv2.bias").unwrap(), "encoder.conv2.bias");
        assert_eq!(ggml_name("model.encoder.embed_positions.weight").unwrap(), "encoder.positional_embedding");
        assert_eq!(ggml_name("model.decoder.embed_tokens.weight").unwrap(), "decoder.token_embedding.weight");
        assert_eq!(ggml_name("proj_out.weight"), None);
        assert_eq!(ggml_name("model.encoder.layers.x.fc1.weight"), None);
    }

    #[test]
    fn layout_follows_whisper_cpp() {
        assert_eq!(ggml_dims("encoder.conv1.bias", &[1280]), vec![1, 1280]);
        assert_eq!(ggml_dims("encoder.conv1.weight", &[1280, 128, 3]), vec![3, 128, 1280]);
        assert_eq!(ggml_dims("encoder.positional_embedding", &[1500, 1280]), vec![1280, 1500]);
        assert!(keeps_f32("encoder.positional_embedding", 2) && keeps_f32("encoder.conv1.bias", 1) && keeps_f32("decoder.ln.weight", 1));
        assert!(!keeps_f32("decoder.token_embedding.weight", 2) && !keeps_f32("encoder.conv1.weight", 3));
        let hp = Hparams { n_vocab: 51866, n_audio_ctx: 1500, n_audio_state: 1280, n_audio_head: 20, n_audio_layer: 32, n_text_ctx: 448, n_text_state: 1280, n_text_head: 20, n_text_layer: 4, n_mels: 128, ftype: 1 };
        assert_eq!(hp.tensor_count(), 587); // large-v3-turbo
    }

    #[test]
    fn half_precision_rounds_like_numpy() {
        for (x, h) in [(0.0f32, 0x0000u16), (1.0, 0x3c00), (-2.0, 0xc000), (65504.0, 0x7bff), (1e6, 0x7c00), (6.0e-8, 0x0001), (1.0e-9, 0x0000), (0.1, 0x2e66), (f32::INFINITY, 0x7c00)] {
            assert_eq!(f32_to_f16(x), h, "{x}");
        }
        // ties go to even
        assert_eq!(f32_to_f16(f32::from_bits(0x3f80_1000)), 0x3c00);
        assert_eq!(f32_to_f16(f32::from_bits(0x3f80_3000)), 0x3c02);
        for h in [0x3c00u16, 0x2e66, 0x0001, 0xc000, 0x7bff] {
            assert_eq!(f32_to_f16(f16_to_f32(h)), h);
        }
    }

    #[test]
    fn template_header_is_copied_with_an_f16_file_type() {
        let mut b = vec![];
        b.extend_from_slice(&GGML_MAGIC.to_le_bytes());
        for v in [51866, 1500, 1280, 20, 32, 448, 1280, 20, 4, 128, 2008] {
            b.extend_from_slice(&(v as i32).to_le_bytes());
        }
        b.extend_from_slice(&2i32.to_le_bytes()); // 2 x 3 mel filters
        b.extend_from_slice(&3i32.to_le_bytes());
        b.extend(std::iter::repeat_n(0u8, 24));
        b.extend_from_slice(&2i32.to_le_bytes()); // two words
        for w in ["hi", "there"] {
            b.extend_from_slice(&(w.len() as i32).to_le_bytes());
            b.extend_from_slice(w.as_bytes());
        }
        let len = b.len();
        b.extend_from_slice(b"tensors follow");
        let (h, hp) = template_header(&b).unwrap();
        assert_eq!(h.len(), len);
        assert_eq!(i32_at(&h, 44).unwrap(), 1);
        assert_eq!((hp.n_audio_layer, hp.n_text_layer, hp.n_mels), (32, 4, 128));
        assert!(template_header(&b[..60]).is_err());
        let cfg = r#"{"vocab_size":51866,"max_source_positions":1500,"d_model":1280,"encoder_attention_heads":20,"encoder_layers":32,"max_target_positions":448,"decoder_attention_heads":20,"decoder_layers":4,"num_mel_bins":128}"#;
        check_config(cfg, &hp).unwrap();
        assert!(check_config(&cfg.replace("\"decoder_layers\":4", "\"decoder_layers\":32"), &hp).is_err());
    }

    /// The real thing: FLO_HF_SAFETENSORS=…/model.safetensors FLO_GGML_TEMPLATE=…/ggml-large-v3-turbo-q5_0.bin
    /// FLO_GGML_OUT=/tmp/x.bin cargo test --release --lib convert_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn convert_real() {
        let (Ok(st), Ok(tpl), Ok(out)) = (std::env::var("FLO_HF_SAFETENSORS"), std::env::var("FLO_GGML_TEMPLATE"), std::env::var("FLO_GGML_OUT")) else { return };
        let mut head = vec![0u8; 1 << 20];
        let n = std::fs::File::open(&tpl).unwrap().read(&mut head).unwrap();
        let (h, hp) = template_header(&head[..n]).unwrap();
        let t = std::time::Instant::now();
        let k = convert(Path::new(&st), &h, &hp, Path::new(&out)).unwrap();
        println!("{k} tensors in {} ms", t.elapsed().as_millis());
    }
}
