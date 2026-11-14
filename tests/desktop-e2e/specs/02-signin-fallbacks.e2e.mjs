// The sign-in fallbacks: paste the one-time code when the browser can't hand back the link, a
// wrong password, email + password, and signing out hides the pill again.
import { assert, clickButton, ctx, info, invoke, ready, shot, toMain, waitFor } from "../support/app.mjs";
import { PASSWORD, USER } from "../support/mock-server.mjs";

describe("sign-in fallbacks", () => {
  it("paste-code: Google sign-in finished by typing the code from the browser", async () => {
    await ready();
    await $("[data-testid=signin]").waitForDisplayed({ timeout: 30000 });
    await clickButton("Continue with Google");
    await $("[data-testid=google-wait]").waitForDisplayed();
    const code = ctx().mock.issueCode(null);
    const input = await $("input[aria-label='Paste code']");
    await input.setValue(code);
    await shot("paste-code");
    await clickButton("Continue");
    // the "You're in" beat, then the app (the beat can be shorter than a poll)
    await waitFor(async () => (await $("[data-testid=signin-success]").isExisting()) || !(await $("[data-testid=signin]").isExisting()), { msg: "sign-in to complete" });
    await shot("signin-success");
    await $("[data-testid=signin]").waitForDisplayed({ reverse: true, timeout: 15000 });
    const i = await info();
    assert.equal(i.signedIn, true);
    assert.ok(i.windows.find((w) => w.label === "island")?.visible, "pill visible after sign-in");
  });

  it("an expired code shows an error and stays on the sign-in screen", async () => {
    await invoke("account_logout");
    await browser.execute(() => location.reload());
    await ready();
    await $("[data-testid=signin]").waitForDisplayed({ timeout: 20000 });
    assert.equal((await info()).windows.find((w) => w.label === "island")?.visible, false, "pill hidden after sign-out");
    await clickButton("Continue with Google");
    await $("input[aria-label='Paste code']").setValue("NOPE-000");
    await clickButton("Continue");
    await waitFor(async () => /didn't work|expire|try again/i.test(await $("[data-testid=signin]").getText()), { msg: "an error message" });
    await shot("bad-code");
    assert.equal((await invoke("account_status")).signedIn, false);
  });

  it("email + password: wrong password is refused, the right one signs in", async () => {
    await clickButton("Back");
    const email = await $("input[type=email]");
    await email.setValue(USER.email);
    const pw = await $("input[type=password]");
    await pw.setValue("wrong-password");
    await browser.keys("Enter");
    await waitFor(async () => /wrong|incorrect|don.t match/i.test(await $("[data-testid=signin]").getText()), { msg: "wrong password message" });
    await shot("wrong-password");
    await pw.setValue(PASSWORD);
    await browser.keys("Enter");
    await $("[data-testid=signin]").waitForDisplayed({ reverse: true, timeout: 20000 });
    await toMain();
    assert.equal((await invoke("account_status")).user.email, USER.email);
  });

  it("cold start: a flo://auth link that STARTS Flo (it wasn't running) still signs in", async () => {
    await invoke("account_logout");
    const code = ctx().mock.issueCode(null);
    // Flo quits; the browser's link starts it again with the link as its argument
    await browser.reloadSession({
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application: ctx().app, args: [`flo://auth?code=${code}`] },
    });
    await ready();
    await waitFor(async () => (await invoke("account_status")).signedIn, { timeout: 20000, msg: "sign-in from the launch link" });
    await $("[data-testid=signin]").waitForDisplayed({ reverse: true, timeout: 20000 });
    await shot("cold-start-signed-in");
  });
});
