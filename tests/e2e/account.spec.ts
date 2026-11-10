import { expect, test, type Page } from "@playwright/test";

// Account gate + Lemon-style onboarding. The mock starts SIGNED OUT here (no localStorage flag).
test.use({ storageState: { cookies: [], origins: [] } });

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const step = (page: Page, s: string) => expect(page.locator('[data-testid="onboarding"]')).toHaveAttribute("data-step", s);

/** Hold the try-out's mic button like a person would (press, talk, let go). */
async function holdToTalk(page: Page, ms = 900) {
  const mic = page.locator('[data-testid="onboarding"]').getByTestId("try-mic");
  // wait until the step has finished animating in and the button takes the pointer (slow CI
  // runners were pressing while the step was still fading in)
  await mic.hover();
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("sign in → hello → permissions → a real first dictation → voice & AI → about you (saved) → ready → signature finale", async ({ page }) => {
  test.slow(); // long cinematic walkthrough with animations; headroom under parallel load
  await page.goto("/?onboard=1&perms=noax#/home");
  await mock(page);
  const gate = page.locator('[data-testid="signin"]');
  await expect(gate).toBeVisible();
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0); // gate comes first

  // friendly errors, then sign in
  await page.getByLabel("Email").fill("priya.shah@example.com");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("don't match");
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(gate).toHaveCount(0);

  const ob = page.locator('[data-testid="onboarding"]');
  const btn = (name: string) => ob.getByRole("button", { name, exact: true });
  // no generic Skip anywhere in setup
  await expect(ob.getByRole("button", { name: /skip/i })).toHaveCount(0);

  // hello: Notchling + the name question (prefilled from the account)
  await step(page, "welcome");
  await expect(btn("Back")).toHaveCount(0);
  await expect(ob.locator('[data-testid="onboard-guide"]')).toBeVisible();
  await expect(ob.getByLabel("Your name")).toHaveValue("Priya");
  await btn("Let's begin").click();

  // permissions come BEFORE the try-out: just two, the microphone and Accessibility, in one card
  // (no Input Monitoring: the Flo key runs on Accessibility alone; no Screen Recording in setup)
  await step(page, "permissions");
  await expect(ob.locator('[data-testid="perm-row"]')).toHaveCount(2);
  await expect(ob.getByText("Input Monitoring")).toHaveCount(0);
  await expect(ob.getByText("Screen Recording")).toHaveCount(0);
  await expect(ob.locator('[data-testid="perm-row"][data-perm="microphone"]')).toHaveAttribute("data-granted", "true");
  await expect(btn("Continue")).toHaveCount(0); // Accessibility is still off in the mock
  await btn("Allow Accessibility").click();
  await expect(ob.locator('[data-testid="onboard-line"]')).toContainText("I'll notice");
  await expect(ob.locator('[data-testid="perm-row"][data-granted="true"]')).toHaveCount(2, { timeout: 6000 });
  await expect(ob.locator('[data-testid="onboard-line"]')).toContainText("All set");
  expect((await calls(page, "open_permission_settings")).map((a: any) => a.kind)).toEqual(["accessibility"]);
  // no "I did it" button: setup moves on by itself the moment the switch is on

  // the try-out: hold the mic button, the mic level moves, the words land in the box
  await step(page, "try");
  await expect.poll(async () => (await calls(page, "set_setup_capture")).at(-1)).toEqual({ on: true });
  await expect(btn("I'll try it later")).toBeVisible();
  const mic = ob.getByTestId("try-mic");
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-live", "true");
  await expect(ob.getByText("I'm listening. Let go when you're done.")).toBeVisible();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(ob.getByLabel("Demo text box")).toHaveValue("Hey team, the build is ready for review.");
  await expect(ob.locator('[data-testid="demo-success"]')).toBeVisible();
  expect(await calls(page, "start_session")).toEqual([{ mode: "dictation" }]);
  expect((await calls(page, "stop_session")).length).toBe(1);
  await btn("Continue").click();

  // voice + ai in one step; leaving the try-out hands dictation back to other apps
  await step(page, "setup");
  await expect.poll(async () => (await calls(page, "set_setup_capture")).at(-1)).toEqual({ on: false });
  await expect(ob.getByRole("radio", { name: "On this Mac" })).toHaveAttribute("aria-checked", "true");
  await btn("Continue").click();

  // what you do: one tap picks and moves on
  await step(page, "role");
  await ob.getByRole("radio", { name: "I build software" }).click();

  // where your voice goes + languages; Continue saves the personal profile
  await step(page, "uses");
  await ob.getByRole("checkbox", { name: "Coding prompts" }).click();
  await ob.getByRole("checkbox", { name: "Slack & chat" }).click();
  await expect(ob.getByRole("checkbox", { name: "Coding prompts" })).toHaveAttribute("aria-checked", "true");
  await ob.locator('[data-testid="languages"]').getByRole("checkbox", { name: "English" }).click();
  await btn("Continue").click();

  // ready: the keys to remember
  await step(page, "done");
  const set = await invoke(page, "get_settings");
  expect(set.userName).toBe("Priya");
  expect(set.language).toBe("en");
  expect(set.systemPrompt).toMatch(/software developer/);
  expect(set.systemPrompt).toMatch(/coding agents/);
  const dict = (await invoke(page, "list_dictionary")).map((d: any) => d.word);
  expect(dict).toEqual(expect.arrayContaining(["Claude Code", "TypeScript", "Priya"]));
  await expect(ob.locator('[data-testid="cheatsheet"]')).toContainText("Hold to dictate");
  await expect(ob.locator('[data-testid="cheatsheet"]')).toContainText("Hands-free");
  await expect(page.getByText(/[—–]/)).toHaveCount(0);

  // the signature finale opens the app
  await btn("Start using Flo").click();
  await expect(ob.locator('[data-testid="finale"]')).toBeVisible();
  await expect(ob.locator('[data-testid="finale"]')).toHaveAttribute("aria-label", "Invented by Naman");
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0, { timeout: 8000 });
  await expect.poll(async () => (await invoke(page, "get_settings")).onboarded).toBe(true);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Working late/ })).toBeVisible();
});

test("try-out on a fresh Mac: no mic yet → clear fix right there; silence → human error; a quick tap explains itself", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1&perms=none#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  const btn = (name: string) => ob.getByRole("button", { name, exact: true });
  await btn("Let's begin").click();
  await step(page, "permissions");
  await expect(ob.locator('[data-testid="perm-row"][data-granted="false"]')).toHaveCount(2);
  await btn("I'll do this later").click();

  await step(page, "try");
  const needs = ob.getByTestId("try-needs");
  await expect(needs).toContainText("Allow the microphone first");
  // holding the button without a mic never starts a session; it says what to do instead
  await holdToTalk(page, 300);
  await expect(ob.getByTestId("demo-error")).toContainText("Allow the microphone first");
  expect(await calls(page, "start_session")).toEqual([]);
  await needs.getByRole("button", { name: "Allow microphone" }).click();
  expect((await calls(page, "open_permission_settings")).at(-1)).toEqual({ kind: "microphone" });
  await expect(needs).toContainText("needs Accessibility", { timeout: 6000 }); // mic granted; the key still needs Accessibility

  // the backend heard nothing: a human error and a way to the mic settings
  await page.evaluate(() => (window as any).__floMock.emit("flo://state", { phase: "error", mode: "dictation", message: "I didn't hear anything. Check the microphone in System Settings → Sound." }));
  await expect(ob.getByTestId("demo-error")).toContainText("I couldn't hear you");
  await expect(ob.getByRole("button", { name: "Open mic settings" })).toBeVisible();

  // a quick tap is cancelled and explained, not left recording (press + release in one tick, so a
  // busy machine can't stretch it into a real hold)
  await ob.getByTestId("try-mic").evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
  });
  await expect(ob.getByText("Keep holding while you talk, then let go.")).toBeVisible();
  await expect.poll(async () => (await calls(page, "cancel_session")).length).toBe(1);

  // a real hold works now
  await holdToTalk(page, 800);
  await expect(ob.getByLabel("Demo text box")).toHaveValue("Hey team, the build is ready for review.");
  await expect(ob.getByTestId("demo-success")).toBeVisible();
  await expect(btn("Continue")).toBeVisible();
});

test("Continue with Google: waiting state, bad code → friendly error, pasted code signs in", async ({ page }) => {
  await page.goto("/#/home");
  await mock(page);
  await page.getByRole("button", { name: /Continue with Google/ }).click();
  const wait = page.locator('[data-testid="google-wait"]');
  await expect(wait).toContainText("Finish in your browser");
  await page.getByLabel("Paste code").fill("BAD");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("code didn't work");
  await page.getByLabel("Paste code").fill("K7Q-29X");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('[data-testid="signin"]')).toHaveCount(0);
  const [start] = await page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "account_google_start"));
  expect(start).toBeTruthy();
  const ex = await calls(page, "account_exchange");
  expect(ex.at(-1).code).toBe("K7Q-29X");
  expect(ex.at(-1).state).toMatch(/^st_/);
});

test("Continue with Google completes by itself when the deep link arrives (flo://account)", async ({ page }) => {
  await page.goto("/#/home");
  await mock(page);
  await page.getByRole("button", { name: /Continue with Google/ }).click();
  await expect(page.locator('[data-testid="google-wait"]')).toBeVisible();
  await page.evaluate(() => (window as any).__floMock.completeGoogle());
  await expect(page.locator('[data-testid="signin"]')).toHaveCount(0);
});

test("offline with a cached user: 'Use offline' is offered and lets you in; otherwise it's hidden", async ({ page }) => {
  await page.goto("/#/home");
  await mock(page);
  await expect(page.locator('[data-testid="signin"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /Use offline/ })).toHaveCount(0);
  await page.goto("/?offline=1#/home");
  await mock(page);
  await page.getByRole("button", { name: /Use offline as naman@hellonaman.com/ }).click();
  await expect(page.locator('[data-testid="signin"]')).toHaveCount(0);
});

test("signed out: dictation hotkey shows a 'Sign in to Flo' card in the notch", async ({ page }) => {
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator("[data-island-root]").waitFor();
  await invoke(page, "start_session", { mode: "dictation" }).catch(() => {});
  const card = page.locator('[data-testid="signin-card"]');
  await expect(card).toContainText("Sign in to Flo");
  await expect(card.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("Settings → Account shows the user and Sign out returns to the gate", async ({ page }) => {
  await page.goto("/?signedin=1#/settings/general");
  await mock(page);
  const card = page.locator('[data-testid="account-card"]');
  await expect(card).toContainText("Naman Gundaniya");
  await expect(card).toContainText("naman@hellonaman.com");
  await expect(card).toContainText("NG");
  await card.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator('[data-testid="signin"]')).toBeVisible();
});

test("permissions: an update left a stale Accessibility switch → one click resets it and setup moves on", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1&perms=stale#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await step(page, "permissions");
  const fix = ob.getByTestId("ax-reset");
  await expect(fix).toContainText("An update reset");
  // nothing is reset without a click
  expect(await calls(page, "reset_accessibility")).toEqual([]);
  await fix.getByRole("button", { name: "Reset and ask again" }).click();
  expect((await calls(page, "reset_accessibility")).length).toBe(1);
  await expect(ob.locator('[data-testid="perm-row"][data-granted="true"]')).toHaveCount(2, { timeout: 6000 });
  await step(page, "try");
  expect(await calls(page, "restart_app")).toEqual([]); // no relaunch needed
});

test("the floating helper over System Settings shows the exact switch to flip, and closes", async ({ page }) => {
  await page.goto("/#/perm-guide");
  await mock(page);
  const g = page.getByTestId("perm-guide");
  await expect(g).toContainText("Turn on Flo");
  await expect(g).toContainText("Accessibility");
  await g.getByRole("button", { name: "Close" }).click();
  expect((await calls(page, "close_permission_guide")).length).toBe(1);
});

test("onboarding: no Back on step 1; Back and a progress dot jump to earlier steps", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  await step(page, "welcome");
  await expect(ob.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await step(page, "permissions");
  await ob.getByRole("button", { name: "Back", exact: true }).click();
  await step(page, "welcome");
  // advance past permissions and the try-out, then a progress dot jumps back to the first step
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await ob.getByRole("button", { name: "Continue", exact: true }).click(); // both already allowed in the mock
  await step(page, "try");
  await ob.getByRole("button", { name: "I'll try it later" }).click();
  await step(page, "setup");
  await ob.getByRole("button", { name: "Welcome", exact: true }).click();
  await step(page, "welcome");
});
