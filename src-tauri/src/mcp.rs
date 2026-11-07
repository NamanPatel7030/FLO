//! Minimal MCP (Model Context Protocol) client: connect to a user-added server, list its tools,
//! call a tool. Two transports: stdio (a local command, newline-delimited JSON-RPC) and
//! Streamable HTTP (JSON-RPC POSTs; replies as JSON or an SSE stream). Servers only run because
//! the user added them in Skills → Connections; HTTP servers are reachable only through the
//! egress allow-list entry made for their host (Purpose::Mcp).
use crate::egress::Purpose;
use crate::model::{Connection, McpTool};
use crate::state::Shared;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOL: &str = "2025-06-18";
const TIMEOUT: Duration = Duration::from_secs(30);

enum Transport {
    Stdio {
        child: tokio::process::Child,
        stdin: tokio::process::ChildStdin,
        lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    },
    Http {
        client: reqwest::Client,
        url: String,
        session: Option<String>,
        headers: Vec<(String, String)>,
    },
}

pub struct Session {
    t: Transport,
    next_id: u64,
    pub server_name: String,
}

/// PATH for servers started from a Finder-launched app (which gets a bare /usr/bin:/bin).
fn server_path() -> String {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    let mut parts: Vec<String> = std::env::var("PATH").unwrap_or_default().split(':').filter(|p| !p.is_empty()).map(String::from).collect();
    for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", &format!("{home}/.local/bin"), &format!("{home}/.cargo/bin"), &format!("{home}/.bun/bin")] {
        if !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    }
    parts.join(":")
}

fn stdio_transport(c: &Connection) -> Result<Transport> {
    if c.command.trim().is_empty() {
        bail!("Add the command that starts this MCP server (for example: npx -y @modelcontextprotocol/server-filesystem ~/Documents)");
    }
    let mut cmd = tokio::process::Command::new(c.command.trim());
    cmd.args(&c.args)
        .envs(&c.env)
        .env("PATH", server_path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn().with_context(|| format!("couldn't start “{}”", c.command.trim()))?;
    let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    Ok(Transport::Stdio { child, stdin, lines: BufReader::new(stdout).lines() })
}

/// "Bearer abc" / "X-Api-Key: abc" style header lines from the connection's env map (http only).
fn http_headers(c: &Connection) -> Vec<(String, String)> {
    c.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

impl Session {
    /// Start / reach the server and complete the MCP handshake.
    pub async fn connect(st: &Shared, c: &Connection) -> Result<Session> {
        let t = match c.transport.as_str() {
            "http" => {
                let url = url::Url::parse(c.url.trim()).context("MCP server URL is not valid")?;
                if !matches!(url.scheme(), "https" | "http") {
                    bail!("MCP server URL must be http(s)");
                }
                let host = url.host_str().unwrap_or_default().to_string();
                refresh_hosts(st, Some(host));
                st.egress.check(url.as_str(), Purpose::Mcp, false)?;
                Transport::Http { client: st.egress.client(Purpose::Mcp, false), url: url.to_string(), session: None, headers: http_headers(c) }
            }
            _ => stdio_transport(c)?,
        };
        Self::start(t, &c.name).await
    }

    /// A local MCP server started straight from its command (no app state needed).
    pub async fn connect_stdio(c: &Connection) -> Result<Session> {
        Self::start(stdio_transport(c)?, &c.name).await
    }

    async fn start(t: Transport, name: &str) -> Result<Session> {
        let mut s = Session { t, next_id: 1, server_name: name.to_string() };
        let init = s
            .request(
                "initialize",
                json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "Flo", "version": env!("CARGO_PKG_VERSION") } }),
            )
            .await
            .context("the server didn't complete the MCP handshake")?;
        if let Some(name) = init["serverInfo"]["name"].as_str() {
            if s.server_name.is_empty() {
                s.server_name = name.to_string();
            }
        }
        s.notify("notifications/initialized", json!({})).await?;
        Ok(s)
    }

    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>> {
        let mut out = vec![];
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let r = self.request("tools/list", params).await?;
            for t in r["tools"].as_array().cloned().unwrap_or_default() {
                out.push(McpTool {
                    name: t["name"].as_str().unwrap_or_default().to_string(),
                    description: t["description"].as_str().unwrap_or_default().to_string(),
                    input_schema: if t["inputSchema"].is_object() { t["inputSchema"].clone() } else { json!({ "type": "object", "properties": {} }) },
                });
            }
            cursor = r["nextCursor"].as_str().map(String::from);
            if cursor.is_none() {
                break;
            }
        }
        Ok(out)
    }

    /// Call a tool; returns its text output and whether the server flagged it as an error.
    pub async fn call_tool(&mut self, name: &str, arguments: Value) -> Result<(String, bool)> {
        let r = self.request("tools/call", json!({ "name": name, "arguments": arguments })).await?;
        let text = r["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .map(|b| match b["type"].as_str() {
                        Some("text") => b["text"].as_str().unwrap_or_default().to_string(),
                        Some(other) => format!("[{other} content]"),
                        None => String::new(),
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .filter(|t| !t.is_empty())
            .or_else(|| r.get("structuredContent").map(|v| v.to_string()))
            .unwrap_or_default();
        Ok((text, r["isError"].as_bool().unwrap_or(false)))
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        match &mut self.t {
            Transport::Stdio { stdin, .. } => {
                stdin.write_all(format!("{msg}\n").as_bytes()).await?;
                stdin.flush().await?;
            }
            Transport::Http { client, url, session, headers } => {
                let mut req = client.post(url.as_str()).header("Accept", "application/json, text/event-stream").header("MCP-Protocol-Version", PROTOCOL).json(&msg);
                if let Some(sid) = session {
                    req = req.header("Mcp-Session-Id", sid.as_str());
                }
                for (k, v) in headers.iter() {
                    req = req.header(k.as_str(), v.as_str());
                }
                let _ = req.timeout(TIMEOUT).send().await?;
            }
        }
        Ok(())
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let reply = match &mut self.t {
            Transport::Stdio { stdin, lines, .. } => {
                stdin.write_all(format!("{msg}\n").as_bytes()).await?;
                stdin.flush().await?;
                tokio::time::timeout(TIMEOUT, async {
                    loop {
                        let Some(line) = lines.next_line().await? else { bail!("the server closed the connection") };
                        // skip logs / notifications / unrelated replies
                        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { continue };
                        if v["id"].as_u64() == Some(id) {
                            return Ok(v);
                        }
                    }
                })
                .await
                .map_err(|_| anyhow!("the MCP server didn't answer {method} in time"))??
            }
            Transport::Http { client, url, session, headers } => {
                let mut req = client.post(url.as_str()).header("Accept", "application/json, text/event-stream").json(&msg);
                if method != "initialize" {
                    req = req.header("MCP-Protocol-Version", PROTOCOL);
                }
                if let Some(sid) = session.as_ref() {
                    req = req.header("Mcp-Session-Id", sid.as_str());
                }
                for (k, v) in headers.iter() {
                    req = req.header(k.as_str(), v.as_str());
                }
                let resp = req.timeout(TIMEOUT).send().await?;
                if let Some(sid) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
                    *session = Some(sid.to_string());
                }
                let status = resp.status();
                let is_sse = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).map(|c| c.contains("text/event-stream")).unwrap_or(false);
                let body = resp.text().await?;
                if !status.is_success() {
                    bail!("MCP server returned {status}: {}", crate::text::truncate_chars(&body, 200));
                }
                if is_sse {
                    sse_reply(&body, id).ok_or_else(|| anyhow!("no reply to {method} in the server's event stream"))?
                } else {
                    serde_json::from_str(&body).context("the MCP server's reply wasn't JSON")?
                }
            }
        };
        if let Some(err) = reply.get("error") {
            bail!("{}", err["message"].as_str().unwrap_or("MCP error"));
        }
        Ok(reply["result"].clone())
    }

    pub async fn close(self) {
        if let Transport::Stdio { mut child, stdin, .. } = self.t {
            drop(stdin);
            let _ = tokio::time::timeout(Duration::from_millis(500), child.wait()).await;
            let _ = child.kill().await;
        }
    }
}

/// The JSON-RPC reply with this id inside an SSE body ("data: {...}" lines).
pub fn sse_reply(body: &str, id: u64) -> Option<Value> {
    body.split("\n\n").find_map(|event| {
        let data: String = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.trim_start()).collect::<Vec<_>>().join("\n");
        let v: Value = serde_json::from_str(&data).ok()?;
        (v["id"].as_u64() == Some(id)).then_some(v)
    })
}

/// Allow (Purpose::Mcp only) the hosts of the user's HTTP MCP servers, plus one being tested.
pub fn refresh_hosts(st: &Shared, extra: Option<String>) {
    let mut hosts: Vec<String> = st
        .db
        .list_connections()
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.kind == "mcp" && c.transport == "http" && c.enabled)
        .filter_map(|c| url::Url::parse(c.url.trim()).ok()?.host_str().map(String::from))
        .collect();
    hosts.extend(extra);
    st.egress.set_mcp_hosts(hosts);
}

/// Connect, list tools, disconnect (Settings "Test" and the canvas tool picker).
pub async fn probe(st: &Shared, c: &Connection) -> Result<Vec<McpTool>> {
    let mut s = Session::connect(st, c).await?;
    let tools = s.list_tools().await;
    s.close().await;
    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_reply_in_an_sse_stream() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"ok\":true}}\n\n";
        assert_eq!(sse_reply(body, 3).unwrap()["result"]["ok"], true);
        assert!(sse_reply(body, 4).is_none());
    }

    /// End to end against a real stdio MCP server (scripts/mcp-test-server.py).
    #[tokio::test]
    async fn talks_to_a_real_stdio_server() {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/mcp-test-server.py");
        let c = Connection { name: "test".into(), kind: "mcp".into(), transport: "stdio".into(), command: "python3".into(), args: vec!["-I".into(), script.into()], ..Default::default() };
        let mut s = Session::connect_stdio(&c).await.expect("handshake");
        let tools = s.list_tools().await.unwrap();
        let names: Vec<_> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["add", "shout"]);
        assert_eq!(tools[0].input_schema["properties"]["a"]["type"], "number");
        assert_eq!(s.call_tool("add", serde_json::json!({ "a": 2, "b": 40 })).await.unwrap(), ("42".to_string(), false));
        assert_eq!(s.call_tool("shout", serde_json::json!({ "text": "hello" })).await.unwrap().0, "HELLO");
        let (msg, is_err) = s.call_tool("nope", serde_json::json!({})).await.unwrap();
        assert!(is_err && msg.contains("unknown tool"));
        s.close().await;
    }

    #[test]
    fn finder_launched_path_includes_homebrew() {
        let p = server_path();
        assert!(p.contains("/opt/homebrew/bin") && p.contains("/usr/local/bin"));
    }
}
