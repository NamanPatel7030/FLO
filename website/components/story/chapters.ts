/**
 * The notch story: one chapter per feature. Each chapter drives the pinned notch through a short
 * loop of phases (durations in ms). Copy lives here so the layout code stays about layout.
 */
export type ChapterId =
  | "hero"
  | "dictation"
  | "languages"
  | "assistant"
  | "learns"
  | "todos"
  | "deadlines"
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
    title: "Hold Fn. Talk. It's typed.",
    what: "Hold Fn anywhere and speak. Let go, and clean, punctuated text lands right where your cursor is: Slack, Mail, VS Code or any text box.",
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
    what: "Hold Control and say what you need, like “draft a Dhanteras wish for the team”. Flo reads the conversation on screen and types the draft into the box you're in.",
    why: "No copying context into a chatbot and pasting back. It replies in the thread's language and tone, and uses people's real names.",
    bullets: ["Reads the focused window only when you ask", "Writes Hinglish when the thread is Hinglish", "Uses your own AI key or a local model"],
    phases: [2800, 2400, 5600],
    still: 2,
  },
  {
    id: "learns",
    label: "Learns words",
    eyebrow: "Learns your words",
    title: "Fix it once. It's right forever.",
    what: "When you correct a word Flo got wrong, it notices. A small card in the notch confirms the new spelling, with Undo in case you didn't mean it.",
    why: "Names, product terms and jargon stop being a fight. Say Tauri, get Tauri, every single time.",
    bullets: ["Learns from the edits you make after dictating", "One tap to undo", "Your dictionary stays on your Mac"],
    phases: [2600, 4000, 2800],
    still: 1,
  },
  {
    id: "todos",
    label: "To-dos",
    eyebrow: "To-dos from everywhere",
    title: "The promises you make get written down.",
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
    what: "When a to-do comes with a deadline, Flo works out the real date and time and files it under Reminders.",
    why: "It understands “by next Monday”, “tomorrow at 5pm” and “in 2 hours”, then taps you on the shoulder 5 minutes early, right in the notch.",
    bullets: ["Snooze 10 minutes or mark Done from the card", "A Reminders section sits at the top of your to-dos", "Deadlines read in your local time"],
    phases: [2400, 2800, 4000],
    still: 2,
  },
  {
    id: "meetings",
    label: "Meetings",
    eyebrow: "Meeting notes",
    title: "Listen. Flo takes the notes.",
    what: "Start recording from the notch. Flo transcribes live on your Mac, then hands you a summary and the action items when the call ends.",
    why: "You stay in the conversation instead of typing through it, and still know who said what and who owes what.",
    bullets: ["Transcript with who said what", "Action items land in your to-dos", "Transcription happens on device"],
    phases: [4200, 5200],
    still: 1,
  },
  {
    id: "claude",
    label: "Claude Code",
    eyebrow: "Claude Code in your notch",
    title: "Stop babysitting terminals.",
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
    what: "Open the notch for a panel of live widgets: what's playing, today's to-dos, your Claude sessions and the weather.",
    why: "The things you check fifty times a day are one glance away, and gone the moment you move on.",
    bullets: ["Choose and reorder the widgets you want", "Everything updates live", "Closes as soon as your pointer leaves"],
    phases: [7000],
    still: 0,
  },
  {
    id: "custom",
    label: "Make it yours",
    eyebrow: "Make it yours",
    title: "It's your notch. Style it.",
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

export const STYLES = ["Ribbon wave", "Equalizer bars", "Neon line", "Helix", "Sparkles"] as const;
export const SIZES = ["Small", "Big", "Bigger", "Biggest"] as const;
export const SOUNDS = ["Chime", "Glass", "Soft", "Pop"] as const;
