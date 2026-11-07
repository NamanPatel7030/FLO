// Screenshot Settings → Notch (full page) — dev server on :5190.
import { webkit } from "playwright";
const out = process.argv[2];
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto(`http://localhost:5190/?offline#/settings/${process.argv[4] ?? "notch"}`);
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(500);
// the sign-in overlay appears a moment after load; continue offline when it does
const off = p.getByText(/Use offline as/).first();
if (await off.isVisible({ timeout: 4000 }).catch(() => false) || (await off.waitFor({ timeout: 4000 }).then(() => true).catch(() => false))) {
  await off.click();
  await p.waitForTimeout(800);
}
await p.waitForTimeout(1500);
const target = process.argv[3];
if (target) {
  await p.getByText(target, { exact: true }).first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
}
await p.screenshot({ path: out });
await b.close();
