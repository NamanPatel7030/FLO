import { expect, test, type Page } from "@playwright/test";

// Flo Agent: the main face of Flo (mock: lib/mockFloAgent.ts, routing mirrored in lib/agentRoute.ts).
const ready = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock && !!(window as any).__floAgentMock);
const fast = (page: Page) => page.evaluate(() => ((window as any).__floAgentMock.stepMs = 120));

test("Flo Agent is first in the sidebar and the default landing page; Home stays reachable", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const nav = page.locator("aside nav button");
  await expect(nav.first()).toHaveText(/Flo Agent/);
  await expect(page.getByTestId("flo-agent")).toBeVisible();
  await expect(page.getByLabel("Ask Flo Agent")).toBeVisible();
  await nav.filter({ hasText: "Home" }).click();
  await expect(page).toHaveURL(/#\/home$/);
});

test("typing previews the route; an on-screen task streams steps, asks before posting, then finishes", async ({ page }) => {
  await page.goto("/#/agent");
  await ready(page);
  await fast(page);
  const box = page.getByLabel("Ask Flo Agent");
  await box.fill("Open LinkedIn and write a post about Flo");
  await expect(page.getByTestId("route-preview").getByTestId("route-badge")).toHaveAttribute("data-route", "screen");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  const live = page.getByTestId("live-run");
  await expect(live.getByText("Open LinkedIn and write a post about Flo")).toBeVisible();
  await expect(live.getByTestId("run-step").filter({ hasText: "Opening linkedin.com" })).toBeVisible();
  // it stops and waits for a yes before posting
  const confirm = page.getByTestId("agent-confirm");
  await expect(confirm).toContainText("About to post on LinkedIn");
  await expect(live.getByTestId("run-status")).toHaveAttribute("data-status", "waiting");
  await confirm.getByRole("button", { name: "Yes, do it" }).click();
  await expect(page.getByTestId("live-run")).toHaveCount(0);
  const row = page.getByTestId("recent-runs").getByTestId("run-row").first();
  await expect(row).toContainText("Open LinkedIn and write a post about Flo");
  await expect(row.getByTestId("run-status")).toHaveAttribute("data-status", "done");
  await row.click();
  await expect(page.getByTestId("run-timeline").first().getByTestId("run-step").filter({ hasText: "Confirmed" })).toBeVisible();
});

test("saying no stops the run without acting; Stop ends a run", async ({ page }) => {
  await page.goto("/#/agent");
  await ready(page);
  await fast(page);
  await page.getByLabel("Ask Flo Agent").fill("Open LinkedIn and post that I'm hiring");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByTestId("agent-confirm").getByRole("button", { name: "No" }).click();
  await expect(page.getByTestId("run-row").first().getByTestId("run-status")).toHaveAttribute("data-status", "stopped");
  await expect(page.getByTestId("live-run")).toHaveCount(0);

  await page.evaluate(() => ((window as any).__floAgentMock.stepMs = 4000));
  await page.getByLabel("Ask Flo Agent").fill("Go to YouTube and play lofi beats");
  await page.getByLabel("Ask Flo Agent").press("Enter");
  await page.getByTestId("live-run").getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("live-run")).toHaveCount(0);
  await expect(page.getByTestId("run-row").first()).toContainText("Go to YouTube");
  await expect(page.getByTestId("run-row").first().getByTestId("run-status")).toHaveAttribute("data-status", "stopped");
});

test("skills and connected apps are routed to their runners", async ({ page }) => {
  await page.goto("/#/agent");
  await ready(page);
  await fast(page);
  const box = page.getByLabel("Ask Flo Agent");
  await box.fill("In Notion, find my notes from Monday");
  await expect(page.getByTestId("route-preview")).toContainText("Uses Notion");
  await box.press("Enter");
  await expect(page.getByTestId("run-row").first()).toContainText("Found 3 pages", { timeout: 5000 });
  await page.getByTestId("run-row").first().click();
  await expect(page.getByTestId("run-step").filter({ hasText: "notion__search_pages" }).first()).toBeVisible();

  const skills = await page.evaluate(() => (window as any).__floMock.invoke("list_skills"));
  const trigger = String(skills.find((k: any) => k.enabled)?.triggers ?? "").split(",")[0].trim();
  expect(trigger.length).toBeGreaterThan(2);
  await box.fill(`please ${trigger}`);
  await expect(page.getByTestId("route-preview").getByTestId("route-badge")).toHaveAttribute("data-route", "skill");
});

test("Apps and Skills tabs bring every connection and the skill canvas into Flo Agent", async ({ page }) => {
  await page.goto("/#/agent/apps");
  await ready(page);
  await expect(page.getByTestId("connections-grid")).toContainText("Notion");
  await expect(page.getByTestId("integrations-grid")).toBeVisible();
  await expect(page.getByTestId("slack-link")).toBeVisible();
  await page.getByRole("tab", { name: "Skills" }).click();
  await expect(page).toHaveURL(/#\/agent\/skills$/);
  await expect(page.getByTestId("skills-grid")).toBeVisible();
});

const mockSet = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => Object.assign((window as any).__floAgentMock, p), patch);
const installed = (page: Page) => page.evaluate(() => (window as any).__floAgentMock.setHermes({ installed: true, version: "0.22.5", path: "/Users/you/.local/bin/hermes" }));

test("Engine: one click installs Hermes (live progress), then it plays; Pause and Play; Hermes can be chosen", async ({ page }) => {
  await page.goto("/#/agent/engine");
  await ready(page);
  await expect(page.getByTestId("hermes-state")).toContainText("Not installed");
  await expect(page.getByRole("radio", { name: "Hermes Agent" })).toBeDisabled();
  await expect(page.getByTestId("copy-command")).toHaveCount(0); // no Terminal step any more
  await page.getByRole("button", { name: "Install Hermes" }).click();
  await expect(page.getByTestId("hermes-state")).toContainText("Installing");
  await expect(page.getByTestId("hermes-install-log")).toContainText("Cloning hermes-agent");
  // done: detected, verified, and playing without another click
  await expect(page.getByTestId("hermes-state")).toContainText("Running on 127.0.0.1:8642", { timeout: 5000 });
  await expect(page.getByTestId("hermes-export")).toContainText("1 MCP server");
  await expect(page.getByTestId("hermes-log")).toContainText("hermes gateway");
  expect((await page.evaluate(() => (window as any).__floMock.invoke("flo_agent_config"))).hermesPlaying).toBe(true);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("hermes-state")).toContainText("Paused");
  expect((await page.evaluate(() => (window as any).__floMock.invoke("hermes_status"))).running).toBe(false);
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("hermes-state")).toContainText("Running on 127.0.0.1:8642");

  await page.getByRole("radio", { name: "Hermes Agent" }).click();
  await expect(page.getByRole("radio", { name: "Hermes Agent" })).toHaveAttribute("aria-checked", "true");
  // answer tasks now go to Hermes, and its output streams into the timeline
  await fast(page);
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByTestId("aside-engine")).toContainText("Hermes Agent");
  await page.getByLabel("Ask Flo Agent").fill("Summarize my week");
  await expect(page.getByTestId("route-preview").getByTestId("route-badge")).toHaveAttribute("data-route", "hermes");
  await page.getByLabel("Ask Flo Agent").press("Enter");
  await expect(page.getByTestId("run-row").first().getByTestId("run-status")).toHaveAttribute("data-status", "done", { timeout: 5000 });
});

test("a failed install shows the installer's own reason; Cancel stops it; Intel computers get a clear message", async ({ page }) => {
  await page.goto("/#/agent/engine");
  await ready(page);
  await mockSet(page, { installFails: "git needs Apple's Command Line Tools. Install Apple's Command Line Tools (run: xcode-select --install), then re-run this installer." });
  await page.getByRole("button", { name: "Install Hermes" }).click();
  await expect(page.getByTestId("hermes-install-error")).toContainText("The Hermes installer stopped: git needs Apple's Command Line Tools", { timeout: 5000 });
  await expect(page.getByTestId("hermes-install-log")).toContainText("✗ git needs");
  await expect(page.getByTestId("hermes-state")).toContainText("Not installed");

  await mockSet(page, { installFails: null, installMs: 3000 });
  await page.getByRole("button", { name: "Install Hermes" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("hermes-install-error")).toContainText("Install cancelled");
  await expect(page.getByRole("button", { name: "Install Hermes" })).toBeVisible();

  await page.evaluate(() => (window as any).__floAgentMock.setHermes({ appleSilicon: false }));
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("hermes-intel")).toContainText("Apple Silicon");
  await expect(page.getByRole("button", { name: "Install Hermes" })).toHaveCount(0);
});

test("Slack: the user's case (tokens and allow-list saved, no Hermes) says why @Flo is silent; Install makes it live; Pause stops it", async ({ page }) => {
  await page.goto("/#/agent/slack");
  await ready(page);
  await page.evaluate(async () => {
    const m = (window as any).__floMock;
    await m.invoke("set_api_key", { provider: "hermes_slack_bot", key: "xoxb-1-2-abc" });
    await m.invoke("set_api_key", { provider: "hermes_slack_app", key: "xapp-1-A-abc" });
    await m.invoke("flo_agent_save_config", { config: { ...(await m.invoke("flo_agent_config")), slackAllowedUsers: "U0AR547TTRS" } });
  });
  // leave and come back (same app session) so the page reads the new state
  await page.goto("/#/home");
  await page.goto("/#/agent/slack");
  const hero = page.getByTestId("slack-hero");
  await expect(page.getByTestId("slack-status")).toHaveText("Install Hermes to answer in Slack");
  await expect(page.getByTestId("slack-blocker")).toContainText("Hermes isn't installed, so nothing is listening for @Flo");
  await expect(page.getByTestId("slack-checks").getByRole("button", { name: "Hermes installed" })).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("slack-checks").getByRole("button", { name: "Bot token (xoxb-)" })).toHaveAttribute("data-ok", "true");
  // the bot token was checked with Slack: setup collapses to one row
  await expect(page.getByTestId("slack-bot-connected")).toContainText("Bot connected: @flo in Northwind");
  await expect(page.getByTestId("slack-setup")).toHaveCount(0);

  await hero.getByRole("button", { name: "Install Hermes" }).click();
  await expect(page.getByTestId("slack-status")).toHaveText("Installing Hermes…");
  await expect(page.getByTestId("slack-status")).toHaveText("Flo is live in Slack", { timeout: 5000 });
  await expect(page.getByTestId("slack-blocker")).toHaveCount(0);
  await expect(page.getByTestId("slack-checks").getByRole("button", { name: "Live in Slack" })).toHaveAttribute("data-ok", "true");

  await hero.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("slack-status")).toHaveText("Paused");
  await expect(page.getByTestId("slack-blocker")).toContainText("Hermes is paused");
  expect((await page.evaluate(() => (window as any).__floMock.invoke("hermes_status"))).slackRunning).toBe(false);
  await hero.getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("slack-status")).toHaveText("Flo is live in Slack");
});

test("Slack setup: manifest link, tokens to the keychain (prefix checked), invalid bot token, allow-list filled with your own ID", async ({ page }) => {
  await page.goto("/#/agent/slack");
  await ready(page);
  await installed(page);
  await page.getByRole("tab", { name: "Engine" }).click();
  await page.getByRole("tab", { name: "Slack" }).click();
  await expect(page.getByTestId("slack-blocker")).toContainText("bot token is missing");
  await page.evaluate(() => ((window as any).open = (u: string) => (((window as any).__openedUrl = u), null)));
  await page.getByRole("button", { name: "Create Slack app" }).click();
  expect(await page.evaluate(() => decodeURIComponent((window as any).__openedUrl))).toMatch(/^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_yaml=[\s\S]*socket_mode_enabled: true/);

  const bot = page.getByTestId("secret-hermes_slack_bot");
  await bot.getByLabel("Bot token").fill("not-a-token");
  await bot.getByRole("button", { name: "Save" }).click();
  await expect(bot).toContainText("Bot token starts with xoxb-");
  await mockSet(page, { badBotToken: true });
  await bot.getByLabel("Bot token").fill("xoxb-test-123");
  await bot.getByRole("button", { name: "Save" }).click();
  await expect(bot).toContainText("Saved in your keychain");
  await expect(page.getByTestId("slack-bot-error")).toContainText("isn't valid");
  await expect(page.getByTestId("slack-blocker")).toContainText("isn't valid");
  await mockSet(page, { badBotToken: false });
  await bot.getByRole("button", { name: "Remove" }).click();
  await bot.getByLabel("Bot token").fill("xoxb-test-123");
  // Flo's own Slack connection is on: your Member ID fills the empty allow-list
  await page.evaluate(() => (window as any).__floMock.invoke("slack_connect", { token: "xoxp-123-abc" }));
  await bot.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Added you (U0AR547TTRS) to who can talk to Flo")).toBeVisible();
  await expect(page.getByLabel("Allowed Slack Member IDs")).toHaveValue("U0AR547TTRS");
  await expect(page.getByTestId("slack-blocker")).toContainText("app token is missing");

  const app = page.getByTestId("secret-hermes_slack_app");
  await app.getByLabel("App token").fill("xapp-test-456");
  await app.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("slack-bot-connected")).toContainText("Bot connected: @flo in Northwind");
  // still editable: Change opens the steps, Member IDs are cleaned
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByLabel("Allowed Slack Member IDs").fill("u01abc2def3, junk!, W0456");
  await page.getByTestId("slack-setup").getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByLabel("Allowed Slack Member IDs")).toHaveValue("U01ABC2DEF3, W0456");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("slack-blocker")).toContainText("Hermes is paused");
  await page.getByTestId("slack-hero").getByRole("button", { name: "Play" }).click();
  await expect(page.getByTestId("slack-status")).toHaveText("Flo is live in Slack");
});

test("one Slack page: Integrations links to it, and Slack to-dos live there too", async ({ page }) => {
  await page.goto("/#/settings/integrations");
  await ready(page);
  await expect(page.getByTestId("slack-disconnected")).toHaveCount(0);
  await page.getByTestId("slack-link").click();
  await expect(page).toHaveURL(/#\/agent\/slack$/);
  await expect(page.getByTestId("agent-slack").getByTestId("slack-disconnected")).toBeVisible();
  await expect(page.getByTestId("agent-slack")).toContainText("Slack to-dos");
  const text = await page.getByTestId("agent-slack").innerText();
  expect(text).not.toMatch(/\bMac\b/);
});

test("Customize: persona and switches persist; send/post/pay/delete confirmation can't be turned off", async ({ page }) => {
  await page.goto("/#/agent/customize");
  await ready(page);
  await expect(page.getByTestId("confirm-locked")).toContainText("Always");
  await expect(page.getByTestId("confirm-locked").getByRole("switch")).toHaveCount(0);
  await page.getByLabel("Persona").fill("A careful recruiter");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("switch", { name: /Screen control/ }).click();
  const cfg = await page.evaluate(() => (window as any).__floMock.invoke("flo_agent_config"));
  expect(cfg.persona).toBe("A careful recruiter");
  expect(cfg.allowScreen).toBe(false);
  // with screen control off, an on-screen task is not routed to the screen agent
  const plan = await page.evaluate(() => (window as any).__floMock.invoke("flo_agent_plan", { goal: "open LinkedIn and like the first post" }));
  expect(plan.route).not.toBe("screen");
});

test("a voice run from the notch shows up in Flo Agent with its steps", async ({ page }) => {
  await page.goto("/#/agent");
  await ready(page);
  await expect(page.getByTestId("recent-runs")).toBeVisible(); // runs loaded: the listener is wired
  await page.evaluate(() => {
    const m = (window as any).__floMock;
    m.emit("flo://agent", { kind: "start", text: "play lofi on youtube" });
    m.emit("flo://agent", { kind: "step", text: "Opening youtube.com" });
  });
  const live = page.getByTestId("live-run");
  await expect(live).toContainText("play lofi on youtube");
  await expect(live.getByTestId("run-step").filter({ hasText: "Opening youtube.com" })).toBeVisible();
  await page.evaluate(() => (window as any).__floMock.emit("flo://agent", { kind: "done", text: "Playing it." }));
  await expect(page.getByTestId("run-row").first()).toContainText("Playing it.");
});

test("Flo Agent copy has no em dashes", async ({ page }) => {
  for (const tab of ["", "/apps", "/engine", "/slack", "/customize"]) {
    await page.goto(`/#/agent${tab}`);
    await ready(page);
    await page.waitForTimeout(300);
    const text = await page.getByTestId("flo-agent").innerText();
    expect(text, tab || "overview").not.toContain("—");
  }
});
