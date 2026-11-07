// Screenshot an island demo or a dashboard route. Usage: node tests/perf/shot.mjs <url-path> <out.png> [w] [h] [waitMs]
import { webkit } from "playwright";
const [path, out, w = "900", h = "300", wait = "1200"] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
await p.goto(`http://localhost:5190${path}`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(Number(wait));
await p.screenshot({ path: out });
await b.close();
console.log("saved", out);
