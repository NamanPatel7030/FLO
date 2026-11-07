// Frame-timing probe for the notch hover expand/collapse and the widgets panel.
// Usage (dev server on :5190): node tests/perf/hover-probe.mjs [webkit|chromium] [runs]
// Prints dropped frames (>24 ms) and the worst frame per run. Lower is smoother.
import { webkit, chromium } from "playwright";

const engine = (process.argv[2] ?? "webkit") === "chromium" ? chromium : webkit;
const runs = Number(process.argv[3] ?? 3);
// chromium only: simulate a busy machine so paint-heavy animations show their cost
const throttle = Number(process.argv[4] ?? 1);

async function newPage(b, viewport) {
  const p = await b.newPage({ viewport, deviceScaleFactor: 2 });
  if (throttle > 1 && engine === chromium) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  return p;
}

async function record(p, action) {
  await p.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__rec) requestAnimationFrame(tick);
    };
    window.__rec = true;
    requestAnimationFrame(tick);
  });
  await action();
  const f = await p.evaluate(() => {
    window.__rec = false;
    return window.__frames.slice(2);
  });
  return { frames: f.length, jank: f.filter((d) => d > 24).length, max: Math.round(Math.max(...f)) };
}

const b = await engine.launch();
const out = { engine: engine.name(), hover: [], widgets: [] };
for (let r = 0; r < runs; r++) {
  // 1) hover → peek expand → leave → collapse
  const p = await newPage(b, { width: 900, height: 700 });
  await p.goto("http://localhost:5190/?nh=38&nw=200#/island");
  await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
  await p.waitForTimeout(800);
  const box = await (await p.$("[data-island-root]")).boundingBox();
  out.hover.push(
    await record(p, async () => {
      await p.mouse.move(box.x + box.width / 2, box.y + 10, { steps: 8 });
      await p.waitForTimeout(1400);
      await p.mouse.move(box.x + box.width / 2, box.y + 600, { steps: 8 });
      await p.waitForTimeout(1200);
    }),
  );
  await p.close();

  // 2) widgets panel opening
  const w = await newPage(b, { width: 900, height: 900 });
  await w.addInitScript(() => localStorage.setItem("flo.widgets", JSON.stringify(["today", "agents", "nowPlaying", "weather"])));
  await w.goto("http://localhost:5190/?nh=38&nw=420#/island");
  await w.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
  await w.waitForTimeout(800);
  const wb = await (await w.$("[data-island-root]")).boundingBox();
  await w.mouse.move(wb.x + wb.width / 2, wb.y + 10);
  out.widgets.push(
    await record(w, async () => {
      await w.evaluate(() => window.__floOpenWidgets?.());
      await w.waitForTimeout(1200);
    }),
  );
  await w.close();
}
await b.close();
const tot = (k) => out[k].reduce((s, x) => s + x.jank, 0);
console.log(JSON.stringify({ ...out, hoverJank: tot("hover"), widgetsJank: tot("widgets") }));
