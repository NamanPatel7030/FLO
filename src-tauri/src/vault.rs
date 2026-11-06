//! Flo Vault — a local, Obsidian-style knowledge graph that Flo grows on its own.
//!
//! Notes are markdown with `[[wikilinks]]`. Projects, people, meetings and topics become linked
//! notes automatically as you work, so Flo (and you) keep a living memory you can see as a graph.
//! Everything stays on the Mac; building the graph uses no network.
use crate::model::*;
use crate::state::Shared;
use crate::text;
use anyhow::Result;

/// Stable id for a note from its title (so the same person/project maps to one node).
pub fn slug(title: &str) -> String {
    let s: String = title
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() {
        "note".into()
    } else {
        text::truncate_chars(&s, 64).trim_matches('-').to_string()
    }
}

/// Extract `[[wikilink]]` targets (title + optional `|alias`) from markdown.
pub fn wikilinks(md: &str) -> Vec<String> {
    let bytes = md.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(end) = md[i + 2..].find("]]") {
                let inner = &md[i + 2..i + 2 + end];
                let title = inner.split('|').next().unwrap_or("").trim();
                if !title.is_empty() && !out.iter().any(|t: &String| t.eq_ignore_ascii_case(title)) {
                    out.push(title.to_string());
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

pub fn kind_color(kind: &str) -> &'static str {
    match kind {
        "person" => "#66ceff",
        "project" => "#3dbbff",
        "meeting" | "note" => "#93ddff",
        "daily" => "#1a9be0",
        "topic" => "#c2ecff",
        "doc" => "#8b5cf6",
        _ => "#66ceff",
    }
}

/// Create or update a note by title (idempotent on its slug), re-syncing its outgoing links.
pub fn upsert(st: &Shared, title: &str, kind: &str, content: &str) -> Result<String> {
    let id = slug(title);
    st.db.vault_upsert(&id, title.trim(), kind, content)?;
    // rebuild outgoing links from the content's wikilinks (+ ensure stub targets exist)
    st.db.vault_clear_links(&id, "wiki")?;
    for target in wikilinks(content) {
        let tid = slug(&target);
        if st.db.vault_get(&tid)?.is_none() {
            st.db.vault_upsert(&tid, &target, "topic", "")?;
        }
        st.db.vault_link(&id, &tid, "wiki")?;
    }
    Ok(id)
}

/// Ensure a bare node exists (person/project/topic) and return its id.
pub fn ensure(st: &Shared, title: &str, kind: &str) -> Result<String> {
    let id = slug(title);
    if st.db.vault_get(&id)?.is_none() {
        st.db.vault_upsert(&id, title.trim(), kind, "")?;
    }
    Ok(id)
}

pub fn link(st: &Shared, from_title: &str, to_title: &str, kind: &str) -> Result<()> {
    let (a, b) = (slug(from_title), slug(to_title));
    if a != b {
        st.db.vault_link(&a, &b, kind)?;
    }
    Ok(())
}

/// Fold a finished meeting into the vault: a note linked to its project and to people it names.
pub fn record_meeting(st: &Shared, note: &Note, project_name: Option<&str>) -> Result<()> {
    let mut md = String::new();
    if let Some(p) = project_name {
        md.push_str(&format!("Project: [[{p}]]\n\n"));
    }
    if !note.summary.is_empty() {
        md.push_str(&note.summary);
        md.push_str("\n\n");
    }
    if !note.action_items.is_empty() {
        md.push_str("## Action items\n");
        for a in &note.action_items {
            md.push_str(&format!("- {a}\n"));
        }
    }
    let id = upsert(st, &note.title, "meeting", &md)?;
    if let Some(p) = project_name {
        ensure(st, p, "project")?;
        st.db.vault_link(&id, &slug(p), "project")?;
    }
    Ok(())
}

/// A per-day note that gathers the day's activity, so the graph has a time spine.
pub fn touch_daily(st: &Shared, line: &str) -> Result<()> {
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let id = slug(&day);
    let existing = st.db.vault_get(&id)?.map(|n| n.content).unwrap_or_default();
    let stamp = chrono::Local::now().format("%H:%M").to_string();
    let content = format!("{existing}- {stamp} {line}\n");
    st.db.vault_upsert(&id, &day, "daily", &content)?;
    Ok(())
}

/// Seed/rebuild the vault from everything Flo already knows (projects, to-dos, meeting notes).
pub fn rebuild(st: &Shared) -> Result<usize> {
    let mut n = 0;
    for p in st.db.list_projects()? {
        let mut md = String::new();
        if let Some(d) = &p.description {
            md.push_str(d);
            md.push_str("\n\n");
        }
        md.push_str(&format!("Status: {}\n", p.status));
        upsert(st, &p.name, "project", &md)?;
        n += 1;
    }
    let projects = st.db.list_projects()?;
    for t in st.db.list_todos()?.into_iter().filter(|t| t.status != "dismissed") {
        if let Some(person) = t.person.as_deref().filter(|s| !s.is_empty() && *s != "null") {
            ensure(st, person, "person")?;
            if let Some(pid) = &t.project_id {
                if let Some(proj) = projects.iter().find(|p| &p.id == pid) {
                    st.db.vault_link(&slug(person), &slug(&proj.name), "mentions")?;
                }
            }
            n += 1;
        }
    }
    for note in st.db.list_notes()?.into_iter().filter(|n| n.kind == "meeting" && !n.live) {
        let proj = note.project_id.as_ref().and_then(|pid| projects.iter().find(|p| &p.id == pid)).map(|p| p.name.clone());
        record_meeting(st, &note, proj.as_deref())?;
        n += 1;
    }
    for d in st.db.list_context_docs()? {
        upsert(st, &d.title, "doc", &st.db.get_context_content(&d.id)?.unwrap_or_default())?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_stable_and_safe() {
        assert_eq!(slug("Apollo Launch!"), "apollo-launch");
        assert_eq!(slug("  Rahul   Patel "), "rahul-patel");
        assert_eq!(slug("2026-11-06"), "2026-11-06");
        assert_eq!(slug("???"), "note");
        assert_eq!(slug("Rahul"), slug("rahul")); // same person → one node
    }

    #[test]
    fn parses_wikilinks_with_aliases_and_dedups() {
        let md = "Met [[Rahul]] about [[Apollo Launch|the launch]]. Ping [[rahul]] again. Not a [link].";
        assert_eq!(wikilinks(md), vec!["Rahul".to_string(), "Apollo Launch".to_string()]);
        assert!(wikilinks("no links here").is_empty());
        assert!(wikilinks("[[]] [[ ]]").is_empty());
    }
}
