// Log the x position of every notch wing icon on each frame while the panel opens, to catch icons
// that jump or swap. Dev server on :5190.
import { webkit } from "playwright";
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
await p.addInitScript(() => localStorage.setItem("flo.mock.signedin", "1"));
await p.goto(`http://localhost:5190/?nh=38&nw=200#/island`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(1000);
const snap = () =>
  p.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-label^="Agents:"],[aria-label*="to-do" i],[data-testid="music-activity"] > div,[aria-label^="Playing"],[aria-label^="Paused"]')];
    return els
      .map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return `${(e.getAttribute("aria-label") || e.className.toString().slice(0, 20)).slice(0, 18)}@${Math.round(r.left + r.width / 2)}(${cs.opacity})`;
      })
      .join("  ");
  });
console.log("before:", await snap());
await p.evaluate(() => window.__floMock.emit("flo://hover", { inside: true, x: 0, y: 10 }));
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(30);
  console.log(String(i * 30).padStart(4), await snap());
}
await b.close();
