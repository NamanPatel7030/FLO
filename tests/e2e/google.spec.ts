import { expect, test, type Page } from "@playwright/test";

// Connect with Google (Settings → Integrations), the notch meeting card, the agenda widget and the
// Gmail reply flow. The mock stands in for the Rust side: google_oauth_start records the URL it would
// open and ~0.7 s later "receives" flo://google; __floMock.meetingAlert() is EV.meetingAlert.
const ISLAND = "/?nh=38&nw=200#/island";
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const opened = (page: Page) => page.evaluate(() => [...(window as any).__floMock.opened] as string[]);
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as any).__floMock.calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const settingsGoogle = async (page: Page) => (await invoke(page, "get_settings")).google;
const connectGoogle = (page: Page) => page.evaluate(() => (window as any).__floMock.connectGoogle());
const fireAlert = (page: Page, o: Record<string, unknown> = {}) => page.evaluate((x) => (window as any).__floMock.meetingAlert(x), o);

async function openIsland(page: Page) {
  await page.goto(ISLAND);
  await mock(page);
  await page.locator("[data-island-root]").waitFor();
  await page.locator('[aria-label="todos"]').waitFor();
  await page.waitForTimeout(150);
}

test("Connect with Google: asks only for what's checked, shows the account, adds Gmail later, then disconnects", async ({ page }) => {
  await page.goto("/#/settings/integrations");
  await mock(page);
  const card = page.getByTestId("google-card");
  await expect(card.getByTestId("google-disconnected")).toBeVisible({ timeout: 20_000 });
  // the official white "Connect with Google" button with the G logo
  const btn = card.getByRole("button", { name: "Connect with Google" });
  await expect(btn).toBeVisible();
  await expect(btn.locator("svg path[fill='#4285F4']")).toHaveCount(1);

  // Calendar only
  await card.getByRole("checkbox", { name: "Gmail" }).uncheck();
  await btn.click();
  await expect.poll(() => opened(page)).toHaveLength(1);
  expect((await opened(page))[0]).toMatch(/\/api\/google\/install\?state=gs_[a-z0-9]+&scopes=calendar$/);
  expect(await calls(page, "google_oauth_start")).toEqual([{ calendar: true, gmail: false }]);

  // the deep link arrives by itself in the mock
  const on = card.getByTestId("google-connected");
  await expect(on).toBeVisible();
  await expect(card.getByTestId("google-email")).toHaveText("you@example.com");
  await expect(page.getByText("Google connected as you@example.com")).toBeVisible(); // toast
  await expect(on.getByRole("checkbox", { name: "Calendar" })).toBeChecked();
  await expect(on.getByRole("checkbox", { name: "Gmail" })).not.toBeChecked();
  await expect(on.getByText("Not allowed yet: checking it asks Google")).toBeVisible();

  // calendar options: lead time, solo events, calendar picker (primary checked by default)
  await on.locator("select").selectOption("2");
  await expect.poll(async () => (await settingsGoogle(page)).alertMinutes).toBe(2);
  await on.getByText("Alert for events without other guests").click();
  await expect.poll(async () => (await settingsGoogle(page)).alertSolo).toBe(true);
  const cals = on.getByTestId("google-calendars");
  await expect(cals.getByRole("checkbox").first()).toBeChecked();
  await cals.getByText("Work").click();
  await expect.poll(async () => (await settingsGoogle(page)).calendars).toEqual(["primary", "work"]);

  // checking Gmail asks Google again for both (incremental consent)
  await on.getByRole("checkbox", { name: "Gmail" }).check();
  await expect.poll(() => calls(page, "google_oauth_start")).toEqual([
    { calendar: true, gmail: false },
    { calendar: true, gmail: true },
  ]);
  await expect(on.getByText("Turn emails that need a reply into to-dos")).toBeVisible();
  await expect(on.getByRole("checkbox", { name: "Gmail" })).toBeChecked();
  await on.getByRole("button", { name: "Check email now" }).click();
  await expect(page.getByText("1 email to-do added")).toBeVisible();

  // Disconnect asks first
  await on.getByRole("button", { name: "Disconnect" }).click();
  const confirm = page.getByTestId("google-disconnect-confirm");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(on).toBeVisible();
  await on.getByRole("button", { name: "Disconnect" }).click();
  await confirm.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByTestId("google-disconnected")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__floMock.googleRevoked())).toBe(1);
});

test("Home shows the next meeting once Google is connected", async ({ page }) => {
  await page.goto("/#/home");
  await mock(page);
  await expect(page.getByText("Try dictation")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("home-next-meeting")).toHaveCount(0);
  await connectGoogle(page);
  await expect(page.getByTestId("home-next-meeting")).toContainText(/Next: Design sync in \d+ min/);
  await expect(page.getByRole("button", { name: "Join Meet" })).toBeVisible();
});

test("agenda widget: asks to connect, then lists today's meetings with the next one and Join chips", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flo.widgets", JSON.stringify(["agenda", "timer"])));
  await openIsland(page);
  await page.evaluate(() => (window as any).__floOpenWidgets());
  const w = page.getByTestId("agenda-widget");
  await expect(w).toBeVisible();
  await expect(w).toContainText("Today's agenda");
  await expect(w.getByRole("button", { name: "Connect Google in Settings" })).toBeVisible();

  await connectGoogle(page);
  await expect(w.getByTestId("agenda-next")).toHaveText(/Next: Design sync in \d+ min/);
  const rows = w.getByTestId("agenda-row");
  await expect(rows.filter({ hasText: "Design sync" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Design sync" }).getByRole("button", { name: "Join Meet" })).toBeVisible();
  await expect(rows.filter({ hasText: "Offsite prep" })).toContainText("All day");
  // declined meetings stay out
  await expect(rows.filter({ hasText: "Vendor pitch" })).toHaveCount(0);
});

test("meeting alert: countdown, guests, Join opens the link, Take notes starts recording, dismiss closes it", async ({ page }) => {
  await openIsland(page);
  await connectGoogle(page);

  // Join
  await fireAlert(page);
  const card = page.getByTestId("meeting-alert-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("meeting-alert-title")).toHaveText("Design sync");
  await expect(card.getByTestId("meeting-alert-when")).toHaveText("· in 5 min");
  await expect(card.getByTestId("meeting-alert-guests")).toHaveText("3 guests · Priya, Rahul and Sam");
  await card.getByRole("button", { name: "Join Meet" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => opened(page)).toContain("https://meet.google.com/abc-defg-hij");

  // the countdown ticks every second near the start, and the same id re-sent with phase "now" updates the card
  const a = await fireAlert(page, { inMinutes: 0.5 });
  const when = card.getByTestId("meeting-alert-when");
  await expect(when).toHaveText(/in \d+ sec/);
  const first = await when.textContent();
  await expect.poll(() => when.textContent(), { timeout: 4000 }).not.toBe(first);
  await page.evaluate((x) => (window as any).__floMock.emit("flo://meeting-alert", { ...x, phase: "now" }), a);
  await expect(when).toHaveText("· Starting now");
  await expect(card).toHaveCount(1);
  // dismiss
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toHaveCount(0);
  expect((await calls(page, "google_meeting_action")).map((c: any) => c.action)).toEqual(["join", "dismiss"]);

  // no join link → no Join button; Take notes starts notes titled after the event
  await fireAlert(page, { joinUrl: undefined, joinKind: undefined });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /^Join/ })).toHaveCount(0);
  await card.getByRole("button", { name: "Take notes" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await invoke(page, "list_notes"))[0]).toMatchObject({ title: "Design sync", live: true });
  const note = (await invoke(page, "list_notes"))[0];
  expect((await invoke(page, "meeting_info", { noteId: note.id })).attendees).toEqual(["Priya Shah", "Rahul Mehta", "Sam Lee"]);
  // the notch shows the live meeting
  await expect.poll(async () => (await page.locator("[data-island-root]").boundingBox())!.width).toBeGreaterThan(200);
  await invoke(page, "stop_meeting");
});

test("meeting alert-done from the backend closes the card", async ({ page }) => {
  await openIsland(page);
  const a = await fireAlert(page);
  await expect(page.getByTestId("meeting-alert-card")).toBeVisible();
  await page.evaluate((id) => (window as any).__floMock.emit("flo://meeting-alert-done", { id }), a.id);
  await expect(page.getByTestId("meeting-alert-card")).toHaveCount(0);
});

test("Gmail: reply by voice, confirm in the notch, the answer card says it was sent", async ({ page }) => {
  await openIsland(page);
  await connectGoogle(page);
  const r = await invoke(page, "ask_assistant", { text: "reply to the last email from Rahul saying I'll send it tonight" });
  expect(r.actions[0]).toMatchObject({ type: "gmail_send", to: "Rahul Mehta", text: "I'll send it tonight" });
  expect(r.results).toEqual(["Waiting for you to confirm the email to Rahul Mehta"]);

  const confirm = page.getByTestId("confirm-card");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Send to Rahul Mehta by email?");
  await expect(confirm).toContainText("I'll send it tonight");
  await expect(confirm.getByTestId("confirm-gmail-icon")).toBeVisible();
  await confirm.getByRole("button", { name: "Send" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Sent to Rahul Mehta")).toBeVisible();
  await expect(page.getByText(/Waiting for you to confirm/)).toHaveCount(0);
});

test("Gmail: asking about email reads the inbox", async ({ page }) => {
  await openIsland(page);
  const off = await invoke(page, "ask_assistant", { text: "check my email" });
  expect(off.reply).toContain("Connect Google in Settings");
  await connectGoogle(page);
  const r = await invoke(page, "ask_assistant", { text: "check my email" });
  expect(r.reply).toContain("Rahul Mehta: Invoice for October");
});
