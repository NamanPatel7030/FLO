import { expect, test, type Page } from "@playwright/test";

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as any).__floMock.emit(e, p), [event, payload] as const);

test("context library: upload a .md, pin it, and the system prompt autosaves", async ({ page }) => {
  await page.goto("/#/context");
  await mock(page);
  await expect(page.locator('[data-testid="context-doc"]')).toHaveCount(2); // sample docs
  await page.setInputFiles('[data-testid="context-file-input"]', {
    name: "clients.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Clients\nNorthwind: dashboard redesign. Contact Priya for invoices."),
  });
  const doc = page.locator('[data-testid="context-doc"]').filter({ has: page.locator('input[value="clients"]') });
  await expect(doc).toBeVisible();
  await doc.getByRole("switch", { name: "Pin" }).click();
  await expect.poll(async () => (await invoke(page, "list_context_docs")).find((d: any) => d.title === "clients")?.pinned).toBe(true);

  const prompt = page.getByLabel("System prompt");
  await prompt.fill("I'm Naman. Reply briefly and warmly.");
  await expect.poll(async () => (await invoke(page, "get_settings")).systemPrompt, { timeout: 4000 }).toBe("I'm Naman. Reply briefly and warmly.");
});

test("about: maker card with name and site link", async ({ page }) => {
  await page.goto("/#/settings/about");
  await mock(page);
  await expect(page.getByText("Naman Gundaniya")).toBeVisible();
  await expect(page.getByRole("button", { name: "hellonaman.com" })).toBeVisible();
  await expect(page.getByText("I turn messy problems into AI agents that ship.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crafted by Naman Gundaniya" })).toBeVisible();
});

test("live meeting: partial line grows, then the committed segment replaces it", async ({ page }) => {
  await page.clock.install(); // freeze the mock's own meeting timer
  await page.goto("/#/notes");
  await mock(page);
  const note = await invoke(page, "start_meeting", { title: "Design sync" });
  await page.goto(`/#/notes/${note.id}`);
  const live = page.locator('[data-testid="live-line"]');
  await expect(live).toBeVisible();
  for (const p of ["Let's", "Let's kick off", "Let's kick off the launch"]) {
    await emit(page, "flo://meeting", { noteId: note.id, partial: p, elapsedSec: 3, live: true });
    await expect(live).toContainText(p);
  }
  await emit(page, "flo://meeting", { noteId: note.id, segment: { t: 3, text: "Let's kick off the launch checklist." }, partial: "", elapsedSec: 4, live: true });
  await expect(page.locator('[data-testid="live-transcript"]')).toContainText("Let's kick off the launch checklist.");
  await expect(live).not.toContainText("Let's kick off the launch");
});

test("meeting stop: late live:true events never bring the notch pill back", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator('[aria-label="todos"]').waitFor();
  const note = await invoke(page, "start_meeting", { title: "Standup" });
  await emit(page, "flo://meeting", { noteId: note.id, partial: "morning everyone", elapsedSec: 2, live: true });
  await page.clock.runFor(800);
  const pill = page.locator('[data-testid="island-live-line"]');
  await expect(pill).toBeVisible();
  // open the expanded view and stop
  await pill.click();
  await page.clock.runFor(800);
  await page.getByRole("button", { name: "Stop meeting" }).click();
  await page.clock.runFor(800);
  await expect(pill).toHaveCount(0);
  // a late final sentence arrives with live:true for the same note
  await emit(page, "flo://meeting", { noteId: note.id, segment: { t: 9, text: "and that's a wrap" }, elapsedSec: 9, live: true });
  await emit(page, "flo://state", { phase: "listening", mode: "meeting" });
  await page.clock.runFor(1200);
  await expect(pill).toHaveCount(0);
});

test("notes: Stop switches to Summarizing and ignores late events", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#/notes");
  await mock(page);
  const note = await invoke(page, "start_meeting", { title: "Retro" });
  await page.goto(`/#/notes/${note.id}`);
  await expect(page.locator('[data-testid="live-line"]')).toBeVisible();
  await page.getByRole("button", { name: /stop & summarize/i }).click();
  // late event for the stopped note
  await emit(page, "flo://meeting", { noteId: note.id, partial: "one more thing", elapsedSec: 12, live: true });
  await page.clock.runFor(500);
  await expect(page.getByText("one more thing")).toHaveCount(0);
  const n = (await invoke(page, "list_notes")).find((x: any) => x.id === note.id);
  expect(n.live).toBe(false);
});

test("typing test: 1 minute, finish, apply speed to settings", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#/typing");
  await mock(page);
  await page.getByRole("button", { name: "1 min" }).click();
  const box = page.getByLabel("Typing input");
  await box.focus();
  const passage = (await page.locator('[data-testid="typing-passage"]').innerText()).replace(/\s+/g, " ").slice(0, 120);
  await page.keyboard.type(passage);
  await page.clock.runFor(61_000);
  await page.clock.runFor(1_500); // result transition
  const result = page.locator('[data-testid="typing-result"]');
  await expect(result).toBeVisible();
  const wpm = Number((await result.innerText()).match(/\d+/)![0]);
  expect(wpm).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Use this speed" }).click();
  await expect.poll(async () => (await invoke(page, "get_settings")).typingWpm).toBe(wpm);
  await expect(page.getByText(/Typing speed updated/)).toBeVisible();
});

test("confirm card: Slack message waits for Send (never auto-sends)", async ({ page }) => {
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator('[aria-label="todos"]').waitFor();
  const c = await page.evaluate(() => (window as any).__floMock.confirm("Send to Rahul on Slack?", "Hey Rahul, deck is in the drive."));
  const card = page.locator('[data-testid="confirm-card"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Send to Rahul on Slack?");
  await expect(card).toContainText("Hey Rahul, deck is in the drive.");
  expect(await page.evaluate(() => (window as any).__floMock.confirms.length)).toBe(0); // nothing sent yet
  await card.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floMock.confirms)).toEqual([{ id: c.id, approve: true }]);
  await expect(card).toHaveCount(0);
  // a second one can be cancelled
  const c2 = await page.evaluate(() => (window as any).__floMock.confirm());
  await page.locator('[data-testid="confirm-card"]').getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floMock.confirms.at(-1))).toEqual({ id: c2.id, approve: false });
});

test("integrations: 4 agent cards, webhook token hidden, Slack connect flow", async ({ page }) => {
  await page.goto("/#/settings/integrations");
  await mock(page);
  await expect(page.locator('[data-testid="integration-card"]')).toHaveCount(4);
  await expect(page.getByText("Not found on this Mac")).toBeVisible();
  await expect(page.getByText(/token=•••/)).toBeVisible();
  await expect(page.getByText(/token=TOKEN/)).toHaveCount(0);
  await page.getByLabel("Slack token").fill("xoxp-123-abc");
  await page.getByRole("button", { name: "Connect" }).last().click();
  await expect(page.locator('[data-testid="slack-connected"]')).toContainText("Parth Gundaniya · Avenuor");
  await page.getByText("Turn unanswered DMs and mentions into to-dos").click();
  await expect.poll(async () => (await invoke(page, "get_settings")).slackSync).toBe(true);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("3 to-dos added")).toBeVisible();
});
