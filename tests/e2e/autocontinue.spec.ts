import { expect, test, type Page } from "@playwright/test";

// Auto-continue after a Claude Code usage limit (src-tauri/src/autocontinue.rs), against the mock
// backend (lib/mockAutoContinue.ts; window.__floAutoContinueMock.limit() = Claude hit its limit).

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => !!(window as any).__floMock);
  // the mock's test hook installs on the first auto-continue call
  await page.evaluate(() => (window as any).__floMock.invoke("list_auto_continue"));
  await page.waitForFunction(() => !!(window as any).__floAutoContinueMock, null, { timeout: 20_000 });
  // cold dev-server compiles can be slow on a busy machine: wait for the page itself
  if (path.includes("home")) await page.getByText("Claude sessions").first().waitFor({ timeout: 20_000 });
  if (path.includes("settings")) await page.getByTestId("ac-settings").waitFor({ timeout: 20_000 });
}

const limit = (page: Page, o: Record<string, unknown> = {}) => page.evaluate((opts) => (window as any).__floAutoContinueMock.limit(opts), o);
const calls = (page: Page) => page.evaluate(() => (window as any).__floAutoContinueMock.calls.map((c: any) => c.cmd));
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);

test("Home: a session that hit its limit shows the waiting state with a live countdown", async ({ page }) => {
  await ready(page, "/#/home");
  await limit(page, { sessionId: "s1", project: "api", inMinutes: 72 });
  const row = page.getByTestId("ac-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-status", "waiting");
  await expect(row.getByTestId("ac-headline")).toHaveText("Waiting for limit reset");
  await expect(row).toContainText("api");
  await expect(row).toContainText(/Resets \d{1,2}:\d{2} [AP]M/); // toggle off by default → "Resets", not "Resumes"
  const cd = row.getByTestId("ac-countdown");
  await expect(cd).toHaveText(/^1h 1[01]m$/);
  // a short wait: the countdown is live (seconds tick when under an hour)
  await limit(page, { sessionId: "s1", project: "api", inMinutes: 2 });
  const first = await cd.textContent();
  await page.waitForTimeout(1300);
  expect(await cd.textContent()).not.toBe(first);
});

test("per-session switch turns auto-continue on; Continue now and Cancel call the backend", async ({ page }) => {
  await ready(page, "/#/home");
  await limit(page, { sessionId: "s1", project: "api", inMinutes: 30 });
  const row = page.getByTestId("ac-row");
  const sw = row.getByRole("switch", { name: /Auto-continue at/ });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(row).toContainText(/Resumes \d{1,2}:\d{2} [AP]M/);
  expect(await calls(page)).toContain("set_auto_continue");
  const e = (await invoke(page, "list_auto_continue"))[0];
  expect([e.enabled, e.auto]).toEqual([true, true]);

  await row.getByRole("button", { name: "Continue now" }).click();
  await expect(row).toHaveAttribute("data-status", "resuming");
  await expect(row.getByTestId("ac-headline")).toHaveText("Resumed — continuing");
  expect(await calls(page)).toContain("auto_continue_now");
  // the log shows the resume command (no permission-bypass flags) and Claude's output
  await row.getByRole("button", { name: "Log" }).click();
  const log = page.getByTestId("ac-log");
  await expect(log).toContainText('claude --resume s1 --print "Continue where you left off."');
  await expect(log).not.toContainText(/dangerously|skip-permissions/);
  await page.getByRole("button", { name: "Close log" }).click();

  await row.getByRole("button", { name: "Stop" }).click();
  await expect(row).toHaveAttribute("data-status", "cancelled");
  expect(await calls(page)).toContain("cancel_auto_continue");
});

test("typing in the session cancels; no reset time shows the retry back-off", async ({ page }) => {
  await ready(page, "/#/home");
  await limit(page, { sessionId: "s9", project: "web", inMinutes: null, enabled: true });
  const row = page.getByTestId("ac-row");
  await expect(row).toContainText(/No reset time given · retrying/);
  await expect(row.getByRole("switch", { name: "Auto-continue when the limit lifts" })).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => (window as any).__floAutoContinueMock.typed("s9"));
  await expect(row).toHaveAttribute("data-status", "cancelled");
  await expect(row).toContainText("You continued the session yourself.");
  await row.getByRole("button", { name: "Dismiss web" }).click();
  await expect(page.getByTestId("ac-row")).toHaveCount(0);
});

test("Settings: 'Auto-continue when limits reset' persists, with the continue prompt", async ({ page }) => {
  await ready(page, "/#/settings/appearance");
  const box = page.getByTestId("ac-settings");
  const sw = box.getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "false"); // default off
  await expect(box.getByLabel("Continue prompt")).toHaveCount(0);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const prompt = box.getByLabel("Continue prompt");
  await expect(prompt).toHaveValue("Continue where you left off.");
  await prompt.fill("Keep going with the plan.");
  await expect.poll(async () => (await invoke(page, "get_settings")).claudeContinuePrompt).toBe("Keep going with the plan.");
  expect((await invoke(page, "get_settings")).claudeAutoContinue).toBe(true);
  // the global setting now drives sessions without an override
  await limit(page, { sessionId: "s1", project: "api", inMinutes: 30 });
  expect((await invoke(page, "list_auto_continue"))[0].auto).toBe(true);
  // leave and come back: the page reloads settings from the backend
  await page.evaluate(() => (location.hash = "#/home"));
  await expect(page.getByTestId("ac-settings")).toHaveCount(0);
  await page.evaluate(() => (location.hash = "#/settings/appearance"));
  await expect(page.getByTestId("ac-settings").getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("ac-settings").getByLabel("Continue prompt")).toHaveValue("Keep going with the plan.");
});

test("notch tray: the session row shows the amber waiting line and its switch", async ({ page }) => {
  await ready(page, "/?nh=38&nw=200#/island");
  await page.locator("[data-island-root]").waitFor();
  await page.locator('[aria-label="todos"]').waitFor();
  await page.waitForTimeout(150);
  await page.evaluate(() =>
    (window as any).__floMock.setSessions([
      { sessionId: "s1", project: "api", cwd: "/Users/parth/api", status: "done", message: "You've hit your session limit · resets 3pm", updatedAt: new Date().toISOString(), source: "claude" },
      { sessionId: "s2", project: "web", cwd: "/Users/parth/web", status: "working", message: "Running the test suite", updatedAt: new Date().toISOString(), source: "claude" },
    ]),
  );
  await limit(page, { sessionId: "s1", project: "api", inMinutes: 45, enabled: true });
  const icon = page.locator('[aria-label^="Agents:"]');
  await expect(icon).toHaveCount(1);
  const list = page.locator('[data-testid="session-list"]');
  const box = await icon.boundingBox();
  const win = await page.locator("[data-island-root]").boundingBox();
  const cx = box!.x + box!.width / 2 - (win!.x + win!.width / 2);
  const y = box!.y - win!.y + box!.height / 2;
  for (let i = 0; i < 30 && !(await list.isVisible()); i++) {
    const w = await page.locator("[data-island-root]").boundingBox();
    await page.evaluate((p) => (window as any).__floMock.emit("flo://hover", p), { inside: true, cx, y, x: w!.width / 2 + cx });
    await page.waitForTimeout(80);
  }
  const row = list.locator('[data-testid="session-row"]').filter({ hasText: "api" });
  await expect(row).toContainText("Limit");
  await expect(row.getByTestId("limit-line")).toContainText(/Resumes \d{1,2}:\d{2} [AP]M\s*· \d+m \d{2}s/);
  await expect(row.getByTestId("limit-line")).toHaveAttribute("title", /^Waiting for limit reset · Resumes/);
  const sw = row.getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(row.getByTestId("limit-line")).toContainText(/Resets \d{1,2}:\d{2} [AP]M/);
  // the other session is untouched
  await expect(list.locator('[data-testid="session-row"]').filter({ hasText: "web" })).toContainText("Running the test suite");
});
