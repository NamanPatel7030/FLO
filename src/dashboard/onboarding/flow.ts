// First-run setup: the step list, the chapters shown in the progress rail, and the pure bits that
// turn the playful answers into a profile. No React here, so it is unit-tested (flow.test.ts).
import type { Platform } from "../../lib/types";
import { os, settingsApp } from "../../lib/os";
import { buildProfile, type Answers, type App, type Lang, type Role, type Use } from "../../lib/profile";
import type { NotchlingMood } from "../../lib/notchling";

export const STEPS = ["welcome", "permissions", "try", "setup", "role", "uses", "done"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_NAME: Record<Step, string> = {
  welcome: "Welcome", permissions: "Permissions", try: "Try it", setup: "Voice & AI",
  role: "What you do", uses: "Where you write", done: "Ready",
};

/** Chapters group steps in the progress rail. Permissions come before the try-out so the mic,
 *  the Flo key and typing already work when the person first talks. */
export const CHAPTERS: { name: string; steps: Step[] }[] = [
  { name: "Hello", steps: ["welcome"] },
  { name: "Setup", steps: ["permissions", "try", "setup"] },
  { name: "You", steps: ["role", "uses"] },
  { name: "Ready", steps: ["done"] },
];

export const stepIndex = (s: Step) => STEPS.indexOf(s);
export const clampStep = (n: number) => Math.max(0, Math.min(STEPS.length - 1, n));

/** Notchling's default mood on each step (steps with live state override it). */
export const STEP_MOOD: Record<Step, NotchlingMood> = {
  welcome: "happy", permissions: "listen", try: "happy", setup: "think", role: "think", uses: "excited", done: "love",
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
export function headline(step: Step, name: string, hour = new Date().getHours(), platform: Platform = os()): { title: string; sub: string } {
  const n = name.trim();
  switch (step) {
    case "welcome": return { title: n ? `Hi ${n}, I'm Flo.` : "Hi, I'm Flo.", sub: `${hello(hour)} I live ${platform === "macos" ? "in your notch" : "at the top of your screen"} and turn your voice into words, in any app.` };
    case "permissions":
      return platform === "macos"
        ? { title: "Let me hear you and type for you", sub: "Two quick yeses: the microphone, and one switch for Accessibility. I'll notice the moment you flip it." }
        : { title: "Let me hear you", sub: "One quick yes: the microphone. I'll notice the moment it's on." };
    case "try": return { title: "Now say something", sub: "" };
    case "setup": return { title: "How should I listen and think?", sub: "Good defaults are set. Change anything, anytime." };
    case "role": return { title: n ? `So ${n}, what do you do?` : "So, what do you do?", sub: "I'll learn the words you use most." };
    case "uses": return { title: "Where will you use your voice?", sub: "Pick everything that fits, and the languages you speak." };
    case "done": return { title: n ? `You're all set, ${n}` : "You're all set", sub: "Three keys are all you need. Hold one, talk, let go." };
  }
}

/** Turn a backend error into something a person can act on. */
export function friendlyError(msg: string, platform: Platform = os()): { text: string; fixMic?: boolean } {
  const m = msg.toLowerCase();
  if (m.includes("microphone unavailable") || m.includes("privacy → microphone") || m.includes("not authorized"))
    return { text: "Allow the microphone first, then try again.", fixMic: true };
  if (m.includes("didn't hear")) return { text: `I couldn't hear you. Check your mic is on and picked in ${settingsApp(platform)}, Sound, then try again.`, fixMic: true };
  if (m.includes("didn't catch")) return { text: "That was a bit short. Hold a little longer and say the whole line." };
  return { text: msg.replace(/[—–]/g, ",") };
}
