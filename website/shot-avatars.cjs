// Screenshot the maker card (before/after a click) and the auth pages' bylines; print which avatar
// each page shows and whether the favicon files are served.
const { chromium } = require("@playwright/test");
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const f of ["/favicon.ico", "/favicon-32x32.png", "/apple-touch-icon.png", "/site.webmanifest", "/naman/ocean-04-big-curl-wave.webp"]) {
    const r = await p.request.get("http://localhost:3000" + f);
    console.log(f, r.status());
  }
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
  await p.evaluate(() => document.getElementById("maker")?.scrollIntoView());
  await p.waitForTimeout(1500);
  const card = p.locator("#maker");
  await card.screenshot({ path: `${out}/av-maker-1.png` });
  console.log("maker:", await card.locator("[data-avatar]").getAttribute("data-avatar"));
  await card.locator("[data-avatar]").click();
  await p.waitForTimeout(600);
  console.log("maker after click:", await card.locator("[data-avatar]").getAttribute("data-avatar"));
  await card.screenshot({ path: `${out}/av-maker-2.png` });
  for (const path of ["/login", "/signup", "/privacy", "/terms"]) {
    await p.goto("http://localhost:3000" + path, { waitUntil: "networkidle", timeout: 120000 });
    await p.waitForTimeout(800);
    const a = p.locator("[data-avatar]").first();
    console.log(path, await a.getAttribute("data-avatar"));
    await a.scrollIntoViewIfNeeded();
    const box = await a.boundingBox();
    await p.screenshot({ path: `${out}/av-${path.slice(1)}.png`, clip: { x: Math.max(0, box.x - 160), y: Math.max(0, box.y - 30), width: 360, height: 80 } });
  }
  await b.close();
})();
