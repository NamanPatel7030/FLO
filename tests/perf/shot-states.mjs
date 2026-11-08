// Screenshot every notch state at a real MacBook notch size (dev server on :5190), plus a frame
// sequence of the hover-open morph, for visual review.
//   node tests/perf/shot-states.mjs <outdir> [states,comma,separated]
import { webkit } from "playwright";

const out = process.argv[2];
const all = ["tray", "hover", "listening", "assistant", "thinking", "working", "result", "error", "card", "claude", "meeting", "correction", "reminder", "music", "panel", "permission", "agent", "agentmode", "history"];
const states = process.argv[3] ? process.argv[3].split(",") : all;
const b = await webkit.launch();
for (const s of states) {
  const p = await b.newPage({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => localStorage.setItem("flo.mock.signedin", "1"));
  await p.goto(`http://localhost:5190/?demo=${s}&nh=38&nw=200#/island`);
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `${out}/st-${s}.png` });
  await p.close();
}
// hover-open frames: start collapsed, enter, capture every 40 ms
const p = await b.newPage({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.setItem("flo.mock.signedin", "1"));
await p.goto(`http://localhost:5190/?nh=38&nw=200#/island`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(800);
await p.evaluate(() => window.__floMock.emit("flo://hover", { inside: true, x: 0, y: 10 }));
for (let i = 0; i < 10; i++) {
  await p.screenshot({ path: `${out}/open-${String(i).padStart(2, "0")}.png`, clip: { x: 100, y: 0, width: 800, height: 420 } });
  await p.waitForTimeout(40);
}
await b.close();
