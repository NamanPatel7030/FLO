// The dashboard: every page opens from the sidebar without an error screen, light and dark themes
// both render, the permissions page shows this OS's own checks, start-at-login, and the update
// check → download.
import { assert, bodyText, ctx, fs, invoke, IS_LINUX, IS_WIN, markOnboarded, path, ready, screen, shot, signInQuick, sleep, waitFor } from "../support/app.mjs";
import { spawnSync } from "node:child_process";

// sidebar label → data-page id
const PAGES = [
  ["Home", "home"],
  ["Flo Agent", "agent"],
  ["Assistant", "assistant"],
  ["Skills", "skills"],
  ["To-dos", "todos"],
  ["Projects", "projects"],
  ["Notes", "notes"],
  ["Analytics", "analytics"],
  ["History", "history"],
  ["Settings", "settings"],
];

async function openPage(label) {
  const link = await $(`//aside//*[self::button or self::a][normalize-space(.)='${label}']`);
  await link.waitForClickable({ timeout: 10000 });
  await link.click();
  await sleep(900);
}

/** what's on screen in the active page */
async function activePage() {
  return browser.execute(() => {
    const p = document.querySelector("[data-page]:not([hidden])");
    return p ? { id: p.getAttribute("data-page"), text: p.innerText.slice(0, 400), h: p.getBoundingClientRect().height } : null;
  });
}

async function look() {
  return browser.execute(() => {
    const cs = getComputedStyle(document.documentElement);
    const aside = document.querySelector("aside");
    return { theme: document.documentElement.dataset.theme, fg: cs.getPropertyValue("--fg").trim(), bg: cs.getPropertyValue("--bg").trim(), aside: aside ? getComputedStyle(aside).backgroundColor : null };
  });
}

describe("dashboard", () => {
  before(async () => {
    await ready();
    await signInQuick();
    await markOnboarded();
  });

  for (const [label, id] of PAGES) {
    it(`${label} opens from the sidebar and renders`, async () => {
      await openPage(label);
      const p = await waitFor(async () => {
        const a = await activePage();
        return a && a.text.trim().length > 20 ? a : null;
      }, { msg: `the ${label} page content` });
      assert.ok(!/something went wrong|unexpected error|is not a function|undefined is not/i.test(p.text), `no error screen on ${label}`);
      if (p.id !== id) console.warn(`page id for ${label}: ${p.id}`);
      await shot(`page-${id}`);
    });
  }

  it("light and dark themes both render", async () => {
    const s = await invoke("get_settings");
    const looks = {};
    for (const theme of ["light", "dark"]) {
      await invoke("save_settings", { settings: { ...s, theme } });
      await browser.execute(() => location.reload());
      await ready();
      await waitFor(async () => (await look()).theme === theme, { msg: `theme ${theme}` });
      await sleep(1500);
      looks[theme] = await look();
      await shot(`theme-${theme}`);
      screen(`theme-${theme}`);
    }
    fs.writeFileSync(path.join(ctx().artifacts, ctx().spec, "themes.json"), JSON.stringify(looks, null, 2));
    assert.notEqual(looks.light.fg, looks.dark.fg, `text colour differs (${looks.light.fg} vs ${looks.dark.fg})`);
    assert.notEqual(looks.light.bg, looks.dark.bg, `background differs (${looks.light.bg} vs ${looks.dark.bg})`);
    await invoke("save_settings", { settings: s });
    await browser.execute(() => location.reload());
    await ready();
  });

  it("permissions: this OS's checks, no macOS-only ones", async () => {
    const p = await invoke("check_permissions");
    fs.writeFileSync(path.join(ctx().artifacts, ctx().spec, "permissions.json"), JSON.stringify(p, null, 2));
    assert.ok(p.checks.length > 0);
    const ids = p.checks.map((c) => c.id);
    for (const mac of ["inputMonitoring", "screenRecording", "fullDiskAccess"]) assert.ok(!ids.includes(mac), `no macOS check ${mac}`);
    await openPage("Settings");
    const tab = await $("//button[normalize-space(.)='Permissions']");
    if (await tab.isExisting()) {
      await tab.click();
      await sleep(900);
    }
    const t = await bodyText();
    assert.ok(!/System Settings → Privacy|Input Monitoring/i.test(t), "no macOS permission wording on this OS");
    if (IS_LINUX) assert.ok(/Start at login/.test(t) && /Flo key/.test(t), "the Linux checks are listed on the page");
    await shot("permissions");
    screen("permissions");
  });

  it("start at login can be turned on", async () => {
    await invoke("open_permission_settings", { kind: "autostart" });
    await sleep(500);
    if (IS_LINUX) {
      const f = path.join(ctx().appEnv.XDG_CONFIG_HOME, "autostart", "flo.desktop");
      assert.ok(fs.existsSync(f), "~/.config/autostart/flo.desktop written");
      assert.match(fs.readFileSync(f, "utf8"), /Exec=.*flo-flow/, "it starts this Flo");
    } else if (IS_WIN) {
      const r = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"], { encoding: "utf8" });
      assert.match(r.stdout, /flo/i, "a Run entry for Flo");
    }
    const auto = (await invoke("check_permissions")).checks.find((c) => c.id === "autostart");
    if (auto) assert.equal(auto.status, "ok", "the start-at-login check is now ok");
  });

  it("update check: up to date, then a new version offers the installer download", async () => {
    const up = await invoke("check_update");
    assert.equal(up.available, false, "up to date when the server has nothing newer");
    ctx().mock.state.update = { version: "9.9.9", notes: "E2E release" };
    const info = await invoke("check_update");
    assert.equal(info.available, true);
    assert.equal(info.version, "9.9.9");
    assert.match(info.downloadUrl ?? "", IS_WIN ? /setup\.exe$/ : /\.(deb|AppImage)$/);
    if (IS_LINUX) {
      await invoke("install_update");
      await waitFor(() => ctx().mock.state.opened.some((u) => /releases\/latest\/download/.test(u)), { msg: "the installer download to open in the browser" });
    }
    ctx().mock.state.update = null;
  });
});
