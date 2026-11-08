import { expect, test, type Page } from "@playwright/test";

// One-click Connect Slack (Settings → Integrations). The mock stands in for the Rust side:
// slack_oauth_start records the URL it would open; __floMock.slackDeepLink() is flo://slack?code=… arriving.
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const opened = (page: Page) => page.evaluate(() => [...(window as any).__floMock.opened] as string[]);
const deepLink = (page: Page, code?: string) => page.evaluate((c) => (window as any).__floMock.slackDeepLink(c), code);

async function open(page: Page) {
  await page.goto("/#/settings/integrations");
  await mock(page);
  await expect(page.getByTestId("slack-disconnected")).toBeVisible({ timeout: 20_000 });
}

test("Connect Slack: one click opens the website's Connect URL, the deep link flips the card live", async ({ page }) => {
  await open(page);
  // the token field is tucked away; the big button is the way in
  await expect(page.getByLabel("Slack token")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect Slack" }).click();

  await expect.poll(() => opened(page)).toHaveLength(1);
  const [url] = await opened(page);
  expect(url).toMatch(/^http:\/\/localhost:3000\/api\/slack\/install\?state=st_[a-z0-9]+$/);
  await expect(page.getByTestId("slack-waiting")).toContainText("Finish in your browser");

  // browser → Slack → our website → flo://slack?code=… → backend claims the token → event
  expect(await deepLink(page)).toBe(true);
  const card = page.getByTestId("slack-connected");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("slack-user")).toHaveText("@parth");
  await expect(page.getByTestId("slack-team")).toHaveText("Northwind");
  await expect(page.getByText("Slack connected as @parth in Northwind")).toBeVisible(); // toast
  // the existing toggles still work
  await page.getByText("Turn unanswered DMs and mentions into to-dos").click();
  await expect.poll(async () => (await invoke(page, "get_settings")).slackSync).toBe(true);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("3 to-dos added")).toBeVisible();
});

test("a stray flo://slack link (no Connect started here) shows an error and stays disconnected", async ({ page }) => {
  await open(page);
  expect(await deepLink(page, "forged_code_1234567890")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByTestId("slack-disconnected")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("slack-connected")).toHaveCount(0);
});

test("Cancel while waiting returns to the button; Open again re-opens the browser", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect(page.getByTestId("slack-waiting")).toBeVisible();
  await page.getByRole("button", { name: "Open again" }).click();
  await expect.poll(() => opened(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Connect Slack" })).toBeVisible();
});

test("Advanced: paste a token still works", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Advanced: paste a token" }).click();
  await page.getByLabel("Slack token").fill("not-a-token");
  await page.getByTestId("slack-disconnected").getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/doesn't look like a Slack token/)).toBeVisible();
  await page.getByLabel("Slack token").fill("xoxp-123-abc");
  await page.getByTestId("slack-disconnected").getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("slack-user")).toHaveText("Parth Gundaniya");
  await expect(page.getByTestId("slack-team")).toHaveText("Northwind");
  expect(await opened(page)).toHaveLength(0);
});

test("Disconnect asks first, revokes by default, and can skip the revoke", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect.poll(() => opened(page)).toHaveLength(1);
  await deepLink(page);
  await expect(page.getByTestId("slack-connected")).toBeVisible();

  await page.getByTestId("slack-connected").getByRole("button", { name: "Disconnect" }).click();
  const confirm = page.getByTestId("slack-disconnect-confirm");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("slack-connected")).toBeVisible();

  await page.getByTestId("slack-connected").getByRole("button", { name: "Disconnect" }).click();
  await expect(confirm.getByRole("checkbox", { name: /revoke/ })).toBeChecked();
  await confirm.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("slack-disconnected")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__floMock.slackRevoked())).toBe(1);
  const disc = await page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "slack_disconnect").map((c: any) => c.args));
  expect(disc).toEqual([{ revoke: true }]);

  // reconnect via token, disconnect without revoking
  await page.getByRole("button", { name: "Advanced: paste a token" }).click();
  await page.getByLabel("Slack token").fill("xoxp-123-abc");
  await page.getByTestId("slack-disconnected").getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByTestId("slack-connected").getByRole("button", { name: "Disconnect" }).click();
  await confirm.getByRole("checkbox", { name: /revoke/ }).uncheck();
  await confirm.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("slack-disconnected")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__floMock.slackRevoked())).toBe(1);
});
