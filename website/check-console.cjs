// Load the site, scroll through it, and print any console errors / page errors / failed requests.
const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 300)));
  p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));
  p.on("response", (r) => r.status() >= 400 && errs.push(`http ${r.status()}: ${r.url()}`));
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
  for (let i = 0; i < 14; i++) {
    await p.mouse.wheel(0, 900);
    await p.waitForTimeout(350);
  }
  await p.waitForTimeout(800);
  console.log(errs.length ? errs.join("\n") : "NO ERRORS");
  await b.close();
})();
