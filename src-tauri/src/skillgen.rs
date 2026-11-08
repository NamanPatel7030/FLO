//! "Build with AI": turn a plain-language description ("every weekday at 9 read my unread Gmail,
//! summarise it and post to Slack #daily") into a skill the canvas can lay out — name, trigger
//! phrases, an optional cron schedule, ordered steps, and only platforms / MCP servers / documents
//! the user actually has. The model's JSON is parsed tolerantly; anything it names that doesn't
//! exist is dropped and reported in `notes`.
use crate::cron::Cron;
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::state::Shared;
use crate::text::{self, extract_json_object};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What the canvas builds nodes from.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneratedSkill {
    pub name: String,
    pub triggers: Vec<String>,
    /// 5-field cron, validated
    pub schedule: Option<String>,
    /// in run order
    pub steps: Vec<String>,
    /// built-in platform ids ("slack") or custom-platform connection ids
    pub platforms: Vec<String>,
    /// MCP server connection ids
    pub mcp: Vec<String>,
    /// "doc:<id>"
    pub knowledge: Vec<String>,
    /// "write" | "do"
    pub mode: String,
    /// things the user should know (a server they'd need to add, a schedule that didn't parse)
    pub notes: Vec<String>,
}

/// What the user has: the only things the model may pick from. Each entry is (id, label, detail).
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    pub platforms: Vec<(String, String, String)>,
    pub mcps: Vec<(String, String, String)>,
    pub docs: Vec<(String, String, String)>,
}

/// Built-in platforms (mirrors src/dashboard/platforms.tsx).
pub const BUILTIN_PLATFORMS: &[(&str, &str)] = &[
    ("upwork", "Upwork"),
    ("slack", "Slack"),
    ("gmail", "Gmail"),
    ("linkedin", "LinkedIn"),
    ("whatsapp", "WhatsApp"),
    ("browser", "Any website"),
    ("any", "Any app"),
];

impl Catalog {
    pub fn load(st: &Shared) -> Self {
        let conns = st.db.list_connections().unwrap_or_default();
        let mut platforms: Vec<_> = BUILTIN_PLATFORMS.iter().map(|(i, l)| (i.to_string(), l.to_string(), String::new())).collect();
        platforms.extend(conns.iter().filter(|c| c.kind == "platform" && c.enabled).map(|c| (c.id.clone(), c.name.clone(), c.description.clone())));
        let mcps = conns.iter().filter(|c| c.kind == "mcp" && c.enabled).map(|c| (c.id.clone(), c.name.clone(), c.description.clone())).collect();
        let docs = st.db.list_context_docs().unwrap_or_default().into_iter().map(|d| (format!("doc:{}", d.id), d.title, String::new())).collect();
        Catalog { platforms, mcps, docs }
    }
}

fn list(items: &[(String, String, String)]) -> String {
    if items.is_empty() {
        return "(none)\n".into();
    }
    items
        .iter()
        .map(|(id, label, detail)| if detail.trim().is_empty() { format!("- {id}: {label}\n") } else { format!("- {id}: {label} ({})\n", text::truncate_chars(detail.trim(), 120)) })
        .collect()
}

pub fn system_prompt(cat: &Catalog, now: &str) -> String {
    format!(
        r#"You design "skills" for Flo, a voice assistant on the user's Mac. A skill is a small recipe Flo runs when the user says a trigger phrase, or on a schedule.
Return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{{
  "name": "2-4 word title, e.g. \"Daily inbox digest\"",
  "triggers": ["2-4 short phrases the user might say to run it"],
  "schedule": "5-field cron in the user's local time (minute hour day-of-month month day-of-week), or null if it only runs when asked",
  "steps": ["3-7 ordered steps; each one imperative sentence doing one thing"],
  "platforms": ["ids from PLATFORMS where it works"],
  "mcp": ["ids from MCP SERVERS whose tools the steps need"],
  "knowledge": ["ids from DOCUMENTS to use as reference"],
  "mode": "write" or "do",
  "notes": ["short things the user must set up, e.g. \"Add a Slack MCP server to post messages\""]
}}
Rules:
- Use ONLY ids listed below. Never invent ids. If something is needed but missing, leave it out and add a note.
- schedule examples: every weekday at 9 = "0 9 * * 1-5"; every hour = "0 * * * *"; every 15 minutes = "*/15 * * * *"; every Monday at 8:30 = "30 8 * * 1"; every day at 18:00 = "0 18 * * *". Use null when no time or frequency is mentioned.
- mode "write": Flo writes text (typed into the focused field, or saved as a note when it runs on a schedule). mode "do": Flo acts (operates apps, posts, sends, clicks). Posting or sending through an MCP server counts as "do".
- Steps name the exact source and destination (e.g. "Post the summary to #daily in Slack").
- Keep the user's wording for names, channels, people and numbers.
Now: {now}

PLATFORMS (id: label):
{}
MCP SERVERS (id: name):
{}
DOCUMENTS (id: title):
{}"#,
        list(&cat.platforms),
        list(&cat.mcps),
        list(&cat.docs)
    )
}

pub fn user_prompt(description: &str, current: Option<&str>) -> String {
    match current.map(str::trim).filter(|c| !c.is_empty()) {
        Some(cur) => format!("Here is my current skill:\n\"\"\"\n{}\n\"\"\"\nChange it like this: {}\nReturn the whole updated skill as JSON.", text::truncate_chars(cur, 4000), description.trim()),
        None => format!("Build a skill for this:\n{}", description.trim()),
    }
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Map whatever the model wrote (an id, a label, "Slack MCP") to a catalog id.
fn resolve(raw: &str, items: &[(String, String, String)]) -> Option<String> {
    let n = norm(raw.strip_prefix("doc:").unwrap_or(raw));
    if n.is_empty() {
        return None;
    }
    let alias = match n.as_str() {
        "web" | "website" | "chrome" | "safari" | "browser" | "internet" => "browser",
        "anyapp" | "mac" | "desktop" | "macos" | "anywhere" => "any",
        "email" | "mail" | "googlemail" | "inbox" => "gmail",
        _ => "",
    };
    let id_of = |id: &str| norm(id.strip_prefix("doc:").unwrap_or(id));
    items
        .iter()
        .find(|(id, label, _)| id_of(id) == n || norm(label) == n || (!alias.is_empty() && id == alias))
        .or_else(|| {
            // "Notion MCP server" ↔ "Notion": one contains the other (only for names long enough to be unambiguous)
            items.iter().find(|(_, label, _)| {
                let l = norm(label);
                l.len() >= 4 && (n.contains(&l) || (n.len() >= 4 && l.contains(&n)))
            })
        })
        .map(|(id, _, _)| id.clone())
}

/// Strings from an array (of strings or objects), or a single comma/newline separated string.
fn strings(v: Option<&Value>, split_commas: bool) -> Vec<String> {
    let pick = |o: &Value| -> Option<String> {
        match o {
            Value::String(s) => Some(s.clone()),
            Value::Object(m) => ["text", "step", "instruction", "description", "action", "id", "name", "title", "phrase"]
                .iter()
                .find_map(|k| m.get(*k).and_then(|x| x.as_str()).map(String::from)),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }
    };
    let raw: Vec<String> = match v {
        Some(Value::Array(a)) => a.iter().filter_map(pick).collect(),
        Some(Value::String(s)) => s.split(|c| c == '\n' || (split_commas && c == ',')).map(String::from).collect(),
        Some(o @ Value::Object(_)) => pick(o).into_iter().collect(),
        _ => vec![],
    };
    raw.into_iter().map(|s| clean_item(&s)).filter(|s| !s.is_empty()).collect()
}

/// "1. Read mail" / "- Read mail" / "Step 2: Read mail" → "Read mail"
fn clean_item(s: &str) -> String {
    let mut t = s.trim().trim_matches('"').trim();
    if let Some(rest) = t.strip_prefix("Step ").or_else(|| t.strip_prefix("step ")) {
        t = rest.trim_start_matches(|c: char| c.is_ascii_digit()).trim_start_matches([':', '.', ')']).trim();
    }
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits < 3 && t[digits..].starts_with(['.', ')', ':']) {
        t = t[digits + 1..].trim();
    }
    t.trim_start_matches(['-', '*', '•']).trim().to_string()
}

fn first<'a>(o: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| o.get(*k)).filter(|v| !v.is_null())
}

fn dedupe(v: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for x in v {
        if !out.iter().any(|y| y.eq_ignore_ascii_case(&x)) {
            out.push(x);
        }
    }
    out
}

/// Parse the model's answer against what the user has.
pub fn parse(raw: &str, cat: &Catalog) -> Result<GeneratedSkill> {
    let j = extract_json_object(raw).ok_or_else(|| anyhow!("The AI didn't return a skill. Try again, or describe it a little differently."))?;
    let v: Value = serde_json::from_str(&j).map_err(|_| anyhow!("The AI's answer wasn't valid JSON. Try again."))?;
    // some models wrap it: {"skill": {...}}
    let v = match v.get("skill") {
        Some(inner @ Value::Object(_)) => inner.clone(),
        _ => v,
    };
    let o = v.as_object().ok_or_else(|| anyhow!("The AI didn't return a skill. Try again."))?;
    let mut notes = strings(first(o, &["notes", "warnings", "setup"]), false);

    let name = first(o, &["name", "title", "skill_name", "skillName"]).and_then(|x| x.as_str()).map(|s| text::truncate_chars(s.trim().trim_matches('"'), 60)).unwrap_or_default();
    let triggers: Vec<String> = dedupe(strings(first(o, &["triggers", "trigger_phrases", "triggerPhrases", "trigger", "phrases"]), true)).into_iter().take(5).collect();
    let steps: Vec<String> = strings(first(o, &["steps", "instructions", "plan"]), false).into_iter().map(|s| text::strip_ai_dashes(&s)).take(10).collect();
    if steps.is_empty() {
        bail!("The AI didn't come up with any steps. Try describing what the skill should do.");
    }

    let schedule = match first(o, &["schedule", "cron", "when"]) {
        Some(Value::String(s)) => Some(s.trim().to_string()),
        Some(Value::Object(m)) => m.get("cron").or_else(|| m.get("expression")).and_then(|x| x.as_str()).map(|s| s.trim().to_string()),
        _ => None,
    }
    .filter(|s| !s.is_empty() && !matches!(s.to_ascii_lowercase().as_str(), "null" | "none" | "n/a" | "manual" | "on demand"))
    .and_then(|s| match Cron::parse(&s) {
        Ok(_) => Some(s.split_whitespace().collect::<Vec<_>>().join(" ")),
        Err(_) => {
            notes.push(format!("Couldn't use the schedule “{s}”. Set it on the Schedule node."));
            None
        }
    });

    let mut pick = |key: &[&str], items: &[(String, String, String)], what: &str| -> Vec<String> {
        let mut out = vec![];
        for raw in strings(first(o, key), true) {
            match resolve(&raw, items) {
                Some(id) if !out.contains(&id) => out.push(id),
                Some(_) => {}
                None => notes.push(format!("No {what} called “{raw}”, so it was left out.")),
            }
        }
        out
    };
    let platforms = pick(&["platforms", "platform", "apps"], &cat.platforms, "platform");
    let mcp = pick(&["mcp", "mcp_servers", "mcpServers", "servers", "tools", "connections"], &cat.mcps, "MCP server");
    let knowledge = pick(&["knowledge", "docs", "documents", "knowledge_docs", "knowledgeDocs"], &cat.docs, "document");

    let mode_raw = first(o, &["mode", "output", "output_mode", "outputMode"]).and_then(|x| x.as_str()).map(norm).unwrap_or_default();
    let mode = if matches!(mode_raw.as_str(), "do" | "doit" | "act" | "action" | "operate" | "screen" | "onscreen") { "do" } else { "write" };

    Ok(GeneratedSkill { name, triggers, schedule, steps, platforms, mcp, knowledge, mode: mode.into(), notes: dedupe(notes) })
}

/// A name from the description when the model gave none: its first few words, capitalised.
fn fallback_name(description: &str) -> String {
    let words: Vec<&str> = description.split_whitespace().take(4).collect();
    let s = words.join(" ");
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_else(|| "New skill".into())
}

pub async fn generate(st: &Shared, description: &str, current: Option<&str>) -> Result<GeneratedSkill> {
    if description.trim().is_empty() {
        bail!("Describe what the skill should do.");
    }
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        bail!("Pick an AI model in Settings → AI to build skills with AI.");
    }
    let cat = Catalog::load(st);
    let now = chrono::Local::now().format("%A %Y-%m-%d %H:%M").to_string();
    let system = system_prompt(&cat, &now);
    let user = user_prompt(description, current);
    let raw = llm::chat(&st.egress, &cfgl, ChatRequest { system: &system, user: &user, image_b64: None, json: true, purpose: Purpose::Assistant, cloud_allowed: s.assistant_cloud_allowed, max_tokens: 1500 })
        .await
        .map_err(|e| {
            if crate::settings::is_cloud_llm(&s.llm_provider) && !s.assistant_cloud_allowed {
                anyhow!("The assistant is set to on-device only. Allow cloud AI in Settings → Privacy, or choose a local model.")
            } else {
                e
            }
        })?;
    let mut g = parse(&raw, &cat)?;
    if g.name.is_empty() {
        g.name = fallback_name(description);
    }
    Ok(g)
}

/// Build (or, with `current`, refine) a skill from a description.
#[tauri::command]
pub async fn generate_skill_graph(st: tauri::State<'_, Shared>, description: String, current: Option<String>) -> Result<GeneratedSkill, String> {
    generate(st.inner(), &description, current.as_deref()).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cat() -> Catalog {
        let mut platforms: Vec<_> = BUILTIN_PLATFORMS.iter().map(|(i, l)| (i.to_string(), l.to_string(), String::new())).collect();
        platforms.push(("c_fiverr".into(), "Fiverr".into(), String::new()));
        Catalog {
            platforms,
            mcps: vec![("c1".into(), "Notion".into(), String::new()), ("c2".into(), "Slack".into(), "post messages".into())],
            docs: vec![("doc:d1".into(), "Portfolio".into(), String::new())],
        }
    }

    #[test]
    fn parses_fenced_answer_and_maps_names_to_ids() {
        let raw = "Here you go:\n```json\n{\"name\":\"Daily inbox digest\",\"triggers\":[\"inbox digest\",\"summarise my inbox\"],\"schedule\":\"0 9 * * 1-5\",\"steps\":[\"Read my unread Gmail\",\"Summarise it in 5 bullets\",\"Post it to #daily in Slack\"],\"platforms\":[\"Gmail\",\"slack\",\"Myspace\"],\"mcp\":[\"Slack MCP server\",\"Jira\"],\"knowledge\":[\"Portfolio\"],\"mode\":\"do\",\"notes\":[]}\n```";
        let g = parse(raw, &cat()).unwrap();
        assert_eq!(g.name, "Daily inbox digest");
        assert_eq!(g.triggers, vec!["inbox digest", "summarise my inbox"]);
        assert_eq!(g.schedule.as_deref(), Some("0 9 * * 1-5"));
        assert_eq!(g.steps.len(), 3);
        assert_eq!(g.platforms, vec!["gmail", "slack"]);
        assert_eq!(g.mcp, vec!["c2"]);
        assert_eq!(g.knowledge, vec!["doc:d1"]);
        assert_eq!(g.mode, "do");
        assert!(g.notes.iter().any(|n| n.contains("Myspace")));
        assert!(g.notes.iter().any(|n| n.contains("Jira")));
    }

    #[test]
    fn tolerates_other_shapes() {
        let raw = r#"{"skill":{"title":"Fiverr gigs","trigger":"check fiverr, new gigs, Check Fiverr","when":{"cron":"*/30  *  * * *"},"instructions":"1. Open Fiverr\n2) Read new requests\n- Draft a reply","platforms":"fiverr, web","tools":[{"name":"Notion"}],"docs":["d1"],"output":"Write"}}"#;
        let g = parse(raw, &cat()).unwrap();
        assert_eq!(g.name, "Fiverr gigs");
        assert_eq!(g.triggers, vec!["check fiverr", "new gigs"]);
        assert_eq!(g.schedule.as_deref(), Some("*/30 * * * *"));
        assert_eq!(g.steps, vec!["Open Fiverr", "Read new requests", "Draft a reply"]);
        assert_eq!(g.platforms, vec!["c_fiverr", "browser"]);
        assert_eq!(g.mcp, vec!["c1"]);
        assert_eq!(g.knowledge, vec!["doc:d1"]);
        assert_eq!(g.mode, "write");
    }

    #[test]
    fn bad_schedule_becomes_a_note_and_null_means_none() {
        let g = parse(r#"{"name":"x","steps":["a"],"schedule":"weekdays at nine"}"#, &cat()).unwrap();
        assert_eq!(g.schedule, None);
        assert!(g.notes[0].contains("weekdays at nine"));
        let g = parse(r#"{"name":"x","steps":["a"],"schedule":null}"#, &cat()).unwrap();
        assert_eq!(g.schedule, None);
        assert!(g.notes.is_empty());
        let g = parse(r#"{"name":"x","steps":["a"],"schedule":"none"}"#, &cat()).unwrap();
        assert!(g.notes.is_empty() && g.schedule.is_none());
    }

    #[test]
    fn errors_are_readable() {
        assert!(parse("Sorry, I can't help with that.", &cat()).unwrap_err().to_string().contains("didn't return a skill"));
        assert!(parse(r#"{"name":"Empty","steps":[]}"#, &cat()).unwrap_err().to_string().contains("steps"));
    }

    #[test]
    fn prompt_lists_only_what_the_user_has() {
        let p = system_prompt(&cat(), "Sunday 2026-11-08 10:00");
        assert!(p.contains("- c1: Notion") && p.contains("- c2: Slack (post messages)") && p.contains("- doc:d1: Portfolio") && p.contains("- c_fiverr: Fiverr"));
        let empty = system_prompt(&Catalog::default(), "now");
        assert!(empty.contains("MCP SERVERS (id: name):\n(none)"));
        assert!(user_prompt("add a step", Some("Say: digest")).contains("current skill"));
        assert!(user_prompt("daily digest", None).starts_with("Build a skill"));
        assert_eq!(fallback_name("every weekday at 9 read my mail"), "Every weekday at 9");
    }
}
