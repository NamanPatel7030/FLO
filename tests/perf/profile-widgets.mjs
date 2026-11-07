// CPU-profile the widgets panel opening (Chromium, throttled). Prints the hottest functions by self time.
// Usage (dev server on :5190): node tests/perf/profile-widgets.mjs [throttle] [hover]
import { chromium } from "playwright";

const throttle = Number(process.argv[2] ?? 6);
const scenario = process.argv[3] ?? "widgets";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
const cdp = await p.context().newCDPSession(p);
await p.addInitScript(() => localStorage.setItem("flo.widgets", JSON.stringify(["today", "agents", "nowPlaying", "weather"])));
await p.goto("http://localhost:5190/?nh=38&nw=420#/island");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(1000);
const box = await (await p.$("[data-island-root]")).boundingBox();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
if (scenario === "hover") {
  await p.mouse.move(box.x + box.width / 2, box.y + 10, { steps: 8 });
  await p.waitForTimeout(1400);
  await p.mouse.move(box.x + box.width / 2, box.y + 600, { steps: 8 });
  await p.waitForTimeout(1200);
} else {
  await p.mouse.move(box.x + box.width / 2, box.y + 10);
  await p.evaluate(() => window.__floOpenWidgets?.());
  await p.waitForTimeout(1200);
}
const { profile } = await cdp.send("Profiler.stop");
await b.close();

// self time per node = samples hitting it × interval
const counts = new Map();
for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
const dt = (profile.endTime - profile.startTime) / profile.samples.length / 1000; // ms per sample
const byFn = new Map();
for (const n of profile.nodes) {
  const c = counts.get(n.id) ?? 0;
  if (!c) continue;
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-1)[0].split("?")[0]}:${f.lineNumber + 1}`;
  byFn.set(key, (byFn.get(key) ?? 0) + c * dt);
}
const top = [...byFn.entries()].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, ms] of top) console.log(ms.toFixed(1).padStart(7), "ms ", k);
