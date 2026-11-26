import { expect, test, type Page } from "@playwright/test";

// Fathom-like automatic notes on Home: today's Google Calendar meetings with Join, guests and a
// per-meeting "Take notes" switch; turning automatic notes on asks for consent once; a joined call
// (the mock's stand-in for meeting_detect's signal) starts notes titled after the event and linked
// under it; the call ending stops them and the note opens from the agenda with structured notes.
const mock = (page: Page) => page.waitForFunction(() => !!(window as any).__floMock);
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => (window as any).__floMock.invoke(c, a), [cmd, args] as const);
const connectGoogle = (page: Page) => page.evaluate(() => (window as any).__floMock.connectGoogle());
const callJoined = (page: Page) => page.evaluate(() => (window as any).__floMock.callJoined());
const callEnded = (page: Page) => page.evaluate(() => (window as any).__floMock.callEnded());
const google = async (page: Page) => (await invoke(page, "get_settings")).google;

async function home(page: Page) {
  await page.goto("/#/home");
  await mock(page);
  await expect(page.getByText("Try dictation")).toBeVisible({ timeout: 20_000 });
}

test("Today's meetings: only real meetings, with Join, guests and Take notes defaults", async ({ page }) => {
  await home(page);
  await expect(page.getByTestId("today-meetings")).toHaveCount(0); // not connected: no card
  await connectGoogle(page);
  const card = page.getByTestId("today-meetings");
  await expect(card).toBeVisible();
  const rows = page.getByTestId("today-row");
  // all-day "Offsite prep", declined "Vendor pitch" and tomorrow's "Client review" stay out
  await expect(page.getByTestId("today-title")).toHaveText(["Weekly product sync", "Design sync", "1:1 with Priya"]);
  const design = rows.filter({ hasText: "Design sync" });
  await expect(design.getByTestId("today-guests")).toHaveText("Priya, Rahul and Sam");
  await expect(design.getByRole("button", { name: "Join Meet" })).toBeVisible();
  // Meet / Zoom meetings default to notes on
  await expect(design.getByTestId("take-notes-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(rows.filter({ hasText: "1:1 with Priya" }).getByTestId("take-notes-toggle")).toHaveAttribute("aria-checked", "true");
  // the ended morning sync has its notes linked, and no switch
  const sync = rows.filter({ hasText: "Weekly product sync" });
  await expect(sync).toHaveAttribute("data-status", "done");
  await expect(sync.getByTestId("take-notes-toggle")).toHaveCount(0);
  await expect(sync.getByRole("button", { name: "Open notes for Weekly product sync" })).toBeVisible();
  await expect(card).toContainText("notes on for 2");

  // per-meeting choice
  await rows.filter({ hasText: "1:1 with Priya" }).getByTestId("take-notes-toggle").click();
  await expect(rows.filter({ hasText: "1:1 with Priya" }).getByTestId("take-notes-toggle")).toHaveAttribute("aria-checked", "false");
  await expect(card).toContainText("notes on for 1");
  const prefs = await invoke(page, "calendar_agenda");
  expect(prefs.find((i: any) => i.id === "ev_priya").takeNotes).toBe(false);

  // morning brief switch is a setting (default on)
  await expect(page.getByTestId("morning-brief-toggle")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("morning-brief-toggle").click();
  await expect.poll(async () => (await google(page)).morningBrief).toBe(false);
});

test("automatic notes: consent once, no call → no recording, joined call → notes linked to the event, call ends → stops", async ({ page }) => {
  await home(page);
  await connectGoogle(page);
  // off by default: a joined call records nothing
  expect(await callJoined(page)).toBeNull();
  expect((await invoke(page, "list_notes")).some((n: any) => n.live)).toBe(false);

  // turning it on explains what is recorded; "Not now" leaves it off
  await expect(page.getByTestId("autonotes-banner")).toBeVisible();
  await page.getByTestId("autonotes-toggle").click();
  const consent = page.getByTestId("autonotes-consent");
  await expect(consent).toBeVisible();
  await expect(consent).toContainText("your microphone and the call's audio");
  await expect(consent).toContainText("Tell the people in the meeting");
  await consent.getByRole("button", { name: "Not now" }).click();
  await expect(consent).toHaveCount(0);
  expect((await google(page)).autoNotes).toBe(false);
  await page.getByTestId("autonotes-toggle").click();
  await consent.getByRole("button", { name: "Turn on automatic notes" }).click();
  await expect.poll(async () => (await google(page)).autoNotes).toBe(true);
  expect((await google(page)).autoNotesConsent).toBe(true);
  await expect(page.getByTestId("autonotes-banner")).toHaveCount(0);
  // the second time, no dialog
  await page.getByTestId("autonotes-toggle").click();
  await expect.poll(async () => (await google(page)).autoNotes).toBe(false);
  await page.getByTestId("autonotes-toggle").click();
  await expect(consent).toHaveCount(0);
  await expect.poll(async () => (await google(page)).autoNotes).toBe(true);

  // the meeting app joins the Design sync call → notes start, titled and linked, with its guests
  const note = await callJoined(page);
  expect(note).toMatchObject({ title: "Design sync", live: true });
  await expect(page.getByText("Taking notes: Design sync")).toBeVisible();
  const design = page.getByTestId("today-row").filter({ hasText: "Design sync" });
  await expect(design).toHaveAttribute("data-status", "recording");
  await expect(design).toContainText("Taking notes");
  const info = await invoke(page, "meeting_info", { noteId: note.id });
  expect(info.attendees).toEqual(["Priya Shah", "Rahul Mehta", "Sam Lee"]);
  expect(info.event).toMatchObject({ eventId: "ev_design", title: "Design sync", auto: true });

  // the call ends → recording stops, "Notes ready", the note stays under the event
  await callEnded(page);
  await expect(page.getByText(/Notes ready: Design sync/)).toBeVisible();
  await expect(design).not.toHaveAttribute("data-status", "recording");
  await design.getByRole("button", { name: "Open notes for Design sync" }).click();
  await expect(page.getByTestId("note-event")).toContainText("Taken automatically in Design sync");
});

test("meeting notes: structured sections, timestamps jump to the transcript, follow-up is a draft", async ({ page }) => {
  await home(page);
  await connectGoogle(page);
  await page.getByTestId("today-row").filter({ hasText: "Weekly product sync" }).getByRole("button", { name: "Open notes for Weekly product sync" }).click();
  await expect(page.getByTestId("structured-notes")).toBeVisible();
  await expect(page.getByTestId("notes-section")).toHaveText(["Overview", "Key points", "Decisions", "Questions and follow-ups"]);
  await expect(page.getByTestId("structured-notes")).toContainText("Priya Shah");
  await expect(page.getByTestId("note-event")).toContainText("with Priya Shah, Rahul Mehta");
  // [02:14] scrolls to Priya's line
  await page.getByTestId("summary-ts").first().click();
  await expect(page.locator('[data-testid="transcript-row"][data-t="134"]')).toHaveAttribute("data-flash", "1");
  // follow-up email: drafted to the guests, never sent
  await page.getByRole("button", { name: "Draft follow-up email" }).click();
  const d = page.getByTestId("followup-draft");
  await expect(d).toContainText("not sent");
  await expect(d).toContainText("To: priya@example.com, rahul@example.com");
  await expect(d.getByLabel("Follow-up email")).toHaveValue(/I'll send the onboarding numbers/);
  // the browser preview opens links with window.open: capture it instead of leaving the page
  await page.evaluate(() => {
    (window as any).open = (u: string) => {
      (window as any).__lastOpen = u;
      return null;
    };
  });
  await d.getByRole("button", { name: "Open in Gmail" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__lastOpen ?? "")).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
});
