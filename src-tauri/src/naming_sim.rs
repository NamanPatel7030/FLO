//! Speaker-naming simulator (extends `meeting_sim`): a scripted call with named voices
//! (macOS `say`: Samantha plays "Priya", Daniel plays "Rahul"), a fake calendar invite and a
//! synthetic meeting-window feed (the "X is speaking" readings `meet_screen.rs` would take, with
//! the indicator's lag, misreads and gaps), run through the exact live pipeline
//! (Capture → Processor → LiveNames → recluster → `meeting::name_speakers`).
//!
//! `FLO_NAMING_OUT=report.json cargo test --release --lib naming_sim -- --ignored --nocapture`
//!
//! Reports per scenario: naming accuracy (share of call lines carrying the right real name),
//! wrong-name rate (lines carrying someone else's name: must be ~0), and time to first name
//! (live, seconds into the call when the first line showed a correct name).
#![cfg(all(test, feature = "local-stt", target_os = "macos"))]
use crate::meeting::{apply_call_labels, insert_sorted, name_changes, name_speakers, YOU};
use crate::meeting_sim::{engine, mix, them, you, Clips, Line, Mix, Placed};
use crate::meetpipe::{self, Capture, Change, Processor, RATE, SLICE};
use crate::model::MeetingSegment;
use crate::speaker_names::{LiveNames, ScreenObs};
use crate::speakers::{Cluster, Voice};
use serde_json::json;

/// voice → (true name, how the meeting app labels the tile)
const CAST: [(&str, &str, &str); 2] = [("Samantha", "Priya Patel", "Priya P."), ("Daniel", "Rahul Sharma", "Rahul Sharma (Host)")];
const ATTENDEES: [&str; 3] = ["Priya Patel", "Rahul Sharma", "Jake Miller"];

fn true_name(voice: &str) -> Option<&'static str> {
    CAST.iter().find(|c| c.0 == voice).map(|c| c.1)
}

#[derive(Clone, Copy)]
enum Feed {
    None,
    /// readings every 1.5 s while the call talks: lag, every 9th misread, every 6th missing
    Noisy,
}

/// The sampler's readings for a mix: what the meeting window shows while the call track talks.
fn screen_feed(placed: &[Placed], feed: Feed, end: f64) -> Vec<ScreenObs> {
    let mut out = vec![];
    if matches!(feed, Feed::None) {
        return out;
    }
    let (mut t, mut k) = (0.0, 0usize);
    while t < end {
        t += 1.5;
        // the indicator follows the voice ~0.4 s late and lingers ~0.6 s
        let talking: Vec<&Placed> = placed.iter().filter(|p| !p.line.you && t >= p.start + 0.4 && t <= p.end + 0.6).collect();
        let Some(p) = talking.first() else { continue };
        k += 1;
        if k % 6 == 0 {
            continue; // nothing readable this time
        }
        let mut idx = CAST.iter().position(|c| c.0 == p.line.voice).unwrap_or(0);
        if k % 9 == 0 {
            idx = 1 - idx; // misread: the other tile
        }
        let raw = CAST[idx].2;
        // the same parsing the live sampler applies to an AX string
        if let Some((name, weight)) = crate::speaker_names::active_from_ax(&[format!("{raw}, speaking")], &ATTENDEES.map(String::from)) {
            out.push(ScreenObs { t, name, weight });
        }
    }
    out
}

struct NamedRun {
    transcript: Vec<MeetingSegment>,
    clusters: Vec<Cluster>,
    first_name_at: Option<f64>,
    live_wrong: usize,
    live_named: usize,
    suggested: std::collections::BTreeMap<String, String>,
}

fn run(lines: &[Line], feed: Feed, voices: &[Voice], clips: &mut Clips) -> (Vec<Placed>, NamedRun) {
    let (mic, call, placed) = mix(clips, lines, &Mix { noise: 0.001, ..Default::default() }, 1.0, 2.0);
    let (stt, emb) = engine().expect("speech model");
    let screen = screen_feed(&placed, feed, call.len() as f64 / RATE);
    let mut cap = Capture::new(true);
    let mut p = Processor::new(stt, true, voices.to_vec(), Some("en".into()));
    p.embedder = emb.clone();
    let attendees: Vec<String> = ATTENDEES.iter().map(|s| s.to_string()).collect();
    let mut live = LiveNames { attendees: attendees.clone(), ..Default::default() };
    let mut transcript: Vec<MeetingSegment> = vec![];
    let (mut fed, mut first_name_at, mut live_wrong, mut live_named) = (0usize, None, 0usize, 0usize);
    let total = mic.len().max(call.len());
    let part = |s: &[f32], a: usize, b: usize| -> Vec<f32> { (a..b).map(|i| s.get(i).copied().unwrap_or(0.0)).collect() };
    let mut i = 0;
    let mut handle = |jobs: Vec<meetpipe::Job>, now: f64, transcript: &mut Vec<MeetingSegment>, p: &mut Processor<_>, live: &mut LiveNames| {
        while fed < screen.len() && screen[fed].t <= now {
            live.add_obs(screen[fed].clone());
            fed += 1;
        }
        for job in jobs.into_iter().filter(|j| !j.chunk.partial) {
            let seen = p.turns.len();
            let mut ch = p.handle(job);
            for t in p.turns[seen..].to_vec() {
                live.add_turn(t);
            }
            name_changes(live, &mut ch);
            for c in ch {
                match c {
                    Change::Add(s) => {
                        let who = s.speaker.clone().unwrap_or_default();
                        if CAST.iter().any(|c| c.1 == who) {
                            live_named += 1;
                            // the true speaker of this line
                            let truth = placed.iter().filter(|pl| !pl.line.you && s.t >= pl.start - 1.0 && s.t <= pl.end).filter_map(|pl| true_name(pl.line.voice)).next();
                            if truth == Some(who.as_str()) {
                                first_name_at.get_or_insert(now);
                            } else {
                                live_wrong += 1;
                            }
                        }
                        insert_sorted(transcript, s)
                    }
                    Change::Remove(s) => transcript.retain(|x| !(x.t == s.t && x.text == s.text)),
                    _ => {}
                }
            }
        }
    };
    while i < total {
        let end = (i + SLICE).min(total);
        let jobs = cap.push(&part(&mic, i, end), &part(&call, i, end), end as f64 / RATE);
        handle(jobs, end as f64 / RATE, &mut transcript, &mut p, &mut live);
        i = end;
    }
    handle(cap.flush(), total as f64 / RATE, &mut transcript, &mut p, &mut live);
    // post-call pass, as meeting::speaker_pass
    if let Some(e) = &emb {
        meetpipe::fill_embeddings(&mut p.call_segs, e);
    }
    let mut clusters = vec![];
    let mut suggested = Default::default();
    if std::env::var_os("FLO_SIM_DEBUG_VOICES").is_some() {
        for s in &p.call_segs {
            if let Some(e) = &s.emb {
                let who = placed.iter().find(|pl| !pl.line.you && s.t >= pl.start - 1.0 && s.t <= pl.end).map(|pl| pl.line.voice).unwrap_or("?");
                eprintln!("SEG {:6.1} {who:9} {}", s.t, voices.iter().map(|v| format!("{}={:.2}", v.name, crate::speakers::cosine(e, &v.embedding))).collect::<Vec<_>>().join(" "));
            }
        }
    }
    if let Some((labels, mut cl)) = meetpipe::recluster(&p.call_segs, voices) {
        apply_call_labels(&mut transcript, &labels);
        let named = name_speakers(&mut transcript, &mut cl, &labels, &p.turns, &screen, voices, &attendees, &["Jake Miller".to_string()]);
        eprintln!("naming outcome: {}", serde_json::to_string(&named.outcome).unwrap_or_default());
        suggested = named.suggested;
        clusters = cl;
    }
    (placed, NamedRun { transcript, clusters, first_name_at, live_wrong, live_named, suggested })
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Score {
    call_lines: usize,
    matched: usize,
    right_name: usize,
    wrong_name: usize,
    generic: usize,
    you_ok: usize,
    you_lines: usize,
    accuracy: f64,
    wrong_rate: f64,
}

fn score(placed: &[Placed], tr: &[MeetingSegment]) -> Score {
    let mut s = Score::default();
    let mut used = vec![false; tr.len()];
    for p in placed {
        let w = meetpipe::norm_words(p.line.text);
        let best = tr
            .iter()
            .enumerate()
            .filter(|(j, x)| !used[*j] && x.t >= p.start - 1.0 && x.t <= p.end)
            .map(|(j, x)| (j, meetpipe::lcs(&w, &meetpipe::norm_words(&x.text)) as f64 / w.len().max(1) as f64))
            .filter(|(_, c)| *c >= 0.5)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if p.line.you {
            s.you_lines += 1;
            if let Some((j, _)) = best {
                used[j] = true;
                s.you_ok += usize::from(tr[j].speaker.as_deref() == Some(YOU));
            }
            continue;
        }
        s.call_lines += 1;
        let Some((j, _)) = best else { continue };
        used[j] = true;
        s.matched += 1;
        let who = tr[j].speaker.clone().unwrap_or_default();
        if Some(who.as_str()) == true_name(p.line.voice) {
            s.right_name += 1;
        } else if crate::meeting::is_generic_label(&who) {
            s.generic += 1;
        } else {
            s.wrong_name += 1;
        }
    }
    s.accuracy = s.right_name as f64 / s.call_lines.max(1) as f64;
    s.wrong_rate = s.wrong_name as f64 / s.call_lines.max(1) as f64;
    s
}

const P: [&str; 6] = [
    "Sounds good. I looked at the numbers from last quarter.",
    "Our conversion rate went up by about twelve percent.",
    "Tuesday works for me, but not before two o'clock.",
    "Please also share the customer feedback summary.",
    "I think we should talk to the sales team about this.",
    "The onboarding emails are ready for review as well.",
];
const R: [&str; 6] = [
    "I agree with that plan. Marketing needs the final copy next week.",
    "I will draft the announcement email tomorrow morning.",
    "Let's keep the budget under fifty thousand dollars.",
    "Can someone send me the contract before the weekend?",
    "The design team finished the new pricing page yesterday.",
    "We should run the beta for at least two more weeks.",
];
const Y: [&str; 4] = ["Okay, let's get started with the pricing review.", "Can we move the design review to Tuesday afternoon?", "Great, I will book the meeting room for that.", "Thanks everyone, that was a really useful discussion."];

fn script(offset: usize) -> Vec<Line> {
    let mut v = vec![you(Y[0], 0.0)];
    for k in 0..6 {
        let (a, b) = (P[(k + offset) % 6], R[(k + offset) % 6]);
        v.push(them("Samantha", a, 0.9));
        v.push(them("Daniel", b, 1.0));
        if k % 2 == 1 {
            v.push(you(Y[(k / 2 + 1) % 4], 0.8));
        }
    }
    v
}

#[test]
#[ignore = "needs the installed Whisper + voice models and macOS `say`; run with --ignored"]
fn naming_sim_scenarios() {
    let tmp = std::env::temp_dir().join(format!("flo-namesim-{}", std::process::id()));
    let mut clips = Clips::new(&tmp);
    let mut rows = vec![];
    let mut failures = vec![];

    // 1) first meeting: screen feed + calendar, no voice memory
    let (placed, r1) = run(&script(0), Feed::Noisy, &[], &mut clips);
    let s1 = score(&placed, &r1.transcript);
    eprintln!("screen+calendar: {s1:?} first name at {:?}s live named {} wrong {}", r1.first_name_at, r1.live_named, r1.live_wrong);
    rows.push(json!({ "name": "screen_and_calendar", "score": s1, "firstNameAtSecs": r1.first_name_at, "liveNamedLines": r1.live_named, "liveWrong": r1.live_wrong,
        "suggested": r1.suggested, "transcript": r1.transcript.iter().map(|s| format!("[{:5.1}] {}: {}", s.t, s.speaker.clone().unwrap_or_default(), s.text)).collect::<Vec<_>>() }));
    if s1.wrong_name > 0 || r1.live_wrong > 0 {
        failures.push(format!("screen: {} wrong names after the call, {} live", s1.wrong_name, r1.live_wrong));
    }
    if s1.accuracy < 0.8 {
        failures.push(format!("screen: accuracy {:.2}", s1.accuracy));
    }

    // 2) the user confirms → voices remembered; a later meeting with NO screen feed
    let voices: Vec<Voice> = r1.clusters.iter().filter(|c| CAST.iter().any(|x| x.1 == c.label)).map(|c| Voice { name: c.label.clone(), embedding: c.centroid.clone(), samples: c.count }).collect();
    let (placed, r2) = run(&script(3), Feed::None, &voices, &mut clips);
    let s2 = score(&placed, &r2.transcript);
    eprintln!("voice memory: {s2:?}");
    rows.push(json!({ "name": "voice_memory_only", "voicesRemembered": voices.iter().map(|v| v.name.clone()).collect::<Vec<_>>(), "score": s2,
        "transcript": r2.transcript.iter().map(|s| format!("[{:5.1}] {}: {}", s.t, s.speaker.clone().unwrap_or_default(), s.text)).collect::<Vec<_>>() }));
    if s2.wrong_name > 0 {
        failures.push(format!("voice memory: {} wrong names", s2.wrong_name));
    }
    if voices.len() == 2 && s2.accuracy < 0.8 {
        failures.push(format!("voice memory: accuracy {:.2}", s2.accuracy));
    }

    // 2b) remembered voices + a stranger (Karen) in Rahul's place: she must never become Rahul
    let stranger: Vec<Line> = script(2).into_iter().map(|l| if l.voice == "Daniel" { them("Karen", l.text, l.gap) } else { l }).collect();
    let (placed, r4) = run(&stranger, Feed::None, &voices, &mut clips);
    let s4 = score(&placed, &r4.transcript);
    eprintln!("stranger: {s4:?}");
    rows.push(json!({ "name": "voice_memory_with_a_stranger", "score": s4,
        "transcript": r4.transcript.iter().map(|s| format!("[{:5.1}] {}: {}", s.t, s.speaker.clone().unwrap_or_default(), s.text)).collect::<Vec<_>>() }));
    if s4.wrong_name > 0 {
        failures.push(format!("stranger: {} lines got a remembered name that isn't theirs", s4.wrong_name));
    }

    // 3) nothing to go on (no screen, no memory): never a name, only "Speaker N" (+ suggestions)
    let (placed, r3) = run(&script(1), Feed::None, &[], &mut clips);
    let s3 = score(&placed, &r3.transcript);
    eprintln!("no signals: {s3:?} suggested {:?}", r3.suggested);
    rows.push(json!({ "name": "no_signals", "score": s3, "suggested": r3.suggested }));
    if s3.wrong_name > 0 || s3.right_name > 0 {
        failures.push(format!("no signals: {} names applied without evidence", s3.right_name + s3.wrong_name));
    }

    let out = std::env::var("FLO_NAMING_OUT").unwrap_or_else(|_| "/tmp/flo-naming-sim.json".into());
    let _ = std::fs::write(&out, serde_json::to_string_pretty(&json!({ "scenarios": rows, "failures": failures })).unwrap_or_default());
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(failures.is_empty(), "naming sim failures:\n{}", failures.join("\n"));
}

#[test]
fn synthetic_screen_feed_follows_the_call_with_noise() {
    let pl = |voice: &'static str, s: f64, e: f64| Placed { line: them(voice, "x", 0.0), start: s, end: e };
    let placed = vec![pl("Samantha", 1.0, 6.0), Placed { line: you("y", 0.0), start: 7.0, end: 9.0 }, pl("Daniel", 10.0, 16.0)];
    let f = screen_feed(&placed, Feed::Noisy, 20.0);
    assert!(f.iter().all(|o| ATTENDEES.contains(&o.name.as_str())), "{f:?}");
    assert!(f.iter().filter(|o| o.t < 7.0).filter(|o| o.name == "Priya Patel").count() >= 2);
    assert!(f.iter().all(|o| !(7.2..=9.0).contains(&o.t)), "no readings while only you talk");
    assert!(screen_feed(&placed, Feed::None, 20.0).is_empty());
}
