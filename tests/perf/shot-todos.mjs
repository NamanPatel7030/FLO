// Screenshot the To-dos page and a to-do's Details panel (dev server on :5190).
import { webkit } from "playwright";
const [outPage, outDetails] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:5190/?offline#/todos");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(500);
const off = p.getByText(/Use offline as/).first();
if (await off.count()) {
  await off.click();
  await p.waitForTimeout(700);
}
await p.waitForTimeout(800);
await p.screenshot({ path: outPage });
const row = p.getByText("Ask Priya for Stripe webhook keys").first().locator("xpath=ancestor::div[contains(@class,'group')][1]");
await row.hover();
await row.getByRole("button", { name: "Details" }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: outDetails });
await b.close();
