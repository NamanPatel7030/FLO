// Idle-cost probe for the notch: with the island collapsed / tray-only and the cursor away,
// count what still runs. Target: 0 running animations, 0 rAF callbacks, no timer faster than ~2 s.
// Usage (dev server on :5190): node tests/perf/idle-probe.mjs [webkit|chromium] [media: none|spotify|paused]
import { webkit, chromium } from "playwright";

const engine = (process.argv[2] ?? "webkit") === "chromium" ? chromium : webkit;
const media = process.argv[3] ?? "none";

const b = await engine.launch();
const p = await b.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
await p.addInitScript(() => {
  localStorage.setItem("flo.mock.signedin", "1");
  const w = window;
  w.__idle = { raf: 0, timers: new Map() };
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => raf((t) => (w.__idle.raf++, cb(t)));
  const where = () => (new Error().stack ?? "").split("\n").slice(2, 4).join(" | ").replace(/https?:\/\/[^/]+/g, "").slice(0, 160);
  const si = w.setInterval.bind(w);
  w.setInterval = (fn, ms, ...a) => {
    const k = `interval ${ms}ms @ ${where()}`;
    return si((...x) => (w.__idle.timers.set(k, (w.__idle.timers.get(k) ?? 0) + 1), typeof fn === "function" ? fn(...x) : 0), ms, ...a);
  };
  const st = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...a) => {
    const k = `timeout ${ms ?? 0}ms @ ${where()}`;
    return st((...x) => (w.__idle.timers.set(k, (w.__idle.timers.get(k) ?? 0) + 1), typeof fn === "function" ? fn(...x) : 0), ms, ...a);
  };
});
await p.goto(`http://localhost:5190/?nh=38&nw=200&media=${media}#/island`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });

await p.mouse.move(5, 650);
await p.waitForTimeout(2500); // settle (entrance animations finish)
await p.evaluate(() => {
  window.__idle.raf = 0;
  window.__idle.timers.clear();
});
const SECS = 5;
await p.waitForTimeout(SECS * 1000);
const r = await p.evaluate(() => {
  const anims = document
    .getAnimations()
    .filter((a) => a.playState === "running")
    .map((a) => {
      const el = a.effect?.target;
      return `${a.animationName ?? a.constructor.name} on ${el?.tagName?.toLowerCase()}.${String(el?.className?.baseVal ?? el?.className ?? "").slice(0, 50)}`;
    });
  return { raf: window.__idle.raf, timers: [...window.__idle.timers.entries()], anims };
});
const fast = r.timers.filter(([, n]) => n > Math.ceil(5 / 2));
console.log(JSON.stringify({ engine: engine.name(), media, seconds: SECS, rafCallbacks: r.raf, runningAnimations: r.anims.length, anims: r.anims, timerFires: r.timers.reduce((s, [, n]) => s + n, 0), fastTimers: fast }, null, 1));
await b.close();
