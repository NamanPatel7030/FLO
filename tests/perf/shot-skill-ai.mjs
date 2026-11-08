// Screenshot Build with AI (composer, shimmer loading, result), the Schedule node, and a scheduled
// skill card with Run now (dev server on :5190). Usage: node tests/perf/shot-skill-ai.mjs <outPrefix>
import { webkit } from "playwright";
const prefix = process.argv[2] ?? "/tmp/skillai";
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const open = async (q = "") => {
  await p.goto(`http://localhost:5190/?offline${q}#/skills`);
  await p.waitForFunction(() => !!window.__floMock, { timeout: 10000 });
  const off = p.getByText(/Use offline as/).first();
  if (await off.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) {
    await off.click();
    await p.waitForTimeout(600);
  }
};

// 1) the skills list with a scheduled skill
await open();
await p.waitForTimeout(800);
await p.screenshot({ path: `${prefix}-list.png` });
await p.getByRole("button", { name: /Run Morning inbox digest now/ }).click();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${prefix}-ran.png` });

// 2) new skill → composer
await open("&slowai");
await p.getByRole("button", { name: "New skill" }).click();
const ed = p.getByTestId("skill-editor");
await ed.getByLabel("Describe the skill").waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${prefix}-composer.png` });
await ed.getByLabel("Describe the skill").fill("Every weekday at 9, read my unread Gmail, summarise it and post it to Slack #daily with Notion notes");
await ed.getByRole("button", { name: "Build", exact: true }).click();
await p.waitForTimeout(1600);
await p.screenshot({ path: `${prefix}-loading.png` });
await p.waitForTimeout(5200);
await p.waitForTimeout(450);
await p.screenshot({ path: `${prefix}-revealing.png` });
await p.waitForTimeout(2200);
await p.screenshot({ path: `${prefix}-built.png` });

// 3) schedule node: switch to Every Monday, then advanced cron
const sch = ed.getByTestId("node-schedule");
await sch.getByLabel("Repeat").selectOption("weekly");
await p.waitForTimeout(300);
await sch.screenshot({ path: `${prefix}-schedule-node.png` });
await ed.getByRole("button", { name: "Refine with AI" }).click();
await ed.getByLabel("Describe the skill").fill("skip newsletters");
await p.waitForTimeout(300);
await p.screenshot({ path: `${prefix}-refine.png` });
await b.close();
