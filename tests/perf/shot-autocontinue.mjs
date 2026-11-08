// Screenshot auto-continue after a Claude usage limit: Home's Claude sessions card (dark + light),
// the run log, Settings, the notch tray row and the notch cards.
// Usage: node tests/perf/shot-autocontinue.mjs <outDir>   (Vite dev server on :5190)
import { chromium } from "playwright";
const out = process.argv[2] || ".";
const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("flo.mock.signedin", "1"));
const p = await ctx.newPage();
const ready = async (url) => {
  await p.goto(url);
  await p.waitForFunction(() => !!window.__floMock, null, { timeout: 30000 });
  await p.evaluate(() => window.__floMock.invoke("list_auto_continue"));
  await p.waitForFunction(() => !!window.__floAutoContinueMock, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
};
const seed = () =>
  p.evaluate(() => {
    const m = window.__floAutoContinueMock;
    m.clear();
    m.limit({ sessionId: "s9", project: "web", inMinutes: null, status: "resumed", detail: "Continued after the limit reset." });
    m.limit({ sessionId: "s2", project: "hermes-api", inMinutes: 312 });
    m.limit({ sessionId: "s1", project: "Flo", inMinutes: 72, enabled: true });
  });
const card = () => p.getByTestId("ac-list").locator("xpath=..");

for (const theme of ["dark", "light"]) {
  await ready("http://localhost:5190/#/home");
  await p.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  await seed();
  await p.waitForTimeout(900);
  await card().scrollIntoViewIfNeeded();
  await card().screenshot({ path: `${out}/autocont-home-${theme}.png` });
}

// resuming + its log
await p.evaluate(() => (document.documentElement.dataset.theme = "dark"));
await p.getByTestId("ac-row").filter({ hasText: "Flo" }).getByRole("button", { name: "Continue now" }).click();
await p.waitForTimeout(700);
await card().screenshot({ path: `${out}/autocont-home-resuming.png` });
await p.getByTestId("ac-row").filter({ hasText: "Flo" }).getByRole("button", { name: "Log" }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/autocont-log.png` });
await p.getByRole("button", { name: "Close log" }).click();

// settings → appearance → notifications card, toggle on
await ready("http://localhost:5190/#/settings/appearance");
const box = p.getByTestId("ac-settings");
await box.getByRole("switch").click();
await p.waitForTimeout(500);
const notif = box.locator("xpath=..");
await notif.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await notif.screenshot({ path: `${out}/autocont-settings.png` });

// notch: tray row (hover the agents icon), then the cards
await ready("http://localhost:5190/?nh=38&nw=200#/island");
await p.locator('[aria-label="todos"]').waitFor();
await p.evaluate(() =>
  window.__floMock.setSessions([
    { sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", status: "done", message: "You've hit your session limit · resets 3pm", updatedAt: new Date().toISOString(), source: "claude" },
    { sessionId: "s4", project: "apollo-web", cwd: "/Users/parth/apollo-web", status: "working", message: "Refactoring chart components…", updatedAt: new Date().toISOString(), source: "claude" },
    { sessionId: "s2", project: "hermes-api", cwd: "/Users/parth/hermes-api", status: "done", message: "Weekly limit reached ∙ resets Mon 9am", updatedAt: new Date(Date.now() - 600000).toISOString(), source: "claude" },
  ]),
);
await p.evaluate(() => {
  const m = window.__floAutoContinueMock;
  m.clear();
  m.limit({ sessionId: "s1", project: "Flo", inMinutes: 72, enabled: true });
  m.limit({ sessionId: "s2", project: "hermes-api", inMinutes: 1300 });
});
const icon = p.locator('[aria-label^="Agents:"]');
await icon.waitFor();
const list = p.locator('[data-testid="session-list"]');
const ib = await icon.boundingBox();
const wb = await p.locator("[data-island-root]").boundingBox();
const cx = ib.x + ib.width / 2 - (wb.x + wb.width / 2);
const y = ib.y - wb.y + ib.height / 2;
for (let i = 0; i < 40 && !(await list.isVisible()); i++) {
  const w = await p.locator("[data-island-root]").boundingBox();
  await p.evaluate((q) => window.__floMock.emit("flo://hover", q), { inside: true, cx, y, x: w.width / 2 + cx });
  await p.waitForTimeout(80);
}
await p.waitForTimeout(800);
const lb = await list.boundingBox();
await p.screenshot({ path: `${out}/autocont-notch-tray.png`, clip: { x: lb.x - 24, y: 0, width: lb.width + 48, height: lb.y + lb.height + 24 } });

// notch cards: limit, then resumed
await p.evaluate(() => window.__floMock.emit("flo://hover", { inside: false, x: 0, y: 0 }));
await p.waitForTimeout(600);
const cardShot = async (name, ev) => {
  await p.evaluate((e) => window.__floMock.emit("flo://claude", e), ev);
  await p.getByTestId("claude-card").waitFor();
  await p.waitForTimeout(900);
  const r = await p.locator("[data-island-root]").boundingBox();
  await p.screenshot({ path: `${out}/autocont-notch-${name}.png`, clip: { x: Math.max(0, r.x - 30), y: 0, width: r.width + 60, height: r.y + r.height + 30 } });
};
const now = new Date().toISOString();
await cardShot("limit", { id: "l1", kind: "limit", sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", message: "Will continue at 3:00 PM.", at: now, seen: false });
await p.getByTestId("claude-card").getByRole("button", { name: "Dismiss" }).click();
await p.waitForTimeout(700);
await cardShot("resumed", { id: "r1", kind: "resumed", sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", message: "Continuing where it left off.", at: now, seen: false });
await b.close();
