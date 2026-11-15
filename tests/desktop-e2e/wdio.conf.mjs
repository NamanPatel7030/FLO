// Real-app E2E suite for Flo on Linux and Windows: the built app (Rust + system webview) driven by
// tauri-driver (WebKitWebDriver on Linux, msedgedriver on Windows) + WebdriverIO.
//
//   1. build:   cd src-tauri && cargo build --profile e2e --features e2e,tauri/custom-protocol
//               (after `npm run build` at the repo root; the e2e feature is never in a release build)
//   2. model:   cd tests/desktop-e2e && npm ci && npm run fetch-model
//   3. run:     npm test                     (Linux: inside xvfb-run, with a window manager; see
//                                             docker/run.sh for the exact local recipe)
//
// Every spec file gets a fresh Flo: its own empty home / app-data folder, its own mock account
// server and model host (support/mock-server.mjs) and its own tauri-driver, so specs never share
// state. FLO_APP overrides the binary path.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./support/mock-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const IS_WIN = process.platform === "win32";
const APP =
  process.env.FLO_APP ?? path.join(ROOT, "src-tauri/target", process.env.FLO_PROFILE ?? "e2e", IS_WIN ? "flo-flow.exe" : "flo-flow");
const ARTIFACTS = process.env.FLO_E2E_ARTIFACTS ?? path.join(HERE, "artifacts");
const MODEL = path.join(HERE, ".cache", "model.bin");
const DRIVER_PORT = 4444;

let driver;

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });

function killLeftovers() {
  // a spec that failed mid-way (or a session that never started) can leave Flo or the drivers
  // running; never let them leak into the next spec
  const exe = path.basename(APP);
  const names = IS_WIN ? [exe, "tauri-driver.exe", "msedgedriver.exe"] : [exe.slice(0, 15), "tauri-driver", "WebKitWebDriver"];
  for (const n of names) {
    try {
      if (IS_WIN) spawnSync("taskkill", ["/F", "/T", "/IM", n], { stdio: "ignore" });
      else spawnSync("pkill", ["-9", "-x", n], { stdio: "ignore" });
    } catch {}
  }
}

function wipeWindowsAppData() {
  if (process.env.CI !== "true" && process.env.FLO_E2E_WIPE !== "1") {
    throw new Error("On Windows the suite resets Flo's app data before every spec. Run it on CI, or set FLO_E2E_WIPE=1 on a machine whose Flo data you don't need.");
  }
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (base) fs.rmSync(path.join(base, "com.flo.flow"), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const log = path.join(process.env.LOCALAPPDATA ?? "", "Flo", "logs", "flo.log");
  fs.rmSync(log, { force: true });
  // the sign-in token from the previous spec (Windows Credential Manager)
  for (const name of ["account-token", "db-key"]) spawnSync("cmdkey", [`/delete:${name}.com.flo.flow`], { stdio: "ignore" });
}

async function waitPortFree(port, ms = 10000) {
  const end = Date.now() + ms;
  while ((await portOpen(port)) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
}

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  // classic WebDriver only: WebKitWebDriver / msedgedriver-for-WebView2 don't do BiDi
  capabilities: [{ maxInstances: 1, "wdio:enforceWebDriverClassic": true, "tauri:options": { application: APP } }],
  logLevel: "warn",
  outputDir: path.join(ARTIFACTS, "wdio-logs"),
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 300000 },
  specFileRetries: Number(process.env.FLO_E2E_RETRIES ?? 1),

  onPrepare() {
    if (!fs.existsSync(APP)) throw new Error(`Flo binary not found at ${APP} (build it first, see wdio.conf.mjs)`);
    fs.mkdirSync(ARTIFACTS, { recursive: true });
  },

  async beforeSession(_cfg, _caps, specs) {
    const spec = path.basename(specs[0] ?? "spec").replace(/\.e2e\.mjs$/, "");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `flo-e2e-${spec}-`));
    const mock = await startMock({ modelFile: MODEL });
    const env = {
      ...process.env,
      FLO_E2E: "1",
      FLO_E2E_ACCOUNT_URL: mock.url,
      FLO_E2E_MODEL_URL: `${mock.url}/models`,
      FLO_E2E_WAV: path.join(HERE, "fixtures", "dictation.wav"),
      FLO_E2E_MOCK: mock.url,
      RUST_LOG: process.env.RUST_LOG ?? "info",
    };
    if (IS_WIN) {
      // Windows resolves the app data folders through the Known Folder API, not %APPDATA%, so
      // they can't be redirected: start every spec from a clean Flo instead (CI machines only, so
      // a developer's own Flo data is never wiped by accident)
      wipeWindowsAppData();
    } else {
      Object.assign(env, {
        HOME: home,
        XDG_DATA_HOME: path.join(home, ".local/share"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        BROWSER: path.join(HERE, "support/fake-browser.sh"),
      });
      // web links → the fake browser, whatever browsers the machine has (a CI runner has Chrome
      // and Firefox registered; xdg-open would start them instead of honouring $BROWSER)
      const apps = path.join(env.XDG_DATA_HOME, "applications");
      fs.mkdirSync(apps, { recursive: true });
      fs.mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
      fs.writeFileSync(
        path.join(apps, "flo-e2e-browser.desktop"),
        `[Desktop Entry]\nType=Application\nName=E2E browser\nExec=${env.BROWSER} %u\nNoDisplay=true\nMimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;\n`,
      );
      fs.writeFileSync(
        path.join(env.XDG_CONFIG_HOME, "mimeapps.list"),
        "[Default Applications]\nx-scheme-handler/http=flo-e2e-browser.desktop\nx-scheme-handler/https=flo-e2e-browser.desktop\ntext/html=flo-e2e-browser.desktop\n",
      );
    }
    killLeftovers();
    await waitPortFree(DRIVER_PORT);
    await waitPortFree(DRIVER_PORT + 1);
    driver = spawn(process.env.TAURI_DRIVER ?? "tauri-driver", ["--port", String(DRIVER_PORT)], { env, stdio: [null, "inherit", "inherit"] });
    const end = Date.now() + 20000;
    while (!(await portOpen(DRIVER_PORT))) {
      if (Date.now() > end) throw new Error("tauri-driver did not start");
      await new Promise((r) => setTimeout(r, 200));
    }
    globalThis.__flo = { spec, home, mock, app: APP, appEnv: env, root: ROOT, artifacts: ARTIFACTS };
  },

  async afterTest(test, _ctx, { passed, error }) {
    if (passed || !error) return; // passed or skipped
    const dir = path.join(ARTIFACTS, globalThis.__flo?.spec ?? "spec");
    fs.mkdirSync(dir, { recursive: true });
    const name = test.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    await browser.saveScreenshot(path.join(dir, `FAILED-${name}.png`)).catch(() => {});
  },

  async afterSession() {
    const f = globalThis.__flo;
    driver?.kill("SIGKILL");
    driver = undefined;
    killLeftovers();
    if (f) {
      await f.mock.close().catch(() => {});
      // keep the app's own log next to the screenshots
      const logs = IS_WIN
        ? [path.join(process.env.LOCALAPPDATA ?? "", "Flo", "logs", "flo.log")]
        : [path.join(f.home, ".local/share", "Flo", "logs", "flo.log")];
      for (const l of logs) {
        if (fs.existsSync(l)) {
          fs.mkdirSync(path.join(ARTIFACTS, f.spec), { recursive: true });
          fs.copyFileSync(l, path.join(ARTIFACTS, f.spec, "flo.log"));
        }
      }
      fs.rmSync(f.home, { recursive: true, force: true, maxRetries: 3 });
    }
  },
};
