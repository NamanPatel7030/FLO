// Onboarding answers → a personal system prompt, dictionary seeds and the STT language.
// Pure and deterministic (unit-tested); shown to the user, editable before saving.

export type Role = "developer" | "founder" | "designer" | "student" | "sales" | "writer" | "marketer" | "other" | "";
export type Use = "emails" | "chat" | "coding" | "docs" | "meetings" | "social" | "notes";
export type Lang = "english" | "hindi" | "gujarati" | "hinglish" | "other";
export type App = "gmail" | "slack" | "whatsapp" | "vscode" | "cursor" | "notion" | "chrome" | "other";

export interface Answers {
  name: string;
  role: Role;
  uses: Use[];
  languages: Lang[];
  otherLanguage?: string;
  apps: App[];
}

export const ROLES: { id: Role; label: string; emoji: string }[] = [
  { id: "developer", label: "Developer", emoji: "💻" },
  { id: "founder", label: "Founder", emoji: "🚀" },
  { id: "designer", label: "Designer", emoji: "🎨" },
  { id: "student", label: "Student", emoji: "📚" },
  { id: "sales", label: "Sales", emoji: "🤝" },
  { id: "writer", label: "Writer", emoji: "✍️" },
  { id: "marketer", label: "Marketer", emoji: "📣" },
  { id: "other", label: "Other", emoji: "✨" },
];

export const USES: { id: Use; label: string; emoji: string }[] = [
  { id: "emails", label: "Emails", emoji: "✉️" },
  { id: "chat", label: "Slack & WhatsApp", emoji: "💬" },
  { id: "coding", label: "Coding prompts (Claude/Cursor)", emoji: "🧠" },
  { id: "docs", label: "Docs & notes", emoji: "📝" },
  { id: "meetings", label: "Meetings", emoji: "🎙️" },
  { id: "social", label: "Social posts", emoji: "📱" },
];

export const LANGS: { id: Lang; label: string }[] = [
  { id: "english", label: "English" },
  { id: "hindi", label: "Hindi" },
  { id: "gujarati", label: "Gujarati" },
  { id: "hinglish", label: "Hinglish" },
  { id: "other", label: "Other" },
];

export const APPS: { id: App; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "slack", label: "Slack" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "notion", label: "Notion" },
  { id: "chrome", label: "Chrome" },
  { id: "other", label: "Other" },
];

const ROLE_TEXT: Record<Exclude<Role, "">, string> = {
  developer: "a software developer",
  founder: "a startup founder",
  designer: "a product designer",
  student: "a student",
  sales: "in sales",
  writer: "a writer",
  marketer: "a marketer",
  other: "",
};

const USE_TEXT: Record<Use, string> = {
  emails: "Emails: clear, warm and professional, a greeting and a short sign-off, no fluff.",
  chat: "Slack and WhatsApp: short and casual, like a real person typing, no formal sign-offs.",
  coding: "Prompts for coding agents (Claude Code, Cursor): precise and structured, keep file names, function names and code identifiers exactly as said, use bullet points for steps.",
  docs: "Docs and notes: well organised, headings and bullets where they help.",
  notes: "Notes: concise bullets.",
  meetings: "Meeting notes: decisions, owners and action items first.",
  social: "Social posts: punchy and human, no hashtags unless I ask.",
};

const DEV_TERMS = ["Claude Code", "TypeScript", "GitHub", "React", "Tauri", "npm", "API", "PR"];
const APP_WORDS: Partial<Record<App, string>> = { gmail: "Gmail", slack: "Slack", whatsapp: "WhatsApp", vscode: "VS Code", cursor: "Cursor", notion: "Notion", chrome: "Chrome" };

export function languageSetting(langs: Lang[]): string {
  if (langs.length !== 1) return "auto";
  return ({ english: "en", hindi: "hi", gujarati: "gu" } as Record<string, string>)[langs[0]] ?? "auto";
}

export function buildProfile(a: Answers): { systemPrompt: string; dictionary: string[]; language: string } {
  const name = a.name.trim();
  const role = a.role ? ROLE_TEXT[a.role] : "";
  const who = [name ? `I'm ${name}` : "", role ? `${name ? "" : "I'm "}${role}` : ""].filter(Boolean).join(", ");
  const lines: string[] = [];
  lines.push(`${who ? who + ". " : ""}Write the way I talk: natural, friendly and to the point. Fix grammar and remove filler words, but keep my meaning and my voice.`);

  const uses = a.uses.length ? a.uses : (["emails", "chat"] as Use[]);
  lines.push("", "When I'm writing:");
  for (const u of uses) lines.push(`- ${USE_TEXT[u]}`);

  const langNames = a.languages
    .map((l) => (l === "other" ? a.otherLanguage?.trim() : LANGS.find((x) => x.id === l)?.label))
    .filter((x): x is string => !!x);
  if (langNames.length && !(langNames.length === 1 && langNames[0] === "English")) {
    const mixed = a.languages.includes("hinglish") || langNames.length > 1;
    lines.push(
      "",
      `I speak ${langNames.join(", ").replace(/, ([^,]*)$/, " and $1")}.` +
        (mixed ? " I often mix languages (Hinglish). Keep the language I used and don't translate unless I ask; write Hindi words in Latin script when I speak Hinglish." : " Reply in the language I used."),
    );
  }

  const dictionary: string[] = [];
  const add = (w: string) => !dictionary.includes(w) && dictionary.push(w);
  for (const ap of a.apps) if (APP_WORDS[ap]) add(APP_WORDS[ap]!);
  if (a.role === "developer" || a.uses.includes("coding")) DEV_TERMS.forEach(add);
  if (name) add(name.split(/\s+/)[0]);

  return { systemPrompt: lines.join("\n"), dictionary, language: languageSetting(a.languages) };
}
