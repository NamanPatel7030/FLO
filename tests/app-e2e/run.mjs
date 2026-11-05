// End-to-end test of the REAL Flo app (Rust backend + system webview) via tauri-driver.
// Works on Windows and Linux (tauri-driver isn't available on macOS — there we use the
// --selftest / --diag modes + Playwright).
//
//   cargo install tauri-driver   (+ WebKitWebDriver on Linux, msedgedriver on Windows)
//   tauri-driver &               (listens on :4444)
//   node tests/app-e2e/run.mjs path/to/flo-flow[.exe]
//
// No dependencies: plain WebDriver over fetch.
import assert from "node:assert/strict";

const DRIVER = process.env.TAURI_DRIVER_URL ?? "http://127.0.0.1:4444";
const app = process.argv[2];
if (!app) {
  console.error("usage: node tests/app-e2e/run.mjs <path-to-flo-binary>");
  process.exit(2);
}

async function wd(method, path, body) {
  const r = await fetch(DRIVER + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sid;
const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    console.log(`  ✘ ${name}\n      ${String(e).split("\n")[0]}`);
  }
}

/** Call a real Tauri command inside the app. */
async function invoke(cmd, args = {}) {
  const v = await wd("POST", `/session/${sid}/execute/async`, {
    script: `const [cmd, args, done] = arguments;
      window.__TAURI_INTERNALS__.invoke(cmd, args).then(r => done({ ok: r }), e => done({ err: String(e) }));`,
    args: [cmd, args],
  });
  if (v && "err" in v) throw new Error(`${cmd}: ${v.err}`);
  return v?.ok;
}

async function bodyText() {
  return wd("POST", `/session/${sid}/execute/sync`, { script: "return document.body.innerText", args: [] });
}

async function goto(hash) {
  await wd("POST", `/session/${sid}/execute/sync`, { script: `location.hash = arguments[0]`, args: [hash] });
  await sleep(500);
}

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw last ?? new Error("timed out");
}

console.log(`Flo app e2e · ${app}`);
sid = (
  await wd("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: app } } },
  })
).sessionId;

try {
  await step("app starts with dashboard + notch windows", async () => {
    await waitFor(async () => (await wd("GET", `/session/${sid}/window/handles`)).length >= 2, 20000);
    // make sure we drive the dashboard (not the island)
    for (const h of await wd("GET", `/session/${sid}/window/handles`)) {
      await wd("POST", `/session/${sid}/window`, { handle: h });
      const hash = await wd("POST", `/session/${sid}/execute/sync`, { script: "return location.hash", args: [] });
      if (!String(hash).includes("island")) break;
    }
    await waitFor(async () => !!(await invoke("get_settings")));
  });

  await step("settings round-trip", async () => {
    const s = await invoke("get_settings");
    assert.ok(s.hotkeyDictation && s.hotkeyAssistant);
    await invoke("save_settings", { settings: { ...s, userName: "E2E" } });
    assert.equal((await invoke("get_settings")).userName, "E2E");
    await invoke("save_settings", { settings: s });
  });

  await step("to-dos: add → complete → delete", async () => {
    const t = await invoke("add_todo", { title: "E2E send the deck", projectId: null, due: null });
    await invoke("update_todo", { id: t.id, status: "done" });
    const list = await invoke("list_todos");
    assert.equal(list.find((x) => x.id === t.id)?.status, "done");
    await invoke("delete_todo", { id: t.id });
    assert.ok(!(await invoke("list_todos")).some((x) => x.id === t.id));
  });

  await step("projects + counts", async () => {
    const p = await invoke("create_project", { name: "E2E Apollo", description: "test" });
    const t = await invoke("add_todo", { title: "E2E task", projectId: p.id, due: null });
    const got = (await invoke("list_projects")).find((x) => x.id === p.id);
    assert.equal(got.openTodos, 1);
    await invoke("delete_todo", { id: t.id });
    await invoke("delete_project", { id: p.id });
  });

  await step("context library: add → pin → delete", async () => {
    const d = await invoke("add_context_doc", { title: "E2E notes", content: "# About\nReply briefly." });
    await invoke("update_context_doc", { id: d.id, pinned: true });
    assert.ok((await invoke("list_context_docs")).find((x) => x.id === d.id)?.pinned);
    await invoke("delete_context_doc", { id: d.id });
  });

  await step("dictionary: learned correction", async () => {
    const e = await invoke("accept_correction", { heard: "tory", corrected: "Tauri" });
    assert.equal(e.replacement, "Tauri");
    await invoke("remove_dictionary", { id: e.id });
  });

  await step("analytics, history, notes, integrations, models", async () => {
    const a = await invoke("get_analytics", { days: 7 });
    assert.equal(a.daily.length, 7);
    assert.ok(Array.isArray(await invoke("list_history", { limit: 5 })));
    assert.ok(Array.isArray(await invoke("list_notes")));
    assert.ok((await invoke("list_integrations")).length >= 4);
    assert.ok((await invoke("provider_models", { provider: "minimax" })).length > 0);
  });

  await step("privacy: no unexpected network hosts", async () => {
    const log = await invoke("network_log");
    const allowed = log.filter((l) => l.allowed).map((l) => l.host);
    for (const h of allowed) assert.ok(/^(127\.0\.0\.1|localhost|.*huggingface\.co|.*hf\.co)$/.test(h) || !h, `unexpected host ${h}`);
  });

  for (const [hash, text] of [
    ["#/home", "Flo"],
    ["#/todos", "To-dos"],
    ["#/projects", "Projects"],
    ["#/notes", "Notes"],
    ["#/analytics", "Analytics"],
    ["#/history", "History"],
    ["#/context", "Context"],
    ["#/settings", "Settings"],
  ]) {
    await step(`page ${hash} renders`, async () => {
      await goto(hash);
      await waitFor(async () => (await bodyText()).includes(text));
    });
  }
} finally {
  await wd("DELETE", `/session/${sid}`).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
