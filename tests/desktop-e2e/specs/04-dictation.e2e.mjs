// Dictation into another app: a plain text window has focus, the Flo key (Ctrl) is held with real
// OS key events while the WAV plays as the microphone, and the words land in that window. Also the
// tray's click-to-talk (for desktops where the key can't be read) and the history entry.
import { appPids, artifact, assert, ctx, fs, invoke, IS_WIN, installModel, markOnboarded, os, path, ready, screen, signInQuick, sleep, waitFor } from "../support/app.mjs";
import { spawn } from "node:child_process";

const WORDS = ["weekly", "report", "design", "friday"];
const heard = (t) => WORDS.filter((w) => t.toLowerCase().includes(w)).length;

let target;
let out;

function openTarget() {
  out = path.join(ctx().home, "typed.txt");
  fs.writeFileSync(out, "");
  target = IS_WIN
    ? spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ctx().root, "tests/desktop-e2e/support/target-window.ps1"), "-Out", out], { stdio: "ignore" })
    : spawn("python3", [path.join(ctx().root, "tests/desktop-e2e/support/target-window.py"), out], { stdio: "ignore", env: process.env });
}

describe("dictation into another app", () => {
  before(async () => {
    await ready();
    await signInQuick();
    await markOnboarded();
    await installModel();
    openTarget();
    await sleep(2500);
  });
  after(() => target?.kill());

  it("holding the Flo key types the words into the focused window", async () => {
    let text = "";
    for (let attempt = 0; attempt < 3 && heard(text) < 3; attempt++) {
      fs.writeFileSync(out, "");
      os.focus("Flo E2E target");
      await sleep(800);
      os.keyDown("ctrl");
      await sleep(4500);
      os.keyUp("ctrl");
      text = await waitFor(
        () => {
          const t = fs.readFileSync(out, "utf8");
          return heard(t) >= 3 ? t : null;
        },
        { timeout: 30000, msg: "the dictated words in the target window" },
      ).catch(() => fs.readFileSync(out, "utf8"));
    }
    screen("dictated");
    fs.writeFileSync(artifact("typed.txt"), text);
    assert.ok(heard(text) >= 3, `the target window got the dictation (got “${text}”)`);
  });

  it("the dictation is in History", async () => {
    const h = await invoke("list_history", { limit: 5 });
    assert.ok(h.length >= 1, "a history entry");
    assert.ok(heard(JSON.stringify(h)) >= 3, "with the words");
  });

  it("tray: Start / stop dictation works without the key", async () => {
    fs.writeFileSync(out, "");
    os.focus("Flo E2E target");
    await sleep(800);
    await invoke("e2e_tray", { id: "dictate" });
    await sleep(4500);
    await invoke("e2e_tray", { id: "dictate" });
    const text = await waitFor(
      () => {
        const t = fs.readFileSync(out, "utf8");
        return heard(t) >= 3 ? t : null;
      },
      { timeout: 30000, msg: "tray dictation text" },
    ).catch(() => fs.readFileSync(out, "utf8"));
    screen("tray-dictated");
    assert.ok(heard(text) >= 3, `tray dictation reached the window (got “${text}”)`);
    assert.equal(appPids().length, 1);
  });
});
