// Screenshot the site in light and dark: hero, a chapter, the feature grid, FAQ.
const { chromium } = require("@playwright/test");
const out = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  for (const scheme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await p.addInitScript((s) => { try { localStorage.setItem("flo-theme", s); } catch {} }, scheme);
    await p.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `${out}/th-${scheme}-hero.png` });
    for (const [name, id] of [["features", "everything"], ["faq", "faq"]]) {
      await p.evaluate((i) => document.getElementById(i)?.scrollIntoView(), id);
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${out}/th-${scheme}-${name}.png` });
    }
    await p.close();
  }
  await b.close();
})();
