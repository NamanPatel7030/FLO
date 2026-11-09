import { expect, test, type Page } from "@playwright/test";

// Account gate + Lemon-style onboarding. The mock starts SIGNED OUT here (no localStorage flag).
test.use({ storageState: { cookies: [], origins: [] } });

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const step = (page: Page, s: string) => expect(page.locator('[data-testid="onboarding"]')).toHaveAttribute("data-step", s);

test("sign in → hello → try-out → playful questions → personalised prompt saved → setup → signature finale", async ({ page }) => {
  test.slow(); // long cinematic walkthrough with animations; headroom under parallel load
  await page.goto("/?onboard=1#/home");
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

  // the try-out: dictation before any question (simulated in preview); auto-advances on success
  await step(page, "try");
  await expect(btn("I'll try it later")).toBeVisible();
  await btn("Simulate (preview)").click();
  await expect(ob.getByLabel("Demo text box")).toHaveValue(/Hello Flo, this is my first dictation/);
  await expect(ob.locator('[data-testid="demo-success"]')).toBeVisible();

  // what you do: one tap picks and moves on
  await step(page, "role");
  await ob.getByRole("radio", { name: "I build software" }).click();

  // where your voice goes + apps
  await step(page, "uses");
  await ob.getByRole("checkbox", { name: "Coding prompts" }).click();
  await ob.getByRole("checkbox", { name: "Slack & chat" }).click();
  await expect(ob.getByRole("checkbox", { name: "Coding prompts" })).toHaveAttribute("aria-checked", "true");
  await ob.locator('[data-testid="apps"]').getByRole("checkbox", { name: "Notion" }).click();
  await btn("Continue").click();

  // languages + tone
  await step(page, "voice");
  await ob.locator('[data-testid="languages"]').getByRole("checkbox", { name: "English" }).click();
  await ob.getByRole("radio", { name: "Crisp" }).click();
  await btn("Continue").click();

  // personalise: generated from role + uses + tone; editable; saved
  await step(page, "personalise");
  await expect(ob.locator('[data-testid="personalising"]')).toBeVisible();
  const prompt = ob.getByLabel("System prompt");
  await expect(prompt).toHaveValue(/Priya/);
  await prompt.click(); // focus switches from the typewriter preview to the full editable prompt
  await expect(prompt).toHaveValue(/software developer/);
  await expect(prompt).toHaveValue(/coding agents/);
  await expect(prompt).toHaveValue(/crisp and direct/);
  await expect(ob.locator('[data-testid="seeds"]')).toContainText("Claude Code");
  await expect(ob.locator('[data-testid="seeds"]')).toContainText("Notion");
  await prompt.fill((await prompt.inputValue()) + "\nKeep replies short.");
  await btn("Save & continue").click();

  await step(page, "permissions");
  const set = await invoke(page, "get_settings");
  expect(set.userName).toBe("Priya");
  expect(set.language).toBe("en");
  expect(set.systemPrompt).toMatch(/Keep replies short\.$/);
  const dict = (await invoke(page, "list_dictionary")).map((d: any) => d.word);
  expect(dict).toEqual(expect.arrayContaining(["Claude Code", "TypeScript", "Notion"]));
  // a way forward even when a permission is still missing
  await expect(ob.locator('[data-testid="perm-row"]')).toHaveCount(4);
  await ob.getByRole("button", { name: /I'll do this later|Continue/ }).first().click();

  // voice + ai condensed into one step
  await step(page, "setup");
  await btn("Continue").click();

  // superpowers: optional mini demos in one step
  await step(page, "powers");
  await btn("Simulate (preview)").click();
  await expect(ob.locator('[data-testid="demo-success"]')).toBeVisible();
  await ob.getByRole("tab", { name: "Agent tray" }).click();
  await btn("Show me").click();
  await expect(ob.locator('[data-testid="tray-preview"]')).toBeVisible();
  await btn("Continue").click();

  // optional typing offer; Back returns to the previous step
  await step(page, "typing");
  await expect(ob.locator('[data-testid="typing-offer"]')).toBeVisible();
  await btn("Back").click();
  await step(page, "powers");
  await btn("Continue").click();
  await step(page, "typing");
  // "Measure now" starts the test inline (not a navigate-away dead-end)
  await btn("Measure now").click();
  await expect(ob.locator('[data-testid="typing-inline"]')).toBeVisible();
  await expect(ob.locator('[data-testid="typing-passage"]')).toBeVisible();
  await btn("I'll do this later").click();

  // ready, then the signature finale opens the app
  await step(page, "done");
  await expect(ob.locator('[data-testid="cheatsheet"]')).toContainText("Hands-free");
  await expect(page.getByText(/[—–]/)).toHaveCount(0);
  await btn("Start using Flo").click();
  await expect(ob.locator('[data-testid="finale"]')).toBeVisible();
  await expect(ob.locator('[data-testid="finale"]')).toHaveAttribute("aria-label", "Invented by Naman");
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0, { timeout: 8000 });
  await expect.poll(async () => (await invoke(page, "get_settings")).onboarded).toBe(true);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Working late/ })).toBeVisible();
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

test("onboarding: no Back on step 1; Back and a progress dot jump to earlier steps", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  await step(page, "welcome");
  await expect(ob.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await step(page, "try");
  await ob.getByRole("button", { name: "Back", exact: true }).click();
  await step(page, "welcome");
  // advance past the try-out, then a progress dot jumps back to the first step
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await ob.getByRole("button", { name: "I'll try it later" }).click();
  await step(page, "role");
  await ob.getByRole("button", { name: "Welcome", exact: true }).click();
  await step(page, "welcome");
});
