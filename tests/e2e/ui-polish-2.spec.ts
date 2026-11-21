import { expect, test, type Page } from "@playwright/test";

// Regression checks for the second UI pass: the pill's live meeting line keeps the newest words in
// view, the meeting note view (pinned speaker legend, chips that truncate, Hindi line height, no
// sideways scroll with a crowd of speakers), and Windows / Linux wording.

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as any).__floMock.emit(e, p), [event, payload] as const);

const LONG =
  "We still need the Windows bottom-right positioning tested before Friday, and somebody has to own the release notes this week";

for (const where of [
  { name: "notch", url: "/?nh=38&nw=200#/island" },
  { name: "Windows pill", url: "/?platform=windows#/island" },
]) {
  test(`pill (${where.name}): a long live meeting line shows its newest words under a fade, with the speaker`, async ({ page }) => {
    await page.clock.install();
    await page.goto(where.url);
    await mock(page);
    await page.locator("[data-island-root]").waitFor();
    await page.waitForTimeout(1500); // geometry + settings arrive before time stops
    await page.clock.pauseAt(new Date(Date.now() + 4000));
    const note = await invoke(page, "start_meeting", { title: "Standup" });
    await page.clock.runFor(800);
    // (after the clock ran: the mock's own demo partials would replace it)
    await emit(page, "flo://meeting", { noteId: note.id, partial: LONG, partialSpeaker: "Speaker 2", elapsedSec: 14, live: true });
    const line = page.getByTestId("island-live-line");
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute("data-overflow", "start", { timeout: 5000 });
    await expect(line.getByTestId("island-live-speaker")).toHaveText("Speaker 2");
    const measure = () =>
      line.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const caret = el.querySelector(".flo-caret")!.getBoundingClientRect();
        const text = el.querySelector("[dir=auto]")!;
        const slide = text.parentElement!;
        const who = el.querySelector("[data-testid=island-live-speaker]")!.getBoundingClientRect();
        const cs = getComputedStyle(slide);
        const mask = cs.maskImage || (cs as any).webkitMaskImage;
        return { right: box.right, caretRight: caret.right, innerLeft: text.getBoundingClientRect().left, left: slide.getBoundingClientRect().left, mask, whoLeft: who.left, boxLeft: box.left };
      });
    // the end of what's being said (the caret) is inside the line once the slide settles; the start is what slid out
    await expect.poll(async () => { const m = await measure(); return m.caretRight <= m.right + 1; }, { timeout: 5000 }).toBe(true);
    const m = await measure();
    expect(m.innerLeft).toBeLessThan(m.left);
    expect(m.mask).toContain("gradient");
    // the speaker's name stays at the start, only the words slide
    expect(m.whoLeft).toBeGreaterThanOrEqual(m.boxLeft);
    // a short line doesn't move and isn't faded
    await emit(page, "flo://meeting", { noteId: note.id, partial: "Morning!", partialSpeaker: "You", elapsedSec: 15, live: true });
    await expect(line).not.toHaveAttribute("data-overflow", /./);
    await invoke(page, "stop_meeting");
  });
}

test.describe("meeting note at the minimum window (980 x 640)", () => {
  test.use({ viewport: { width: 980, height: 640 } });

  test("a crowd of speakers with long names: chips truncate inside the card, nothing scrolls sideways", async ({ page }) => {
    await page.goto("/?crowd=1#/notes/n9");
    const chips = page.getByTestId("speaker-chip");
    await expect(chips).toHaveCount(10, { timeout: 20_000 });
    const main = page.locator("main .overflow-y-auto").first();
    expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const bar = (await page.getByTestId("speakers-bar").boundingBox())!;
    for (const b of await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
    }
    // the long name ends in "…" (cut by CSS, the full name is in the tooltip), the short one is whole
    const long = page.locator('[data-speaker="Dr. Bartholomew Montgomery-Ashworth III"] [data-testid="speaker-chip-name"]');
    expect(await long.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === "ellipsis")).toBe(true);
    await expect(long).toHaveAttribute("title", /Bartholomew Montgomery-Ashworth III/);
    const short = page.locator('[data-speaker="Priya"] [data-testid="speaker-chip-name"]');
    expect(await short.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    // the note title wraps beside its buttons instead of pushing them out
    const title = page.getByText(/^Quarterly all-hands with Northwind/).last();
    const del = page.getByRole("button", { name: "Delete note" });
    expect((await title.boundingBox())!.x + (await title.boundingBox())!.width).toBeLessThanOrEqual((await del.boundingBox())!.x);
    // an hour+ of times ("1:08:50") fits its column
    const times = page.locator('[data-testid="transcript-row"] > span:first-child');
    expect(await times.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length)).toBe(0);
    await expect(times.last()).toHaveText(/^1:\d\d:\d\d$/);
  });

  test("Hindi lines are tagged and get room for matras; Roman Hinglish stays plain", async ({ page }) => {
    await page.goto("/?crowd=1#/notes/n9");
    const hindi = page.locator('[data-testid="transcript-text"][lang="hi"]').first();
    await expect(hindi).toBeVisible({ timeout: 20_000 });
    const m = await hindi.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize), clipped: e.scrollHeight > e.clientHeight + 1 };
    });
    expect(m.lh / m.fs).toBeGreaterThanOrEqual(1.75);
    expect(m.clipped).toBe(false);
    const hinglish = page.locator('[data-testid="transcript-text"]', { hasText: "Haan theek hai" }).first();
    expect(await hinglish.getAttribute("lang")).toBeNull();
    // the bundled Devanagari face loads for Hindi (Linux installs often have no Indic font: boxes)
    const faces = await page.evaluate(async () => (await document.fonts.load('13px "Flo Devanagari"', "हाँ")).length);
    expect(faces).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.fonts.check('13px "Flo Devanagari"', "हाँ"))).toBe(true);
  });

  test("the speaker legend stays pinned while reading down the transcript", async ({ page }) => {
    await page.goto("/#/notes/n1");
    const legend = page.getByTestId("speakers-legend");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    const main = page.locator("main .overflow-y-auto").first();
    await main.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(300);
    const [l, m] = [(await legend.boundingBox())!, (await main.boundingBox())!];
    // still on screen at the top of the scroller, and the notes list stayed in view too
    expect(l.y).toBeGreaterThanOrEqual(m.y - 1);
    expect(l.y).toBeLessThan(m.y + 40);
    const list = (await page.getByTestId("notes-list").boundingBox())!;
    expect(list.y).toBeGreaterThanOrEqual(m.y - 1);
  });

  test("'Who is this?' on the right-most chip opens inside the window and closes on an outside click", async ({ page }) => {
    await page.goto("/?crowd=1#/notes/n9");
    const chips = page.getByTestId("speaker-chip-name");
    await expect(chips.first()).toBeVisible({ timeout: 20_000 });
    // the chip whose right edge is furthest right
    const idx = await chips.evaluateAll((els) => {
      const r = els.map((e) => e.getBoundingClientRect().right);
      return r.indexOf(Math.max(...r));
    });
    await chips.nth(idx).click();
    const picker = page.getByTestId("speaker-picker");
    await expect(picker).toBeVisible();
    const b = (await picker.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(980);
    expect(b.x).toBeGreaterThanOrEqual(0);
    const main = page.locator("main .overflow-y-auto").first();
    expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.mouse.click(400, 300);
    await expect(picker).toHaveCount(0);
  });

  test("opening another note from the end of a long one starts at its top", async ({ page }) => {
    await page.goto("/?crowd=1#/notes/n9");
    await expect(page.getByTestId("speaker-chip").first()).toBeVisible({ timeout: 20_000 });
    const main = page.locator("main .overflow-y-auto").first();
    await main.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.getByTestId("notes-list").getByText("Hermes standup").click();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeLessThan(5);
    await expect(page.getByText("Migration blocked on Stripe webhook keys", { exact: false })).toBeInViewport();
  });

  test("deleting a note asks once", async ({ page }) => {
    await page.goto("/#/notes/n2");
    await page.getByRole("button", { name: "Delete note" }).click({ timeout: 20_000 });
    await expect(page.getByText("Hermes standup").first()).toBeVisible();
    await page.getByRole("button", { name: "Confirm delete note" }).click();
    await expect(page.getByText("Hermes standup")).toHaveCount(0);
  });
});

test.describe("other pages at the minimum window (980 x 640)", () => {
  test.use({ viewport: { width: 980, height: 640 } });

  test("analytics: every stat (\"18h 57m\") stays on one line, labels too", async ({ page }) => {
    await page.goto("/#/analytics");
    const stats = page.getByTestId("analytics-stats");
    await expect(stats).toBeVisible({ timeout: 20_000 });
    const bad = await stats.evaluate((g) =>
      [...g.children].flatMap((card) => {
        const label = card.children[1] as HTMLElement;
        const value = card.children[2] as HTMLElement;
        const line = (e: HTMLElement) => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).lineHeight || "0") * 1.5 || e.getBoundingClientRect().height < 40;
        return [label, value].filter((e) => !line(e)).map((e) => e.textContent);
      }),
    );
    expect(bad).toEqual([]);
  });

  test("settings: a tab row that scrolls fades its cut edge instead of showing half a label", async ({ page }) => {
    await page.goto("/#/settings/privacy");
    const tabs = page.getByTestId("settings-tabs");
    await expect(tabs).toBeVisible({ timeout: 20_000 });
    await expect(tabs).toHaveAttribute("data-fade", /start|end|both/);
    expect(await tabs.evaluate((e) => getComputedStyle(e).maskImage || (getComputedStyle(e) as any).webkitMaskImage)).toContain("gradient");
  });
});

test.describe("Windows / Linux wording", () => {
  test("Linux: voices stay on this computer, the sidebar hint never wraps as '· no phone alerts'", async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 640 });
    await page.goto("/?platform=linux#/notes/n1");
    await page.getByTestId("voices-open").click({ timeout: 20_000 });
    await expect(page.getByTestId("voices-panel")).toContainText("Voices stay on this computer.");
    await expect(page.getByTestId("voices-panel")).not.toContainText("Mac");
    const hint = page.getByTestId("presence-hint");
    await expect(hint).toHaveText("At your computer · no phone alerts");
    // each phrase is on one line
    for (const span of await hint.locator("span.whitespace-nowrap").all()) {
      expect(await span.evaluate((e) => e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).lineHeight) * 1.5)).toBe(true);
    }
  });

  test("Windows: Assistant answers asked from the pill say Pill, not Notch", async ({ page }) => {
    await page.goto("/?platform=windows#/assistant");
    await expect(page.getByText("Pill", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Notch", { exact: true })).toHaveCount(0);
  });
});
