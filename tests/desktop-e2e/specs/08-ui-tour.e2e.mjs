// Screenshot tour of the real app (light + dark): sign-in, every setup step, every dashboard page and
// Settings tab, the Notes list + a seeded meeting note (speakers, Hindi/Hinglish, long names, summary,
// action items with owners), and the pill in each state. Not a behaviour test: it saves what a user
// sees under artifacts/08-ui-tour/ for review, and only fails when a screen can't be reached.
//   SPEC=specs/08-ui-tour.e2e.mjs tests/desktop-e2e/docker/run.sh
import { clickButton, invoke, os, ready, screen, shot, signInQuick, sleep, toIsland, toMain, waitFor, win } from "../support/app.mjs";

const PAGES = ["home", "agent", "assistant", "skills", "todos", "projects", "notes", "analytics", "history"];
const TABS = ["General", "Appearance", "Shortcuts", "Voice", "AI", "Privacy", "Permissions", "Dictionary", "Integrations", "About"];
const step = () => $("[data-testid=onboarding]").getAttribute("data-step");
const emit = (event, payload) => invoke("plugin:event|emit", { event, payload });
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const MEETING = {
  id: "tour-meeting",
  title: "Apollo launch sync with Northwind and the platform team",
  kind: "meeting",
  transcript: [
    { t: 4, text: "Okay, let's start with the dashboard cards and the launch checklist.", speaker: "You" },
    { t: 12, text: "हाँ, नए कार्ड्स काफ़ी साफ़ दिख रहे हैं, बस dark mode में contrast check करना है।", speaker: "Rahul" },
    { t: 31, text: "I like the frosted look, it feels much lighter than the old one.", speaker: "Speaker 1" },
    { t: 47, text: "Haan theek hai, main kal tak component library final kar dungi.", speaker: "Anastasia Konstantinopoulou-Whitfield" },
    { t: 88, text: "Ana, can you own the component library?", speaker: "You" },
    { t: 95, text: "Yes, I can have it by Monday.", speaker: "Speaker 2" },
    { t: 120, text: "मुझे लगता है हमें release notes भी इसी हफ़्ते भेज देने चाहिए।", speaker: "Speaker 3" },
    { t: 160, text: "We should double-check contrast for the charts in dark mode.", speaker: "Speaker 1" },
    { t: 240, text: "Launch target is still the twentieth.", speaker: "Speaker 2" },
  ],
  summary:
    "The team agreed to move the Apollo dashboard to glass cards. Ana owns the component library (due Monday); launch target stays the 20th. Rahul flagged dark-mode chart contrast. Release notes go out this week.",
  actionItems: [
    "Speaker 2: finalize the component library by Monday",
    "You: send the updated deck to Northwind",
    "Rahul: check chart contrast in dark mode",
    "Draft the release notes",
  ],
  durationSec: 1840,
  createdAt: iso(90),
  live: false,
};
const EMPTY = { id: "tour-empty", title: "Quick call", kind: "meeting", transcript: [], summary: "", actionItems: [], durationSec: 12, createdAt: iso(400), live: false };

async function setTheme(theme) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await invoke("get_settings");
    await invoke("save_settings", { settings: { ...s, theme } });
    await browser.execute(() => location.reload());
    await ready();
    const ok = await waitFor(() => browser.execute((t) => document.documentElement.dataset.theme === t, theme), { timeout: 20000, msg: `theme ${theme}` }).catch(() => false);
    if (ok) break;
    console.warn(`theme ${theme} not applied yet (attempt ${attempt + 1})`);
  }
  await sleep(1500);
}

async function go(hash) {
  await browser.execute((h) => (location.hash = h), hash);
  await sleep(1300);
}

describe("ui tour", function () {
  // a slow software-rendered webview under Xvfb: each screen takes a while
  this.timeout(900000);
  before(async () => {
    await ready();
    os.move(5, 700);
  });

  it("sign-in (light + dark)", async () => {
    for (const t of ["light", "dark"]) {
      const s = await invoke("get_settings");
      await invoke("save_settings", { settings: { ...s, theme: t } });
      await browser.execute(() => location.reload());
      await ready();
      await sleep(1800);
      await shot(`signin-${t}`);
    }
  });

  it("setup: every step", async () => {
    await signInQuick();
    await $("[data-testid=onboarding]").waitForDisplayed({ timeout: 30000 });
    await sleep(1200);
    await shot("onb-1-welcome");
    await $("#ob-name").setValue("Ada");
    await shot("onb-1-welcome-name");
    await clickButton("Let's begin");
    for (let n = 0; n < 10; n++) {
      await sleep(1500);
      const s = await step().catch(() => null);
      if (!s) break;
      await shot(`onb-${n + 2}-${s}`);
      if (s === "done") {
        screen("onb-done");
        await clickButton("Start using Flo");
        break;
      }
      const labels = { model: "Continue", permissions: "I'll do this later", try: "I'll try it later" };
      await clickButton(labels[s] ?? "Continue", 4000).catch(() => clickButton("Continue"));
    }
    await $("[data-testid=onboarding]").waitForDisplayed({ reverse: true, timeout: 30000 }).catch(() => {});
    await sleep(1500);
  });

  it("seeds a meeting note", async () => {
    await toMain();
    await invoke("e2e_seed_note", { note: EMPTY });
    await invoke("e2e_seed_note", { note: MEETING });
    const s = await invoke("get_settings");
    await invoke("save_settings", { settings: { ...s, onboarded: true, userName: "Ada" } });
  });

  for (const theme of ["light", "dark"]) {
    it(`dashboard pages and settings (${theme})`, async () => {
      await toMain();
      await setTheme(theme);
      for (const p of PAGES) {
        await go(`#/${p}`);
        await shot(`${theme}-page-${p}`);
      }
      await go("#/notes/tour-meeting");
      await shot(`${theme}-note-meeting`);
      await browser.execute(() => document.querySelector("[data-testid=note-transcript]")?.scrollIntoView({ block: "start" }));
      await sleep(500);
      await shot(`${theme}-note-meeting-transcript`);
      // "Who is this?" and the Voices panel
      await browser.execute(() => document.querySelector("[data-testid=speaker-chip-name]")?.click());
      await sleep(400);
      await shot(`${theme}-note-picker`);
      await browser.execute(() => document.querySelector("[data-testid=speaker-chip-name]")?.click());
      await browser.execute(() => document.querySelector("[data-testid=voices-open]")?.click());
      await sleep(500);
      await shot(`${theme}-note-voices`);
      await go("#/notes/tour-empty");
      await sleep(800);
      await shot(`${theme}-note-empty`);
      for (const t of TABS) {
        await go(`#/settings/${t.toLowerCase()}`);
        await shot(`${theme}-settings-${t.toLowerCase()}`);
      }
      screen(`${theme}-desktop`);
    });
  }

  for (const theme of ["light", "dark"]) {
    it(`the pill in every state (${theme})`, async () => {
      await toMain();
      await setTheme(theme);
      await toMain();
      await go("#/home");
      const rest = await win("island");
      os.move(5, 700);
      await sleep(800);
      await toIsland();
      await shot(`${theme}-pill-rest`);
      screen(`${theme}-pill-rest`);
      // hover panel + stopwatch
      os.move(rest.x + rest.width / 2 - 8, rest.y + rest.height / 2);
      await sleep(150);
      os.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
      await sleep(1600);
      await shot(`${theme}-pill-hover`);
      screen(`${theme}-pill-hover`);
      const start = await $("//button[normalize-space(.)='Start']");
      if (await start.isExisting()) {
        await start.click();
        await sleep(2300);
        await shot(`${theme}-pill-stopwatch`);
        screen(`${theme}-pill-stopwatch`);
        const pause = await $("//button[normalize-space(.)='Pause']");
        if (await pause.isExisting()) await pause.click();
      }
      os.move(5, 700);
      await sleep(1500);
      await toMain();
      // dictating (real Flo key + the WAV as the microphone)
      os.keyDown("ctrl");
      await sleep(1600);
      await toIsland();
      await shot(`${theme}-pill-dictating`);
      screen(`${theme}-pill-dictating`);
      os.keyUp("ctrl");
      await sleep(600);
      await shot(`${theme}-pill-transcribing`);
      await sleep(2500);
      screen(`${theme}-pill-after-dictation`);
      await toMain();
      // assistant answer
      await emit("flo://state", { phase: "done", mode: "assistant" });
      await emit("flo://assistant", {
        id: `a-${theme}`,
        query: "What's on my plate today and is anything overdue?",
        reply: "You have **3 to-dos** today: send the Northwind deck, review the Apollo charts, and pay the electricity bill (due in 5 minutes). Nothing is overdue.",
        actions: [],
        results: [],
        createdAt: new Date().toISOString(),
        mode: "quick",
      });
      await sleep(1500);
      await toIsland();
      await shot(`${theme}-pill-assistant`);
      screen(`${theme}-pill-assistant`);
      await browser.execute(() => document.querySelector("[data-island-root] button[aria-label=Dismiss]")?.click());
      await sleep(800);
      await toMain();
      await emit("flo://state", { phase: "idle", mode: "assistant" });
      // a meeting: live line with a speaker name (collapsed, then expanded)
      const noteId = "tour-live";
      await emit("flo://state", { phase: "listening", mode: "meeting" });
      await emit("flo://meeting", { noteId, segment: { t: 3, text: "Alright, let's kick off with the launch checklist.", speaker: "You" }, elapsedSec: 3, live: true });
      await emit("flo://meeting", { noteId, segment: { t: 9, text: "हाँ, नए कार्ड्स काफ़ी साफ़ दिख रहे हैं।", speaker: "Rahul" }, elapsedSec: 9, live: true });
      await emit("flo://meeting", {
        noteId,
        partial: "We still need the Windows bottom-right positioning tested before Friday, and somebody has to own the release notes",
        partialSpeaker: "Speaker 2",
        elapsedSec: 14,
        live: true,
      });
      await sleep(1500);
      await toIsland();
      await shot(`${theme}-pill-meeting`);
      screen(`${theme}-pill-meeting`);
      await browser.execute(() => document.querySelector("[data-testid=island-live-line]")?.closest(".cursor-pointer")?.click());
      // the window grows to the expanded view: wait for it, then for the content to settle
      await waitFor(async () => {
        await toMain();
        const w = await win("island");
        return w && w.height > 200;
      }, { timeout: 8000, msg: "the expanded meeting window" }).catch(() => {});
      await sleep(1500);
      await toMain();
      const ew = await win("island");
      await toIsland();
      const dom = await browser.execute(() => {
        const r = document.querySelector("[data-testid=island-pill]")?.getBoundingClientRect();
        return { innerW: innerWidth, innerH: innerHeight, pill: r && { x: r.x, y: r.y, w: r.width, h: r.height } };
      });
      console.log("expanded meeting: window", JSON.stringify(ew), "dom", JSON.stringify(dom));
      await shot(`${theme}-pill-meeting-expanded`);
      screen(`${theme}-pill-meeting-expanded`);
      await toMain();
      await emit("flo://meeting", { noteId, elapsedSec: 20, live: false });
      await emit("flo://state", { phase: "idle", mode: "meeting" });
      await sleep(1200);
      // a to-do reminder
      await emit("flo://reminder", { id: `r-${theme}`, title: "Pay the electricity bill before the office closes", source: "manual", status: "open", due: new Date(Date.now() + 5 * 60000).toISOString(), createdAt: new Date().toISOString() });
      await sleep(1500);
      await toIsland();
      await shot(`${theme}-pill-reminder`);
      screen(`${theme}-pill-reminder`);
      await toMain();
    });
  }
});
