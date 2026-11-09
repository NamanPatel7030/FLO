// First-run setup: the step list, the chapters shown in the progress rail, and the pure bits that
// turn the playful answers into a profile. No React here, so it is unit-tested (flow.test.ts).
import { buildProfile, type Answers, type App, type Lang, type Role, type Use } from "../../lib/profile";
import type { NotchlingMood } from "../../lib/notchling";

export const STEPS = [
  "welcome", "try", "role", "uses", "voice", "personalise", "permissions", "setup", "powers", "typing", "done",
] as const;
export type Step = (typeof STEPS)[number];

export const STEP_NAME: Record<Step, string> = {
  welcome: "Welcome", try: "Try it", role: "What you do", uses: "Where you write", voice: "Your voice",
  personalise: "Personalise", permissions: "Permissions", setup: "Voice & AI", powers: "Superpowers",
  typing: "Typing speed", done: "Ready",
};

/** Chapters group steps in the progress rail so eleven steps read as four short moments. */
export const CHAPTERS: { name: string; steps: Step[] }[] = [
  { name: "Hello", steps: ["welcome", "try"] },
  { name: "You", steps: ["role", "uses", "voice", "personalise"] },
  { name: "Setup", steps: ["permissions", "setup"] },
  { name: "Extras", steps: ["powers", "typing", "done"] },
];

export const stepIndex = (s: Step) => STEPS.indexOf(s);
export const clampStep = (n: number) => Math.max(0, Math.min(STEPS.length - 1, n));

/** Notchling's default mood on each step (steps with live state override it). */
export const STEP_MOOD: Record<Step, NotchlingMood> = {
  welcome: "happy", try: "happy", role: "think", uses: "excited", voice: "talk", personalise: "proud",
  permissions: "listen", setup: "think", powers: "cool", typing: "fire", done: "love",
};

export type Tone = "" | "polished" | "friendly" | "crisp" | "playful";

export const TONES: { id: Exclude<Tone, "">; label: string; sample: string; line: string }[] = [
  { id: "friendly", label: "Warm", sample: "Hey! Thanks so much, this looks great.", line: "Overall tone: warm and friendly, like talking to a colleague I like." },
  { id: "polished", label: "Polished", sample: "Thank you, this looks great. Happy to proceed.", line: "Overall tone: polished and professional, clear and courteous." },
  { id: "crisp", label: "Crisp", sample: "Looks great. Ship it.", line: "Overall tone: crisp and direct, as few words as possible." },
  { id: "playful", label: "Playful", sample: "Oh this is lovely, ship it!", line: "Overall tone: light and playful, a little personality is welcome." },
];

/** When the person didn't pick a role, guess one from how they'll use Flo. */
export function deriveRole(uses: Use[]): Role {
  if (uses.includes("coding")) return "developer";
  if (uses.includes("social")) return "marketer";
  if (uses.includes("docs")) return "writer";
  if (uses.includes("meetings")) return "founder";
  return "";
}

export interface SetupAnswers {
  name: string;
  role: Role;
  uses: Use[];
  languages: Lang[];
  otherLanguage: string;
  apps: App[];
  tone: Tone;
}

export const EMPTY_ANSWERS: SetupAnswers = { name: "", role: "", uses: [], languages: [], otherLanguage: "", apps: [], tone: "" };

export function toAnswers(a: SetupAnswers): Answers {
  return {
    name: a.name.trim(),
    role: a.role || deriveRole(a.uses),
    uses: a.uses,
    languages: a.languages,
    otherLanguage: a.otherLanguage.trim() || undefined,
    apps: a.apps,
  };
}

/** buildProfile plus the chosen tone. */
export function profileFor(a: SetupAnswers): { systemPrompt: string; dictionary: string[]; language: string } {
  const p = buildProfile(toAnswers(a));
  const tone = TONES.find((t) => t.id === a.tone);
  return tone ? { ...p, systemPrompt: `${p.systemPrompt}\n\n${tone.line}` } : p;
}

/** Toggle an item in a multi-select list. */
export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const hello = (h: number) => (h < 5 ? "Up late?" : h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : h < 22 ? "Good evening." : "Up late?");

/** The big line Notchling says at the top of each step. */
export function headline(step: Step, name: string, hour = new Date().getHours()): { title: string; sub: string } {
  const n = name.trim();
  switch (step) {
    case "welcome": return { title: n ? `Hi ${n}, I'm Flo.` : "Hi, I'm Flo.", sub: `${hello(hour)} I live in your notch and turn your voice into words, in any app.` };
    case "try": return { title: "Let's try it right now", sub: "" };
    case "role": return { title: n ? `So ${n}, what do you do?` : "So, what do you do?", sub: "I'll learn the words you use most." };
    case "uses": return { title: "Where will your voice go?", sub: "Pick everything that fits. I'll match each place." };
    case "voice": return { title: "How do you sound?", sub: "Your languages and the tone you like." };
    case "personalise": return { title: "I wrote this just for you", sub: "This is how I'll write in your voice. Edit anything." };
    case "permissions": return { title: "Let me hear and help", sub: "Grant these in System Settings. I'll notice the moment you do." };
    case "setup": return { title: "How should I listen and think?", sub: "Sensible defaults are set. Change anything, anytime." };
    case "powers": return { title: "A few more tricks", sub: "Try one, or take a look and move on." };
    case "typing": return { title: "How fast do you type?", sub: "One minute, and I'll show how much time talking saves you." };
    case "done": return { title: "We're all set", sub: "Here's everything you need. Make me yours if you like." };
  }
}
