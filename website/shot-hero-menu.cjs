// Screenshot the hero with the platform dropdown open, in dark and light.
const { chromium } = require("@playwright/test");
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  for (const scheme of ["dark", "light"]) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await p.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/hero-${scheme}.png` });
    await p.locator('[aria-label="More platforms"]').first().click();
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/hero-menu-${scheme}.png`, clip: { x: 300, y: 380, width: 840, height: 520 } });
    await p.close();
  }
  await b.close();
})();
