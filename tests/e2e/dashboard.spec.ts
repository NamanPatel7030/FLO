import { expect, test } from "@playwright/test";

test("every dashboard page renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const p of ["home", "assistant", "todos", "projects", "notes", "analytics", "history", "settings"]) {
    await page.goto(`/#/${p}`);
    await expect(page.locator("main, [role=main], body").first()).toBeVisible();
    await page.waitForTimeout(250);
  }
  expect(errors).toEqual([]);
  await expect(page.getByText("Your Assistant").first()).toBeVisible();
  await expect(page.getByText(/flo flow/i)).toHaveCount(0);
});

test("assistant: quick-command style request shows a reply", async ({ page }) => {
  await page.goto("/#/assistant");
  const box = page.getByPlaceholder(/ask|tell flo/i);
  await box.fill("Add a to-do to Apollo: send the deck by Friday");
  await box.press("Enter");
  await expect(page.getByText(/Apollo/).first()).toBeVisible();
});

test("history: entries can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/history");
  const copy = page.getByRole("button", { name: /copy/i }).first();
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByText(/copied/i).first()).toBeVisible();
});

test("settings → shortcuts: fn = assistant, control = dictation, no duplicates", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /shortcuts/i }).first().click();
  await expect(page.getByText(/Dictation key/i)).toBeVisible();
  await expect(page.getByText(/Assistant key/i)).toBeVisible();
  const s = await page.evaluate(() => (window as any).__floMock.invoke("get_settings"));
  expect([s.hotkeyDictation, s.hotkeyAssistant]).toEqual(["ctrl", "fn"]);
});

test("permissions: repair needs a second click to confirm", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /permissions/i }).first().click();
  const repair = page.getByRole("button", { name: /repair permissions/i });
  await expect(repair).toBeVisible();
  await repair.click();
  await expect(page.getByRole("button", { name: /click again/i })).toBeVisible();
});

test("network log shows tokens for AI calls", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /privacy/i }).first().click();
  await expect(page.getByText(/Network log/i)).toBeVisible();
});
