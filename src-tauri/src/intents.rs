//! Instant "Jarvis" commands — handled locally without an LLM (fast, offline):
//!   "open Slack" · "launch VS Code" · "open github.com" · "Spotify kholo"
//!   "google best biryani near me" · "search for tauri nspanel"
//!   "play lofi beats on youtube" · "youtube tauri tutorial"
use crate::model::AssistantAction;

pub struct Intent {
    pub reply: String,
    pub action: AssistantAction,
}

const SITES: &[(&str, &str)] = &[
    ("youtube", "https://youtube.com"),
    ("gmail", "https://mail.google.com"),
    ("google", "https://google.com"),
    ("github", "https://github.com"),
    ("linkedin", "https://linkedin.com"),
    ("twitter", "https://x.com"),
    ("x", "https://x.com"),
    ("whatsapp web", "https://web.whatsapp.com"),
    ("chatgpt", "https://chatgpt.com"),
    ("claude ai", "https://claude.ai"),
    ("upwork", "https://upwork.com"),
    ("google calendar", "https://calendar.google.com"),
    ("google drive", "https://drive.google.com"),
    ("google docs", "https://docs.google.com"),
    ("netflix", "https://netflix.com"),
    ("amazon", "https://amazon.in"),
];

const APPS: &[(&str, &str)] = &[
    ("vs code", "Visual Studio Code"),
    ("vscode", "Visual Studio Code"),
    ("visual studio code", "Visual Studio Code"),
    ("code", "Visual Studio Code"),
    ("chrome", "Google Chrome"),
    ("google chrome", "Google Chrome"),
    ("terminal", "Terminal"),
    ("settings", "System Settings"),
    ("system settings", "System Settings"),
    ("whatsapp", "WhatsApp"),
    ("slack", "Slack"),
    ("notion", "Notion"),
    ("figma", "Figma"),
    ("spotify", "Spotify"),
    ("safari", "Safari"),
    ("mail", "Mail"),
    ("calendar", "Calendar"),
    ("notes", "Notes"),
    ("finder", "Finder"),
    ("messages", "Messages"),
    ("cursor", "Cursor"),
    ("claude", "Claude"),
    ("zoom", "zoom.us"),
    ("teams", "Microsoft Teams"),
    ("arc", "Arc"),
    ("warp", "Warp"),
    ("iterm", "iTerm"),
    ("xcode", "Xcode"),
    ("postman", "Postman"),
    ("discord", "Discord"),
    ("telegram", "Telegram"),
];

fn clean(q: &str) -> String {
    let t = q.trim().trim_end_matches(|c: char| c == '.' || c == '!' || c == '?').trim().to_lowercase();
    let t = t.strip_prefix("hey flo").or_else(|| t.strip_prefix("flo")).unwrap_or(&t).trim_start_matches(|c: char| c == ',' || c == ' ');
    let t = t.strip_prefix("please ").unwrap_or(t);
    let t = t.strip_prefix("can you ").unwrap_or(t);
    t.trim().to_string()
}

fn enc(q: &str) -> String {
    url::form_urlencoded::byte_serialize(q.trim().as_bytes()).collect()
}

fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn open_target(target: &str) -> Option<Intent> {
    let t = target.trim().trim_start_matches("the ").trim_end_matches(" app").trim();
    if t.is_empty() || t.split_whitespace().count() > 4 {
        return None;
    }
    if let Some((_, url)) = SITES.iter().find(|(k, _)| *k == t) {
        return Some(Intent { reply: format!("Opening {}", title_case(t)), action: AssistantAction::OpenUrl { url: url.to_string() } });
    }
    // domain-like: github.com, docs.rs/tauri
    let dom = t.replace(" dot ", ".").replace(' ', "");
    if dom.contains('.') && !dom.starts_with('.') && !dom.ends_with('.') && dom.chars().all(|c| c.is_ascii_alphanumeric() || ".-/_".contains(c)) {
        return Some(Intent { reply: format!("Opening {dom}"), action: AssistantAction::OpenUrl { url: format!("https://{dom}") } });
    }
    let app = APPS.iter().find(|(k, _)| *k == t).map(|(_, v)| v.to_string()).unwrap_or_else(|| title_case(t));
    Some(Intent { reply: format!("Opening {app}"), action: AssistantAction::OpenApp { name: app } })
}

/// Recognise a short, unambiguous command. Returns None for anything else (→ LLM).
pub fn parse(query: &str) -> Option<Intent> {
    let q = clean(query);
    if q.is_empty() || q.split_whitespace().count() > 10 {
        return None;
    }
    // YouTube
    if let Some(rest) = q.strip_prefix("play ") {
        let what = rest.trim_end_matches(" on youtube").trim_end_matches(" on you tube");
        if rest.ends_with("on youtube") || rest.ends_with("on you tube") {
            return Some(Intent {
                reply: format!("Playing “{what}” on YouTube"),
                action: AssistantAction::OpenUrl { url: format!("https://www.youtube.com/results?search_query={}", enc(what)) },
            });
        }
    }
    for p in ["youtube ", "search youtube for ", "search on youtube "] {
        if let Some(what) = q.strip_prefix(p) {
            return Some(Intent {
                reply: format!("Searching YouTube for “{what}”"),
                action: AssistantAction::OpenUrl { url: format!("https://www.youtube.com/results?search_query={}", enc(what)) },
            });
        }
    }
    // ask another AI with the question pre-filled
    for (p, name, url) in [
        ("ask chatgpt ", "ChatGPT", "https://chatgpt.com/?q="),
        ("ask chat gpt ", "ChatGPT", "https://chatgpt.com/?q="),
        ("ask gpt ", "ChatGPT", "https://chatgpt.com/?q="),
        ("ask claude ", "Claude", "https://claude.ai/new?q="),
        ("ask perplexity ", "Perplexity", "https://www.perplexity.ai/search?q="),
    ] {
        if let Some(what) = q.strip_prefix(p) {
            let what = what.trim_start_matches("about ").trim_start_matches("to ").trim();
            if !what.is_empty() {
                return Some(Intent { reply: format!("Asking {name}"), action: AssistantAction::OpenUrl { url: format!("{url}{}", enc(what)) } });
            }
        }
    }
    // web search
    for p in ["google ", "search for ", "search ", "look up ", "web search "] {
        if let Some(what) = q.strip_prefix(p) {
            let what = what.trim_start_matches("for ").trim();
            if !what.is_empty() {
                return Some(Intent {
                    reply: format!("Searching for “{what}”"),
                    action: AssistantAction::OpenUrl { url: format!("https://www.google.com/search?q={}", enc(what)) },
                });
            }
        }
    }
    // media + volume (instant, no AI)
    {
        let vol = |d: i32| Some(Intent { reply: if d > 0 { "Volume up".into() } else { "Volume down".into() }, action: AssistantAction::Media { action: if d > 0 { "volume_up".into() } else { "volume_down".into() } } });
        match q.as_str() {
            "volume up" | "turn up the volume" | "louder" | "turn it up" => return vol(1),
            "volume down" | "turn down the volume" | "quieter" | "turn it down" | "lower the volume" => return vol(-1),
            "mute" | "mute it" | "unmute" => return Some(Intent { reply: "Muted".into(), action: AssistantAction::Media { action: "mute".into() } }),
            "pause" | "pause music" | "pause the music" | "pause song" | "pause the song" => return Some(Intent { reply: "Paused".into(), action: AssistantAction::Media { action: "playpause".into() } }),
            "play" | "play music" | "resume" | "resume music" | "play the music" | "play song" => return Some(Intent { reply: "Playing".into(), action: AssistantAction::Media { action: "playpause".into() } }),
            "next" | "next song" | "next track" | "skip" | "skip song" | "skip this song" => return Some(Intent { reply: "Next track".into(), action: AssistantAction::Media { action: "next".into() } }),
            "previous" | "previous song" | "previous track" | "last song" | "go back" => return Some(Intent { reply: "Previous track".into(), action: AssistantAction::Media { action: "previous".into() } }),
            _ => {}
        }
    }
    // open / launch (English) and "<x> kholo" / "<x> open karo" (Hinglish)
    for p in ["open up ", "open ", "launch ", "start ", "go to ", "show me "] {
        if let Some(what) = q.strip_prefix(p) {
            return open_target(what);
        }
    }
    for s in [" kholo", " open karo", " khol do", " chalao"] {
        if let Some(what) = q.strip_suffix(s) {
            return open_target(what);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn act(q: &str) -> Option<AssistantAction> {
        parse(q).map(|i| i.action)
    }

    #[test]
    fn opens_apps_with_aliases() {
        assert_eq!(act("Open VS Code."), Some(AssistantAction::OpenApp { name: "Visual Studio Code".into() }));
        assert_eq!(act("hey flo, launch slack"), Some(AssistantAction::OpenApp { name: "Slack".into() }));
        assert_eq!(act("open linear"), Some(AssistantAction::OpenApp { name: "Linear".into() }));
        assert_eq!(act("Spotify kholo"), Some(AssistantAction::OpenApp { name: "Spotify".into() }));
    }

    #[test]
    fn opens_sites_and_domains() {
        assert_eq!(act("open youtube"), Some(AssistantAction::OpenUrl { url: "https://youtube.com".into() }));
        assert_eq!(act("open github dot com"), Some(AssistantAction::OpenUrl { url: "https://github.com".into() }));
        assert_eq!(act("go to docs.rs"), Some(AssistantAction::OpenUrl { url: "https://docs.rs".into() }));
    }

    #[test]
    fn searches() {
        assert_eq!(
            act("google best biryani near me"),
            Some(AssistantAction::OpenUrl { url: "https://www.google.com/search?q=best+biryani+near+me".into() })
        );
        assert_eq!(
            act("play lofi beats on youtube"),
            Some(AssistantAction::OpenUrl { url: "https://www.youtube.com/results?search_query=lofi+beats".into() })
        );
    }

    #[test]
    fn asks_other_ais() {
        assert_eq!(
            act("ask ChatGPT how to center a div"),
            Some(AssistantAction::OpenUrl { url: "https://chatgpt.com/?q=how+to+center+a+div".into() })
        );
        assert_eq!(act("ask claude about rust lifetimes"), Some(AssistantAction::OpenUrl { url: "https://claude.ai/new?q=rust+lifetimes".into() }));
        assert!(matches!(act("ask perplexity best laptops 2026"), Some(AssistantAction::OpenUrl { .. })));
    }

    #[test]
    fn leaves_real_requests_to_the_llm() {
        assert!(act("add a to-do to Apollo to send the deck by Friday").is_none());
        assert!(act("what's blocked across my projects").is_none());
        assert!(act("make this shorter").is_none());
        assert!(act("open the pod bay doors and then summarize every note from this week please").is_none());
    }
}
