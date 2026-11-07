// Screenshot the Skills page and the skill editor (dev server on :5190).
import { webkit } from "playwright";
const [outPage, outEditor] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
await p.goto("http://localhost:5190/?offline#/skills");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
const off = p.getByText(/Use offline as/).first();
if (await off.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
  await off.click();
  await p.waitForTimeout(800);
}
await p.waitForTimeout(800);
await p.screenshot({ path: outPage });
await p.getByRole("button", { name: /Upwork proposal/ }).first().click();
await p.waitForTimeout(700);
await p.screenshot({ path: outEditor });
await b.close();
