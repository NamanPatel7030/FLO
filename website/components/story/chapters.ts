/**
 * The notch story: one chapter per feature. Each chapter drives the pinned notch through a short
 * loop of phases (durations in ms). Copy lives here so the layout code stays about layout.
 */
export type ChapterId =
  | "hero"
  | "dictation"
  | "languages"
  | "assistant"
  | "skills"
  | "agent"
  | "learns"
  | "todos"
  | "deadlines"
  | "projects"
  | "meetings"
  | "claude"
  | "widgets"
  | "custom"
  | "privacy";

export type Chapter = {
  id: ChapterId;
  label: string;
  eyebrow: string;
  title: string;
  /** the words in the title that get the shimmering accent */
  hl?: string;
  what: string;
  why: string;
  bullets: string[];
  /** ms per phase; the loop restarts after the last one */
  phases: number[];
  /** phase shown when motion is reduced (or when the chapter is not the active one) */
  still: number;
};

export const CHAPTERS: Chapter[] = [
  {
    id: "hero",
    label: "Flo",
    eyebrow: "Flo for macOS · lives in your notch",
    title: "Your Mac, at the speed of speech.",
    what: "Hold a key and talk. Flo types, drafts, remembers and reminds you, right from the notch you already have. It all runs on your Mac.",
    why: "",
    bullets: [],
    phases: [2600, 2800],
    still: 1,
  },
  {
    id: "dictation",
    label: "Dictation",
    eyebrow: "Dictation",
    title: "Hold Control. Talk. It's typed.",
    hl: "It's typed.",
    what: "Hold Control anywhere and speak. Let go, and clean, punctuated text lands right where your cursor is: Slack, Mail, VS Code or any text box.",
    why: "You speak three to four times faster than you type. A reply that took a minute now takes fifteen seconds.",
    bullets: ["Whisper runs on your Mac. Your audio never leaves it.", "Text appears about 0.2 s after you let go.", "No word caps and no usage meter."],
    phases: [3200, 1000, 4200],
    still: 2,
  },
  {
    id: "languages",
    label: "Languages",
    eyebrow: "Hindi, Gujarati & English",
    title: "Speak the language you think in.",
    hl: "you think in.",
    what: "Tell Flo which languages you speak. Each time you talk it picks the right one by itself and writes it in the proper script.",
    why: "Hindi comes out in Devanagari, Gujarati in Gujarati script, and Hindi is never mistaken for Urdu. No transliteration to clean up.",
    bullets: ["Detects the language among the ones you speak", "Native script, not romanised guesses", "Same on-device speed as English"],
    phases: [2800, 900, 3600],
    still: 2,
  },
  {
    id: "assistant",
    label: "Assistant",
    eyebrow: "Assistant that reads your screen",
    title: "Ask for a draft. It reads the room first.",
    hl: "reads the room",
    what: "Hold fn and say what you need, like “draft a Dhanteras wish for the team”. Flo reads the conversation on screen and types the draft into the box you're in.",
    why: "No copying context into a chatbot and pasting back. It replies in the thread's language and tone, and uses people's real names.",
    bullets: ["Reads the focused window only when you ask", "Go deeper or search the web from any answer", "Uses your own AI key or a local model"],
    phases: [2800, 2400, 5600],
    still: 2,
  },
  {
    id: "skills",
    label: "Skills",
    eyebrow: "Skills & MCP tools",
    title: "Teach it once. Then just ask.",
    hl: "just ask.",
    what: "Draw a skill on a canvas: the phrases that start it, the steps, the apps it works in, the MCP tools it may call and the docs it can read. Then say “write a proposal for this job”.",
    why: "The way you like things done stops living in your head. Proposals, standups and follow-ups come out your way, every time.",
    bullets: ["Write mode types the result, Do mode works the screen", "Connect any MCP server and call its tools mid-skill", "Attach Knowledge docs for Flo to draw on"],
    phases: [2400, 3800, 3600],
    still: 2,
  },
  {
    id: "agent",
    label: "Hands-free",
    eyebrow: "Hands-free agent",
    title: "Double-tap. Say it. Watch it happen.",
    hl: "Watch it happen.",
    what: "Double-tap fn and Flo keeps listening, no key held. Ask it to open apps, search, click and type, and it works your screen step by step while the notch shows every move.",
    why: "Your hands stay free. And it never sends, posts, buys or deletes anything until you say “yes” out loud.",
    bullets: ["Say “stop” at any moment and it stops", "“Open Slack” or “volume up” run instantly, offline", "Switches itself off after 5 quiet minutes"],
    phases: [2600, 4200, 4400],
    still: 2,
  },
  {
    id: "learns",
    label: "Learns words",
    eyebrow: "Learns your words",
    title: "Fix it once. It's right forever.",
    hl: "right forever.",
    what: "When you correct a word Flo got wrong, it notices. A small card in the notch confirms the new spelling, with Undo in case you didn't mean it.",
    why: "Names, product terms and jargon stop being a fight. Say Tauri, get Tauri, every single time.",
    bullets: ["Learns from the edits you make after dictating", "“Did I mishear?” saves a word in one tap", "Your dictionary stays on your Mac"],
    phases: [2600, 4000, 2800],
    still: 1,
  },
  {
    id: "todos",
    label: "To-dos",
    eyebrow: "To-dos from everywhere",
    title: "The promises you make get written down.",
    hl: "written down.",
    what: "Flo catches what you commit to in meetings, in Slack and on screen, and keeps it behind a tray icon in your notch. Hover to see the list.",
    why: "Every item says why it's there, so you can trust the list instead of re-checking every app.",
    bullets: ["“I'll send it tonight” on a call becomes a to-do", "Unanswered Slack asks are caught for you", "Tick off from the notch, or select many for bulk actions"],
    phases: [1800, 4200, 2400],
    still: 1,
  },
  {
    id: "deadlines",
    label: "Reminders",
    eyebrow: "Deadlines become reminders",
    title: "“By next Monday” turns into a reminder.",
    hl: "a reminder.",
    what: "When a to-do comes with a deadline, Flo works out the real date and time and files it under Reminders.",
    why: "It understands “by next Monday”, “tomorrow at 5pm” and “in 2 hours”, then taps you on the shoulder 5 minutes early, right in the notch.",
    bullets: ["Snooze 10 minutes or mark Done from the card", "A Reminders section sits at the top of your to-dos", "Deadlines read in your local time"],
    phases: [2400, 2800, 4000],
    still: 2,
  },
  {
    id: "projects",
    label: "Projects",
    eyebrow: "Projects & clients",
    title: "Everything files itself under the right client.",
    hl: "files itself",
    what: "Give a project its client, a few details and keywords. From then on, the to-dos, notes and meetings that mention them land in that project on their own.",
    why: "Open Acme and see everything Acme: what you owe them, what was said and what's next, without sorting a thing.",
    bullets: ["Filed by client name and keywords", "Progress and open to-dos for every project", "The assistant knows your projects when it drafts"],
    phases: [2200, 3600, 3400],
    still: 1,
  },
  {
    id: "meetings",
    label: "Meetings",
    eyebrow: "Meeting notes",
    title: "Listen. Flo takes the notes.",
    hl: "takes the notes.",
    what: "When a Zoom, Meet or Teams call starts, the notch offers to take notes. Flo transcribes live on your Mac, then hands you a summary and the action items when the call ends.",
    why: "You stay in the conversation instead of typing through it, and still know who said what and who owes what.",
    bullets: ["Who said what: name a voice once and Flo remembers it", "Action items land in your to-dos", "Transcription happens on device"],
    phases: [4200, 5200],
    still: 1,
  },
  {
    id: "claude",
    label: "Claude Code",
    eyebrow: "Claude Code in your notch",
    title: "Stop babysitting terminals.",
    hl: "babysitting",
    what: "Your Claude Code sessions sit in the notch tray with a live count. When one finishes or needs your permission, the notch tells you.",
    why: "No more checking tabs every two minutes. And it doesn't cry wolf: if Claude is still running background work, Flo waits until it's really done.",
    bullets: ["Allow or deny a permission ask from the notch", "Click to jump straight to that session", "Codex and Cursor sessions show up too"],
    phases: [2200, 3200, 4000],
    still: 2,
  },
  {
    id: "widgets",
    label: "Widgets",
    eyebrow: "Widgets",
    title: "Glance up. It's all there.",
    hl: "all there.",
    what: "Open the notch for live widgets: music, to-dos, Claude sessions, world clocks, weather, focus timers and a note.",
    why: "The things you check fifty times a day are one glance away, and gone the moment you move on.",
    bullets: ["Choose and reorder any of the 8 widgets", "Add the time zones your team lives in"],
    phases: [7000],
    still: 0,
  },
  {
    id: "custom",
    label: "Make it yours",
    eyebrow: "Make it yours",
    title: "It's your notch. Style it.",
    hl: "Style it.",
    what: "Pick how Flo listens back: a ribbon wave, equalizer bars, a neon line, a helix of dots or sparkles. Then choose a size, a sound and a colour.",
    why: "You'll see it dozens of times a day. It should feel like yours, not ours.",
    bullets: ["15 animation styles", "Four sizes, from Small to Biggest", "Chime, Glass, Soft or Pop, or silence"],
    phases: [2000, 2000, 2000, 2000, 2000],
    still: 0,
  },
  {
    id: "privacy",
    label: "Privacy",
    eyebrow: "Private by design",
    title: "Local first. Enforced, not promised.",
    hl: "Enforced,",
    what: "Your voice, notes and to-dos stay on your Mac in an encrypted database. Bring your own AI key, or run fully local with Ollama.",
    why: "Every network call passes through one allow-list you can see, host by host. Anything not on it is blocked.",
    bullets: ["Your keys live in the macOS Keychain", "Fully offline mode with local models", "We never see your dictation, notes or to-dos"],
    phases: [1600, 1600, 1600, 1600],
    still: 3,
  },
];

export const CHAPTER_INDEX = Object.fromEntries(CHAPTERS.map((c, i) => [c.id, i])) as Record<ChapterId, number>;

export const LANGS = [
  { code: "hi", name: "हिन्दी", en: "Hindi", glyph: "अ", text: "कल सुबह दस बजे तक क्लाइंट को डेमो भेज दूँगा।" },
  { code: "gu", name: "ગુજરાતી", en: "Gujarati", glyph: "અ", text: "આજે સાંજે મીટિંગ પછી રિપોર્ટ મોકલી દઈશ." },
  { code: "en", name: "English", en: "English", glyph: "A", text: "I'll send the demo to the client by ten tomorrow." },
] as const;

/** All 15 listening animations; the first five are the featured chips. */
export const STYLES = [
  "Ribbon",
  "Equalizer",
  "Neon",
  "Helix",
  "Sparkle",
  "Pulse",
  "Wave",
  "Bars",
  "Aurora",
  "Orb",
  "Ripple",
  "Spectrum",
  "Comet",
  "Liquid",
  "Constellation",
] as const;
export const FEATURED_STYLES = 5;
export const SIZES = ["Small", "Big", "Bigger", "Biggest"] as const;
export const SOUNDS = ["Chime", "Glass", "Soft", "Pop"] as const;
/** Notch accent colours: hi (light), a (main), b (deep). */
export const PALETTES = [
  { name: "Flo blue", swatch: "#3dbbff", hi: "#e3f6ff", a: "#66ceff", b: "#1a9be0" },
  { name: "Violet", swatch: "#a78bfa", hi: "#ede9fe", a: "#a78bfa", b: "#7c3aed" },
  { name: "Pink", swatch: "#f472b6", hi: "#fce7f3", a: "#f472b6", b: "#db2777" },
  { name: "Amber", swatch: "#fbbf24", hi: "#fef3c7", a: "#fbbf24", b: "#d97706" },
  { name: "Mint", swatch: "#34d399", hi: "#d1fae5", a: "#34d399", b: "#059669" },
  { name: "Rainbow", swatch: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)", hi: "#fde68a", a: "#f472b6", b: "#60a5fa" },
] as const;

/** Assistant: example prompts the visitor can run. */
export const PROMPTS = [
  {
    say: "draft a Dhanteras wish for the team",
    draft:
      "Happy Dhanteras, team! Priya, Rahul and everyone, thank you for an amazing year so far. Kal 4 baje ke baad family ke saath time enjoy karo. May this festival bring good health and lots of wins.",
  },
  {
    say: "summarise this thread",
    draft: "Quick summary: office closes at 4 tomorrow for Dhanteras, and Rahul has ordered sweets for everyone. Pick yours up before you leave.",
  },
  {
    say: "tell them I'll join after 5",
    draft: "Main 5 baje ke baad join karunga! Rahul, mere liye bhi sweets bacha ke rakhna 😄 Happy Dhanteras sabko.",
  },
] as const;

/** Deadlines: phrases Flo understands and the reminder each one becomes. */
export const DEADLINES = [
  { say: "by next Monday", due: "Mon, 10:00", ring: "9:55" },
  { say: "tomorrow at 5pm", due: "Sun, 17:00", ring: "16:55" },
  { say: "in 2 hours", due: "Today, 12:40", ring: "12:35" },
] as const;

/** The 8 notch widgets the app ships (Settings → Appearance → Widgets); the first four are on by default here. */
export const WIDGETS = ["Now Playing", "Today's to-dos", "Claude sessions", "Clock & time zones", "Weather", "Pomodoro", "Stopwatch", "Quick note"] as const;
export type WidgetName = (typeof WIDGETS)[number];

/** Skills chapter: three skills the visitor can run. `attach` = [kind, label] nodes hanging off the steps. */
export const SKILLS = [
  {
    name: "Upwork proposal",
    say: "write a proposal for this job",
    steps: ["Read the job post on screen", "Find 2 matching past projects", "Write 300 words, end with a question"],
    mode: "Write",
    out: "Type it into the proposal box",
    attach: [
      ["platform", "Upwork"],
      ["mcp", "GitHub · search_repos"],
      ["doc", "portfolio.md"],
    ],
    result: "Proposal typed into Upwork · 312 words",
  },
  {
    name: "Standup update",
    say: "post my standup",
    steps: ["Fetch yesterday's issues", "Sort into done, doing, blocked", "Post it in #standup"],
    mode: "Do",
    out: "Do it on screen",
    attach: [
      ["platform", "Slack"],
      ["mcp", "Linear · list_issues"],
      ["doc", "team-norms.md"],
    ],
    result: "Standup posted in #standup",
  },
  {
    name: "Client follow-up",
    say: "follow up with this client",
    steps: ["Read the email thread", "Check which invoices are open", "Draft a friendly nudge"],
    mode: "Write",
    out: "Type it into the reply",
    attach: [
      ["platform", "Gmail"],
      ["mcp", "Stripe · list_invoices"],
      ["doc", "tone-of-voice.md"],
    ],
    result: "Follow-up typed into Gmail",
  },
] as const;

/** Hands-free agent: the request, the steps it takes on screen, and instant offline commands. */
export const AGENT = {
  say: "email Priya the Q3 deck",
  steps: ["Opened Mail", "New message to Priya Shah", "Subject: Q3 deck", "Attached Q3-deck.pdf"],
  confirm: "Send the email to Priya?",
};
export const INSTANT = [
  { say: "open Slack", did: "Opened Slack" },
  { say: "volume up", did: "Volume 60% → 70%" },
  { say: "play lofi on YouTube", did: "Playing lofi beats on YouTube" },
] as const;

/** Projects chapter: clients, and the captured items Flo files into them. */
export const PROJECTS = [
  { name: "Website redesign", client: "Acme", color: "#66ceff", done: 0.62 },
  { name: "Mobile app", client: "Nimbus", color: "#a78bfa", done: 0.35 },
  { name: "Personal", client: "", color: "#f1e3c6", done: 0.8 },
] as const;
export const FILED = [
  { kind: "To-do", text: "Send Acme the homepage copy", from: "Zoom · Acme weekly", to: 0 },
  { kind: "Note", text: "Nimbus wants dark mode in v1", from: "Meeting notes", to: 1 },
  { kind: "To-do", text: "Reply to Acme about the logo", from: "Slack DM · Jon at Acme", to: 0 },
  { kind: "To-do", text: "Book the dentist", from: "Said to Flo", to: 2 },
] as const;
