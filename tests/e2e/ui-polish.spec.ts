import { expect, test, type Page } from "@playwright/test";

// Regression checks for the UI audit: nothing clipped at the minimum window size, no jump when the
// Windows / Linux pill opens, correct counts and plurals.

const MIN = { width: 980, height: 640 };

/** Elements (matching sel) whose text is cut: wider or taller than their box. */
async function clipped(page: Page, sel: string) {
  return page.locator(sel).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${(el.textContent ?? "").trim().slice(0, 40)} ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`),
  );
}

test.describe("minimum window (980 x 640)", () => {
  test.use({ viewport: MIN });

  test("settings: the tab row never pushes the page sideways, and the chosen tab is in view", async ({ page }) => {
    await page.goto("/#/settings/about");
    const tabs = page.getByTestId("settings-tabs");
    await expect(tabs).toBeVisible({ timeout: 20_000 }); // first load compiles the route
    const main = page.locator("main .overflow-y-auto").first();
    // the page itself doesn't scroll sideways (the tab row did, at 980 px)
    await expect.poll(() => main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const [t, m] = [(await tabs.boundingBox())!, (await main.boundingBox())!];
    expect(t.x + t.width).toBeLessThanOrEqual(m.x + m.width + 1);
    // About is the last tab: scrolled into the row's view
    const about = tabs.getByRole("button", { name: "About" });
    await expect
      .poll(async () => {
        const [a, r] = [(await about.boundingBox())!, (await tabs.boundingBox())!];
        return a.x >= r.x - 1 && a.x + a.width <= r.x + r.width + 1;
      })
      .toBe(true);
  });

  test("sidebar: the status card at the bottom isn't cut off", async ({ page }) => {
    await page.goto("/#/home");
    const aside = page.locator("aside");
    const card = aside.getByText(/Ready|Finish setup/).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    // everything fits, or the sidebar scrolls to it: either way it's reachable and not clipped
    await card.scrollIntoViewIfNeeded();
    const [c, a] = [(await card.boundingBox())!, (await aside.boundingBox())!];
    expect(c.y + c.height).toBeLessThanOrEqual(a.y + a.height + 1);
  });

  test("home: Claude session names stay readable and the card counts what the sidebar badge counts", async ({ page }) => {
    await page.goto("/#/home");
    const badge = page.getByTestId("nav-badge-home");
    await expect(badge).toHaveText("2", { timeout: 20_000 });
    const count = page.getByTestId("claude-attention-count");
    await expect(count).toHaveText("2");
    // the header doesn't run into "Mark all seen"
    const mark = page.getByRole("button", { name: /mark all seen/i });
    const [c, m] = [(await count.boundingBox())!, (await mark.boundingBox())!];
    expect(c.x + c.width).toBeLessThanOrEqual(m.x);
    const title = page.locator("main span", { hasText: /^Claude sessions$/ }).first();
    expect(await title.evaluate((e) => e.getBoundingClientRect().right)).toBeLessThanOrEqual(m.x);
    // each session's project name is shown whole (the status chip gives way first)
    for (const name of ["Flo", "hermes-api", "apollo-web"]) {
      const el = page.locator("main span.font-medium", { hasText: new RegExp(`^${name}$`) }).first();
      await expect(el).toBeVisible();
      expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
  });

  test("skills: a scheduled skill keeps its name and schedule readable", async ({ page }) => {
    await page.goto("/#/skills");
    const sched = page.getByTestId("skill-schedule").first();
    await expect(sched).toBeVisible({ timeout: 20_000 });
    expect(await clipped(page, '[data-testid="skill-schedule"] span')).toEqual([]);
    const name = page.locator("main span.truncate", { hasText: "Morning inbox digest" }).first();
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  });
});

test("home: stats say what they measure (30-day window, singular streak)", async ({ page }) => {
  await page.goto("/#/home");
  await expect(page.getByText(/in the last 30 days$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/this month/)).toHaveCount(0);
  await expect(page.getByText("days in a row")).toHaveCount(0);
});

for (const platform of ["windows", "linux"] as const) {
  test(`${platform}: opening and closing the pill never shows a frame where pill and window disagree`, async ({ page }) => {
    await page.goto(`/?platform=${platform}#/island`);
    await page.waitForFunction(() => !!(window as any).__floMock);
    await page.getByTestId("island-pill").waitFor();
    await page.waitForTimeout(300);
    // record, every frame, how far the pill sits from its 12 px inset inside the window
    await page.evaluate(() => {
      const w = window as any;
      w.__gap = 0;
      const tick = () => {
        const root = document.querySelector("[data-island-root]")!.getBoundingClientRect();
        const pill = document.querySelector('[data-testid="island-pill"]')!.getBoundingClientRect();
        const off = Math.max(Math.abs(pill.left - root.left - 12), Math.abs(root.right - pill.right - 12), Math.abs(pill.top - root.top - 12), Math.abs(root.bottom - pill.bottom - 12));
        w.__gap = Math.max(w.__gap, off);
        w.__raf = requestAnimationFrame(tick);
      };
      tick();
    });
    const emit = (p: unknown) => page.evaluate((p) => (window as any).__floMock.emit("flo://hover", p), p);
    for (let i = 0; i < 2; i++) {
      await emit({ inside: true, x: 0, y: 12, cx: 0 });
      for (let k = 0; k < 8; k++) {
        await page.waitForTimeout(60);
        await emit({ inside: true, x: k * 4, y: 14, cx: k * 4 });
      }
      await page.waitForTimeout(500);
      await emit({ inside: false });
      await page.waitForTimeout(700);
    }
    const gap = await page.evaluate(() => {
      cancelAnimationFrame((window as any).__raf);
      return (window as any).__gap;
    });
    expect(gap).toBeLessThanOrEqual(1);
  });

  test(`${platform}: Claude and reminder cards show their whole title`, async ({ page }) => {
    for (const demo of ["claude", "reminder"]) {
      await page.goto(`/?demo=${demo}&platform=${platform}#/island`);
      const card = page.getByTestId(`${demo}-card`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(300);
      expect(await clipped(page, `[data-testid="${demo}-card"] [data-card-text] span.truncate`)).toEqual([]);
    }
  });
}

test("notch panel: quick action labels aren't clipped (descenders of g / y)", async ({ page }) => {
  await page.goto("/?demo=panel&nh=38&nw=200#/island");
  const labels = page.locator(".island-tile-label");
  await expect(labels.first()).toBeVisible({ timeout: 10_000 });
  expect(await clipped(page, ".island-tile-label")).toEqual([]);
});

test("to-do tray: one to-do reads “1 to-do needs you”", async ({ page }) => {
  await page.goto("/#/island");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.locator('[aria-label="todos"]').waitFor();
  // leave exactly one urgent to-do (due today)
  await page.evaluate(async () => {
    const m = (window as any).__floMock;
    for (const t of await m.invoke("list_todos")) await m.invoke("delete_todo", { id: t.id });
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await m.invoke("add_todo", { title: "Only one", due: today });
    m.emit("flo://todos", {});
  });
  const icon = page.locator('[aria-label="todos"]');
  await expect(icon).toBeVisible();
  const list = page.getByTestId("todo-tip-list");
  for (let i = 0; i < 30 && !(await list.isVisible()); i++) {
    const [b, w] = [(await icon.boundingBox())!, (await page.locator("[data-island-root]").boundingBox())!];
    const cx = b.x + b.width / 2 - (w.x + w.width / 2);
    await page.evaluate((p) => (window as any).__floMock.emit("flo://hover", p), { inside: true, cx, y: b.y - w.y + b.height / 2, x: w.width / 2 + cx });
    await page.waitForTimeout(100);
  }
  await expect(list).toBeVisible();
  await expect(page.getByText("1 to-do needs you")).toBeVisible();
  await expect(page.getByText(/1 to-do need you/)).toHaveCount(0);
});

test("dark theme on a light OS: theme-specific colours follow Flo's theme, not the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("flo:theme-mode", "dark"));
  await page.goto("/#/todos");
  // the "from your screen" app badge: dark:text-brand-300 must apply under data-theme=dark
  const badge = page.locator("main span.rounded-md", { hasText: "Slack" }).first();
  await expect(badge).toBeVisible();
  const light = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "text-brand-600";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(await badge.evaluate((e) => getComputedStyle(e).color)).not.toBe(light);
});
