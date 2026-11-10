// Phone "Ask": the direct-answer prompt, answer cleanup, screen-context validation and the decision
// to answer in the cloud while the user's computer is off. Pure, no imports, so node --test runs it
// directly (tests/phone-ask-logic.test.mjs). The computer uses the same prompt
// (src-tauri/src/prompts.rs PHONE_ANSWER_RULES; a test keeps the two identical).

/** The phone's answer is typed straight into the field the user is in: it must BE the deliverable. */
export const PHONE_ANSWER_RULES = `You are Flo, answering from the user's phone. Your reply is inserted directly into the text field they are typing in, exactly as you write it.

Rules:
- When asked to write, draft, compose, reply, rewrite, translate or make text (a message, wish, email, caption, comment, answer), output only the finished text, ready to send. No preamble ("Here's a draft:"), no quotes around it, no explanations, no notes, no options, no sign-off offers ("Let me know if...").
- Never describe what you wrote. "draft a message: happy Diwali" means you output the Diwali message itself, not "Message drafted".
- If the screen of the user's phone is given, read it: who they are talking to, what was said last, the app. Reply to what is actually there, using real names and details. Never use placeholders like [Name].
- Match the language, script and tone requested. If the user asks for Hindi, Hinglish or Gujarati, or the conversation on screen is in that language, write in it.
- Fit the app: chat messages are short and natural; an email gets a greeting and a sign-off with the user's name.
- Sound like a person, not an AI: no filler, no em dashes, emoji only if the conversation uses them or the request suits them (a festival wish may have one).
- For questions, answer in 1-3 sentences, plain text, to the point.
- You cannot act on the user's computer or phone from here. If asked to do something (open an app, send, add a to-do), say in one short sentence that you can only answer, and give the most useful text you can.`;

export function phoneAnswerSystem(context: string): string {
  return `${PHONE_ANSWER_RULES}\n\nWhat Flo knows about the user (use only when relevant):\n${context}`;
}

/** The user message: the visible phone screen (bubble Ask only, never password fields), then the request. */
export function phoneAnswerUser(question: string, screen: string | null | undefined): string {
  const s = (screen ?? "").trim();
  if (!s) return question;
  const first = s.split("\n", 1)[0];
  const app = first.startsWith("App:") ? first.slice(4).trim() : "";
  const head = app ? `What's on the user's phone screen (app: ${app}):` : "What's on the user's phone screen:";
  return `${head}\n"""\n${s.slice(0, 6000)}\n"""\n\nThe user's request: ${question}`;
}

const PREAMBLE_STARTS = ["here", "sure", "okay", "ok,", "ok!", "of course", "certainly", "absolutely", "draft", "message", "reply", "below"];
const FILLER_STARTS = ["let me know", "feel free", "hope this helps", "i hope this", "would you like", "want me to"];
const QUOTES: [string, string][] = [['"', '"'], ["\u201c", "\u201d"], ["'", "'"], ["\u2018", "\u2019"], ["\u00ab", "\u00bb"]];

function isPreamble(line: string): boolean {
  const l = line.trim().toLowerCase();
  return l.endsWith(":") && [...l].length <= 80 && PREAMBLE_STARTS.some((p) => l.startsWith(p));
}

function stripWrappingQuotes(s: string): string {
  for (const [open, close] of QUOTES) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      const inner = s.slice(open.length, s.length - close.length);
      if (!inner.includes(open) && !inner.includes(close) && inner.trim()) return inner.trim();
    }
  }
  return s;
}

/** Em/en dashes read as AI-written (same as strip_ai_dashes in src-tauri/src/text.rs). */
function stripAiDashes(s: string): string {
  let t = s.replaceAll(" \u2014 ", ", ").replaceAll(" \u2013 ", ", ").replaceAll("\u2014", ", ").replaceAll(" -- ", ", ");
  t = t.replaceAll("\u2013", "-");
  while (t.includes(",,")) t = t.replaceAll(",,", ",");
  return t.replaceAll(" ,", ",");
}

/** Safety net on a model's answer: drop "Here's a draft:", code fences, quotes around everything, "Let me know if...". */
export function cleanPhoneAnswer(raw: string): string {
  let s = raw.trim();
  if (s.length >= 6 && s.startsWith("```") && s.endsWith("```")) {
    let inner = s.slice(3, -3);
    const nl = inner.indexOf("\n");
    if (nl >= 0 && /^[A-Za-z0-9]*$/.test(inner.slice(0, nl).trim())) inner = inner.slice(nl + 1);
    s = inner.trim();
  }
  const lower = s.toLowerCase();
  for (const p of ["draft:", "message:", "reply:"]) {
    if (lower.startsWith(p) && s.slice(p.length).trim()) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  const nl = s.indexOf("\n");
  if (nl >= 0 && isPreamble(s.slice(0, nl)) && s.slice(nl + 1).trim()) s = s.slice(nl + 1).trim();
  const lines = s.split("\n");
  while (lines.length > 1) {
    const l = lines[lines.length - 1].trim().toLowerCase();
    if (!l || FILLER_STARTS.some((p) => l.startsWith(p))) lines.pop();
    else break;
  }
  return stripAiDashes(stripWrappingQuotes(lines.join("\n").trim())).slice(0, 4000);
}

export const CONTEXT_MAX = 6000;

/**
 * Screen text from the phone: keep line breaks (chats read top to bottom), strip control characters,
 * collapse spaces, and over the cap keep the first line (App: ...) plus the newest (bottom) lines.
 */
export function cleanContext(v: unknown, max = CONTEXT_MAX): string | null {
  const s = normalizeLines(v);
  if (!s) return null;
  if (s.length <= max) return s;
  const all = s.split("\n");
  const head = all[0].slice(0, 300);
  const kept: string[] = [];
  let size = head.length + 1;
  for (let i = all.length - 1; i > 0; i--) {
    if (size + all[i].length + 1 > max) break;
    kept.unshift(all[i]);
    size += all[i].length + 1;
  }
  return [head, ...kept].join("\n");
}

/** An answer for the phone: like cleanText, but keeps line breaks (an email draft stays an email). */
export function cleanAnswer(v: unknown, max = 4000): string | null {
  const s = normalizeLines(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "\u2026" : s;
}

function normalizeLines(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const lines = v
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() || null;
}

// ── answering in the cloud while the computer is off ──────────────────────────

/** A computer that hasn't taken a phone ask after this long (and looks offline) gets the cloud fallback. */
export const CLOUD_AFTER_MS = 8_000;
/** Same as ONLINE_WITHIN_MS in desktop-state.ts: the computer republishes at least every 5 minutes. */
const ONLINE_WITHIN_MS = 12 * 60_000;

export type AskState = { mode: string; status: string; createdAt: string; cloudTriedAt?: string | null };

/** No snapshot from the computer, or none in 12 minutes. */
export function computerOffline(desktopSeenAt: string | null, now: Date = new Date()): boolean {
  if (!desktopSeenAt) return true;
  const age = now.getTime() - new Date(desktopSeenAt).getTime();
  return !(age < ONLINE_WITHIN_MS);
}

function waitedLongEnough(r: AskState, now: Date): boolean {
  const age = now.getTime() - new Date(r.createdAt).getTime();
  return Number.isFinite(age) && age >= CLOUD_AFTER_MS;
}

/** Answer this phone ask with cloud AI? Only asks (to-dos and notes need the computer), once. */
export function shouldAnswerInCloud(r: AskState, desktopSeenAt: string | null, now: Date = new Date()): boolean {
  return r.mode === "ask" && r.status === "pending" && !r.cloudTriedAt && waitedLongEnough(r, now) && computerOffline(desktopSeenAt, now);
}

/** A to-do / note waiting for a computer that is off: tell the phone it is saved and will be added later. */
export function queuedOffline(r: AskState, desktopSeenAt: string | null, now: Date = new Date()): boolean {
  return (r.mode === "todo" || r.mode === "note") && r.status === "pending" && waitedLongEnough(r, now) && computerOffline(desktopSeenAt, now);
}

export const QUEUED_TEXT = "Saved. Your computer will add it when it's back online.";
export const CLOUD_MODEL = "anthropic/claude-sonnet-5.5";
export const CLOUD_TIMEOUT_MS = 20_000;
