// Screenshot Settings → Notch (full page) — dev server on :5190.
import { webkit } from "playwright";
const out = process.argv[2];
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto(`http://localhost:5190/?offline#/settings/${process.argv[4] ?? "notch"}`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(500);
const off = p.getByText(/Use offline as/).first();
if (await off.count()) {
  await off.click();
  await p.waitForTimeout(700);
}
await p.waitForTimeout(1500);
const target = process.argv[3];
if (target) {
  await p.getByText(target, { exact: true }).first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
}
await p.screenshot({ path: out });
await b.close();
