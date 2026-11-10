import { expect, test, type Page } from "@playwright/test";

// Island = the notch UI. The browser preview draws a fake desktop + notch; events are injected
// through the mock backend's test hook (window.__floMock), the same events Rust emits.
const ISLAND = "/?nh=38&nw=200#/island";

async function emit(page: Page, event: string, payload: unknown) {
  await page.evaluate(([e, p]) => (window as any).__floMock.emit(e, p), [event, payload] as const);
}

const LISTENING = '[aria-label="Listening"]';
const TRANSCRIBING = '[role="status"][aria-label="Transcribing"]';

async function openIsland(page: Page) {
  await page.goto(ISLAND);
  await page.waitForFunction(() => !!(window as any).__floMock);
  // ready = island rendered AND its initial data fetch landed (tray shows the mock to-dos chip),
  // so injected events can't race with listener setup or be overwritten by the first fetch
  await page.locator("[data-island-root]").waitFor();
  await page.locator('[aria-label="todos"]').waitFor();
  await page.waitForTimeout(150);
}

const sess = (id: string, project: string, status: string, message: string) => ({
  sessionId: id,
  project,
  cwd: `/Users/p/${project}`,
  status,
  message,
  updatedAt: new Date().toISOString(),
});

/** rest the cursor on the agents icon like the backend does (~80 ms samples, centre-relative cx) */
async function hoverAgents(page: Page, until: () => Promise<boolean>) {
  const icon = page.locator('[aria-label^="Agents:"]');
  const box = await icon.boundingBox();
  const win = await page.locator("[data-island-root]").boundingBox();
  const cx = box!.x + box!.width / 2 - (win!.x + win!.width / 2);
  const y = box!.y - win!.y + box!.height / 2;
  for (let i = 0; i < 30; i++) {
    const w = await page.locator("[data-island-root]").boundingBox();
    await emit(page, "flo://hover", { inside: true, cx, y, x: w!.width / 2 + cx });
    if (await until()) return;
    await page.waitForTimeout(80);
  }
}

test("dictation: listening → transcribing → pasted result with copy → back to idle", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await emit(page, "flo://level", { rms: 0.4 });
  await expect(page.locator(LISTENING)).toBeVisible();
  // icons only: no chrome text like "Listening…" or shortcut hints
  await expect(page.getByText(/Listening|release|hands-free|space/i)).toHaveCount(0);

  await emit(page, "flo://state", { phase: "transcribing", mode: "dictation" });
  await expect(page.locator(TRANSCRIBING)).toBeVisible();
  await expect(page.getByText(/Transcribing|Polishing/)).toHaveCount(0);

  await emit(page, "flo://transcript", { text: "Send the deck to Rahul by Friday.", final: true });
  await emit(page, "flo://state", { phase: "done", mode: "dictation" });
  await expect(page.getByText("Send the deck to Rahul by Friday.")).toBeVisible();
  await expect(page.getByRole("button", { name: /copy/i }).first()).toBeVisible();

  await emit(page, "flo://state", { phase: "idle", mode: "dictation" });
  await expect(page.locator(`${LISTENING}, ${TRANSCRIBING}`)).toHaveCount(0);
});

test("watchdog: a stuck 'listening' with no mic activity returns to idle by itself", async ({ page }) => {
  await page.clock.install();
  await openIsland(page);
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await page.clock.runFor(600); // let the island open
  await expect(page.locator(LISTENING)).toBeVisible();
  await page.clock.runFor(9000); // no level events, no state updates
  await expect(page.locator(LISTENING)).toHaveCount(0);
});

test("watchdog: never resets while the mic is live", async ({ page }) => {
  await page.clock.install();
  await openIsland(page);
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  for (let i = 0; i < 6; i++) {
    await emit(page, "flo://level", { rms: 0.3 });
    await page.clock.runFor(2000);
  }
  await expect(page.locator(LISTENING)).toBeVisible();
});

test("errors are readable (no 'Oops'), offer a fix and clear themselves", async ({ page }) => {
  await page.clock.install();
  await openIsland(page);
  const msg = "Pick an AI model in Settings → AI to ask questions (“open …” and “google …” work without one).";
  await emit(page, "flo://state", { phase: "error", mode: "assistant", message: msg });
  await expect(page.getByText(msg)).toBeVisible();
  await expect(page.getByText(/oops/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /fix in settings/i })).toBeVisible();
  await page.clock.runFor(6000);
  await expect(page.getByText(msg)).toHaveCount(0);
});

test("tray: all agent sessions sit behind ONE stacked icon; hover lists them, most urgent first", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://claude-sessions", [
    sess("a", "Flo", "done", "Built the notch tray"),
    sess("b", "job-finder", "waiting_reply", "LinkedIn or Wellfound?"),
    sess("c", "api", "needs_approval", "Allow npm publish?"),
    sess("d", "web", "working", "Running the test suite"),
  ]);
  const icon = page.locator('[aria-label^="Agents:"]');
  await expect(icon).toHaveCount(1);
  // the icon shows the most urgent session + a count
  await expect(icon).toHaveAttribute("aria-label", "Agents: 4 · api Needs approval");
  await expect(page.locator('[data-testid="agents-count"]')).toHaveText("4");
  const list = page.locator('[data-testid="session-list"]');
  await hoverAgents(page, () => list.isVisible());
  await expect(list).toBeVisible();
  await expect(list.locator('[data-testid="session-row"]')).toHaveCount(4);
  await expect(list.locator('[data-testid="session-row"]').first()).toContainText("api");
  await expect(list.locator('[data-testid="session-row"]').last()).toContainText("web");
  await expect(list).toContainText("LinkedIn or Wellfound?");
});

test("correction: 'Did I mishear?' → Save to dictionary", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://correction", { id: "c1", heard: "tory", corrected: "Tauri", app: "Notes" });
  await expect(page.getByText(/Did I mishear/)).toBeVisible();
  await page.getByRole("button", { name: /save to dictionary/i }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  const dict = await page.evaluate(() => (window as any).__floMock.invoke("list_dictionary"));
  expect(dict.some((d: any) => d.word === "tory" && d.replacement === "Tauri")).toBe(true);
});

test("correction: a fix Flo learned says sorry, shows old → new, and Undo removes it", async ({ page }) => {
  await openIsland(page);
  // the backend already saved it (auto-learn); the mock dictionary mirrors that
  await page.evaluate(() => (window as any).__floMock.invoke("accept_correction", { heard: "tory", corrected: "Tauri" }));
  await emit(page, "flo://correction", { id: "c2", heard: "tory", corrected: "Tauri", app: "Slack", saved: true });
  const card = page.getByTestId("correction-card");
  await expect(card).toContainText("Sorry, my mistake");
  await expect(card).toContainText("tory");
  await expect(card).toContainText("Tauri");
  await expect(card).toContainText("from now on");
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card).toContainText("Undone");
  const dict = await page.evaluate(() => (window as any).__floMock.invoke("list_dictionary"));
  expect(dict.some((d: any) => d.word === "tory")).toBe(false);
});

test("meeting detection: prompt → Start notes starts a meeting", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://meeting-detected", { app: "Zoom", active: true });
  await expect(page.getByText(/Zoom/).first()).toBeVisible();
  await page.getByRole("button", { name: /start notes/i }).click();
  const notes = await page.evaluate(() => (window as any).__floMock.invoke("list_notes"));
  expect(notes.some((n: any) => n.live)).toBe(true);
});

test("hovering the notch opens the glass quick menu", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://hover", { inside: true, x: 100, y: 10 });
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  await emit(page, "flo://hover", { inside: false });
  await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0, { timeout: 3000 });
});

test("ONE hover opens everything: quick actions + widgets in one large panel, no click; leaving collapses it", async ({ page }) => {
  await openIsland(page);
  const calls0 = await page.evaluate(() => (window as any).__floMock.calls.length);
  await emit(page, "flo://hover", { inside: true, cx: 0, y: 12 });
  const panel = page.getByTestId("notch-panel");
  await expect(panel).toBeVisible();
  // the widgets are right there (no "Widgets" button / second panel)
  await expect(page.getByTestId("widget-grid")).toBeVisible();
  await expect(page.getByTestId("np-player")).toBeVisible();
  await expect(panel.getByText("Stopwatch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Widgets" })).toHaveCount(0);
  for (const name of ["Dictate", "Ask", "Agent", "Meeting", "History", "Open", "Customize"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  // nothing was clicked to get here
  const clicks = await page.evaluate((n) => (window as any).__floMock.calls.slice(n).map((c: any) => c.cmd), calls0);
  expect(clicks.filter((c: string) => c !== "island_resize" && c !== "now_playing" && c !== "get_volume" && c !== "list_todos" && c !== "weather" && c !== "get_analytics" && !c.startsWith("get_presence"))).toEqual([]);
  // a big panel (≥ 640 wide at the default size)
  const w = (await page.locator("[data-island-root]").boundingBox())!.width;
  expect(w).toBeGreaterThanOrEqual(640);
  await emit(page, "flo://hover", { inside: false });
  await expect(panel).toHaveCount(0, { timeout: 3000 });
});

test("music live activity: artwork + equalizer in the collapsed notch while playing; gone when nothing plays", async ({ page }) => {
  await openIsland(page);
  const activity = page.getByTestId("music-activity");
  await expect(activity).toBeVisible();
  await expect(activity).toHaveAttribute("aria-label", /Playing: Night Owl/);
  await expect(activity.getByTestId("np-artwork")).toBeVisible();
  await expect(activity.getByTestId("np-equalizer")).toHaveAttribute("data-playing", "true");
  // paused → still shown (dimmed, static bars) for a while
  await page.evaluate(() => (window as any).__floMock.setNowPlaying("paused"));
  await expect(activity.getByTestId("np-equalizer")).toHaveAttribute("data-playing", "false");
  // a video in the browser: no artwork → the app icon
  await page.evaluate(() => (window as any).__floMock.setNowPlaying("youtube"));
  await expect(activity.getByTestId("np-appicon")).toBeVisible();
  await expect(activity).toHaveAttribute("aria-label", /Deep focus/);
  // nothing playing → the activity disappears
  await page.evaluate(() => (window as any).__floMock.setNowPlaying("none"));
  await expect(activity).toHaveCount(0);
  // and listening wins over music
  await page.evaluate(() => (window as any).__floMock.setNowPlaying("spotify"));
  await expect(activity).toBeVisible();
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await emit(page, "flo://level", { rms: 0.3 });
  await expect(page.locator(LISTENING)).toBeVisible();
  await expect(activity).toHaveCount(0);
});

test("rich player in the hover panel: progress, controls call media_control, volume", async ({ page }) => {
  await openIsland(page);
  const keep = setInterval(() => emit(page, "flo://hover", { inside: true, cx: 0, y: 12 }).catch(() => {}), 120);
  try {
    const player = page.getByTestId("np-player");
    await expect(player).toBeVisible();
    await expect(player).toContainText("Night Owl");
    await expect(player).toContainText("Galimatias");
    await expect(player).toContainText("Spotify");
    await expect(player).toContainText("3:34"); // duration
    await expect(player.getByRole("progressbar")).toBeVisible();
    await expect(player.getByRole("slider", { name: "Volume" })).toBeVisible();
    await player.getByRole("button", { name: "Pause" }).click();
    await expect(player.getByRole("button", { name: "Play" })).toBeVisible();
    await player.getByRole("button", { name: "Next" }).click();
    await expect(player).toContainText("Weightless");
    await player.getByRole("button", { name: "Previous" }).click();
    const actions = await page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "media_control").map((c: any) => c.args.action));
    expect(actions).toEqual(["playpause", "next", "previous"]);
  } finally {
    clearInterval(keep);
  }
});

test("hover dwell: a quick pass opens nothing; after the short dwell an item shows only its tooltip, not the panel", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://claude-sessions", [
    sess("a", "Flo", "done", "Built the notch tray"),
    sess("b", "job-finder", "waiting_reply", "LinkedIn or Wellfound?"),
  ]);
  const icon = page.locator('[aria-label^="Agents:"]');
  await icon.waitFor();
  const box = await icon.boundingBox();
  const win = await page.locator("[data-island-root]").boundingBox();
  const cx = box!.x + box!.width / 2 - (win!.x + win!.width / 2);
  const y = box!.y - win!.y + box!.height / 2;

  // quick pass: hover for < 200ms — nothing should have opened yet
  const keep = setInterval(() => emit(page, "flo://hover", { inside: true, cx, y, x: win!.width / 2 + cx }).catch(() => {}), 60);
  await page.waitForTimeout(90);
  expect(await page.getByText("LinkedIn or Wellfound?").isVisible()).toBe(false);
  expect(await page.getByRole("button", { name: "Dictate" }).isVisible()).toBe(false);

  // keep resting past the dwell: only this item's tooltip opens, not the quick-actions peek
  await page.waitForTimeout(500);
  clearInterval(keep);
  await expect(page.getByText("LinkedIn or Wellfound?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dictate" })).toHaveCount(0);
  await emit(page, "flo://hover", { inside: false });
});

test("hands-free (ctrl/fn + space): lock badge on the icon, no text", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://state", { phase: "listening", mode: "dictation", message: "hands-free" });
  await emit(page, "flo://level", { rms: 0.2 });
  await expect(page.locator('[aria-label="Hands-free"]')).toBeVisible();
  await expect(page.getByText(/esc to cancel|hands-free|release/i)).toHaveCount(0);
});


test("session list stays open while resting on the icon (no resize feedback loop)", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://claude-sessions", [
    sess("a", "Flo", "done", "Built the notch tray"),
    sess("b", "job-finder", "waiting_reply", "LinkedIn or Wellfound?"),
    sess("c", "api", "working", "Running the test suite"),
  ]);
  const icon = page.locator('[aria-label^="Agents:"]');
  await icon.waitFor();
  const box = await icon.boundingBox();
  const win = await page.locator("[data-island-root]").boundingBox();
  const cx = box!.x + box!.width / 2 - (win!.x + win!.width / 2);
  const y = box!.y - win!.y + box!.height / 2;
  const t0 = Date.now();
  let opened = false;
  const samples: boolean[] = [];
  while (Date.now() - t0 < 2400) {
    const w = await page.locator("[data-island-root]").boundingBox();
    await emit(page, "flo://hover", { inside: true, cx, y, x: w!.width / 2 + cx });
    const vis = await page.getByText("LinkedIn or Wellfound?").isVisible();
    if (vis) opened = true;
    if (opened) samples.push(vis);
    await page.waitForTimeout(80);
  }
  expect(opened).toBe(true);
  expect(samples.length).toBeGreaterThanOrEqual(3); // stayed open across several samples; every(Boolean) below is the real check
  expect(samples.every(Boolean)).toBe(true);
  const sizes = await page.evaluate(() => (window as any).__floMock.resizes.map((r: any) => r.w));
  const after = sizes.slice(sizes.findIndex((w: number) => w > 300));
  for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThanOrEqual(after[i - 1]);
});

test("session list: open focuses a session, x dismisses it, Clear done removes finished ones", async ({ page }) => {
  await openIsland(page);
  const list7 = Array.from({ length: 7 }, (_, i) => sess(`s${i}`, `proj-${i}`, i < 3 ? "working" : "done", `message ${i}`));
  const setSessions = (l: unknown[]) => page.evaluate((x) => (window as any).__floMock.setSessions(x), l);
  await setSessions(list7.map((x) => ({ ...x, source: "claude" })));
  await expect(page.locator('[aria-label^="Agents:"]')).toHaveCount(1);
  const list = page.locator('[data-testid="session-list"]');
  await hoverAgents(page, () => list.isVisible());
  await expect(list).toContainText("7 sessions");
  await expect(list).toContainText("3 working");
  for (let i = 0; i < 7; i++) await expect(page.getByRole("button", { name: `Open proj-${i}` })).toBeAttached();
  await expect(page.getByText(/[\u2014\u2013]/)).toHaveCount(0);
  // keep the cursor there while acting (backend keeps reporting inside)
  const keep = setInterval(() => emit(page, "flo://hover", { inside: true, cx: 0, y: 60 }).catch(() => {}), 80);
  try {
    await page.getByRole("button", { name: "Dismiss proj-0" }).click();
    await expect(list.locator('[data-testid="session-row"]')).toHaveCount(6);
    await page.getByRole("button", { name: "Open proj-4" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "open_claude_by_session").map((c: any) => c.args.sessionId)))
      .toContain("s4");
  } finally {
    clearInterval(keep);
  }
  // Clear done (re-open the list first)
  await setSessions(list7.slice(1).map((x) => ({ ...x, source: "claude" })));
  await hoverAgents(page, () => list.isVisible());
  await list.getByRole("button", { name: "Clear done" }).click();
  await expect(page.locator('[aria-label^="Agents:"]')).toHaveAttribute("aria-label", /^Agents: 2 /);
});

test("ribbon: lives only while listening / working / done, never when idle", async ({ page }) => {
  await openIsland(page);
  const ribbon = page.locator('[data-testid="island-ribbon"]');
  await expect(ribbon).toHaveCount(0); // idle tray: nothing drawn
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await expect(ribbon).toHaveAttribute("data-mode", "listen");
  await emit(page, "flo://state", { phase: "transcribing", mode: "dictation" });
  await expect(ribbon).toHaveAttribute("data-mode", "transcribe");
  await emit(page, "flo://state", { phase: "thinking", mode: "assistant" });
  await expect(ribbon).toHaveAttribute("data-mode", "think");
  await emit(page, "flo://state", { phase: "done", mode: "dictation" });
  await expect(ribbon).toHaveAttribute("data-mode", "done");
  await emit(page, "flo://state", { phase: "idle", mode: "dictation" });
  await expect(ribbon).toHaveCount(0);
  await expect(page.locator('[data-testid="island-ocean"]')).toHaveCount(0);
});

test("content cards: notch row empty; icon + text + action in one row below, 16px sides, icon centred", async ({ page }) => {
  await openIsland(page);
  const root = page.locator("[data-island-root]");
  const check = async (name: string) => {
    const row = page.locator("[data-card-row]");
    await expect(row, name).toBeVisible();
    await page.waitForTimeout(450); // let the spring settle
    const r = await row.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const icon = el.querySelector("[data-card-icon]")!.getBoundingClientRect();
      const text = el.querySelector("[data-card-text]")!.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { top: b.top, pl: cs.paddingLeft, pr: cs.paddingRight, iconMid: icon.top + icon.height / 2, textMid: text.top + text.height / 2, iconLeft: icon.left - b.left };
    });
    const top = (await root.boundingBox())!.y;
    expect(r.top - top, `${name}: below the notch`).toBeGreaterThanOrEqual(38);
    expect(r.pl, name).toBe("16px");
    expect(r.pr, name).toBe("16px");
    expect(Math.abs(r.iconMid - r.textMid), `${name}: icon centred with text`).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `test-results/card-${name}.png`, clip: { x: 420, y: 0, width: 600, height: 170 } }).catch(() => {});
  };
  await emit(page, "flo://transcript", { text: "Ship the notch fix today and tell Rahul.", final: true });
  await check("result");
  await page.keyboard.press("Escape");
  await emit(page, "flo://state", { phase: "error", mode: "dictation", message: "No API key for Groq. Add one in Settings." });
  await check("error");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await emit(page, "flo://correction", { id: "c9", heard: "tory", corrected: "Tauri", app: "Notes" });
  await check("correction");
  await page.getByRole("button", { name: "Ignore" }).click();
  await page.evaluate(() => (window as any).__floMock.confirm("Send to Rahul on Slack?", "Hey Rahul, deck is in the drive."));
  await check("confirm");
  await page.locator('[data-testid="confirm-card"]').getByRole("button", { name: "Cancel" }).click();
  await emit(page, "flo://claude", { id: "e1", kind: "stop", sessionId: "s1", project: "Flo", cwd: "/Users/p/Flo", message: "Built the notch tray", at: new Date().toISOString(), seen: false });
  await check("claude");
});

test("hover: DOM mouseleave/enter during resizes is ignored while the backend says inside", async ({ page }) => {
  await openIsland(page);
  const root = page.locator("[data-island-root]");
  const dictate = page.getByRole("button", { name: "Dictate" });
  const box = await root.boundingBox();
  // the real cursor rests on the notch; the backend reports inside every ~80 ms
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
  const t0 = Date.now();
  let opened = false;
  const samples: boolean[] = [];
  let i = 0;
  while (Date.now() - t0 < 2400) {
    await emit(page, "flo://hover", { inside: true, cx: 0, y: 10, x: 100 });
    // WebKit-style spurious DOM leave/enter as the window resizes under the cursor
    const b = await root.boundingBox();
    if (i++ % 2) await page.mouse.move(b!.x + b!.width / 2, b!.y + 10);
    else await page.mouse.move(5, 600);
    const vis = await dictate.isVisible();
    if (vis) opened = true;
    if (opened) samples.push(vis);
    await page.waitForTimeout(80);
  }
  expect(opened).toBe(true);
  expect(samples.length).toBeGreaterThanOrEqual(3); // stayed open across several samples; every(Boolean) below is the real check
  expect(samples.every(Boolean)).toBe(true);
  // the window never shrinks while hovered
  const log: number[][] = await page.evaluate(() => (window as any).__floMock.resizes.map((r: any) => [r.w, r.h]));
  const from = log.findIndex(([w]) => w > 300);
  expect(from).toBeGreaterThanOrEqual(0);
  for (let k = from + 1; k < log.length; k++) {
    expect(log[k][0]).toBeGreaterThanOrEqual(log[k - 1][0]);
    expect(log[k][1]).toBeGreaterThanOrEqual(log[k - 1][1]);
  }
  // leaving for real (backend) still closes it
  await emit(page, "flo://hover", { inside: false });
  await expect(dictate).toHaveCount(0, { timeout: 3000 });
});

test("widgets: now-playing shows and play/pause toggles", async ({ page }) => {
  await page.goto("/?nh=38&nw=200&demo=widgets#/island");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.locator("[data-island-root]").waitFor();
  // the mock track is playing → Pause button shown
  const pause = page.getByRole("button", { name: "Pause" });
  await expect(pause).toBeVisible();
  await expect(page.getByText("Night Owl")).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  // stopwatch + clock widgets render alongside now-playing
  await expect(page.getByText("Stopwatch")).toBeVisible();
  await expect(page.getByText("Clock")).toBeVisible();
});

test("agent overlay: streams steps with a Stop button, then shows the result", async ({ page }) => {
  await page.goto("/?nh=38&nw=200&demo=agent#/island");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.locator("[data-island-root]").waitFor();
  // goal + a live step + the prominent Stop button
  await expect(page.getByText("Open YouTube and play lofi beats")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  // the run completes → summary + Stop gone
  await expect(page.getByText("Playing the lofi video.")).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
});

test("agent overlay: Stop clears the spinner at once, and a failed run shows its error instead of loading", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://agent", { kind: "start", text: "Open Slack and find the design channel" });
  await emit(page, "flo://agent", { kind: "step", text: "Opening Slack" });
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await stop.click();
  // no waiting on the backend: the card says stopped right away, and a late step can't revive it
  await expect(page.getByText("Stopped.")).toBeVisible();
  await expect(stop).toHaveCount(0);
  await emit(page, "flo://agent", { kind: "step", text: "Clicking Search" });
  await expect(page.getByText("Clicking Search")).toHaveCount(0);

  // a run that can't click (no Accessibility) ends in a readable error, not an endless spinner
  await emit(page, "flo://agent", { kind: "start", text: "Click the first video" });
  await emit(page, "flo://agent", { kind: "error", text: "Flo can't click or type for you yet. Turn on Flo in System Settings." });
  await expect(page.getByText(/can't click or type/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
});

test("reminder: card offers Done and Snooze, and each answers the to-do", async ({ page }) => {
  await page.goto("/?nh=38&nw=200&demo=reminder#/island");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const card = page.getByTestId("reminder-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Pay electricity bill");
  await expect(card).toContainText("due");
  await expect(card.getByRole("button", { name: /Done/ })).toBeVisible();
  await card.getByRole("button", { name: /10 min/ }).click();
  await expect(card).toHaveCount(0);
  const snoozed = await page.evaluate(() => (window as any).__floSnoozed);
  expect(snoozed).toEqual({ id: "t8", minutes: 10 });

  // a second reminder → Done marks the to-do done
  await page.evaluate(() => (window as any).__floMock.emit("flo://reminder", { id: "t5", title: "Book flight to Bangalore", source: "voice", status: "open", createdAt: new Date().toISOString() }));
  await expect(page.getByTestId("reminder-card")).toContainText("Book flight");
  await page.getByTestId("reminder-card").getByRole("button", { name: /Done/ }).click();
  await expect(page.getByTestId("reminder-card")).toHaveCount(0);
  const todos = await page.evaluate(() => (window as any).__floMock.invoke("list_todos"));
  expect(todos.find((t: any) => t.id === "t5").status).toBe("done");
});

test("notch size: Biggest opens the Claude session list larger", async ({ page }) => {
  const width = async (size: string) => {
    await page.goto(`${ISLAND.replace("#", `&notchSize=${size}#`)}`);
    await page.waitForFunction(() => !!(window as any).__floMock);
    await page.locator("[data-island-root]").waitFor();
    await page.locator('[aria-label="todos"]').waitFor();
    await page.waitForTimeout(150);
    await emit(page, "flo://claude-sessions", [sess("a", "Flo", "done", "Built the notch tray"), sess("b", "api", "needs_approval", "Allow npm publish?")]);
    const list = page.locator('[data-testid="session-list"]');
    await hoverAgents(page, () => list.isVisible());
    await expect(list).toBeVisible();
    return (await page.locator(".island-tip").first().boundingBox())!.width;
  };
  const big = await width("big");
  const biggest = await width("biggest");
  expect(biggest / big).toBeGreaterThan(1.2);
  expect(biggest / big).toBeLessThan(1.4);
});

test("widgets: the to-do list scrolls when it has more than fits", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flo.widgets", JSON.stringify(["today", "agents", "nowPlaying"])));
  await page.goto("/?nh=38&nw=420&demo=widgets#/island");
  await page.waitForFunction(() => !!(window as any).__floMock);
  const root = page.locator("[data-island-root]");
  const box = (await root.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  const list = page.locator(".flo-scroll-beige").first();
  await expect(list).toBeVisible();
  const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeGreaterThan(m.ch); // more to-dos than fit → it must overflow, not be clipped
  // wheel over the list (re-aimed each try: the panel may still be settling under a loaded machine)
  await expect
    .poll(async () => {
      const lb = (await list.boundingBox())!;
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
      await page.mouse.wheel(0, 120);
      return list.evaluate((el) => el.scrollTop);
    })
    .toBeGreaterThan(0);
});

test("to-do tray: hovering lists every to-do (not just three), scrollable, and ticks one off", async ({ page }) => {
  await openIsland(page);
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `u${i}`,
    title: `Urgent task ${i + 1}`,
    source: "manual",
    status: "open",
    due: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  }));
  await page.evaluate(async (ts) => {
    const m = (window as any).__floMock;
    for (const t of ts) await m.invoke("add_todo", { title: t.title, due: t.due });
    m.emit("flo://todos", {});
  }, many);
  const icon = page.locator('[aria-label="todos"]');
  const box = (await icon.boundingBox())!;
  const win = (await page.locator("[data-island-root]").boundingBox())!;
  const cx = box.x + box.width / 2 - (win.x + win.width / 2);
  const y = box.y - win.y + box.height / 2;
  const list = page.getByTestId("todo-tip-list");
  for (let i = 0; i < 30 && !(await list.isVisible()); i++) {
    const w = (await page.locator("[data-island-root]").boundingBox())!;
    await emit(page, "flo://hover", { inside: true, cx, y, x: w.width / 2 + cx });
    await page.waitForTimeout(100);
  }
  await expect(list).toBeVisible();
  const rows = list.getByTestId("todo-tip-row");
  expect(await rows.count()).toBeGreaterThan(3);
  const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeGreaterThan(m.ch);
  const first = await rows.first().innerText();
  await rows.first().getByRole("button").first().click();
  await expect(list).not.toContainText(first.split("\n")[0]);
  // hovering a row reveals delete; it removes the to-do for good
  const second = rows.first();
  const title = (await second.innerText()).split("\n")[0];
  await second.hover();
  await second.getByRole("button", { name: /^Delete/ }).click();
  await expect(list).not.toContainText(title);
  const all = await page.evaluate(() => (window as any).__floMock.invoke("list_todos"));
  expect(all.some((t: any) => t.title === title)).toBe(false);
});

test("claude permission: the notch shows what Claude wants, and Allow / terminal answer it", async ({ page }) => {
  await openIsland(page);
  // an older backend: title/body only → project from the title, tool inferred from "Run:"
  await emit(page, "flo://confirm", { id: "q1", kind: "claude", title: "Claude needs you · api", body: "Run: npm publish" });
  const card = page.getByTestId("claude-permission-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("perm-project")).toHaveText("api");
  await expect(card.getByTestId("perm-tool")).toHaveText("Bash");
  await expect(card.getByTestId("perm-command")).toContainText("npm publish");
  await card.getByRole("button", { name: "Allow" }).click();
  await expect(card.getByTestId("perm-answered")).toContainText("Allowed");
  await expect(card).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__floPermissions)).toEqual([{ id: "q1", decision: "allow" }]);

  // answer in the terminal instead → no decision sent as allow/deny
  await emit(page, "flo://confirm", { id: "q2", kind: "claude", title: "Claude needs you · web", body: "Edit main.rs" });
  await page.getByTestId("claude-permission-card").getByRole("button", { name: /terminal/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floPermissions.at(-1))).toEqual({ id: "q2", decision: "terminal" });

  // answered elsewhere / timed out → the backend closes the card
  await emit(page, "flo://confirm", { id: "q3", kind: "claude", title: "Claude needs you · api", body: "Run: rm -rf dist" });
  await expect(page.getByTestId("claude-permission-card")).toBeVisible();
  await emit(page, "flo://confirm-done", { id: "q3" });
  await expect(page.getByTestId("claude-permission-card")).toHaveCount(0);
});

test("claude permission: says which session asks, Open focuses it, long commands fit, a queue steps through", async ({ page }) => {
  await openIsland(page);
  const long =
    'Run: for f in content/posts/*.md; do npx markdownlint --fix "$f" && node scripts/frontmatter.js --check --strict "$f" || echo "failed: $f" >> lint.log; done && git add -A && git commit -m "chore: lint all 100 posts" && git push origin main --force-with-lease && npm run deploy -- --prod';
  await page.evaluate((b) => (window as any).__floMock.permission("blog-100-plan", "Bash", b, 12), long);
  const card = page.getByTestId("claude-permission-card");
  await expect(card.getByTestId("perm-project")).toHaveText("blog-100-plan");
  await expect(card.getByTestId("perm-tool")).toHaveText("Bash");
  await expect(card).toContainText("in iTerm");
  await expect(card.getByTestId("perm-waited")).toContainText(/1\ds/);
  // the card fits: buttons inside the window, command clamped with "Show all"
  await page.waitForTimeout(700);
  const fits = async () => {
    const win = (await page.locator("[data-island-root]").boundingBox())!;
    const allow = (await card.getByRole("button", { name: "Allow" }).boundingBox())!;
    expect(allow.y + allow.height).toBeLessThanOrEqual(win.y + win.height - 4);
  };
  await fits();
  await card.getByRole("button", { name: "Show all" }).click();
  await expect(card.getByRole("button", { name: "Show less" })).toBeVisible();
  await page.waitForTimeout(700);
  await fits();
  // Open focuses that session's window (and answers nothing)
  await card.getByRole("button", { name: "Open blog-100-plan" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "focus_claude_session").map((c: any) => c.args)))
    .toEqual([{ sessionId: "sess-blog-100-plan", cwd: "/Users/p/blog-100-plan" }]);
  await expect(card).toBeVisible();

  // two more arrive: 1/3 with a stepper
  await page.evaluate(() => {
    (window as any).__floMock.permission("flo-mvp", "Edit", "Edit src/island/Island.tsx", 3);
    (window as any).__floMock.permission("api", "WebFetch", "Open https://example.com", 1);
  });
  const queue = card.getByTestId("perm-queue");
  await expect(queue).toContainText("1/3");
  await queue.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByTestId("perm-project")).toHaveText("flo-mvp");
  await expect(page.getByTestId("perm-tool")).toHaveText("Edit file");
  // Deny → brief confirmation → the next one slides in
  await page.getByTestId("claude-permission-card").getByRole("button", { name: "Deny" }).click();
  await expect(page.getByTestId("perm-answered")).toContainText("Denied");
  await expect(page.getByTestId("perm-project")).toHaveText("api");
  await expect(page.getByTestId("perm-queue")).toContainText("2/2");
  await expect.poll(() => page.evaluate(() => (window as any).__floPermissions.map((p: any) => p.decision))).toEqual(["deny"]);
});

test("agent mode: hands-free pill, a heard request, live steps, and a spoken yes resolves the confirm", async ({ page }) => {
  await openIsland(page);
  const invoke = (cmd: string, args: Record<string, unknown> = {}) => page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
  // double-tap fn / the island's Agent tile → agent mode on: a persistent listening pill
  expect(await invoke("toggle_agent_mode")).toBe(true);
  const pill = page.getByTestId("agent-mode-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(/agent mode · listening/i);
  await expect(pill).toContainText(/double-tap .* or say “stop”/);

  // a request is heard (no key press) and shown
  const goal = "Open Gmail and email Rahul that the invoice is attached";
  await emit(page, "flo://handsfree", { active: true, phase: "thinking", heard: goal });
  await expect(page.getByTestId("agent-mode-heard")).toContainText(goal);

  // the screen agent runs every step by itself; the card says Flo is still listening
  await emit(page, "flo://handsfree", { active: true, phase: "acting", heard: goal });
  await emit(page, "flo://agent", { kind: "start", text: goal });
  await emit(page, "flo://agent", { kind: "step", text: "Opening mail.google.com" });
  await emit(page, "flo://agent", { kind: "step", text: "Clicking Compose" });
  await expect(page.getByTestId("agent-step")).toContainText("Clicking Compose");
  await expect(page.getByTestId("agent-handsfree")).toBeVisible();

  // a risky step pauses for a spoken answer
  await emit(page, "flo://agent", { kind: "confirm", text: "Send the email to Rahul?", voice: true });
  const confirm = page.getByTestId("agent-confirm");
  await expect(confirm).toContainText("Send the email to Rahul?");
  await expect(confirm).toContainText("Say “yes” or “no”");
  // the backend heard "yes" → the agent continues and finishes
  await invoke("agent_confirm", { yes: true });
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Sent.")).toBeVisible();
  // the finished card steps aside and the listening pill comes back
  await expect(pill).toBeVisible({ timeout: 8000 });

  // buttons answer too: No stops the agent
  await emit(page, "flo://agent", { kind: "start", text: "Delete the draft" });
  await emit(page, "flo://agent", { kind: "confirm", text: "Delete the draft?", voice: true });
  await page.getByTestId("agent-confirm").getByRole("button", { name: "No" }).click();
  await expect(page.getByText("Cancelled, you said no.")).toBeVisible();

  // exit: the pill's X (same as double-tap fn / saying "stop"); the card waits while hovered
  await page.mouse.move(5, 800);
  await expect(pill).toBeVisible({ timeout: 8000 });
  await pill.getByRole("button", { name: "Turn off agent mode" }).click();
  await expect(pill).toHaveCount(0);
});

test("notch shape: flush with the top edge, concave shoulders when open, a fake notch on a notchless Mac", async ({ page }) => {
  // hardware notch: closed = exactly the camera housing, no shoulders; open = shoulders at y 0
  await openIsland(page);
  const shape = page.locator("[data-island-root] > div").first();
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await expect(page.locator(LISTENING)).toBeVisible();
  // measured once the morph has settled (the shoulders grow in from the corner)
  const edges = () =>
    page.evaluate(() => {
      const r = document.querySelector("[data-island-root]")!.getBoundingClientRect();
      const b = document.querySelector("[data-island-root] > div")!.getBoundingClientRect();
      const l = document.querySelector('[data-testid="notch-shoulder-left"]')!.getBoundingClientRect();
      return { top: b.top - r.top, shoulderTop: l.top - r.top, shoulderW: Math.round(l.width), overlap: Math.round(l.right - b.left) };
    });
  // flush with the top edge; the shoulder is full size and overlaps the body by 1px (no seam)
  await expect.poll(edges).toEqual({ top: 0, shoulderTop: 0, shoulderW: 9, overlap: 1 });
  // pure black, no rim along the top
  expect(await shape.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(0, 0, 0)");

  // notchless Mac: the same notch shape (200x32, shoulders), not a floating capsule
  await page.goto("/?notch=none&media=none#/island");
  await page.locator("[data-island-root]").waitFor();
  await page.evaluate(() => (window as any).__floMock.setSessions([]));
  const fake = page.locator("[data-island-root] > div").first();
  await expect(fake).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.getByTestId("stage-hardware-notch")).toHaveCount(0);
  const r2 = (await page.locator("[data-island-root]").boundingBox())!;
  const f = (await fake.boundingBox())!;
  expect(f.y).toBe(r2.y);
  expect(Math.round(f.width)).toBeGreaterThanOrEqual(200);
  expect(Math.round(f.height)).toBe(32);
});

test("claude stack: Clear all dismisses every queued card and marks them seen", async ({ page }) => {
  await openIsland(page);
  const at = new Date().toISOString();
  for (const i of [1, 2, 3, 4]) {
    await emit(page, "flo://claude", { id: `q${i}`, kind: "notification", sessionId: `s${i}`, project: "Flo", cwd: "/Users/p/Flo", message: "Claude is waiting for your input", at, seen: false });
  }
  const card = page.getByTestId("claude-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("+3");
  await card.getByRole("button", { name: "Clear all" }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__floMock.calls.some((c: any) => c.cmd === "mark_claude_seen" && !c.args?.id)))
    .toBe(true);
});
