// Helpers shared by the specs: drive the real Flo app through WebDriver, the OS (real keyboard /
// mouse input, processes, CPU time) and the mock server that wdio.conf.mjs started for this spec.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const ctx = () => globalThis.__flo; // set by wdio.conf.mjs beforeSession
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call a Tauri command inside the app (the window the session is on). */
export async function invoke(cmd, args = {}) {
  const v = await browser.executeAsync(
    (cmd, args, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, args).then(
        (r) => done({ ok: r === undefined ? null : r }),
        (e) => done({ err: String(e) }),
      );
    },
    cmd,
    args,
  );
  if (v && "err" in v) throw new Error(`${cmd}: ${v.err}`);
  return v?.ok;
}

export async function waitFor(fn, { timeout = 15000, interval = 250, msg = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${msg}${last ? `: ${last.message ?? last}` : ""}`);
}

/** Window handles by role: the dashboard ("main") and the pill ("island"). */
export async function handles() {
  const out = { main: [], island: [], all: [] };
  const cur = await browser.getWindowHandle().catch(() => null);
  for (const h of await browser.getWindowHandles()) {
    await browser.switchToWindow(h);
    const hash = await browser.execute(() => location.hash);
    (String(hash).includes("island") ? out.island : out.main).push(h);
    out.all.push(h);
  }
  if (cur) await browser.switchToWindow(cur).catch(() => {});
  return out;
}

export async function toMain() {
  const h = await waitFor(async () => (await handles()).main[0], { msg: "the dashboard window" });
  await browser.switchToWindow(h);
}

export async function toIsland() {
  const h = await waitFor(async () => (await handles()).island[0], { msg: "the island window" });
  await browser.switchToWindow(h);
}

/** Wait for the app's JS bridge (the first webview can still be loading when the session starts). */
export async function ready() {
  await waitFor(async () => (await browser.getWindowHandles()).length >= 2, { timeout: 30000, msg: "both windows" });
  await toMain();
  await waitFor(() => invoke("get_settings"), { timeout: 30000, msg: "the app bridge" });
  // and React has drawn the first screen (sidebar, sign-in or setup)
  await waitFor(() => browser.execute(() => !!document.querySelector("aside, [data-testid=signin], [data-testid=onboarding]")), { timeout: 30000, msg: "the first screen" });
}

export const info = () => invoke("e2e_info");
export const win = async (label) => (await info()).windows.find((w) => w.label === label);

export async function bodyText() {
  return browser.execute(() => document.body.innerText);
}

export async function waitText(text, timeout = 15000) {
  return waitFor(async () => (await bodyText()).includes(text), { timeout, msg: `text “${text}”` });
}

/** Click the first visible button whose text contains `label`. */
export async function clickButton(label, timeout = 15000) {
  const el = await waitFor(
    async () => {
      for (const b of await $$(`//button[contains(normalize-space(.), ${xq(label)})]`)) {
        if ((await b.isDisplayed()) && (await b.isEnabled())) return b;
      }
      return null;
    },
    { timeout, msg: `button “${label}”` },
  );
  await el.click();
  return el;
}

const xq = (s) => (s.includes("'") ? `"${s}"` : `'${s}'`);

// ── artifacts ────────────────────────────────────────────────────────────────────────────────
export function artifact(name) {
  const dir = path.join(ctx().artifacts, ctx().spec);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

/** The current webview, as WebDriver renders it. */
export async function shot(name) {
  await browser.saveScreenshot(artifact(`${name}.png`)).catch((e) => console.warn("screenshot:", e.message));
}

/** The whole screen (the pill, the dashboard and any other window together). */
export function screen(name) {
  const f = artifact(`${name}-screen.png`);
  try {
    if (IS_LINUX) execFileSync("import", ["-window", "root", f], { stdio: "ignore", timeout: 10000 });
    else if (IS_WIN)
      execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${f}')`], { stdio: "ignore", timeout: 20000 });
  } catch (e) {
    console.warn("screen capture failed:", e.message);
  }
}

// ── real OS input ────────────────────────────────────────────────────────────────────────────
const PS_INPUT = () => path.join(ctx().root, "tests/desktop-e2e/support/input.ps1");
function ps(...args) {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS_INPUT(), ...args.map(String)], { stdio: "ignore", timeout: 20000 });
}
export const os = {
  keyDown(k) {
    IS_WIN ? ps("keydown", k) : execFileSync("xdotool", ["keydown", k === "ctrl" ? "Control_L" : k]);
  },
  keyUp(k) {
    IS_WIN ? ps("keyup", k) : execFileSync("xdotool", ["keyup", k === "ctrl" ? "Control_L" : k]);
  },
  move(x, y) {
    IS_WIN ? ps("move", Math.round(x), Math.round(y)) : execFileSync("xdotool", ["mousemove", String(Math.round(x)), String(Math.round(y))]);
  },
  down() {
    IS_WIN ? ps("down") : execFileSync("xdotool", ["mousedown", "1"]);
  },
  up() {
    IS_WIN ? ps("up") : execFileSync("xdotool", ["mouseup", "1"]);
  },
  /** Ask the window manager to close a window (the title-bar ✕), by exact title. */
  closeWindow(title) {
    if (IS_WIN) ps("close", title);
    else spawnSync("wmctrl", ["-F", "-c", title], { timeout: 10000 });
  },
  focus(title) {
    if (IS_WIN) ps("focus", title);
    else spawnSync("xdotool", ["search", "--sync", "--name", title, "windowactivate", "--sync"], { timeout: 10000 });
  },
};

// ── processes ────────────────────────────────────────────────────────────────────────────────
const EXE = () => path.basename(ctx().app);

/** pids of every running Flo (this test's binary). */
export function appPids() {
  if (IS_WIN) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${EXE()}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    return r.stdout.split(/\r?\n/).filter((l) => l.startsWith('"')).map((l) => Number(l.split('","')[1]));
  }
  const r = spawnSync("pgrep", ["-x", EXE().slice(0, 15)], { encoding: "utf8" });
  return r.stdout.split("\n").filter(Boolean).map(Number);
}

/** pid → its descendants (WebKit / WebView2 helper processes). */
export function descendants(pid) {
  if (IS_WIN) {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8" });
    return walk(pid, r.stdout);
  }
  const r = spawnSync("ps", ["-e", "-o", "pid=,ppid="], { encoding: "utf8" });
  return walk(pid, r.stdout);
}
function walk(root, table) {
  const kids = new Map();
  for (const l of table.split(/\r?\n/)) {
    const [p, pp] = l.trim().split(/\s+/).map(Number);
    if (!p) continue;
    if (!kids.has(pp)) kids.set(pp, []);
    kids.get(pp).push(p);
  }
  const out = [];
  const q = [root];
  while (q.length) for (const k of kids.get(q.shift()) ?? []) out.push(k), q.push(k);
  return out;
}

/** CPU seconds used so far by `pids`. */
export function cpuSeconds(pids) {
  if (IS_WIN) {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum`], { encoding: "utf8" });
    return Number(r.stdout.trim() || 0);
  }
  const hz = Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim() || 100);
  let ticks = 0;
  for (const p of pids) {
    try {
      const s = fs.readFileSync(`/proc/${p}/stat`, "utf8");
      const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      ticks += Number(f[11]) + Number(f[12]); // utime, stime
    } catch {}
  }
  return ticks / hz;
}

/** Launch the Flo binary again (as the browser / Start menu would). */
/** Stop every Flo of this test's binary (one the driver didn't start, e.g. via a link). */
export function killApp() {
  const exe = path.basename(ctx().app);
  if (IS_WIN) spawnSync("taskkill", ["/F", "/T", "/IM", exe], { stdio: "ignore" });
  else spawnSync("pkill", ["-x", exe.slice(0, 15)], { stdio: "ignore" });
}

export function launchAgain(args = []) {
  const p = spawn(ctx().app, args, { env: ctx().appEnv, stdio: "ignore", detached: !IS_WIN });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ exited: false, code: null, pid: p.pid }), 15000);
    p.on("exit", (code) => {
      clearTimeout(t);
      resolve({ exited: true, code, pid: p.pid });
    });
  });
}

/** Open a flo:// link through the OS URL handler (registered by Flo at start). */
export function openUrlViaOs(url) {
  // (not `cmd /c start`: cmd would split the URL at its "&")
  if (IS_WIN) return spawnSync("rundll32", ["url.dll,FileProtocolHandler", url], { env: ctx().appEnv, timeout: 15000 });
  return spawnSync("xdg-open", [url], { env: ctx().appEnv, timeout: 15000, encoding: "utf8" });
}

// ── sign-in ──────────────────────────────────────────────────────────────────────────────────
/** Sign in through the real exchange endpoint, without the UI (setup for later flows). */
export async function signInQuick() {
  await toMain();
  const st = await invoke("account_status");
  if (st.signedIn) return;
  const { state } = await invoke("account_google_start");
  const code = ctx().mock.issueCode(state);
  await invoke("account_exchange", { code, state });
  await waitFor(async () => (await invoke("account_status")).signedIn, { msg: "signed in" });
}

/** Skip setup for flows that aren't about it (marks it done the way finishing it does). */
export async function markOnboarded() {
  const s = await invoke("get_settings");
  if (!s.onboarded) await invoke("save_settings", { settings: { ...s, onboarded: true } });
  await browser.execute(() => location.reload());
  await ready();
}

/** Install the speech model from the mock and load it (what setup does). */
export async function installModel() {
  const id = await invoke("setup_speech_model");
  const models = await invoke("list_models");
  if (!models.find((m) => m.id === id)?.installed) await invoke("download_model", { id });
  const s = await invoke("get_settings");
  if (s.sttModel !== id) await invoke("save_settings", { settings: { ...s, sttModel: id } });
  await invoke("load_speech_model", { id });
  return id;
}

export { assert, path, fs };
