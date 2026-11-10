// Screenshot Connect Slack: the Integrations card (disconnected → waiting → connected → disconnect confirm →
// advanced) against the mock, and the website's browser pages (setup / success / error) on :3000.
//   node tests/perf/shot-slack.mjs <outdir>
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await b.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  storageState: { cookies: [], origins: [{ origin: "http://localhost:5190", localStorage: [{ name: "flo.mock.signedin", value: "1" }] }] },
});
const p = await ctx.newPage();
await p.goto("http://localhost:5190/#/agent/slack");
await p.waitForFunction(() => !!window.__floMock, { timeout: 15000 });
await p.getByTestId("slack-disconnected").waitFor({ timeout: 20000 });
const slackCard = () => p.locator('[data-testid="slack-disconnected"], [data-testid="slack-connected"]').locator("xpath=..");
await slackCard().scrollIntoViewIfNeeded();
await p.waitForTimeout(600);
await slackCard().screenshot({ path: `${out}/slack-card-disconnected.png` });
await p.getByRole("button", { name: "Connect Slack" }).click();
await p.getByTestId("slack-waiting").waitFor();
await p.waitForTimeout(300);
await slackCard().screenshot({ path: `${out}/slack-card-waiting.png` });
await p.evaluate(() => window.__floMock.slackDeepLink());
await p.getByTestId("slack-connected").waitFor();
await p.waitForTimeout(500);
await slackCard().screenshot({ path: `${out}/slack-card-connected.png` });
await p.screenshot({ path: `${out}/slack-settings-connected-toast.png` });
await p.getByTestId("slack-connected").getByRole("button", { name: "Disconnect" }).click();
await p.getByTestId("slack-disconnect-confirm").waitFor();
await p.waitForTimeout(400);
await slackCard().screenshot({ path: `${out}/slack-card-disconnect-confirm.png` });
await p.getByTestId("slack-disconnect-confirm").getByRole("button", { name: "Disconnect" }).click();
await p.getByTestId("slack-disconnected").waitFor();
await p.getByRole("button", { name: "Advanced: paste a token" }).click();
await p.waitForTimeout(500);
await slackCard().screenshot({ path: `${out}/slack-card-advanced.png` });

// website pages
const w = await ctx.newPage();
await w.goto("http://localhost:3000/slack/setup", { waitUntil: "load", timeout: 120000 });
await w.waitForTimeout(800);
await w.screenshot({ path: `${out}/slack-web-setup.png`, fullPage: true });
await w.goto("http://localhost:3000/slack/connected?code=abcdefghijklmnopqrstuvwx&team=Northwind", { waitUntil: "load", timeout: 120000 });
await w.waitForTimeout(900);
await w.screenshot({ path: `${out}/slack-web-connected.png` });
await w.goto("http://localhost:3000/slack/connected?error=expired", { waitUntil: "load", timeout: 120000 });
await w.waitForTimeout(600);
await w.screenshot({ path: `${out}/slack-web-error.png` });
await w.setViewportSize({ width: 390, height: 844 });
await w.goto("http://localhost:3000/slack/setup", { waitUntil: "load" });
await w.waitForTimeout(600);
await w.screenshot({ path: `${out}/slack-web-setup-mobile.png` });
await b.close();
console.log("ok");
