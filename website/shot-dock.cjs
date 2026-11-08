// Screenshots of the hero (notch + dock), a tall chapter, the dock hover state, and phone width.
const { chromium } = require("@playwright/test");
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/w-hero.png` });
  await p.getByTestId("dock-privacy").hover();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/w-dock-hover.png`, clip: { x: 300, y: 760, width: 840, height: 140 } });
  await p.getByTestId("dock-features").click();
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${out}/w-chapter.png` });
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(500); }
  await p.waitForTimeout(3500); await p.screenshot({ path: `${out}/w-chapter2b.png` });
  for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 900); await p.waitForTimeout(500); }
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/w-chapter2.png` });
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
  await m.waitForTimeout(1200);
  await m.screenshot({ path: `${out}/w-phone.png` });
  const sw = await m.evaluate(() => document.documentElement.scrollWidth);
  console.log("phone scrollWidth", sw, errs.length ? errs.join("\n") : "NO ERRORS");
  await b.close();
})();
