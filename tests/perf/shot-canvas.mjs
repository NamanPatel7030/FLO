// Screenshot the skill canvas with a richer graph, and the Connections tab (dev server on :5190).
import { webkit } from "playwright";
const [outCanvas, outConn] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto("http://localhost:5190/?offline#/skills");
await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
const off = p.getByText(/Use offline as/).first();
if (await off.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
  await off.click();
  await p.waitForTimeout(800);
}
await p.getByRole("button", { name: /Upwork proposal/ }).last().click();
const ed = p.getByTestId("skill-editor");
await ed.getByRole("button", { name: "Add MCP server" }).click();
await ed.getByRole("combobox", { name: "MCP server", exact: true }).selectOption({ label: "Notion" });
await ed.getByRole("button", { name: "Add Knowledge" }).click();
await p.waitForTimeout(900);
await p.screenshot({ path: outCanvas });
await p.keyboard.press("Escape");
await p.goto("http://localhost:5190/?offline#/skills/connections");
await p.waitForTimeout(900);
await p.getByRole("button", { name: "MCP server" }).click();
const ce = p.getByTestId("connection-editor");
await ce.getByLabel("Connection name").fill("Files");
await ce.getByLabel("Command").fill("npx -y @modelcontextprotocol/server-filesystem ~/Documents");
await ce.getByRole("button", { name: "Test" }).click();
await p.waitForTimeout(700);
await p.screenshot({ path: outConn });
await b.close();
