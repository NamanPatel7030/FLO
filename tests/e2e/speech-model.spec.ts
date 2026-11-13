import { expect, test, type Page } from "@playwright/test";

// The speech model: setup downloads a small one first and keeps the try-out locked until it's
// downloaded and loaded; bigger, more precise models are an opt-in in Settings → Voice.
// ?dl=hold pauses mock downloads at 50% until __floMock.releaseDownloads(); ?dl=fail cuts the
// first one off at 40%.

const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const step = (page: Page, s: string) => expect(page.locator('[data-testid="onboarding"]')).toHaveAttribute("data-step", s);

test("setup downloads the small model first and the try-out stays locked until it's loaded", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1&dl=hold#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  const btn = (name: string) => ob.getByRole("button", { name, exact: true });

  // the download starts the moment setup opens, and step 2 shows it
  await expect.poll(async () => (await calls(page, "download_model")).map((a: any) => a.id)).toEqual(["small-q5_1"]);
  await btn("Let's begin").click();
  await step(page, "model");
  await expect(ob.getByText("Whisper Small (starter)")).toBeVisible();
  await expect(ob.getByText(/190 MB/).first()).toBeVisible();
  const bar = ob.getByRole("progressbar", { name: "Speech model download" });
  await expect(bar).toBeVisible();
  await expect(ob.getByTestId("model-progress")).toHaveText(/^\d+ of 190 MB · \d+\.\d MB\/s$/);
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await expect(page.getByText(/[—–]/)).toHaveCount(0);

  // you can move on while it downloads, but the try-out is locked
  await btn("Continue while it downloads").click();
  await step(page, "permissions");
  await btn("Continue").click(); // both already allowed in the mock
  await step(page, "try");
  const demo = ob.getByTestId("demo");
  await expect(demo).toHaveAttribute("data-locked", "true");
  await expect(ob.getByTestId("try-locked")).toContainText("still downloading");
  await expect(ob.getByTestId("try-locked").getByTestId("model-progress")).toHaveText(/of 190 MB/);
  await expect(ob.getByTestId("try-mic")).toBeDisabled();
  await ob.getByTestId("try-mic").dispatchEvent("pointerdown");
  await ob.getByTestId("try-mic").dispatchEvent("pointerup");
  expect(await calls(page, "start_session")).toEqual([]);
  expect(await calls(page, "load_speech_model")).toEqual([]);

  // the download finishes, the model is loaded, and only then the demo unlocks
  await page.evaluate(() => (window as any).__floMock.releaseDownloads());
  await expect(demo).toHaveAttribute("data-locked", "false", { timeout: 10_000 });
  await expect(ob.getByTestId("try-locked")).toHaveCount(0);
  expect(await calls(page, "load_speech_model")).toEqual([{ id: "small-q5_1" }]);
  expect((await invoke(page, "get_settings")).sttModel).toBe("small-q5_1");
  // setup's starter isn't the user's pick: Flo may move it to the more accurate model later
  expect((await invoke(page, "get_settings")).sttModelExplicit).toBeFalsy();

  // and the demo really transcribes
  const mic = ob.getByTestId("try-mic");
  await expect(mic).toBeEnabled();
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(mic).toHaveAttribute("data-live", "true");
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(ob.getByLabel("Demo text box")).toHaveValue("Hey team, the build is ready for review.");
  await expect(ob.getByTestId("demo-success")).toBeVisible();

  // back on step 2 it says ready and offline
  await ob.getByRole("button", { name: "Speech model", exact: true }).click();
  await step(page, "model");
  await expect(ob.getByTestId("model-progress")).toHaveText("Ready. I work offline from now on.");
  await expect(btn("Continue")).toBeVisible();
});

test("a failed download says so and Try again resumes it", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1&dl=fail#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await step(page, "model");
  await expect(ob.getByTestId("model-error")).toContainText("download stopped early", { timeout: 10_000 });
  // the bar keeps where it got to
  await expect.poll(async () => Number(await ob.getByRole("progressbar", { name: "Speech model download" }).getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(40);
  await ob.getByRole("button", { name: "Try again" }).click();
  await expect(ob.getByTestId("model-progress")).toHaveText("Ready. I work offline from now on.", { timeout: 10_000 });
  expect((await calls(page, "download_model")).length).toBe(2);
  await expect(ob.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
});

test("the end of setup offers a more precise model, optional", async ({ page }) => {
  await page.goto("/?signedin=1&onboard=1#/home");
  await mock(page);
  const ob = page.locator('[data-testid="onboarding"]');
  // let the starter finish, then walk to the last step
  await ob.getByRole("button", { name: "Let's begin" }).click();
  await step(page, "model");
  await expect(ob.getByRole("button", { name: "Continue", exact: true })).toBeVisible({ timeout: 10_000 });
  await ob.getByRole("button", { name: "Continue", exact: true }).click();
  await step(page, "permissions");
  await ob.getByRole("button", { name: "Continue", exact: true }).click();
  await step(page, "try");
  await ob.getByRole("button", { name: "I'll try it later" }).click();
  await step(page, "setup");
  await ob.getByRole("button", { name: "Continue", exact: true }).click();
  await step(page, "role");
  await ob.getByRole("radio", { name: "I build software" }).click();
  await step(page, "uses");
  await ob.getByRole("button", { name: "Continue", exact: true }).click();
  await step(page, "done");
  const card = ob.getByTestId("advanced-card");
  await expect(card).toContainText("Want more precision? Whisper Large v3 Turbo");
  await expect(card).toContainText("574 MB");
  await card.getByRole("button", { name: "Download" }).click();
  await expect(card.getByTestId("advanced-progress")).toHaveText(/of 574 MB/);
  await card.getByRole("button", { name: "Use this model" }).click({ timeout: 10_000 });
  await expect(card).toContainText("In use");
  expect((await invoke(page, "get_settings")).sttModel).toBe("large-v3-turbo-q5_0");
  expect((await invoke(page, "get_settings")).sttModelExplicit).toBe(true);
});

test("Settings → Voice: advanced models download with progress, switch without a restart, and delete", async ({ page }) => {
  await page.goto("/#/settings/voice");
  await mock(page);
  const starter = page.locator('[data-testid="model-row"][data-model="small-q5_1"]');
  await expect(starter).toContainText("Whisper Small (starter)");
  await expect(starter).toContainText("In use");
  await expect(starter).toContainText("190 MB");

  const adv = page.getByTestId("advanced-models");
  await expect(adv.getByTestId("model-row")).toHaveCount(2);
  // smallest first, each with size, speed and accuracy
  await expect(adv.getByTestId("model-row").first()).toHaveAttribute("data-model", "large-v3-turbo-q5_0");
  const turbo = adv.locator('[data-model="large-v3-turbo-q5_0"]');
  await expect(turbo).toContainText("574 MB · A little slower · Much better with accents, Hindi and names");
  await expect(page.getByText(/[—–]/)).toHaveCount(0);

  await turbo.getByRole("button", { name: "Download" }).click();
  await expect(turbo.getByRole("progressbar")).toBeVisible();
  await expect(turbo.getByTestId("model-row-progress")).toHaveText(/^\d+ of 574 MB/);
  const use = turbo.getByRole("button", { name: "Use this model" });
  await expect(use).toBeVisible({ timeout: 10_000 });
  await use.click();
  await expect(turbo).toContainText("In use");
  await expect.poll(async () => (await invoke(page, "get_settings")).sttModel).toBe("large-v3-turbo-q5_0");
  // a model picked in Settings stays: Flo never swaps it by itself
  expect((await invoke(page, "get_settings")).sttModelExplicit).toBe(true);
  // the new model is loaded right away, so the next dictation uses it (no restart)
  await expect.poll(async () => (await calls(page, "load_speech_model")).at(-1)).toEqual({ id: "large-v3-turbo-q5_0" });

  // the starter is now unused: it can be deleted, and then downloaded again
  await starter.getByRole("button", { name: "Delete Whisper Small (starter)" }).click();
  await expect(starter.getByRole("button", { name: "Download" })).toBeVisible();
  // the model in use can't be deleted
  await expect(turbo.getByRole("button", { name: /Delete/ })).toHaveCount(0);
});
