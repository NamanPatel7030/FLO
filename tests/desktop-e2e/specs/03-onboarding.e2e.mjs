// Setup after the first sign-in: welcome → speech model download (from the mock host) → permissions
// (the OS's own checks) → try it (hold the Flo key, real key events, WAV as the microphone) → the
// rest → "Start using Flo". Ends on the home page with setup marked done.
import { assert, clickButton, ctx, invoke, os, ready, screen, shot, signInQuick, sleep, waitFor } from "../support/app.mjs";

const step = () => $("[data-testid=onboarding]").getAttribute("data-step");

async function holdFloKey(ms) {
  os.keyDown("ctrl");
  await sleep(ms);
  os.keyUp("ctrl");
}

describe("onboarding", () => {
  it("starts after the first sign-in", async () => {
    await ready();
    await signInQuick();
    await $("[data-testid=onboarding]").waitForDisplayed({ timeout: 30000 });
    assert.equal(await step(), "welcome");
    await shot("1-welcome");
  });

  it("welcome: name, then begin", async () => {
    await $("#ob-name").setValue("Ada");
    await clickButton("Let's begin");
    await waitFor(async () => (await step()) === "model", { msg: "the model step" });
  });

  it("downloads and loads the speech model", async () => {
    await shot("2-model");
    // ready when the primary "Continue" replaces "Continue while it downloads"
    await waitFor(
      async () => {
        for (const b of await $$("//button[normalize-space(.)='Continue']")) if (await b.isDisplayed()) return true;
        return false;
      },
      { timeout: 180000, interval: 1000, msg: "the model to download and load" },
    );
    assert.ok(ctx().mock.state.modelDownloads >= 1, "the model came from the (mock) model host");
    const models = await invoke("list_models");
    assert.ok(models.some((m) => m.installed), "a model is installed");
    await shot("2-model-ready");
    await clickButton("Continue");
    await waitFor(async () => (await step()) === "permissions", { msg: "the permissions step" });
  });

  it("permissions: shows this OS's checks", async () => {
    await sleep(800);
    await shot("3-permissions");
    const p = await invoke("check_permissions");
    assert.ok(Array.isArray(p.checks) && p.checks.length > 0, "the OS reports its checks");
    // either everything is fine (Continue) or it can be done later
    await clickButton(p.checks.every((c) => c.ok) ? "Continue" : "I'll do this later").catch(() => clickButton("Continue"));
    await waitFor(async () => (await step()) === "try", { msg: "the try-it step" });
  });

  it("try it: holding the Flo key dictates into the demo", async () => {
    await sleep(1500);
    await shot("4-try");
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      await holdFloKey(4500);
      ok = await waitFor(
        async () => {
          for (const b of await $$("//button[normalize-space(.)='Continue']")) if (await b.isDisplayed()) return true;
          return false;
        },
        { timeout: 30000, msg: "the demo to show the transcript" },
      ).catch(() => false);
    }
    await shot("4-try-done");
    screen("4-try-done");
    assert.ok(ok, "dictation in the try-it step produced text");
    await clickButton("Continue");
  });

  it("finishes the remaining steps and lands on home", async () => {
    for (let n = 0; n < 8; n++) {
      const s = await step().catch(() => null);
      if (!s) break;
      await shot(`5-${s}`);
      if (s === "done") {
        await clickButton("Start using Flo");
        break;
      }
      await clickButton("Continue").catch(async () => {
        // a step whose only way forward is a choice: pick the first option, then continue
        const opt = await $(".onb button[aria-pressed], .onb [role=radio], .onb [role=option]");
        if (await opt.isExisting()) await opt.click();
        await clickButton("Continue");
      });
      await sleep(700);
    }
    await $("[data-testid=onboarding]").waitForDisplayed({ reverse: true, timeout: 30000 });
    await waitFor(async () => (await invoke("get_settings")).onboarded === true, { msg: "setup marked done" });
    await sleep(1000);
    await shot("6-home");
    screen("6-home");
  });
});
