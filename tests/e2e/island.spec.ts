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

test("tray: multiple Claude sessions stay beside the notch with a status tooltip", async ({ page }) => {
  await openIsland(page);
  const s = (id: string, project: string, status: string, message: string) => ({
    sessionId: id,
    project,
    cwd: `/Users/p/${project}`,
    status,
    message,
    updatedAt: new Date().toISOString(),
  });
  await emit(page, "flo://claude-sessions", [
    s("a", "Flo", "done", "Built the notch tray"),
    s("b", "job-finder", "waiting_reply", "LinkedIn or Wellfound?"),
    s("c", "api", "needs_approval", "Allow npm publish?"),
  ]);
  const avatars = page.locator('[aria-label*=": "]');
  await expect(avatars).toHaveCount(3);
  await expect(page.locator('[aria-label="job-finder: Waiting for your reply"]')).toBeVisible();

  // hover the second avatar like the backend does: every ~80 ms, coordinates relative to the
  // island window's CURRENT frame (the window grows while hovering)
  const target = page.locator('[aria-label="job-finder: Waiting for your reply"]');
  // (keep hovering, as the real cursor would, until the tooltip shows — max ~2.5 s)
  for (let i = 0; i < 30; i++) {
    const box = await target.boundingBox();
    const win = await page.locator("[data-island-root]").boundingBox();
    if (!box || !win) break;
    await emit(page, "flo://hover", { inside: true, x: box.x - win.x + box.width / 2, y: box.y - win.y + box.height / 2 });
    if (await page.getByText("LinkedIn or Wellfound?").isVisible()) break;
    await page.waitForTimeout(80);
  }
  await expect(page.getByText("LinkedIn or Wellfound?")).toBeVisible();
  await expect(page.getByText(/Waiting for your reply/).first()).toBeVisible();

  // dismissing one leaves the rest until the user is done with them
  await emit(page, "flo://claude-sessions", [s("a", "Flo", "done", "Built the notch tray"), s("c", "api", "needs_approval", "Allow npm publish?")]);
  await expect(avatars).toHaveCount(2);
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

test("hands-free (ctrl/fn + space): lock badge on the icon, no text", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://state", { phase: "listening", mode: "dictation", message: "hands-free" });
  await emit(page, "flo://level", { rms: 0.2 });
  await expect(page.locator('[aria-label="Hands-free"]')).toBeVisible();
  await expect(page.getByText(/esc to cancel|hands-free|release/i)).toHaveCount(0);
});

const sess = (id: string, project: string, status: string, message: string) => ({
  sessionId: id,
  project,
  cwd: `/Users/p/${project}`,
  status,
  message,
  updatedAt: new Date().toISOString(),
});

test("tooltip stays open while hovering one avatar (no resize feedback loop)", async ({ page }) => {
  await openIsland(page);
  await emit(page, "flo://claude-sessions", [
    sess("a", "Flo", "done", "Built the notch tray"),
    sess("b", "job-finder", "waiting_reply", "LinkedIn or Wellfound?"),
    sess("c", "api", "working", "Running the test suite"),
  ]);
  const target = page.locator('[aria-label="job-finder: Waiting for your reply"]');
  await target.waitFor();
  // the real cursor sits still: fixed centre-relative offset (cx) and y, sent every 80 ms
  const box = await target.boundingBox();
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
  // once open it never flickers closed
  expect(samples.length).toBeGreaterThan(10);
  expect(samples.every(Boolean)).toBe(true);
  // the window only grows while hovered: no shrink/grow oscillation
  const sizes = await page.evaluate(() => (window as any).__floMock.resizes.map((r: any) => r.w));
  const after = sizes.slice(sizes.findIndex((w: number) => w > 300));
  for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThanOrEqual(after[i - 1]);
});

test("many Claude sessions: avatars + a list of all of them", async ({ page }) => {
  await openIsland(page);
  const list = Array.from({ length: 7 }, (_, i) => sess(`s${i}`, `proj-${i}`, i < 3 ? "working" : "done", `message ${i}`));
  await emit(page, "flo://claude-sessions", list);
  await expect(page.locator('[aria-label^="proj-"]')).toHaveCount(4); // 4 avatars
  const more = page.locator('[aria-label="more"]');
  await expect(more).toBeVisible();
  await page.waitForTimeout(400); // let the avatars finish springing in
  const box = await more.boundingBox();
  const win = await page.locator("[data-island-root]").boundingBox();
  const cx = box!.x + box!.width / 2 - (win!.x + win!.width / 2);
  const y = box!.y - win!.y + box!.height / 2;
  for (let i = 0; i < 30; i++) {
    const w = await page.locator("[data-island-root]").boundingBox();
    await emit(page, "flo://hover", { inside: true, cx, y, x: w!.width / 2 + cx });
    if (await page.getByText("7 Claude sessions").isVisible()) break;
    await page.waitForTimeout(80);
  }
  await expect(page.getByText("7 Claude sessions")).toBeVisible();
  await expect(page.getByText("3 working")).toBeVisible();
  for (let i = 0; i < 7; i++) await expect(page.getByRole("button", { name: `Open proj-${i}` })).toBeAttached();
  await expect(page.getByText(/[—–]/)).toHaveCount(0);
});
