import { expect, test, type Page } from "@playwright/test";

// Settings → Privacy → Task capture: how selective Flo is when it notes to-dos by itself (screen
// and meetings). The thresholds behind each level are unit-tested in src-tauri/src/capture.rs.
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);

test("task capture: three levels with plain descriptions, Balanced by default, choice is saved", async ({ page }) => {
  await page.goto("/#/settings/privacy");
  await mock(page);
  const group = page.getByRole("radiogroup", { name: "Task capture" });
  await expect(group).toBeVisible({ timeout: 15000 }); // the dev server may still be compiling Settings
  const options = group.getByRole("radio");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("Essential");
  await expect(options.nth(1)).toContainText("Balanced");
  await expect(options.nth(2)).toContainText("Comprehensive");
  await expect(group).toContainText("Only clear requests, commitments and deadlines that need you.");
  await expect(group).toContainText("Essential items plus concrete next steps that matter.");
  await expect(group).toContainText("Everything actionable, including small items.");
  // professional copy, no em dashes
  expect(await group.innerText()).not.toContain("—");

  const balanced = group.getByRole("radio", { name: "Balanced" });
  await expect(balanced).toHaveAttribute("aria-checked", "true");

  await group.getByRole("radio", { name: "Essential" }).click();
  await expect(group.getByRole("radio", { name: "Essential" })).toHaveAttribute("aria-checked", "true");
  await expect(balanced).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await invoke(page, "get_settings")).taskCapture, { timeout: 4000 }).toBe("essential");

  await group.getByRole("radio", { name: "Comprehensive" }).click();
  await expect.poll(async () => (await invoke(page, "get_settings")).taskCapture, { timeout: 4000 }).toBe("comprehensive");
  await expect(group.getByRole("radio", { name: "Comprehensive" })).toHaveAttribute("aria-checked", "true");
});

test("task capture applies even while Attention is off (meeting action items use it too)", async ({ page }) => {
  await page.goto("/#/settings/privacy");
  await mock(page);
  const attention = page.getByRole("switch", { name: /^Attention/ });
  await expect(attention).toBeVisible({ timeout: 15000 });
  if ((await attention.getAttribute("aria-checked")) === "true") await attention.click();
  await expect(page.getByRole("radiogroup", { name: "Task capture" })).toBeVisible();
});
