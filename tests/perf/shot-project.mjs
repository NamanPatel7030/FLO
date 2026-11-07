// Screenshot the new-project form and a project drawer with client details (dev server on :5190).
import { webkit } from "playwright";
const [outForm, outDrawer] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
await p.goto("http://localhost:5190/?offline#/projects");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
await p.waitForTimeout(400);
// the sign-in overlay appears a moment after load; continue offline when it does
const off = p.getByText(/Use offline as/).first();
if (await off.isVisible({ timeout: 4000 }).catch(() => false) || (await off.waitFor({ timeout: 4000 }).then(() => true).catch(() => false))) {
  await off.click();
  await p.waitForTimeout(800);
}
await p.getByRole("button", { name: "New project" }).click();
const f = p.getByTestId("new-project");
await f.getByLabel("Project name").fill("Website rebuild");
await f.getByLabel("Description").fill("SaaS site from scratch");
await f.getByLabel("Client", { exact: true }).fill("Fang Studio");
await f.getByLabel("Client details").fill("Fang Wei · fang@studio.cn · WeChat");
await f.getByLabel("Keywords").fill("Ayushi, SOW, Senshuon");
await p.waitForTimeout(400);
await p.screenshot({ path: outForm });
await f.getByRole("button", { name: "Create" }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: outDrawer });
await b.close();
