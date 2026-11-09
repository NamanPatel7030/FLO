import { expect, test, type Page } from "@playwright/test";

// Settings → Privacy → "Sync your data" against the browser mock (the real crypto is unit-tested
// in src-tauri/src/sync.rs and the server routes in website/tests/sync-logic.test.mjs).
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);

test("turn on Sync: recovery key shown once, categories, sync now, delete", async ({ page }) => {
  await page.goto("/?signedin=1#/settings/privacy");
  await mock(page);
  const card = page.getByTestId("sync-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("End-to-end encrypted");
  await expect(card).toContainText("Off. Nothing leaves this Mac.");

  await card.getByText("Sync your data", { exact: true }).last().click();
  const rk = page.getByTestId("sync-recovery");
  await expect(rk).toBeVisible();
  await expect(page.getByTestId("sync-recovery-key")).toHaveText(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){10}$/);
  // "Done" waits for the user to confirm they saved it
  await expect(rk.getByRole("button", { name: "Done" })).toBeDisabled();
  await page.getByTestId("sync-saved").check();
  await rk.getByRole("button", { name: "Done" }).click();
  await expect(rk).toHaveCount(0);

  await expect(card).toContainText("On, encrypted");
  await expect(card).toContainText("Dictation history");
  // switching a category off is saved through its own command
  await card.getByText("Dictation history", { exact: true }).click();
  await expect.poll(() => calls(page, "sync_set_categories")).toEqual([{ categories: ["todos", "notes", "settings"] }]);

  await card.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(async () => (await calls(page, "sync_now")).length).toBe(1);

  await card.getByRole("button", { name: "Show recovery key" }).click();
  await expect(page.getByTestId("sync-recovery-key")).toBeVisible();

  await card.getByRole("button", { name: "Delete my synced data" }).click();
  await page.getByRole("button", { name: "Delete synced data" }).click();
  await expect(card).toContainText("Off. Nothing leaves this Mac.");
});

test("a second Mac unlocks with the recovery key", async ({ page }) => {
  await page.goto("/?signedin=1&syncjoin=1#/settings/privacy");
  await mock(page);
  const card = page.getByTestId("sync-card");
  await card.getByText("Sync your data", { exact: true }).last().click();
  const join = page.getByTestId("sync-join");
  await expect(join).toBeVisible();
  await join.getByLabel("Recovery key").fill("too-short");
  await join.getByRole("button", { name: "Unlock" }).click();
  await expect(card).toContainText("wrong length");
  await join.getByLabel("Recovery key").fill("7k2qf m9x4d ht8vb 3rj6w pzc1n y5gae qk7m2 xd9tf 4hv8r jb3wn 6pc2k");
  await join.getByRole("button", { name: "Unlock" }).click();
  await expect(card).toContainText("On, encrypted");
  await expect(join).toHaveCount(0);
});
