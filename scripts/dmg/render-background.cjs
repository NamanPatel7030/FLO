// Renders scripts/dmg/background.html to background.tiff (1x + 2x) for the installer DMG.
// usage: node scripts/dmg/render-background.cjs   (needs Playwright, e.g. from website/node_modules)
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require(require.resolve("playwright", { paths: [path.join(__dirname, "../../website")] }));
(async () => {
  const opts = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
  const b = await chromium.launch(opts);
  const out = (s) => path.join(__dirname, s === 2 ? "bg@2x.png" : "bg.png");
  for (const s of [1, 2]) {
    const p = await b.newPage({ viewport: { width: 760, height: 480 }, deviceScaleFactor: s });
    await p.goto("file://" + path.join(__dirname, "background.html"));
    await p.waitForTimeout(500);
    await p.screenshot({ path: out(s) });
    await p.close();
  }
  await b.close();
  execFileSync("tiffutil", ["-cathidpicheck", out(1), out(2), "-out", path.join(__dirname, "background.tiff")]);
  for (const s of [1, 2]) require("fs").unlinkSync(out(s));
  console.log("wrote scripts/dmg/background.tiff");
})();
