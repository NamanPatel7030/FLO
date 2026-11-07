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

test("hover dwell: nothing opens under ~500ms; after dwell an item shows only its tooltip, not the peek menu", async ({ page }) => {
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

  // quick pass: hover for < 500ms, then leave — nothing should have opened
  const keep = setInterval(() => emit(page, "flo://hover", { inside: true, cx, y, x: win!.width / 2 + cx }).catch(() => {}), 60);
  await page.waitForTimeout(300);
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
