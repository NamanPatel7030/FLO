import { expect, test, type Page } from "@playwright/test";

// Active / Away presence + phone pairing (src-tauri/src/push.rs, docs/mobile-api.md), against the
// mock backend (lib/mockPresence.ts; window.__floPresenceMock steers the "phone").

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => !!(window as any).__floMock);
  // cold dev-server compiles can be slow on a busy machine: wait for the dashboard shell
  if (!path.includes("island")) await page.getByTestId("presence-card").waitFor({ timeout: 20_000 });
}

// pairing waits on real timers (phone poll every 2 s); give the whole file headroom
test.slow();

const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);

test("sidebar: Active by default; switch to Away shows the amber phone state, and back", async ({ page }) => {
  await ready(page, "/#/home");
  const card = page.getByTestId("presence-card");
  await expect(card).toHaveAttribute("data-status", "active");
  await expect(card.getByRole("radio", { name: "Active" })).toHaveAttribute("aria-checked", "true");
  await expect(card).toContainText("At your Mac");

  await card.getByRole("radio", { name: "Away" }).click();
  await expect(card).toHaveAttribute("data-status", "away");
  await expect(card.getByTestId("presence-hint")).toHaveText("Away · notifications go to your phone");
  expect((await invoke(page, "get_presence")).status).toBe("away");
  // going Away sends today's to-do digest once
  const pushes = await page.evaluate(() => (window as any).__floPresenceMock.state.pushes.map((p: any) => p.kind));
  expect(pushes).toContain("todos_digest");

  await card.getByRole("radio", { name: "Active" }).click();
  await expect(card).toHaveAttribute("data-status", "active");
  // the update card and the status card are still there
  await expect(page.locator("aside").getByText(/anywhere to dictate|Finish setup/).first()).toBeVisible();
});

test("presence survives a stale settings save (only set_presence changes it)", async ({ page }) => {
  await ready(page, "/#/settings/general");
  await page.getByTestId("presence-settings").getByRole("radio", { name: "Away" }).click();
  await expect(page.getByTestId("presence-card")).toHaveAttribute("data-status", "away");
  // change an unrelated setting with an old settings copy
  await page.evaluate(async () => {
    const m = (window as any).__floMock;
    const s = await m.invoke("get_settings");
    await m.invoke("save_settings", { settings: { ...s, presence: "active", typingWpm: 61 } });
  });
  expect((await invoke(page, "get_presence")).status).toBe("away");
});

test("notch quick menu: presence tile toggles Away and the dashboard follows", async ({ page }) => {
  await ready(page, "/?nh=38&nw=200#/island");
  await page.locator("[data-island-root]").waitFor();
  await page.locator('[aria-label="todos"]').waitFor();
  await page.waitForTimeout(150);
  await page.evaluate(() => (window as any).__floMock.emit("flo://hover", { inside: true, x: 100, y: 10 }));
  const tile = page.getByTestId("notch-presence");
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("aria-checked", "false");
  await tile.click();
  await expect(tile).toHaveAttribute("data-status", "away");
  await expect(tile).toHaveAttribute("title", "Away · notifications go to your phone");
  expect((await invoke(page, "get_presence")).status).toBe("away");
  await tile.click();
  await expect(tile).toHaveAttribute("data-status", "active");
});

test("a presence change from elsewhere (phone / auto-away) updates the sidebar", async ({ page }) => {
  await ready(page, "/#/home");
  const card = page.getByTestId("presence-card");
  await expect(card).toHaveAttribute("data-status", "active");
  await page.evaluate(() => (window as any).__floPresenceMock.remote("away"));
  await expect(card).toHaveAttribute("data-status", "away");
});

test("pairing dialog: QR + 6-digit code + countdown; the phone shows up in the list", async ({ page }) => {
  await ready(page, "/#/settings/general");
  const phones = page.getByTestId("phones-card");
  await expect(phones.getByTestId("phone-row")).toHaveCount(1);
  await expect(phones.getByTestId("phone-row").first()).toContainText("Pixel 8");
  await expect(phones.getByTestId("phone-row").first()).toContainText("Android · last seen");

  await phones.getByRole("button", { name: "Pair your Android phone" }).click();
  const dlg = page.getByTestId("pair-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("pair-code")).toHaveText(/^\d{3} \d{3}$/);
  await expect(dlg.getByRole("img", { name: "Pairing QR code" })).toBeVisible();
  const d = await dlg.getByRole("img", { name: "Pairing QR code" }).locator("path").getAttribute("d");
  expect((d ?? "").length).toBeGreaterThan(500); // a real QR, not a placeholder
  await expect(dlg.getByTestId("pair-countdown")).toContainText(/expires in [45]:\d\d/);

  // the phone scans it
  expect(await page.evaluate(() => (window as any).__floPresenceMock.claim("Galaxy S25"))).toBe(true);
  await expect(dlg.getByTestId("pair-success")).toContainText("Galaxy S25 is paired", { timeout: 6000 });
  await dlg.getByRole("button", { name: "Done" }).click();
  await expect(dlg).toHaveCount(0);
  await expect(phones.getByTestId("phone-row")).toHaveCount(2);

  // single use: claiming again fails
  expect(await page.evaluate(() => (window as any).__floPresenceMock.claim("Again"))).toBe(false);

  // remove a phone
  await phones.getByRole("button", { name: "Disconnect Pixel 8" }).click();
  // asks first: Keep leaves it, Disconnect removes it
  await phones.getByRole("button", { name: "Keep" }).click();
  await expect(phones.getByTestId("phone-row")).toHaveCount(2);
  await phones.getByRole("button", { name: "Disconnect Pixel 8" }).click();
  await phones.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(phones.getByTestId("phone-row")).toHaveCount(1);
  await expect(phones).not.toContainText("Pixel 8");
});

test("send test notification only works while Away", async ({ page }) => {
  await ready(page, "/#/settings/general");
  const phones = page.getByTestId("phones-card");
  await expect(phones.getByTestId("phone-row")).toHaveCount(1);
  const btn = phones.getByRole("button", { name: "Send test notification" });
  await expect(btn).toBeDisabled();
  await expect(phones.getByTestId("test-push-status")).toContainText("Works while you're Away");
  // and the backend refuses too
  await expect(invoke(page, "send_test_push")).rejects.toThrow(/Switch to Away/);

  await page.getByTestId("presence-settings").getByRole("radio", { name: "Away" }).click();
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(phones.getByTestId("test-push-status")).toContainText("Sent to 1 phone.");
  const last = await page.evaluate(() => (window as any).__floPresenceMock.state.pushes.at(-1));
  expect(last.title).toBe("Test from Flo");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("without an account, presence says so and pairing is refused", async ({ page }) => {
    await page.goto("/?offline=1#/settings/general");
    await page.waitForFunction(() => !!(window as any).__floMock);
    expect(await page.evaluate(() => (window as any).__floMock.invoke("get_presence").then((p: any) => p.signedIn))).toBe(false);
    await expect(page.evaluate(() => (window as any).__floMock.invoke("pair_phone_start"))).rejects.toThrow(/Sign in/);
  });
});
