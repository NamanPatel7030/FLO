import { expect, test, type Page } from "@playwright/test";

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);

test("settings: Learning switches save, and What Flo learned lists, forgets and clears", async ({ page }) => {
  await page.goto("/#/settings/dictionary");
  await mock(page);
  const section = page.getByTestId("learning-settings");
  await expect(section).toBeVisible();

  // the three switches, all on by default, each saved to settings
  for (const [label, key] of [
    ["Learn from screen", "learnFromScreen"],
    ["Learn from my edits", "learnCorrections"],
    ["Per-app style", "learnAppStyle"],
  ] as const) {
    const sw = section.locator("label").filter({ hasText: label }).getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect.poll(async () => (await invoke(page, "get_settings"))[key]).toBe(false);
    await sw.click();
    await expect.poll(async () => (await invoke(page, "get_settings"))[key]).toBe(true);
  }

  const panel = page.getByTestId("learned-panel");
  // words read on screen: term, app, count and when
  const terms = panel.getByTestId("learned-term");
  await expect(terms).toHaveCount(4);
  await expect(terms.first()).toContainText("Avenuor");
  await expect(terms.first()).toContainText("Slack · seen 14×");
  await panel.getByRole("button", { name: "Forget Tauri" }).click();
  await expect(terms).toHaveCount(3);
  await expect.poll(async () => (await invoke(page, "learning_overview")).terms.some((t: any) => t.term === "Tauri")).toBe(false);

  // fixes from edits: applied vs waiting for a second time
  await panel.getByRole("tab", { name: /Fixes/ }).click();
  const fixes = panel.getByTestId("learned-fix");
  await expect(fixes).toHaveCount(2);
  await expect(fixes.filter({ hasText: "Priya" })).toContainText("applied");
  await expect(fixes.filter({ hasText: "Supabase" })).toContainText("waiting for a second time");

  // per-app style
  await panel.getByRole("tab", { name: /Style/ }).click();
  await expect(panel.getByTestId("learned-style").filter({ hasText: "Slack" })).toContainText("short messages, casual");
  await expect(panel.getByTestId("learned-style").filter({ hasText: "Mail" })).toContainText("Learning (2 so far)");

  // Clear all empties every list
  await panel.getByRole("button", { name: "Clear all" }).click();
  await expect(panel.getByText("No style yet.")).toBeVisible();
  await panel.getByRole("tab", { name: /Words/ }).click();
  await expect(panel.getByText("No words yet.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Clear all" })).toBeDisabled();
  const o = await invoke(page, "learning_overview");
  expect(o.terms.length + o.fixes.length + o.styles.length).toBe(0);
});
