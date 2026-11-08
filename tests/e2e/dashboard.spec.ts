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

  // notch animation lives on the same Appearance tab (Notch section); pick Bars → saved via save_settings
  await page.getByRole("region", { name: "Notch" }).scrollIntoViewIfNeeded();
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

test("settings: Account merged into General, Notch merged into Appearance; old links still work", async ({ page }) => {
  await page.goto("/#/settings/general");
  await page.waitForFunction(() => !!(window as any).__floMock);
  for (const gone of ["Account", "Notch"]) await expect(page.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Account" }).getByTestId("account-card")).toBeVisible();
  await expect(page.getByRole("region", { name: "Preferences" }).getByText("Your typing speed")).toBeVisible();
  // the old Account link lands on General
  await page.goto("/#/settings/account");
  await expect(page.getByTestId("account-card")).toBeVisible();
  await expect(page).toHaveURL(/#\/settings\/general$/);
  // the old Notch link lands on Appearance, which has accent + every notch section
  await page.goto("/#/settings/notch");
  await expect(page).toHaveURL(/#\/settings\/appearance$/);
  for (const name of ["Colour", "Notch", "Sounds & alerts", "Widgets"]) await expect(page.getByRole("region", { name })).toBeVisible();
  await expect(page.getByText("Accent", { exact: true })).toBeVisible();
});

test("accent recolours the brand palette and logo live", async ({ page }) => {
  await page.goto("/#/settings/appearance");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const before = await page.evaluate(() => {
    const el = document.createElement("span");
    el.className = "text-brand-300";
    document.body.appendChild(el);
    return getComputedStyle(el).color;
  });
  await page.getByLabel("Violet").click();
  // a brand-* utility (Tailwind) follows the accent with no reload
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".text-brand-300")!).color)).not.toBe(before);
  // …and so does the logo (inline SVG drawn from the accent vars)
  const logoStop = () => page.evaluate(() => getComputedStyle(document.querySelector('svg[aria-label="Flo"] linearGradient stop[offset="0.5"]')!).stopColor);
  const violetStop = await logoStop();
  await page.getByLabel("Sky").click();
  await expect.poll(logoStop).not.toBe(violetStop);
});

test("clock widget: add time zones in Settings and they show in the notch widgets", async ({ page }) => {
  await page.goto("/#/settings/appearance");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const ed = page.getByTestId("clock-zones-editor");
  await ed.scrollIntoViewIfNeeded();
  for (const city of ["London", "Singapore"]) {
    const add = ed.getByRole("button", { name: "Add time zone" });
    if (await add.isVisible()) await add.click();
    await ed.getByLabel("Search cities").fill(city.slice(0, 4));
    await ed.getByRole("option", { name: new RegExp(city) }).first().click();
  }
  await expect(ed.getByRole("button", { name: "Remove London" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("flo.clockZones") || "[]").map((z: any) => z.city))).toEqual(["London", "Singapore"]);
  // remove one, then it's gone from storage too
  await ed.getByRole("button", { name: "Remove London" }).click();
  // the picker stays open for adding more; keyboard: type, Enter picks the top match
  await ed.getByLabel("Search cities").fill("new y");
  await ed.getByLabel("Search cities").press("Enter");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("flo.clockZones") || "[]").map((z: any) => z.city))).toEqual(["Singapore", "New York"]);

  // the notch widgets panel (same origin → same localStorage) shows the extra zones
  await page.goto("/?nh=38&nw=420&demo=widgets#/island");
  const zones = page.getByTestId("clock-zone");
  await expect(zones).toHaveCount(2);
  await expect(zones.nth(0)).toContainText("Singapore");
  await expect(zones.nth(1)).toContainText("New York");
  await expect(zones.nth(0)).toContainText(/\d{1,2}:\d{2}/);
});

test("appearance → notch section: size, new animations, sounds and notifications all save", async ({ page }) => {
  await page.goto("/#/settings/notch");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await expect(page).toHaveURL(/#\/settings\/appearance$/);
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

  // start, stop and notification sounds are each their own style + switch
  await page.getByRole("radiogroup", { name: "Start listening style" }).getByRole("radio", { name: /Pop/ }).click();
  await expect.poll(() => get("soundStart")).toBe("pop");
  await page.getByRole("radiogroup", { name: "Stop and done style" }).getByRole("radio", { name: /Soft/ }).click();
  await expect.poll(() => get("soundStop")).toBe("soft");
  await page.getByRole("radiogroup", { name: "Notifications style" }).getByRole("radio", { name: /Glass/ }).click();
  await expect.poll(() => get("soundNotify")).toBe("glass");
  await page.getByRole("switch", { name: "Stop and done sound" }).click();
  await expect.poll(() => get("stopSoundOn")).toBe(false);
  await page.getByRole("switch", { name: "Notifications sound" }).click();
  await expect.poll(() => get("notifySound")).toBe(false);
  await page.getByLabel("Sound volume").fill("35");
  await expect.poll(() => get("soundVolume")).toBe(35);
  await page.getByText("macOS notification banners", { exact: true }).click();
  await expect.poll(() => get("systemNotifications")).toBe(false);
});

test("projects: create with client details, edit them in the drawer", async ({ page }) => {
  await page.goto("/#/projects");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByRole("button", { name: "New project" }).click();
  const form = page.getByTestId("new-project");
  await form.getByLabel("Project name").fill("Website rebuild");
  await form.getByLabel("Client", { exact: true }).fill("Fang Studio");
  await form.getByLabel("Client details").fill("fang@studio.cn");
  await form.getByLabel("Keywords").fill("Ayushi, SOW");
  await form.getByRole("button", { name: "Create" }).click();

  const section = page.getByTestId("client-section");
  await expect(section.getByLabel("Client", { exact: true })).toHaveValue("Fang Studio");
  await expect(section.getByLabel("Keywords")).toHaveValue("Ayushi, SOW");
  await section.getByLabel("Client details").fill("Fang Wei, fang@studio.cn, WeChat");
  await section.getByLabel("Keywords").click(); // blur saves
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.invoke("list_projects").then((ps: any[]) => ps.find((p) => p.name === "Website rebuild")?.clientDetails)))
    .toBe("Fang Wei, fang@studio.cn, WeChat");
});

test("skills: build on the canvas from a template, attach an MCP server, and it saves the generated skill", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const grid = page.getByTestId("skills-grid");
  await expect(grid).toContainText("Upwork proposal");

  await page.getByRole("button", { name: /Slack reply/ }).click();
  const ed = page.getByTestId("skill-editor");
  await expect(ed.getByLabel("Skill name")).toHaveValue("Slack reply");
  // the template is laid out as connected nodes
  await expect(ed.getByTestId("node-trigger")).toBeVisible();
  await expect(ed.getByTestId("node-step")).toBeVisible();
  await expect(ed.getByTestId("node-output")).toBeVisible();
  await expect(ed.getByTestId("node-platform")).toBeVisible();

  // add an MCP server node from the palette and pick a server
  await ed.getByRole("button", { name: "Add MCP server" }).click();
  await ed.getByRole("combobox", { name: "MCP server", exact: true }).selectOption({ label: "Notion" });
  await expect(ed.getByTestId("generated-skill")).toContainText("tools from: Notion");
  // switch the output to doing it on screen
  await ed.getByTestId("node-output").getByRole("radio", { name: /Do it/ }).click();
  await expect(ed.getByTestId("generated-skill")).toContainText("Does it on screen");

  await ed.getByRole("button", { name: "Create skill" }).click();
  await expect(ed).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__floMock.invoke("list_skills").then((ks: any[]) => ks.find((k) => k.name === "Slack reply")));
  expect(saved.mode).toBe("do");
  expect(saved.platforms).toEqual(["slack"]);
  expect(saved.connections).toContain("c1");
  expect(JSON.parse(saved.graph).nodes.some((n: any) => n.type === "mcp")).toBe(true);

  // old Context links land on Skills → Knowledge
  await page.goto("/#/context");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/skills/knowledge");
});

test("connections: add an MCP server, test it to see its tools, save it", async ({ page }) => {
  await page.goto("/#/skills/connections");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await expect(page.getByTestId("connections-grid")).toContainText("Notion");
  await page.getByRole("button", { name: "MCP server" }).click();
  const ed = page.getByTestId("connection-editor");
  await ed.getByLabel("Connection name").fill("Files");
  await ed.getByLabel("Command").fill("npx -y @modelcontextprotocol/server-filesystem ~/Documents");
  await ed.getByRole("button", { name: "Test" }).click();
  await expect(ed.getByTestId("connection-test")).toContainText("Connected · 2 tools");
  await expect(ed.getByTestId("connection-test")).toContainText("search_pages");
  await ed.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("connections-grid")).toContainText("Files");
  const c = await page.evaluate(() => (window as any).__floMock.invoke("list_connections").then((cs: any[]) => cs.find((x) => x.name === "Files")));
  expect(c.command).toBe("npx");
  expect(c.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"]);
});

test("to-dos: delete from a row", async ({ page }) => {
  await page.goto("/#/todos");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const row = page.getByText("Book flight to Bangalore").first().locator("xpath=ancestor::div[contains(@class,'group')][1]");
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Book flight to Bangalore")).toHaveCount(0);
});

test("skill canvas: hover a node to delete it, hover a connection to detach it", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByRole("button", { name: /Follow-up email/ }).click();
  const ed = page.getByTestId("skill-editor");
  await expect(ed.getByTestId("node-platform")).toHaveCount(1);
  // delete the platform node via its hover ×
  const plat = ed.getByTestId("node-platform");
  await plat.hover();
  await plat.getByRole("button", { name: /Delete Platform/ }).click();
  await expect(ed.getByTestId("node-platform")).toHaveCount(0);
  await expect(ed.getByTestId("generated-skill")).not.toContainText("Gmail");
  // detach: hover the connection's midpoint button
  const before = await ed.locator(".react-flow__edge").count();
  const detach = ed.getByTestId("edge-detach").first();
  await detach.hover({ force: true });
  await detach.click({ force: true });
  await expect.poll(() => ed.locator(".react-flow__edge").count()).toBe(before - 1);
});

test("skill canvas: Build with AI drafts the nodes and the name, errors are readable, and it saves", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByRole("button", { name: "New skill" }).click();
  const ed = page.getByTestId("skill-editor");
  // a blank new skill opens the AI composer right away
  const box = ed.getByTestId("ai-composer");
  await expect(box).toBeVisible();
  // a failure shows a readable message and keeps the composer open
  await box.getByLabel("Describe the skill").fill("this will fail");
  await box.getByRole("button", { name: "Build", exact: true }).click();
  await expect(box.getByTestId("ai-error")).toContainText("didn't return a skill");

  await box.getByLabel("Describe the skill").fill("Every weekday at 9, read my unread Gmail, summarise it and post it to Slack #daily");
  await box.getByRole("button", { name: "Build", exact: true }).click();
  await expect(ed.getByTestId("ai-ghosts")).toBeVisible();
  await expect(ed.getByLabel("Skill name")).toHaveValue("Daily inbox digest");
  await expect(box).toHaveCount(0);
  await expect(ed.getByTestId("node-step")).toHaveCount(3);
  await expect(ed.getByTestId("node-schedule")).toHaveCount(1);
  await expect(ed.getByTestId("node-output")).toHaveCount(1);
  // nodes are revealed one by one; wait until the last is in
  await expect(ed.locator(".react-flow__node.flo-node-pending")).toHaveCount(0);
  const panel = ed.getByTestId("generated-skill");
  await expect(panel).toContainText("1. Read my unread Gmail");
  await expect(panel).toContainText("3. Post the summary to #daily in Slack");
  await expect(panel.getByTestId("compiled-schedule")).toContainText("Every weekday at 09:00");
  // the AI's setup note (no Slack MCP server yet)
  await expect(panel.getByTestId("ai-notes")).toContainText("Slack MCP server");

  await ed.getByRole("button", { name: "Create skill" }).click();
  await expect(ed).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__floMock.invoke("list_skills").then((ks: any[]) => ks.find((k) => k.name === "Daily inbox digest")));
  expect(saved.schedule).toBe("0 9 * * 1-5");
  expect(saved.platforms).toEqual(["gmail", "slack"]);
  expect(saved.mode).toBe("do");
  await expect(page.getByTestId("skills-grid")).toContainText("Daily inbox digest");
});

test("skill canvas: Refine with AI sends the current skill and redraws it", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByRole("button", { name: /Follow-up email/ }).click();
  const ed = page.getByTestId("skill-editor");
  await expect(ed.getByTestId("ai-composer")).toHaveCount(0);
  await ed.getByRole("button", { name: "Refine with AI" }).click();
  await ed.getByLabel("Describe the skill").fill("cc my manager on every follow-up");
  await ed.getByRole("button", { name: "Refine", exact: true }).click();
  await expect(ed.locator(".react-flow__node.flo-node-pending")).toHaveCount(0);
  await expect(ed.getByTestId("generated-skill")).toContainText("Cc my manager on every follow-up");
  await expect(ed.getByLabel("Skill name")).toHaveValue("Follow-up email");
});

test("skill canvas: a Schedule node shows a live human preview and compiles into the panel", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByRole("button", { name: /Slack reply/ }).click();
  const ed = page.getByTestId("skill-editor");
  await ed.getByRole("button", { name: "Add Schedule" }).click();
  const node = ed.getByTestId("node-schedule");
  const preview = node.getByTestId("schedule-preview");
  await expect(preview).toContainText("Runs every weekday at 09:00 · next:");
  const panel = ed.getByTestId("generated-skill");
  await expect(panel.getByTestId("compiled-schedule")).toContainText("Every weekday at 09:00");

  await node.getByLabel("Repeat").selectOption("daily");
  await node.getByLabel("Time").fill("18:30");
  await expect(preview).toContainText("Runs every day at 18:30");
  await expect(panel.getByTestId("compiled-schedule")).toContainText("Every day at 18:30");

  await node.getByRole("button", { name: /Advanced: cron expression/ }).click();
  await expect(node.getByLabel("Cron expression")).toHaveValue("30 18 * * *");
  await node.getByLabel("Cron expression").fill("61 * * * *");
  await expect(preview).toContainText("minute must be between 0 and 59");
  await ed.getByRole("button", { name: "Create skill" }).click();
  await expect(panel).toContainText("Fix the Schedule");
  await expect(ed).toBeVisible();

  await node.getByLabel("Cron expression").fill("*/15 * * * *");
  await expect(preview).toContainText("Runs every 15 minutes");
  await expect(node.getByLabel("Repeat")).toHaveValue("minutes");
  await ed.getByRole("button", { name: "Create skill" }).click();
  await expect(ed).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__floMock.invoke("list_skills").then((ks: any[]) => ks.find((k) => k.name === "Slack reply")));
  expect(saved.schedule).toBe("*/15 * * * *");
  expect(JSON.parse(saved.graph).nodes.some((n: any) => n.type === "schedule")).toBe(true);
  await expect(page.getByTestId("skills-grid")).toContainText("Every 15 minutes");
});

test("skills: a scheduled skill shows its next run, and Run now runs it", async ({ page }) => {
  await page.goto("/#/skills");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const card = page.getByTestId("skills-grid").locator("div", { has: page.getByText("Morning inbox digest") }).filter({ has: page.getByTestId("skill-schedule") }).last();
  await expect(card.getByTestId("skill-schedule")).toContainText("Every weekday at 09:00");
  await expect(card.getByTestId("skill-schedule")).toContainText("next ");
  // only scheduled skills get Run now
  await expect(page.getByRole("button", { name: /Run Upwork proposal now/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Run Morning inbox digest now" }).click();
  await expect(card.getByTestId("skill-run-result")).toContainText("Apollo deck");
  // clicking Run now doesn't open the editor
  await expect(page.getByTestId("skill-editor")).toHaveCount(0);
  const k = await page.evaluate(() => (window as any).__floMock.invoke("list_skills").then((ks: any[]) => ks.find((x) => x.id === "k3")));
  expect(k.lastRun).toBeTruthy();
});
