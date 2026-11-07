#!/usr/bin/env python3
"""A tiny stdio MCP server for Flo's tests: two tools, `add` and `shout`.

Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, like any stdio MCP server.
Also handy for trying Skills → Connections by hand:  command `python3`, args `scripts/mcp-test-server.py`.
"""
import json
import sys

TOOLS = [
    {
        "name": "add",
        "description": "Add two numbers.",
        "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]},
    },
    {
        "name": "shout",
        "description": "Return the text in capitals.",
        "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
    },
]


def reply(msg_id, result=None, error=None):
    out = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()


def text(t, is_error=False):
    return {"content": [{"type": "text", "text": t}], "isError": is_error}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method, msg_id, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if msg_id is None:
        continue  # a notification (e.g. notifications/initialized)
    # a log line on stdout that isn't JSON-RPC, to make sure clients skip noise
    sys.stdout.write("debug: handling " + str(method) + "\n")
    if method == "initialize":
        reply(msg_id, {"protocolVersion": params.get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}}, "serverInfo": {"name": "flo-test", "version": "1"}})
    elif method == "tools/list":
        reply(msg_id, {"tools": TOOLS})
    elif method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name == "add":
            total = args.get("a", 0) + args.get("b", 0)
            reply(msg_id, text(str(int(total)) if float(total).is_integer() else str(total)))
        elif name == "shout":
            reply(msg_id, text(str(args.get("text", "")).upper()))
        else:
            reply(msg_id, text("unknown tool: " + str(name), True))
    else:
        reply(msg_id, error={"code": -32601, "message": "method not found"})
