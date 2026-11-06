import { expect, test, type Page } from "@playwright/test";

// Account gate + Lemon-style onboarding. The mock starts SIGNED OUT here (no localStorage flag).
test.use({ storageState: { cookies: [], origins: [] } });

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const step = (page: Page, s: string) => expect(page.locator('[data-testid="onboarding"]')).toHaveAttribute("data-step", s);

test("sign in → wow demo → one question → personalised prompt saved → glimpses → done", async ({ page }) => {
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

  // welcome
  await step(page, "welcome");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Get started" }).click();

  // the wow: dictation before any question (simulated in preview); auto-advances on success
  await step(page, "try");
  await page.getByRole("button", { name: "Simulate (preview)" }).click();
  await expect(page.getByLabel("Demo text box")).toHaveValue(/Hello Flo, this is my first dictation/);
  await expect(page.locator('[data-testid="demo-success"]')).toBeVisible();

  // one light question: name (prefilled) + use tiles
  await step(page, "profile");
  await expect(page.getByLabel("Your name")).toHaveValue("Priya");
  await page.getByRole("checkbox", { name: "Coding prompts" }).click();
  await page.getByRole("checkbox", { name: "Slack & chat" }).click();
  await expect(page.getByRole("checkbox", { name: "Coding prompts" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();

  // personalise: generated from derived role (developer) + uses; editable; saved
  await step(page, "personalise");
  await expect(page.locator('[data-testid="personalising"]')).toBeVisible();
  const prompt = page.getByLabel("System prompt");
  await expect(prompt).toHaveValue(/Priya/);
  await prompt.click(); // focus switches from the typewriter preview to the full editable prompt
  await expect(prompt).toHaveValue(/software developer/);
  await expect(prompt).toHaveValue(/coding agents/);
  await expect(page.locator('[data-testid="seeds"]')).toContainText("Claude Code");
  await expect(page.locator('[data-testid="seeds"]')).toContainText("TypeScript");
  await prompt.fill((await prompt.inputValue()) + "\nKeep replies short.");
  await page.getByRole("button", { name: "Save & continue" }).click();

  await step(page, "permissions");
  const set = await invoke(page, "get_settings");
  expect(set.userName).toBe("Priya");
  expect(set.language).toBe("auto");
  expect(set.systemPrompt).toMatch(/Keep replies short\.$/);
  const dict = (await invoke(page, "list_dictionary")).map((d: any) => d.word);
  expect(dict).toEqual(expect.arrayContaining(["Claude Code", "TypeScript"]));

  // voice + ai condensed into one step
  await page.getByRole("button", { name: "Continue" }).click();
  await step(page, "setup");
  await page.getByRole("button", { name: "Continue" }).click();

  // optional glimpses
  await step(page, "glimpse-handsfree");
  await page.getByRole("button", { name: "Simulate (preview)" }).click();
  await expect(page.locator('[data-testid="demo-success"]')).toBeVisible();
  await step(page, "glimpse-ask"); // auto-advances after success
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await step(page, "glimpse-tray");
  await page.getByRole("button", { name: "Show me" }).click();
  await expect(page.locator('[data-testid="tray-preview"]')).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await step(page, "glimpse-meetings");
  await page.getByRole("button", { name: "Continue" }).click();

  // optional typing offer; Back chevron returns to the previous step
  await step(page, "typing");
  await expect(page.locator('[data-testid="typing-offer"]')).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await step(page, "glimpse-meetings");
  await page.getByRole("button", { name: "Continue" }).click();
  await step(page, "typing");
  // "Measure now" starts the test inline (not a navigate-away dead-end)
  await page.getByRole("button", { name: "Measure now" }).click();
  await expect(page.locator('[data-testid="typing-inline"]')).toBeVisible();
  await expect(page.locator('[data-testid="typing-passage"]')).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // done
  await step(page, "done");
  await expect(page.locator('[data-testid="cheatsheet"]')).toContainText("Hands-free");
  await page.getByRole("button", { name: "Start using Flo" }).click();
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
  await expect.poll(async () => (await invoke(page, "get_settings")).onboarded).toBe(true);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Working late/ })).toBeVisible();
  await expect(page.getByText(/[—–]/)).toHaveCount(0);
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
  await page.goto("/?signedin=1#/settings/account");
  await mock(page);
  const card = page.locator('[data-testid="account-card"]');
  await expect(card).toContainText("Naman Gundaniya");
  await expect(card).toContainText("naman@hellonaman.com");
  await expect(card).toContainText("NG");
  await card.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator('[data-testid="signin"]')).toBeVisible();
});

test("onboarding: no Back on step 1; Back chevron and a progress dot jump to earlier steps", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1#/home");
  await mock(page);
  await step(page, "welcome");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Get started" }).click();
  await step(page, "try");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await step(page, "welcome");
  // advance past the wow demo, then a progress dot jumps back to the first step
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Simulate (preview)" }).click();
  await step(page, "profile");
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await step(page, "welcome");
});
