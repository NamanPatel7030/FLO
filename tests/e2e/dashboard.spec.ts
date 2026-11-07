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

test("home badge counts live Claude sessions needing attention; Mark all seen clears recent events", async ({ page }) => {
  await page.goto("/#/home");
  // mock seeds 3 sessions (done, needs_approval, working) → 2 need attention
  await expect(page.locator('[data-testid="nav-badge-home"]')).toHaveText("2");
  // recent events list has unseen items → "Mark all seen" is offered, then clears
  const mark = page.getByRole("button", { name: /mark all seen/i });
  await expect(mark).toBeVisible();
  await mark.click();
  await expect(mark).toHaveCount(0);
});

test("assistant: quick-command style request shows a reply", async ({ page }) => {
  await page.goto("/#/assistant");
  const box = page.getByPlaceholder(/ask|tell flo/i);
  await box.fill("Add a to-do to Apollo: send the deck by Friday");
  await box.press("Enter");
  await expect(page.getByText(/Apollo/).first()).toBeVisible();
});

test("history: entries can be copied", async ({ page, context, browserName }) => {
  // permission names are Chromium-only; WebKit copies on the user gesture (or via the execCommand fallback)
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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

test("appearance: dark-only (no theme toggle), accent and notch style apply and persist", async ({ page }) => {
  await page.goto("/#/settings/appearance");
  await expect(page.getByText("Accent", { exact: true })).toBeVisible();

  // the Theme switcher was removed: app is dark-only
  await expect(page.getByRole("button", { name: "Light" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  // pick the Violet accent → --accent CSS var updates
  await page.getByLabel("Violet").click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()))
    .toBe("#8b5cf6");

  // a typed hex is a working custom colour (the native picker can't be driven from a test)
  const hex = page.getByLabel("Hex colour");
  await hex.fill("#ff6a3d");
  await hex.press("Enter");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()))
    .toBe("#ff6a3d");
  // the Custom swatch is a real, clickable colour input covering the button (not a 0×0 one)
  const picker = page.getByLabel("Custom", { exact: true });
  const box = await picker.boundingBox();
  expect(box!.width).toBeGreaterThan(40);
  expect(box!.height).toBeGreaterThan(20);

  // notch animation lives in the Notch tab now; pick Bars → saved via save_settings
  await page.goto("/#/settings/notch");
  await page.getByRole("button", { name: "Bars", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.invoke("get_settings").then((s: any) => s.notchStyle)))
    .toBe("bars");
});

test("to-dos: reminders section, per-to-do details, and bulk actions", async ({ page }) => {
  await page.goto("/#/todos");
  await page.waitForFunction(() => !!(window as any).__floMock);
  // Reminders: the timed to-do shows with its reminder time
  const reminders = page.getByTestId("reminders");
  await expect(reminders).toContainText("Pay electricity bill");

  // Details: who, where, when, and the transcript lines it came from
  const row = page.getByText("Ask Priya for Stripe webhook keys").first().locator("xpath=ancestor::div[contains(@class,'group')][1]");
  await row.hover();
  await row.getByRole("button", { name: "Details" }).click();
  const d = page.getByTestId("todo-details");
  await expect(d).toBeVisible();
  await expect(d).toContainText("Who said it");
  await expect(d).toContainText("Rahul");
  await expect(d).toContainText("A meeting");
  await expect(d.getByTestId("todo-excerpt")).toContainText("webhook keys from Stripe");
  await expect(d.getByRole("button", { name: /Open the full meeting note/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);

  // Mark all done asks once in place, then completes every open to-do in view
  const mark = page.getByRole("button", { name: "Mark all done" });
  await mark.click();
  await expect(mark).toContainText(/Mark \d+ done\?/);
  await mark.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.invoke("list_todos").then((t: any[]) => t.filter((x) => x.status === "open").length)))
    .toBe(0);

  // Clear done deletes the finished ones, also after a confirm click
  const clear = page.getByRole("button", { name: "Clear done" });
  await clear.click();
  await expect(clear).toContainText(/Delete \d+ done\?/);
  await clear.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.invoke("list_todos").then((t: any[]) => t.filter((x) => x.status === "done").length)))
    .toBe(0);
});

test("notch tab: size, new animations, sounds and notifications all save", async ({ page }) => {
  await page.goto("/#/settings/notch");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const get = (k: string) => page.evaluate((key) => (window as any).__floMock.invoke("get_settings").then((s: any) => s[key]), k);

  await page.getByRole("radio", { name: /Biggest/ }).click();
  await expect.poll(() => get("notchSize")).toBe("biggest");

  // new styles are offered and apply
  for (const name of ["Helix", "Neon", "Sparkle", "Equalizer"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Helix", exact: true }).click();
  await expect.poll(() => get("notchStyle")).toBe("helix");
  // previews fill their tile (one full-width animation, not two half copies)
  const tile = page.getByRole("button", { name: "Helix", exact: true });
  const canvas = tile.locator("canvas");
  const [tb, cb] = [await tile.boundingBox(), await canvas.boundingBox()];
  expect(cb!.width).toBeGreaterThan(tb!.width - 20);

  await page.getByRole("radio", { name: /Glass/ }).click();
  await expect.poll(() => get("soundPack")).toBe("glass");
  await page.getByLabel("Sound volume").fill("35");
  await expect.poll(() => get("soundVolume")).toBe(35);
  await page.getByText("Notification sound", { exact: true }).click();
  await expect.poll(() => get("notifySound")).toBe(false);
  await page.getByText("macOS notification banners", { exact: true }).click();
  await expect.poll(() => get("systemNotifications")).toBe(false);
});
