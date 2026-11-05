import { expect, test, type Page } from "@playwright/test";

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
/** page.clock.install() keeps time flowing; pause it so the mock meeting timer can't race the test. */
const freeze = (page: Page) => page.clock.pauseAt(new Date(Date.now() + 2000));
const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as any).__floMock.emit(e, p), [event, payload] as const);

test("context library: upload a .md, pin it, and the system prompt autosaves", async ({ page }) => {
  await page.goto("/#/context");
  await mock(page);
  await expect(page.locator('[data-testid="context-doc"]')).toHaveCount(2); // sample docs
  await page.setInputFiles('[data-testid="context-file-input"]', {
    name: "clients.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Clients\nNorthwind: dashboard redesign. Contact Priya for invoices."),
  });
  const doc = page.locator('[data-testid="context-doc"]').filter({ has: page.locator('input[value="clients"]') });
  await expect(doc).toBeVisible();
  await doc.getByRole("switch", { name: "Pin" }).click();
  await expect.poll(async () => (await invoke(page, "list_context_docs")).find((d: any) => d.title === "clients")?.pinned).toBe(true);

  const prompt = page.getByLabel("System prompt");
  await prompt.fill("I'm Naman. Reply briefly and warmly.");
  await expect.poll(async () => (await invoke(page, "get_settings")).systemPrompt, { timeout: 4000 }).toBe("I'm Naman. Reply briefly and warmly.");
});

test("about: maker card with name and site link", async ({ page }) => {
  await page.goto("/#/settings/about");
  await mock(page);
  await expect(page.getByText("Naman Gundaniya")).toBeVisible();
  await expect(page.getByRole("button", { name: "hellonaman.com" })).toBeVisible();
  await expect(page.getByText("I'm the human. AI is my leverage. Together, we build anything.")).toBeVisible();
  await expect(page.getByText("Forward Deployed Engineer", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Naman Gundaniya" })).toBeVisible();
  await expect(page.getByText(/CTO|Avenuor/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Crafted by Naman Gundaniya" })).toBeVisible();
});

test("live meeting: partial line grows, then the committed segment replaces it", async ({ page }) => {
  await page.clock.install(); // freeze the mock's own meeting timer
  await page.goto("/#/notes");
  await mock(page);
  await freeze(page);
  const note = await invoke(page, "start_meeting", { title: "Design sync" });
  await page.goto(`/#/notes/${note.id}`);
  const live = page.locator('[data-testid="live-line"]');
  await expect(live).toBeVisible();
  for (const p of ["Let's", "Let's kick off", "Let's kick off the launch"]) {
    await emit(page, "flo://meeting", { noteId: note.id, partial: p, elapsedSec: 3, live: true });
    await expect(live).toContainText(p);
  }
  await emit(page, "flo://meeting", { noteId: note.id, segment: { t: 3, text: "Let's kick off the launch checklist." }, partial: "", elapsedSec: 4, live: true });
  await expect(page.locator('[data-testid="live-transcript"]')).toContainText("Let's kick off the launch checklist.");
  await expect(live).not.toContainText("Let's kick off the launch");
});

test("meeting stop: late live:true events never bring the notch pill back", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator('[aria-label="todos"]').waitFor();
  await freeze(page);
  const note = await invoke(page, "start_meeting", { title: "Standup" });
  await emit(page, "flo://meeting", { noteId: note.id, partial: "morning everyone", elapsedSec: 2, live: true });
  await page.clock.runFor(800);
  const pill = page.locator('[data-testid="island-live-line"]');
  await expect(pill).toBeVisible();
  // open the expanded view and stop
  await pill.click();
  await page.clock.runFor(800);
  await page.getByRole("button", { name: "Stop meeting" }).click();
  await page.clock.runFor(800);
  await expect(pill).toHaveCount(0);
  // a late final sentence arrives with live:true for the same note
  await emit(page, "flo://meeting", { noteId: note.id, segment: { t: 9, text: "and that's a wrap" }, elapsedSec: 9, live: true });
  await emit(page, "flo://state", { phase: "listening", mode: "meeting" });
  await page.clock.runFor(1200);
  await expect(pill).toHaveCount(0);
});

test("notes: Stop switches to Summarizing and ignores late events", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#/notes");
  await mock(page);
  await freeze(page);
  const note = await invoke(page, "start_meeting", { title: "Retro" });
  await page.goto(`/#/notes/${note.id}`);
  await expect(page.locator('[data-testid="live-line"]')).toBeVisible();
  await page.getByRole("button", { name: /stop & summarize/i }).click();
  // late event for the stopped note
  await emit(page, "flo://meeting", { noteId: note.id, partial: "one more thing", elapsedSec: 12, live: true });
  await page.clock.runFor(500);
  await expect(page.getByText("one more thing")).toHaveCount(0);
  const n = (await invoke(page, "list_notes")).find((x: any) => x.id === note.id);
  expect(n.live).toBe(false);
});

const wordsOnScreen = (page: Page) => page.locator("[data-word]").evaluateAll((els) => els.map((e) => e.textContent ?? ""));

test("typing test: one wrong letter only marks that word", async ({ page }) => {
  await page.goto("/#/typing");
  await mock(page);
  await page.locator("[data-word]").first().waitFor();
  const [w0, w1, w2] = await wordsOnScreen(page);
  const wrong = w0.slice(0, -1) + (w0.endsWith("x") ? "y" : "x");
  await page.keyboard.type(`${wrong} ${w1} ${w2} `);
  await expect(page.locator('[data-word="0"]')).toHaveAttribute("data-state", "wrong");
  await expect(page.locator('[data-word="1"]')).toHaveAttribute("data-state", "correct");
  await expect(page.locator('[data-word="2"]')).toHaveAttribute("data-state", "correct");
  await expect(page.locator('[data-word="3"]')).toHaveAttribute("data-state", "current");
  // the passage box shows whole lines only (3 × line height)
  const h = await page.locator('[data-testid="typing-passage"]').evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBe(126);
});

test("typing test: 1 minute, finish, apply speed to settings", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#/typing");
  await mock(page);
  await page.clock.pauseAt(new Date(Date.now() + 2000));
  await page.getByRole("button", { name: "1 min" }).click();
  await page.locator("[data-word]").first().waitFor();
  const words = (await wordsOnScreen(page)).slice(0, 30);
  await page.keyboard.type(words.join(" ") + " ");
  await page.clock.runFor(61_000);
  const result = page.locator('[data-testid="typing-result"]');
  await expect(result).toBeVisible();
  const wpm = Number(await result.getAttribute("data-wpm"));
  expect(wpm).toBeGreaterThan(20); // 30 correct words in one minute
  await page.getByRole("button", { name: "Use this speed" }).click();
  await expect.poll(async () => (await invoke(page, "get_settings")).typingWpm).toBe(wpm);
  await expect(page.getByText(/Typing speed updated/)).toBeVisible();
});

test("confirm card: Slack message waits for Send (never auto-sends)", async ({ page }) => {
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator('[aria-label="todos"]').waitFor();
  const c = await page.evaluate(() => (window as any).__floMock.confirm("Send to Rahul on Slack?", "Hey Rahul, deck is in the drive."));
  const card = page.locator('[data-testid="confirm-card"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Send to Rahul on Slack?");
  await expect(card).toContainText("Hey Rahul, deck is in the drive.");
  expect(await page.evaluate(() => (window as any).__floMock.confirms.length)).toBe(0); // nothing sent yet
  await card.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floMock.confirms)).toEqual([{ id: c.id, approve: true }]);
  await expect(card).toHaveCount(0);
  // a second one can be cancelled
  const c2 = await page.evaluate(() => (window as any).__floMock.confirm());
  await page.locator('[data-testid="confirm-card"]').getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floMock.confirms.at(-1))).toEqual({ id: c2.id, approve: false });
});

test("AI settings: new providers, key only for key providers, searchable model picker with Custom", async ({ page }) => {
  await page.goto("/#/settings/ai");
  await mock(page);
  const provider = page.locator("select").first();
  for (const label of ["MiniMax", "Qwen (Alibaba DashScope)", "Ollama Cloud", "Ollama (local)"])
    await expect(provider.locator("option", { hasText: label })).toHaveCount(1);
  // local Ollama: no key field, pulled models listed
  await expect(page.getByLabel(/API key/)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Model" }).click();
  await expect(page.getByRole("option", { name: "gemma3:4b" })).toBeVisible();
  await expect(page.getByRole("listbox").getByRole("option", { selected: true })).toHaveText(/qwen3:8b/);
  await page.keyboard.press("Escape");
  // Qwen: key field + Get key + its models
  await provider.selectOption("qwen");
  await expect(page.getByLabel("Qwen (Alibaba DashScope) API key")).toBeVisible();
  await expect(page.getByRole("button", { name: /Get key/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByLabel("Search models").fill("max");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["qwen-max", "Custom…"]);
  await page.getByRole("option", { name: "qwen-max" }).click();
  await expect.poll(async () => (await invoke(page, "get_settings")).llmModel).toBe("qwen-max");
  // Custom… free text
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByRole("option", { name: /Custom/ }).click();
  await page.getByLabel("Custom model").fill("qwen3-max-preview");
  await expect.poll(async () => (await invoke(page, "get_settings")).llmModel).toBe("qwen3-max-preview");
  await expect(page.getByRole("button", { name: "Test" })).toBeVisible();
});

test("AI settings: local Ollama with nothing pulled shows the install hint", async ({ page }) => {
  await page.goto("/?ollama=none#/settings/ai");
  await mock(page);
  const hint = page.locator('[data-testid="ollama-install"]');
  await expect(hint).toContainText("ollama pull qwen3:8b");
  await expect(hint.getByRole("button", { name: "Copy command" })).toBeVisible();
});

test("setup wizard: first run walks every step, finishes, and can be reopened", async ({ page }) => {
  await page.goto("/?onboard=1#/home");
  await mock(page);
  const wiz = page.locator('[data-testid="onboarding"]');
  await expect(wiz).toBeVisible();
  await expect(wiz.getByText("Your Assistant")).toBeVisible();
  await wiz.getByRole("button", { name: "Get started" }).click();
  await expect(wiz.locator('[data-testid="perm-row"]')).toHaveCount(4);
  await wiz.getByRole("button", { name: "Continue" }).click();
  // voice: download the recommended model with progress
  const voice = wiz.locator('[data-testid="voice-model"]');
  await expect(voice).toBeVisible();
  const dl = voice.getByRole("button", { name: "Download" });
  if (await dl.count()) {
    await dl.click();
    await expect(voice.getByText("Ready")).toBeVisible({ timeout: 8000 });
  }
  await wiz.getByRole("button", { name: "Continue" }).click();
  // AI: provider + model picker
  await expect(wiz.getByRole("combobox", { name: "Model" })).toBeVisible();
  await wiz.getByRole("button", { name: "Continue" }).click();
  // shortcuts: live try-it reacts to real events
  await expect(wiz.getByText(/waiting for your voice/)).toBeVisible();
  await emit(page, "flo://state", { phase: "listening", mode: "dictation" });
  await expect(wiz.locator('[data-testid="try-ribbon"] canvas')).toBeVisible();
  await emit(page, "flo://transcript", { text: "hello", final: true });
  await expect(wiz.locator('[data-testid="try-heard"]')).toContainText("hello");
  await wiz.getByRole("button", { name: "Continue" }).click();
  await expect(wiz.getByText("You're all set")).toBeVisible();
  await wiz.getByRole("button", { name: "Start using Flo" }).click();
  await expect(wiz).toHaveCount(0);
  await expect.poll(async () => (await invoke(page, "get_settings")).onboarded).toBe(true);
  // reopen from Settings → General
  await page.goto("/#/settings/general");
  await page.getByRole("button", { name: "Run setup again" }).click();
  await expect(page.locator('[data-testid="onboarding"]')).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
});

test("integrations: 4 agent cards, webhook token hidden, Slack connect flow", async ({ page }) => {
  await page.goto("/#/settings/integrations");
  await mock(page);
  await expect(page.locator('[data-testid="integration-card"]')).toHaveCount(4);
  await expect(page.getByText("Not found on this Mac")).toBeVisible();
  await expect(page.getByText(/token=•••/)).toBeVisible();
  await expect(page.getByText(/token=TOKEN/)).toHaveCount(0);
  await page.getByLabel("Slack token").fill("xoxp-123-abc");
  await page.getByRole("button", { name: "Connect" }).last().click();
  await expect(page.locator('[data-testid="slack-connected"]')).toContainText("Parth Gundaniya · Northwind");
  await page.getByText("Turn unanswered DMs and mentions into to-dos").click();
  await expect.poll(async () => (await invoke(page, "get_settings")).slackSync).toBe(true);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("3 to-dos added")).toBeVisible();
});

const followups = (page: Page) =>
  page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "assistant_followup").map((c: any) => c.args.mode));

test("notch assistant card: Go deeper / Search the web call assistant_followup; long answers fade + Open full answer", async ({ page }) => {
  await page.goto("/?nh=38&nw=200#/island");
  await mock(page);
  await page.locator('[aria-label="todos"]').waitFor();
  const id = (await invoke(page, "list_assistant"))[0].id;
  await emit(page, "flo://assistant", (await invoke(page, "list_assistant"))[0]);
  await expect(page.getByRole("button", { name: "Go deeper" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search the web" })).toBeVisible();
  await page.getByRole("button", { name: "Go deeper" }).click();
  await expect(page.locator('[data-testid="card-thinking"]')).toBeVisible();
  // the deep answer replaces the card; it is long → fade + labelled Open full answer
  await expect(page.locator('[data-testid="card-reply"]')).toContainText("Deeper look");
  await expect(page.getByRole("button", { name: "Open full answer" })).toContainText("Open full answer");
  await page.getByRole("button", { name: "Search the web" }).click();
  await expect(page.getByText("3 sources")).toBeVisible();
  expect(await followups(page)).toEqual(["deep", "web"]);
  const first = (await page.evaluate(() => (window as any).__floMock.calls.find((c: any) => c.cmd === "assistant_followup"))).args.id;
  expect(first).toBe(id);
  await page.getByRole("button", { name: "Open full answer" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__floMock.calls.filter((c: any) => c.cmd === "open_dashboard").map((c: any) => c.args.route))).toContainEqual(expect.stringMatching(/^assistant\//));
});

test("assistant page: markdown replies, sources, mode badge, follow-ups and the Quick/Deep/Web switch", async ({ page }) => {
  await page.goto("/#/assistant");
  await mock(page);
  await expect(page.locator('[data-testid="answer"]').first()).toBeVisible();
  // Web mode from the input switch
  await page.getByRole("radio", { name: /Web/ }).click();
  await expect(page.getByRole("radio", { name: /Web/ })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Ask Flo").fill("How do notch apps avoid stealing focus?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const last = page.locator('[data-testid="answer"]').last();
  await expect(last.locator('[data-testid="mode-badge"]')).toHaveText(/Web/);
  await expect(last.locator("h4")).toHaveText("What I found");
  await expect(last.locator("li")).toHaveCount(3);
  await expect(last.locator("strong").first()).toHaveText("Tauri 2");
  await expect(last.locator("code").first()).toHaveText("NSPanel");
  await expect(last.getByRole("link", { name: "Tauri docs" })).toHaveAttribute("href", "https://v2.tauri.app/plugin/global-shortcut/");
  await expect(last.locator('[data-testid="source-chip"]')).toHaveCount(3);
  await expect(last.locator('[data-testid="source-chip"]').first()).toContainText("v2.tauri.app");
  // per-answer Go deeper → deep answer with a code block + copy
  await last.getByRole("button", { name: "Go deeper" }).click();
  const deep = page.locator('[data-testid="answer"]').last();
  await expect(deep.locator('[data-testid="mode-badge"]')).toHaveText(/Deep/);
  await expect(deep.locator('[data-testid="md-code"]')).toContainText("backendHover.current");
  await expect(deep.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(deep.locator("ol li")).toHaveCount(3);
  expect(await followups(page)).toEqual(["deep"]);
  const ask = await page.evaluate(() => (window as any).__floMock.calls.find((c: any) => c.cmd === "ask_assistant"));
  expect(ask.args.mode).toBe("web");
  // nothing renders as raw markup
  await expect(page.getByText("**")).toHaveCount(0);
});
