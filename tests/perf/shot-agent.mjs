// Screenshot Flo Agent: Overview (idle, route preview, live run waiting for a yes), Apps, Skills,
// Engine (Hermes missing / installed + running), Slack gateway, Customize.
// Dev server on :5190. Usage: node tests/perf/shot-agent.mjs <outDir>
import { webkit } from "playwright";
const out = process.argv[2] ?? ".";
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });
const boot = async (hash) => {
  await p.goto(`http://localhost:5190/?offline#${hash}`);
  await p.waitForFunction(() => !!window.__floMock && !!window.__floAgentMock, { timeout: 10000 });
  await p.waitForTimeout(400);
  const off = p.getByText(/Use offline as/).first();
  if (await off.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) {
    await off.click();
    await p.waitForTimeout(600);
  }
};
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/floagent-${name}.png` });
};

await boot("/agent");
await shot("overview");

await p.getByLabel("Ask Flo Agent").fill("Open LinkedIn and write a post about what I shipped this week");
await p.getByTestId("route-preview").waitFor();
await shot("preview");

await p.evaluate(() => (window.__floAgentMock.stepMs = 260));
await p.getByLabel("Ask Flo Agent").press("Enter");
await p.getByTestId("agent-confirm").waitFor({ timeout: 8000 });
await shot("live-confirm");
await p.getByRole("button", { name: "Yes, do it" }).click();
await p.waitForTimeout(1200);
await p.getByTestId("run-row").first().click();
await shot("recent-open");

await p.getByRole("tab", { name: "Apps" }).click();
await shot("apps");
await p.getByRole("tab", { name: "Skills" }).click();
await shot("skills");

await p.getByRole("tab", { name: "Engine" }).click();
await shot("engine-missing");
await p.evaluate(() => window.__floAgentMock.setHermes({ installed: true, version: "0.22.5", path: "/Users/you/.local/bin/hermes" }));
await p.getByRole("button", { name: "Check again" }).click();
await p.getByRole("button", { name: "Start Hermes" }).click();
await p.getByTestId("hermes-log").waitFor();
await p.getByRole("radio", { name: "Hermes Agent" }).click();
await shot("engine-running");

await p.getByRole("tab", { name: "Slack" }).click();
await shot("slack");

await p.getByRole("tab", { name: "Customize" }).click();
await shot("customize");

// light theme check
await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await p.getByRole("tab", { name: "Overview" }).click();
await shot("overview-light");
await b.close();
