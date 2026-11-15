// An idle Flo stays cheap (CPU over 60 s, app + its web view processes), and "Quit Flo" from the
// tray ends every process it started.
import { spawnSync } from "node:child_process";
import { appPids, artifact, assert, cpuSeconds, descendants, fs, info, invoke, IS_WIN, markOnboarded, os, ready, signInQuick, sleep, toMain, waitFor } from "../support/app.mjs";

// % of ONE core, averaged over the window (CI machines are slow and share cores; a busy loop or a
// running animation shows up as 20 %+)
const MAX_IDLE_PCT = Number(process.env.FLO_E2E_MAX_IDLE_CPU ?? (IS_WIN ? 6 : 6));
const WINDOW_S = Number(process.env.FLO_E2E_IDLE_SECONDS ?? 60);

const procName = (pid) => {
  try {
    if (IS_WIN) {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { "$($p.Name) $($p.CommandLine)" }`], { encoding: "utf8" });
      return r.stdout.trim().slice(0, 240) || "?";
    }
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "?";
  }
};
const procState = (pid) => {
  try {
    return IS_WIN ? "" : fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[0];
  } catch {
    return "";
  }
};

describe("idle and quit", () => {
  let pid;
  before(async () => {
    await ready();
    await signInQuick();
    await markOnboarded();
    pid = (await info()).pid;
    os.move(5, 700);
    // close the dashboard as a user would; Flo keeps running with just the pill
    if (IS_WIN) {
      // Windows: a hidden window of the process can also be titled "Flo", so FindWindow + WM_CLOSE
      // may hit the wrong one; send the same close request the ✕ sends, to the dashboard itself
      await toMain();
      await invoke("e2e_close_window", { label: "main" }).catch(() => {});
    } else {
      os.closeWindow("Flo");
    }
    await waitFor(async () => (await browser.getWindowHandles()).length === 1, { timeout: 10000, msg: "the dashboard to close" });
    await browser.switchToWindow((await browser.getWindowHandles())[0]);
    assert.deepEqual(appPids(), [pid], "Flo keeps running in the pill after the dashboard closes");
    await sleep(20000); // past start-up work (first update check, background setup at ~20 s)
  });

  it(`idle CPU stays under ${MAX_IDLE_PCT}% of a core for ${WINDOW_S} s`, async () => {
    const pids = () => [pid, ...descendants(pid)];
    const t0 = Date.now();
    const c0 = cpuSeconds(pids());
    await sleep(WINDOW_S * 1000);
    const c1 = cpuSeconds(pids());
    const pct = ((c1 - c0) / ((Date.now() - t0) / 1000)) * 100;
    fs.writeFileSync(artifact("idle-cpu.json"), JSON.stringify({ pct, seconds: WINDOW_S, pids: pids() }, null, 2));
    console.log(`idle CPU: ${pct.toFixed(2)} % of one core over ${WINDOW_S} s`);
    assert.ok(pct < MAX_IDLE_PCT, `idle CPU ${pct.toFixed(2)}% < ${MAX_IDLE_PCT}%`);
  });

  it("Quit Flo from the tray ends every Flo process", async () => {
    // the dashboard was closed: drive the island's web view now
    const h = await browser.getWindowHandles();
    await browser.switchToWindow(h[0]);
    const kids = descendants(pid);
    // Flo exits while this call is in flight, so the WebDriver call itself may fail: expected
    await browser.execute(() => void window.__TAURI_INTERNALS__.invoke("e2e_tray", { id: "quit" })).catch(() => {});
    await waitFor(() => appPids().length === 0, { timeout: 15000, msg: "Flo to exit" });
    const names = Object.fromEntries(kids.map((k) => [k, procName(k)]));
    const alive = () =>
      kids.filter((k) => {
        try {
          process.kill(k, 0);
          return !/zombie|^Z/.test(procState(k));
        } catch {
          return false;
        }
      });
    await waitFor(() => alive().length === 0, { timeout: 10000, msg: "Flo's helper processes to exit" }).catch(() => {});
    if (alive().length && IS_WIN) {
      // WebView2's own processes can stay up while msedgedriver still holds its DevTools
      // connection to them; let the driver go first, then they must exit too
      console.warn("still running after quit (driver attached):", alive().map((k) => `${k} ${procName(k)}`));
      await browser.deleteSession().catch(() => {});
      await waitFor(() => alive().length === 0, { timeout: 15000, msg: "WebView2 to exit after the driver let go" }).catch(() => {});
    }
    assert.deepEqual(alive().map((k) => `${k} ${names[k]}`), [], "no helper process outlives Flo");
  });
});
