// Which animations / frame loops / timers keep running on an idle page? (Dev probe; the regression
// guard lives in tests/e2e/idle.spec.ts.) Needs the Vite dev server on :1420 (npm run dev).
//   node tests/perf/idle-animations.mjs [platform=linux]
import { webkit } from "playwright";

const platform = process.argv[2] ?? "platform=linux";
const PAGES = ["#/island", "#/agent", "#/home", "#/assistant", "#/todos", "#/notes", "#/settings"];
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem("flo.mock.signedin", "1");
  // an update is waiting, like the user's 0.1.7 screen
  window.__floMockRelease = { version: "9.9.9", notes: "x" };
  const w = window;
  w.__raf = 0;
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => (w.__raf++, raf(cb));
  w.__iv = [];
  const si = w.setInterval.bind(w);
  w.setInterval = (fn, ms, ...a) => (w.__iv.push(ms), si(fn, ms, ...a));
});
for (const p of PAGES) {
  await page.goto("about:blank");
  await page.goto(`http://localhost:1420/?${platform}${p}`);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const w = window;
    const r0 = w.__raf;
    await new Promise((r) => setTimeout(r, 1000));
    const all = document.getAnimations();
    const anims = all.filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity);
    w.__all = all.length + " total, " + document.title + " " + document.body.innerText.slice(0, 60).replace(/\n/g, " ");
    return {
      rafPerSec: w.__raf - r0,
      infinite: anims.map((a) => `${a.animationName ?? a.constructor.name} on ${a.effect?.target?.className?.toString?.().slice(0, 60) ?? a.effect?.target?.tagName}`),
      intervals: w.__iv.filter((ms) => ms < 1000),
      all: w.__all,
    };
  });
  console.log(p, JSON.stringify(r, null, 1));
}
await browser.close();
