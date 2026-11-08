// Screenshot Active / Away (sidebar, notch quick menu, Settings) and the phone pairing dialog.
// Usage: node tests/perf/shot-presence.mjs <outDir>   (Vite dev server on :5190)
import { chromium } from "playwright";
const out = process.argv[2] || ".";
const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("flo.mock.signedin", "1"));
const p = await ctx.newPage();
const ready = async (url) => {
  await p.goto(url);
  await p.waitForFunction(() => !!window.__floMock, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
};

// sidebar: active, then away
await ready("http://localhost:5190/#/home");
const sidebar = async (name) => {
  const box = await p.locator("aside").boundingBox();
  await p.screenshot({ path: `${out}/presence-${name}.png`, clip: { x: 0, y: box.height - 330, width: box.width, height: 330 } });
};
await sidebar("sidebar-active");
await p.getByTestId("presence-card").getByRole("radio", { name: "Away" }).click();
await p.waitForTimeout(700);
await sidebar("sidebar-away");

// settings → general (presence + phones), away
await ready("http://localhost:5190/#/settings/general");
const sec = p.getByRole("region", { name: "Presence & phone" });
await sec.scrollIntoViewIfNeeded();
await p.waitForTimeout(500);
await sec.screenshot({ path: `${out}/presence-settings.png` });

// pairing dialog
await p.getByRole("button", { name: "Pair your Android phone" }).click();
await p.getByTestId("pair-code").filter({ hasText: /\d{3} \d{3}/ }).waitFor();
await p.waitForTimeout(700);
await p.screenshot({ path: `${out}/presence-pairing.png` });
await p.evaluate(() => window.__floPresenceMock.claim("Galaxy S25"));
await p.getByTestId("pair-success").waitFor({ timeout: 8000 });
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/presence-paired.png` });
await p.keyboard.press("Escape");

// notch quick menu (active + away)
await ready("http://localhost:5190/?nh=38&nw=200#/island");
await p.locator('[aria-label="todos"]').waitFor();
const hover = () => p.evaluate(() => window.__floMock.emit("flo://hover", { inside: true, x: 100, y: 10 }));
await hover();
await p.getByTestId("notch-presence").waitFor();
await p.waitForTimeout(900);
const notch = async (name) => {
  const box = await p.locator("[data-island-root]").boundingBox();
  await p.screenshot({ path: `${out}/presence-${name}.png`, clip: { x: Math.max(0, box.x - 30), y: 0, width: box.width + 60, height: box.y + box.height + 30 } });
};
await notch("notch-active");
await p.getByTestId("notch-presence").click();
await hover();
await p.waitForTimeout(700);
await notch("notch-away");
await b.close();
console.log("ok");
