// Screenshot the "Sorry, my mistake" correction card (dev server on :5190).
import { webkit } from "playwright";
const out = process.argv[2];
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 700, height: 160 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:5190/?nh=38&nw=200#/island");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(600);
await p.evaluate(() => window.__floMock.emit("flo://correction", { id: "c9", heard: "tory", corrected: "Tauri", app: "Slack", saved: true }));
await p.waitForTimeout(900);
await p.screenshot({ path: out });
await b.close();
