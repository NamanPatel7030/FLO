import { expect, test, type Page } from "@playwright/test";

// Projects → Code: clone / link a repo, Edit with AI, coding agent accounts (mock: lib/mockCode.ts).
const ready = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock && !!(window as any).__floCodeMock);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const project = (page: Page, id: string) => page.evaluate((i) => (window as any).__floMock.invoke("list_projects").then((ps: any[]) => ps.find((p) => p.id === i)), id);

test("add code from a GitHub URL: validates, picks a folder, streams progress, shows the repo card", async ({ page }) => {
  await page.goto("/#/projects");
  await ready(page);
  await page.evaluate(() => {
    (window as any).__floCodeMock.folder = "/Users/you/Code";
    (window as any).__floCodeMock.cloneStepMs = 250;
  });
  // the card's "Add code" opens the drawer straight on the clone form
  await page.getByRole("button", { name: "Add code to Apollo" }).click();
  const code = page.getByTestId("code-section");
  const url = code.getByLabel("GitHub repository URL");
  await url.fill("https://gitlab.com/acme/site");
  await url.blur();
  await expect(code.getByText(/Use a GitHub repo URL/)).toBeVisible();
  await expect(code.getByRole("button", { name: "Choose folder & clone" })).toBeDisabled();

  await url.fill("https://github.com/acme/northwind-dashboard.git");
  await expect(code.getByText("acme/northwind-dashboard")).toBeVisible();
  await code.getByRole("button", { name: "Choose folder & clone" }).click();
  const progress = code.getByTestId("clone-progress");
  await expect(progress).toBeVisible();
  await expect(progress).toContainText(/Receiving objects|Resolving deltas/);
  await expect(progress).toContainText(/\d+%/);

  const card = code.getByTestId("repo-card");
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card.getByTestId("repo-name")).toHaveText("northwind-dashboard");
  await expect(card.getByTestId("repo-branch")).toContainText("main");
  await expect(card.getByTestId("repo-commit")).toContainText("Initial landing page");
  await expect(card.getByTestId("repo-dirty")).toHaveText("2 changed");
  expect(await calls(page, "clone_repo")).toEqual([{ projectId: "p_apollo", url: "https://github.com/acme/northwind-dashboard.git", parent: "/Users/you/Code" }]);
  const p = await project(page, "p_apollo");
  expect(p.localPath).toBe("/Users/you/Code/northwind-dashboard");
  expect(p.repoUrl).toBe("https://github.com/acme/northwind-dashboard");

  // open actions + remove link (files stay)
  await card.getByRole("button", { name: "Open in VS Code" }).click();
  expect(await calls(page, "open_code")).toEqual([{ projectId: "p_apollo", target: "vscode" }]);
  await card.getByRole("button", { name: "Remove link" }).click();
  await expect(card.getByText("Files stay on disk.")).toBeVisible();
  await card.getByRole("button", { name: "Remove link" }).click();
  await expect(code.getByTestId("code-empty")).toBeVisible();
  expect((await project(page, "p_apollo")).localPath).toBeUndefined();
});

test("a failed clone explains itself", async ({ page }) => {
  await page.goto("/#/projects/p_hermes");
  await ready(page);
  await page.evaluate(() => {
    const m = (window as any).__floCodeMock;
    m.cloneStepMs = 20;
    m.cloneError = "GitHub didn't let git read this repo. If it's private, sign in to GitHub for git first (run `gh auth login`, or set up an SSH key), then try again.";
  });
  const code = page.getByTestId("code-section");
  await code.getByRole("button", { name: "Clone from GitHub" }).click();
  await code.getByLabel("GitHub repository URL").fill("git@github.com:acme/private-api.git");
  await code.getByRole("button", { name: "Choose folder & clone" }).click();
  await expect(code.getByTestId("clone-error")).toContainText("gh auth login");
  await expect(code.getByTestId("repo-card")).toHaveCount(0);
});

test("use an existing folder, then Edit with AI sends the prompt to the chosen agent", async ({ page }) => {
  await page.goto("/#/projects/p_flo");
  await ready(page);
  await page.evaluate(() => ((window as any).__floCodeMock.folder = "/Users/you/dev/flo"));
  const code = page.getByTestId("code-section");
  await code.getByRole("button", { name: "Use an existing folder" }).click();
  await expect(code.getByTestId("repo-name")).toHaveText("flo");

  await code.getByTestId("repo-card").getByRole("button", { name: "Edit with AI" }).click();
  const ed = page.getByTestId("edit-with-ai");
  // claude connected → enabled; codex installed but signed out and gemini missing → disabled
  const agents = ed.getByRole("radiogroup", { name: "Agent" });
  await expect(agents.getByRole("radio", { name: /Claude/ })).toBeEnabled();
  await expect(agents.getByRole("radio", { name: /ChatGPT/ })).toBeDisabled();
  await expect(agents.getByRole("radio", { name: /Gemini/ })).toBeDisabled();
  await expect(agents.getByRole("radio", { name: /Claude/ })).toHaveAttribute("aria-checked", "true");

  await ed.getByLabel("What should I build?").fill(`Add a "dark mode" toggle; don't break $PATH`);
  await ed.getByTestId("include-notes").click();
  await ed.getByRole("button", { name: "Build it in Terminal" }).click();
  await expect.poll(() => calls(page, "edit_with_ai")).toEqual([
    { req: { projectId: "p_flo", prompt: `Add a "dark mode" toggle; don't break $PATH`, agent: "claude", mode: "terminal", includeNotes: true, acceptEdits: false } },
  ]);
  await expect(code.getByTestId("code-run")).toHaveCount(1);
  await expect(code.getByTestId("code-run")).toContainText("In Terminal");
  await expect(ed).toHaveCount(0); // terminal mode closes the panel

  // background: needs the explicit confirmation, streams a log, and can be stopped
  await page.evaluate(() => ((window as any).__floCodeMock.runHoldMs = 60_000));
  await code.getByTestId("repo-card").getByRole("button", { name: "Edit with AI" }).click();
  await ed.getByLabel("What should I build?").fill("Write tests for the parser");
  await ed.getByRole("radio", { name: /Run in background/ }).click();
  const build = ed.getByRole("button", { name: "Build it", exact: true });
  await expect(build).toBeDisabled();
  await ed.getByTestId("accept-edits").click();
  await build.click();
  const log = code.getByTestId("run-log");
  await expect(log).toContainText("→ Edit src/App.tsx");
  await log.getByRole("button", { name: "Stop" }).click();
  await expect(log).toContainText("Stopped.");
  const last = (await calls(page, "edit_with_ai")).at(-1);
  expect(last.req).toMatchObject({ agent: "claude", mode: "background", acceptEdits: true, includeNotes: false });
  expect((await calls(page, "stop_code_run")).length).toBe(1);
  await expect(code.getByTestId("code-run").first()).toContainText("Stopped");
});

test("edit with AI asks to connect an account when no agent is ready", async ({ page }) => {
  await page.goto("/#/projects/p_flo");
  await ready(page);
  await page.evaluate(() => {
    const m = (window as any).__floCodeMock;
    m.folder = "/Users/you/dev/flo";
    m.setAgents(m.agents.map((a: any) => ({ ...a, signedIn: false, account: undefined })));
  });
  const code = page.getByTestId("code-section");
  await code.getByRole("button", { name: "Use an existing folder" }).click();
  await code.getByTestId("repo-card").getByRole("button", { name: "Edit with AI" }).click();
  const inline = page.getByTestId("connect-inline");
  await expect(inline).toBeVisible();
  await expect(inline.getByTestId("agent-card")).toHaveCount(3);
  await inline.locator('[data-agent="claude"]').getByRole("button", { name: "Sign in" }).click();
  expect(await calls(page, "agent_sign_in")).toEqual([{ agent: "claude" }]);
  await page.evaluate(() => (window as any).__floCodeMock.resetAgents());
});

test("settings → integrations shows the three coding agents with their states", async ({ page }) => {
  await page.goto("/#/settings/integrations");
  await ready(page);
  const group = page.getByTestId("coding-agents");
  await expect(group.getByTestId("agent-card")).toHaveCount(3);
  const claude = group.locator('[data-agent="claude"]');
  await expect(claude).toHaveAttribute("data-state", "connected");
  await expect(claude).toContainText("Connected as you@example.com");
  await expect(claude).toContainText("v2.0.14");
  const codex = group.locator('[data-agent="codex"]');
  await expect(codex).toHaveAttribute("data-state", "signed-out");
  await expect(codex.getByRole("button", { name: "Sign in" })).toBeVisible();
  const gemini = group.locator('[data-agent="gemini"]');
  await expect(gemini).toHaveAttribute("data-state", "missing");
  await expect(gemini).toContainText("npm install -g @google/gemini-cli");
  await expect(gemini.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(group).toContainText("Flo never sees or stores your passwords or tokens");

  await codex.getByRole("button", { name: "Sign in" }).click();
  expect(await calls(page, "agent_sign_in")).toEqual([{ agent: "codex" }]);
  await gemini.getByRole("button", { name: "Re-check" }).click();
  await expect.poll(async () => (await calls(page, "coding_agents")).length).toBeGreaterThanOrEqual(2);
});
