import { expect, test } from "@playwright/test";

// In-app updates: the server publishes a release → the sidebar offers "Update" → progress →
// "Restart now" → the app restarts into the new version.

test("update: available → Update → progress → Restart now restarts the app", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__floMockRelease = { version: "0.2.0", notes: "Skills on a schedule and faster dictation." };
  });
  await page.goto("/#/home");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const card = page.getByTestId("update-card");
  await expect(card).toContainText("Flo 0.2.0 is available");
  await expect(card).toContainText("Skills on a schedule");
  await card.getByRole("button", { name: "Update" }).click();
  await expect(card).toContainText(/Updating to 0\.2\.0/);
  await expect(card.getByRole("progressbar")).toBeVisible();
  await expect(card).toContainText("Flo 0.2.0 is ready", { timeout: 5000 });
  await card.getByRole("button", { name: "Restart now" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floRestarted ?? 0)).toBe(1);
});

test("update: no card when up to date; Settings → Check for updates says so", async ({ page }) => {
  await page.goto("/#/settings/general");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await expect(page.getByTestId("update-card")).toHaveCount(0);
  const row = page.getByTestId("update-settings");
  await row.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByTestId("update-status")).toContainText("You're on the latest version (0.1.0)");
});

test("update: Settings shows the new version and installs it", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__floMockRelease = { version: "0.3.1" };
  });
  await page.goto("/#/settings/general");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const row = page.getByTestId("update-settings");
  await expect(page.getByTestId("update-status")).toContainText("Flo 0.3.1 is available");
  await row.getByRole("button", { name: "Update" }).click();
  await expect(page.getByTestId("update-status")).toContainText("Restart to finish", { timeout: 5000 });
  await expect(row.getByRole("button", { name: "Restart now" })).toBeVisible();
});
