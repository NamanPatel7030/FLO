// Screenshot Projects → Code (clone progress, repo card, Edit with AI, run log) and Settings →
// Integrations → Coding agents. Dev server on :5190. Usage: node tests/perf/shot-code.mjs <outDir>
import { webkit } from "playwright";
const out = process.argv[2] ?? ".";
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
const boot = async (hash) => {
  await p.goto(`http://localhost:5190/?offline#${hash}`);
  await p.waitForFunction(() => !!window.__floMock && !!window.__floCodeMock, { timeout: 10000 });
  await p.waitForTimeout(400);
  const off = p.getByText(/Use offline as/).first();
  if (await off.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) {
    await off.click();
    await p.waitForTimeout(600);
  }
};

await boot("/projects");
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/code-grid.png` });

await p.evaluate(() => {
  window.__floCodeMock.cloneStepMs = 900;
  window.__floCodeMock.folder = "/Users/you/Code";
});
await p.getByRole("button", { name: "Add code to Apollo" }).click();
await p.waitForTimeout(500);
const code = p.getByTestId("code-section");
await code.getByLabel("GitHub repository URL").fill("https://github.com/acme/northwind-dashboard");
await code.scrollIntoViewIfNeeded();
await p.waitForTimeout(250);
await p.screenshot({ path: `${out}/code-url.png` });
await code.getByRole("button", { name: "Choose folder & clone" }).click();
await p.waitForTimeout(2900);
await p.screenshot({ path: `${out}/code-clone.png` });
await code.getByTestId("repo-card").waitFor({ timeout: 10000 });
await p.waitForTimeout(500);
await code.scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/code-repo.png` });

await code.getByTestId("repo-card").getByRole("button", { name: "Edit with AI" }).click();
await p.waitForTimeout(400);
await p.getByLabel("What should I build?").fill("Add a dark mode toggle to the settings page and remember the choice");
await p.getByTestId("edit-with-ai").scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/code-edit.png` });

await p.evaluate(() => (window.__floCodeMock.runHoldMs = 60000));
await p.getByRole("radio", { name: /Run in background/ }).click();
await p.getByTestId("accept-edits").click();
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/code-edit-bg.png` });
await p.getByRole("button", { name: "Build it", exact: true }).click();
await p.waitForTimeout(1300);
await p.getByTestId("run-log").scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/code-log.png` });

await boot("/settings/integrations");
await p.getByTestId("coding-agents").scrollIntoViewIfNeeded();
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/code-agents.png` });
await b.close();
