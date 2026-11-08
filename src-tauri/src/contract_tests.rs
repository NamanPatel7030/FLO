//! Real-backend smoke tests for the TS ↔ Rust contract.
//!
//! The Playwright suite runs against the browser mock (`src/lib/mock.ts`), so it can't
//! notice when the UI calls a command the real app never registered, or listens for an
//! event Rust never emits. These tests parse the sources and fail on exactly that.
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn walk(dir: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, exts, out);
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| exts.contains(&x)) {
            out.push(p);
        }
    }
}

/// UI sources that run against the real backend (mocks and unit tests excluded).
fn ui_sources() -> Vec<(PathBuf, String)> {
    let mut files = vec![];
    walk(&repo().join("src"), &["ts", "tsx"], &mut files);
    files
        .into_iter()
        .filter(|p| {
            let n = p.file_name().unwrap().to_string_lossy().to_lowercase();
            !n.starts_with("mock") && !n.contains(".test.") && !n.contains(".spec.")
        })
        .map(|p| {
            let s = std::fs::read_to_string(&p).unwrap();
            (p, s)
        })
        .collect()
}

fn rust_sources() -> Vec<(PathBuf, String)> {
    let mut files = vec![];
    walk(&repo().join("src-tauri/src"), &["rs"], &mut files);
    files
        .into_iter()
        .map(|p| {
            let s = std::fs::read_to_string(&p).unwrap();
            (p, s)
        })
        .collect()
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

/// Command names passed as a string literal to `call`, `invokeRaw` or `invoke`,
/// with or without a generic argument (which may itself contain parentheses).
pub(crate) fn invoked_commands(src: &str) -> BTreeSet<String> {
    let b = src.as_bytes();
    let mut out = BTreeSet::new();
    for kw in ["call", "invokeRaw", "invoke"] {
        let mut from = 0;
        while let Some(off) = src[from..].find(kw) {
            let start = from + off;
            from = start + kw.len();
            if start > 0 && (is_ident(b[start - 1]) || b[start - 1] == b'.') {
                continue;
            }
            let mut i = start + kw.len();
            if i < b.len() && is_ident(b[i]) {
                continue;
            }
            if i < b.len() && b[i] == b'<' {
                let mut depth = 0i32;
                while i < b.len() {
                    match b[i] {
                        b'<' => depth += 1,
                        b'>' => {
                            depth -= 1;
                            if depth == 0 {
                                i += 1;
                                break;
                            }
                        }
                        b'\n' | b';' => break,
                        _ => {}
                    }
                    i += 1;
                }
            }
            if i >= b.len() || b[i] != b'(' {
                continue;
            }
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i >= b.len() || b[i] != b'"' {
                continue;
            }
            let s = i + 1;
            let mut e = s;
            while e < b.len() && (b[e].is_ascii_lowercase() || b[e].is_ascii_digit() || b[e] == b'_') {
                e += 1;
            }
            if e < b.len() && b[e] == b'"' && e > s {
                out.insert(src[s..e].to_string());
            }
        }
    }
    out
}

/// Function names inside `tauri::generate_handler![...]`.
pub(crate) fn registered_commands(lib_rs: &str) -> BTreeSet<String> {
    let start = lib_rs.find("generate_handler![").expect("generate_handler! block") + "generate_handler![".len();
    let end = start + lib_rs[start..].find(']').unwrap();
    let body: String = lib_rs[start..end]
        .lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    body.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.starts_with("//"))
        .map(|s| s.rsplit("::").next().unwrap().to_string())
        .collect()
}

/// Every `"flo://…"` string literal in `src`.
fn flo_literals(src: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut from = 0;
    while let Some(off) = src[from..].find("\"flo://") {
        let s = from + off + 1;
        let e = s + src[s..].find('"').unwrap_or(0);
        from = s;
        let v = &src[s..e];
        if v.len() > "flo://".len() && v["flo://".len()..].bytes().all(|c| c.is_ascii_lowercase() || c == b'-') {
            out.insert(v.to_string());
        }
    }
    out
}

/// Is `event` emitted somewhere: an `emit` whose first argument (same or next two lines)
/// is the literal or a `const` holding it.
fn rust_emits(event: &str, rust: &[(PathBuf, String)]) -> bool {
    let lit = format!("\"{event}\"");
    let mut names: Vec<String> = vec![lit.clone()];
    for (_, s) in rust {
        for line in s.lines() {
            let t = line.trim_start();
            if t.contains("const ") && t.contains(&lit) {
                let after = &t[t.find("const ").unwrap() + 6..];
                let name: String = after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
                if !name.is_empty() {
                    names.push(name);
                }
            }
        }
    }
    for (_, s) in rust {
        let lines: Vec<&str> = s.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if !line.contains("emit") {
                continue;
            }
            let window = lines[i..(i + 3).min(lines.len())].join(" ");
            let window = &window[window.find("emit").unwrap()..];
            if names.iter().any(|n| {
                window.match_indices(n.as_str()).any(|(at, _)| {
                    let before = window.as_bytes().get(at.wrapping_sub(1)).copied().unwrap_or(b' ');
                    let after = window.as_bytes().get(at + n.len()).copied().unwrap_or(b' ');
                    n.starts_with('"') || (!is_ident(before) && !is_ident(after))
                })
            }) {
                return true;
            }
        }
    }
    false
}

/// Deep-link URLs (handled by the OS, not events) that may appear as literals in TS.
const DEEP_LINKS: &[&str] = &["flo://auth"];

#[test]
fn parser_handles_generics_and_raw_calls() {
    let src = r#"
      a: () => call<Settings>("get_settings"),
      b: () => call<import("./types").UpdateInfo>("check_update"),
      c: () => invokeRaw<{ state: string }>("account_google_start"),
      d: () => call("plain_one", { x }),
      e: (cmd) => invoke<T>(cmd, args),
      f: () => recall("not_a_command"),
      g: () => x.call("also_not"),
    "#;
    let got = invoked_commands(src);
    let want: BTreeSet<String> =
        ["get_settings", "check_update", "account_google_start", "plain_one"].iter().map(|s| s.to_string()).collect();
    assert_eq!(got, want);
    let reg = registered_commands("x.invoke_handler(tauri::generate_handler![\n a::one,\n two, // c\n b::c::three,\n])");
    assert!(reg.contains("one") && reg.contains("two") && reg.contains("three"));
}

#[test]
fn every_ui_command_is_registered_in_lib_rs() {
    let lib = std::fs::read_to_string(repo().join("src-tauri/src/lib.rs")).unwrap();
    let registered = registered_commands(&lib);
    assert!(registered.len() > 50, "parsed only {} commands from generate_handler!", registered.len());
    let mut missing: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut total = 0;
    for (path, src) in ui_sources() {
        for cmd in invoked_commands(&src) {
            total += 1;
            if !registered.contains(&cmd) {
                missing.entry(cmd).or_default().push(path.strip_prefix(repo()).unwrap().display().to_string());
            }
        }
    }
    assert!(total > 50, "found only {total} command calls in src/ — parser broken?");
    assert!(missing.is_empty(), "UI calls commands the real backend never registered: {missing:#?}");
}

#[test]
fn every_registered_command_is_a_tauri_command() {
    let lib = std::fs::read_to_string(repo().join("src-tauri/src/lib.rs")).unwrap();
    let rust = rust_sources();
    let mut missing = vec![];
    for name in registered_commands(&lib) {
        let sig = [format!("fn {name}("), format!("fn {name}<")];
        let found = rust.iter().any(|(_, s)| {
            s.lines().enumerate().any(|(i, l)| {
                sig.iter().any(|x| l.contains(x.as_str())) && {
                    let lines: Vec<&str> = s.lines().collect();
                    lines[i.saturating_sub(4)..i].iter().any(|p| p.contains("tauri::command"))
                }
            })
        });
        if !found {
            missing.push(name);
        }
    }
    assert!(missing.is_empty(), "registered but no #[tauri::command] fn found: {missing:?}");
}

#[test]
fn every_event_the_ui_listens_for_is_emitted_by_rust() {
    let rust = rust_sources();
    let mut events = BTreeSet::new();
    for (_, src) in ui_sources() {
        events.extend(flo_literals(&src));
    }
    assert!(events.contains("flo://state") && events.contains("flo://todos-changed"), "EV map not found: {events:?}");
    let silent: Vec<_> = events
        .iter()
        .filter(|e| !DEEP_LINKS.contains(&e.as_str()))
        .filter(|e| !rust_emits(e, &rust))
        .cloned()
        .collect();
    assert!(silent.is_empty(), "UI listens for events Rust never emits: {silent:?}");
}
