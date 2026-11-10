import { expect, test, type Page } from "@playwright/test";

// Assistant page: the latest conversation at the bottom, threads, live answers from the notch,
// "New answer" when scrolled up, and older history loading on scroll up.
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const exchange = (page: Page, r: Record<string, unknown>, source = "notch", opts: Record<string, unknown> = {}) =>
  page.evaluate(([r, s, o]) => (window as any).__floMock.assistantExchange(r, s, o), [r, source, opts] as const);

const answers = (page: Page) => page.locator('[data-testid="answer"]');
const threads = (page: Page) => page.getByRole("complementary", { name: "Threads" }).locator('[data-testid="thread-item"]');

test.beforeEach(async ({ page }) => {
  await page.goto("/#/assistant");
  await mock(page);
  await expect(answers(page).first()).toBeVisible();
});

test("opens on the latest thread with the newest answer at the bottom, labelled by source", async ({ page }) => {
  // today's thread is selected; the 4-day-old one is listed below it
  await expect(threads(page)).toHaveCount(2);
  await expect(threads(page).first()).toHaveAttribute("aria-current", "true");
  await expect(threads(page).first()).toContainText("Add a to-do to Apollo");
  await expect(threads(page).first()).toContainText("2 answers");
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).last()).toContainText("What's blocked across my projects?");
  await expect(answers(page).last().locator('[data-testid="source-label"]')).toHaveText("Notch");
  await expect(answers(page).first().locator('[data-testid="source-label"]')).toHaveText("Typed");
  // the 4-day-old answers aren't mixed in
  await expect(answers(page).filter({ hasText: "Recap my Tuesday" })).toHaveCount(0);
});

test("a notch answer arrives live at the bottom; asks continue the selected thread", async ({ page }) => {
  await exchange(page, { query: "What's on my calendar today?" }, "notch");
  await expect(answers(page).last()).toContainText("What's on my calendar today?");
  await expect(answers(page)).toHaveCount(3);
  await expect(threads(page).first()).toContainText("3 answers");
  await page.getByLabel("Ask Flo").fill("and tomorrow?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(answers(page)).toHaveCount(4);
  await expect(answers(page).last()).toContainText("and tomorrow?");
  await expect(answers(page).last().locator('[data-testid="source-label"]')).toHaveText("Typed");
  const ask = (await calls(page, "ask_assistant")).at(-1);
  expect(ask.threadId).toBe("a2");
});

test("after a 30-minute break a notch answer starts a new thread and the page follows it", async ({ page }) => {
  await exchange(page, { query: "Back again: what's next?", createdAt: new Date(Date.now() + 31 * 60_000).toISOString() }, "notch");
  await expect(threads(page)).toHaveCount(3);
  await expect(threads(page).first()).toContainText("Back again");
  await expect(threads(page).first()).toHaveAttribute("aria-current", "true");
  await expect(answers(page)).toHaveCount(1);
  await expect(answers(page).last()).toContainText("Back again");
});

test("New thread starts an empty thread; picking an older thread shows it and follow-ups go there", async ({ page }) => {
  await page.getByRole("button", { name: "New thread" }).click();
  await expect(answers(page)).toHaveCount(0);
  await page.getByLabel("Ask Flo").fill("Draft the weekly update");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(answers(page)).toHaveCount(1);
  expect((await calls(page, "ask_assistant")).at(-1).newThread).toBe(true);
  await expect(threads(page)).toHaveCount(3);
  await expect(threads(page).first()).toContainText("Draft the weekly update");
  await expect(threads(page).first()).toHaveAttribute("aria-current", "true");

  await threads(page).filter({ hasText: "Recap my Tuesday" }).click();
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).last()).toContainText("And what's left for tomorrow?");
  await page.getByLabel("Ask Flo").fill("Move the deck to Monday");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(answers(page)).toHaveCount(3);
  expect((await calls(page, "ask_assistant")).at(-1).threadId).toBe("a0");
});

test("search filters threads by question or answer", async ({ page }) => {
  await page.getByLabel("Search threads").fill("northwind deck");
  await expect(threads(page)).toHaveCount(1);
  await expect(threads(page).first()).toContainText("Recap my Tuesday");
  await page.getByLabel("Search threads").fill("");
  await expect(threads(page)).toHaveCount(2);
});

test("scrolled up: a new answer shows the New answer pill, which jumps to it", async ({ page }) => {
  const long = Array.from({ length: 30 }, (_, i) => `Line ${i} of a long answer.`).join("\n\n");
  for (let i = 0; i < 4; i++) await exchange(page, { query: `Long question ${i}`, reply: long }, "notch");
  await expect(answers(page)).toHaveCount(6);
  const scroller = page.locator('[data-testid="assistant-scroller"]');
  // opened/kept at the bottom while following
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(100);
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await exchange(page, { query: "Fresh question" }, "notch");
  const pill = page.locator('[data-testid="new-answer-pill"]');
  await expect(pill).toHaveText(/New answer/);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(50);
  await pill.click();
  await expect(pill).toHaveCount(0);
  await expect(answers(page).last()).toBeInViewport();
});

test("older history loads when scrolling up", async ({ page }) => {
  const start = Date.now() - 6 * 86_400_000;
  // a 40-exchange thread from 6 days ago (1 minute apart)
  await page.evaluate((start) => {
    const m = (window as any).__floMock;
    for (let i = 0; i < 40; i++) m.assistantExchange({ query: `Old question ${i}`, createdAt: new Date(start + i * 60_000).toISOString() }, "typed", { threadId: "big" });
  }, start);
  await threads(page).filter({ hasText: "Old question 0" }).click();
  await expect(answers(page)).toHaveCount(30);
  await expect(answers(page).last()).toContainText("Old question 39");
  await expect(answers(page).first()).toContainText("Old question 10");
  const scroller = page.locator('[data-testid="assistant-scroller"]');
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(answers(page)).toHaveCount(40);
  await expect(answers(page).first()).toContainText("Old question 0");
  // the reading position is kept: the answer that was on top is still in view, not jumped away
  await expect(page.getByText("Old question 10", { exact: true })).toBeInViewport();
});
