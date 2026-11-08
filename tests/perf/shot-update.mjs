// Screenshot the in-app update card (available → downloading → ready) and the Settings row.
import { webkit } from "playwright";
const out = process.argv[2];
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
await p.addInitScript(() => {
  window.__floMockRelease = { version: "0.2.0", notes: "Skills on a schedule, Build with AI and faster dictation." };
});
await p.goto("http://localhost:5190/?offline#/home");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
const off = p.getByText(/Use offline as/).first();
if (await off.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
  await off.click();
  await p.waitForTimeout(800);
}
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/update-available.png`, clip: { x: 0, y: 460, width: 320, height: 400 } });
await p.getByTestId("update-card").getByRole("button", { name: "Update" }).click();
await p.waitForTimeout(350);
await p.screenshot({ path: `${out}/update-downloading.png`, clip: { x: 0, y: 460, width: 320, height: 400 } });
await p.getByText(/is ready/).waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/update-ready.png`, clip: { x: 0, y: 460, width: 320, height: 400 } });
await p.goto("http://localhost:5190/?offline#/settings/general");
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/update-settings.png` });
await b.close();
