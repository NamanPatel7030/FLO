// First launch → sign-in gate (pill hidden) → "Continue with Google" → the browser leg → the
// flo://auth deep link reaches the RUNNING Flo (no second instance, window, pill or tray icon).
import { appPids, assert, clickButton, ctx, handles, info, invoke, IS_LINUX, IS_WIN, launchAgain, openUrlViaOs, ready, screen, shot, sleep, toMain, waitFor } from "../support/app.mjs";
import { spawnSync } from "node:child_process";

describe("first launch and Google sign-in", () => {
  let pid;

  it("shows the sign-in screen and keeps the pill hidden", async () => {
    await ready();
    await $("[data-testid=signin]").waitForDisplayed({ timeout: 30000 });
    const i = await info();
    pid = i.pid;
    assert.equal(i.signedIn, false);
    const island = i.windows.find((w) => w.label === "island");
    assert.ok(island, "the island window exists");
    assert.equal(island.visible, false, "the pill is hidden before sign-in");
    assert.equal(i.tray, true, "the tray icon is up");
    assert.deepEqual(appPids(), [pid], "exactly one Flo process");
    await shot("signin");
    screen("signin");
  });

  it("registers the flo:// link handler with the OS", async () => {
    if (IS_LINUX) {
      const r = spawnSync("xdg-mime", ["query", "default", "x-scheme-handler/flo"], { env: ctx().appEnv, encoding: "utf8" });
      assert.match(r.stdout.trim(), /\.desktop$/, `xdg-mime has a flo:// handler (got “${r.stdout.trim()}” ${r.stderr ?? ""})`);
    } else if (IS_WIN) {
      const r = spawnSync("reg", ["query", "HKCU\\Software\\Classes\\flo\\shell\\open\\command"], { encoding: "utf8" });
      assert.match(r.stdout, /flo-flow/i, "HKCU\\Software\\Classes\\flo points at Flo");
    }
  });

  it("completes Google sign-in through the deep link, in the running instance", async () => {
    await clickButton("Continue with Google");
    await $("[data-testid=google-wait]").waitForDisplayed({ timeout: 15000 });
    await shot("google-wait");
    // the browser leg: Flo opened {account}/app/connect?state=… (the fake browser reports it)
    let state = await waitFor(() => ctx().mock.state.connects.at(-1), { timeout: 10000, msg: "Flo to open the sign-in page in the browser" }).catch(() => null);
    if (!state && IS_WIN) {
      // the CI desktop may have no default browser to open; take the state from a second start
      state = (await invoke("account_google_start")).state;
    }
    assert.ok(state, "Flo opened /app/connect with a state");
    const code = ctx().mock.issueCode(state);
    const link = `flo://auth?code=${code}&state=${state}`;
    // the website sends the browser to flo://auth… → the OS starts Flo with the link → the single
    // instance plugin hands it to the running Flo and the new process exits
    const r = openUrlViaOs(link);
    const viaOs = await waitFor(async () => (await invoke("account_status")).signedIn, { timeout: 20000, msg: "sign-in via the OS link handler" }).catch(() => false);
    if (!viaOs) {
      console.warn("OS handler didn't deliver the link", r?.stdout, r?.stderr, ctx().mock.state.opened);
      const second = await launchAgain([link]);
      assert.ok(second.exited, "a second Flo started with the link exits (hands it over)");
    }
    await waitFor(async () => (await invoke("account_status")).signedIn, { timeout: 20000, msg: "signed in" });
    assert.ok(viaOs, "the flo:// link opened through the OS reached the running Flo");
  });

  it("is signed in with exactly one Flo, one dashboard, one pill and one tray icon", async () => {
    await toMain();
    await $("[data-testid=signin]").waitForDisplayed({ reverse: true, timeout: 20000 });
    await waitFor(() => appPids().length === 1, { timeout: 15000, msg: "the second process to exit" });
    const i = await info();
    assert.equal(i.pid, pid, "the original process signed in");
    assert.deepEqual(appPids(), [pid]);
    assert.equal(i.windows.filter((w) => w.label === "main").length, 1);
    const island = i.windows.find((w) => w.label === "island");
    assert.ok(island?.visible, "the pill shows after sign-in");
    assert.equal(i.tray, true);
    const h = await handles();
    assert.equal(h.main.length, 1, "one dashboard webview");
    assert.equal(h.island.length, 1, "one island webview");
    await sleep(1200);
    await shot("signed-in");
    screen("signed-in");
  });

  it("a plain second launch (Start menu / autostart) hands over and exits", async () => {
    const r = await launchAgain([]);
    assert.ok(r.exited, "the second launch exits");
    await sleep(1000);
    assert.deepEqual(appPids(), [pid], "still exactly one Flo");
    const h = await handles();
    assert.equal(h.main.length, 1);
    assert.equal(h.island.length, 1);
  });
});
