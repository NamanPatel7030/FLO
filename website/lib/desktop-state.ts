// Pure validation for the computer snapshot (to-dos, Claude Code sessions and approvals, non-secret settings) that the
// desktop app publishes for the paired phone, and for the actions the phone sends back.
// No imports, so node --test can run it directly (tests/desktop-state-logic.test.mjs).
//
// The server rebuilds every snapshot from known fields only, with caps, so junk (or a secret a buggy
// client tried to send) never lands in the database.

export const STATE_LIMITS = {
  /** whole request body */
  maxBytes: 160_000,
  openTodos: 100,
  doneTodos: 30,
  approvals: 20,
  waiting: 20,
  settings: 150,
  options: 24,
  listItems: 30,
  /** Claude Code sessions (all of them, not only the ones waiting) */
  sessions: 12,
  /** session's last message excerpt */
  sessionMessage: 400,
  /** questions in one multiple-choice prompt (AskUserQuestion allows 4) */
  questions: 4,
  questionOptions: 8,
  /** a typed reply to a session */
  replyChars: 4000,
} as const;

export type TodoOpen = { id: string; title: string; due?: string; source?: string; person?: string; project?: string; createdAt: string };
export type TodoDone = { id: string; title: string; completedAt: string };
export type Approval = { id: string; project: string; summary: string; tool: string; at: string; expiresAt: string };
export type Waiting = { id: string; project: string; message: string; status: "waiting_reply" | "needs_approval"; at: string };
/** working | waiting for a typed reply or a choice | waiting for Allow / Deny | finished in the last 30 minutes | quiet */
export type SessionState = "working" | "waiting_reply" | "needs_approval" | "done" | "idle";
/**
 * How a reply from the phone reaches the session right now: instantly (the session is idle and
 * listening), queued (it gets it when the current turn ends), as the answer to the question it is
 * asking, by starting it again in the background (its terminal is closed), or not at all.
 */
export type SessionReply = "instant" | "queued" | "answer" | "resume" | "none";
export type SessionQuestion = { question: string; header?: string; multiSelect: boolean; options: string[] };
export type Session = {
  id: string;
  project: string;
  folder: string;
  state: SessionState;
  message: string;
  updatedAt: string;
  reply: SessionReply;
  /** why the phone can't reply (reply = none) */
  replyHint?: string;
  /** the Allow / Deny question for this session (an id in `approvals`) */
  approvalId?: string;
  /** a multiple-choice question Claude is asking */
  question?: { id: string; questions: SessionQuestion[] };
};
export type SettingKind = "toggle" | "select" | "text" | "number" | "list";
export type SettingValue = boolean | number | string | string[];
export type SettingEntry = {
  key: string;
  label: string;
  section: string;
  kind: SettingKind;
  value: SettingValue;
  editable: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  min?: number;
  max?: number;
};
export type ComputerInfo = { platform: "macos" | "windows" | "linux" | "other"; appVersion: string; name?: string };
export type ComputerState = {
  v: 1;
  computer: ComputerInfo;
  todos: { open: TodoOpen[]; done: TodoDone[] };
  approvals: Approval[];
  waiting: Waiting[];
  sessions: Session[];
  settings: SettingEntry[];
};

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.]{0,59}$/;
/** setting keys that could hold a credential are never stored, whatever the desktop sends */
const SECRET_KEY_RE = /(api_?key|access_?key|private_?key|token|secret|passw|credential|cookie|bearer)/i;
const SETTING_KINDS: readonly SettingKind[] = ["toggle", "select", "text", "number", "list"];
const PLATFORMS = ["macos", "windows", "linux"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Trimmed single-line string capped at `max`, or null. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
const id = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : null);
const list = (v: unknown, cap: number): unknown[] => (Array.isArray(v) ? v.slice(0, cap * 2) : []);

function opt<T extends object, K extends string>(o: T, k: K, v: string | null): T {
  if (v) (o as Record<string, unknown>)[k] = v;
  return o;
}

function todoOpen(v: unknown): TodoOpen | null {
  if (!isObj(v)) return null;
  const i = id(v.id), title = str(v.title, 300);
  if (!i || !title) return null;
  const t: TodoOpen = { id: i, title, createdAt: str(v.createdAt, 40) ?? "" };
  opt(t, "due", str(v.due, 40));
  opt(t, "source", str(v.source, 40));
  opt(t, "person", str(v.person, 80));
  opt(t, "project", str(v.project, 80));
  return t;
}

function todoDone(v: unknown): TodoDone | null {
  if (!isObj(v)) return null;
  const i = id(v.id), title = str(v.title, 300);
  if (!i || !title) return null;
  return { id: i, title, completedAt: str(v.completedAt, 40) ?? "" };
}

function approval(v: unknown): Approval | null {
  if (!isObj(v)) return null;
  const i = id(v.id), summary = str(v.summary, 300);
  if (!i || !summary) return null;
  return {
    id: i,
    project: str(v.project, 80) ?? "Claude Code",
    summary,
    tool: str(v.tool, 80) ?? "",
    at: str(v.at, 40) ?? "",
    expiresAt: str(v.expiresAt, 40) ?? "",
  };
}

function waiting(v: unknown): Waiting | null {
  if (!isObj(v)) return null;
  const i = str(v.id, 80);
  if (!i) return null;
  return {
    id: i,
    project: str(v.project, 80) ?? "Claude Code",
    message: str(v.message, 300) ?? "",
    status: v.status === "needs_approval" ? "needs_approval" : "waiting_reply",
    at: str(v.at, 40) ?? "",
  };
}

const SESSION_STATES: readonly SessionState[] = ["working", "waiting_reply", "needs_approval", "done", "idle"];
const SESSION_REPLIES: readonly SessionReply[] = ["instant", "queued", "answer", "resume", "none"];

function sessionQuestion(v: unknown): SessionQuestion | null {
  if (!isObj(v)) return null;
  const question = str(v.question, 300);
  const options = list(v.options, STATE_LIMITS.questionOptions)
    .map((o) => str(o, 80))
    .filter((o): o is string => !!o)
    .slice(0, STATE_LIMITS.questionOptions);
  if (!question || !options.length) return null;
  const q: SessionQuestion = { question, multiSelect: v.multiSelect === true, options };
  opt(q, "header", str(v.header, 40));
  return q;
}

function session(v: unknown): Session | null {
  if (!isObj(v)) return null;
  const i = id(v.id);
  if (!i) return null;
  const s: Session = {
    id: i,
    project: str(v.project, 80) ?? "Claude Code",
    folder: str(v.folder, 80) ?? "",
    state: SESSION_STATES.includes(v.state as SessionState) ? (v.state as SessionState) : "idle",
    message: str(v.message, STATE_LIMITS.sessionMessage) ?? "",
    updatedAt: str(v.updatedAt, 40) ?? "",
    reply: SESSION_REPLIES.includes(v.reply as SessionReply) ? (v.reply as SessionReply) : "none",
  };
  opt(s, "replyHint", str(v.replyHint, 200));
  opt(s, "approvalId", id(v.approvalId));
  if (isObj(v.question)) {
    const qid = id(v.question.id);
    const questions = clean(v.question.questions, STATE_LIMITS.questions, sessionQuestion);
    if (qid && questions.length) s.question = { id: qid, questions };
  }
  return s;
}

function settingValue(kind: SettingKind, v: unknown): SettingValue | null {
  switch (kind) {
    case "toggle":
      return typeof v === "boolean" ? v : null;
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    case "list":
      return Array.isArray(v) ? v.slice(0, STATE_LIMITS.listItems).map((x) => str(x, 80)).filter((x): x is string => !!x) : null;
    default:
      return typeof v === "string" ? (str(v, 300) ?? "") : null;
  }
}

function setting(v: unknown): SettingEntry | null {
  if (!isObj(v)) return null;
  const key = typeof v.key === "string" && KEY_RE.test(v.key) ? v.key : null;
  const kind = SETTING_KINDS.includes(v.kind as SettingKind) ? (v.kind as SettingKind) : null;
  const label = str(v.label, 80);
  if (!key || !kind || !label || SECRET_KEY_RE.test(key)) return null;
  const value = settingValue(kind, v.value);
  if (value === null) return null;
  const s: SettingEntry = { key, label, section: str(v.section, 40) ?? "General", kind, value, editable: v.editable === true };
  if (kind === "select") {
    s.options = list(v.options, STATE_LIMITS.options)
      .map((o) => (isObj(o) ? { value: str(o.value, 80), label: str(o.label, 80) } : null))
      .filter((o): o is { value: string; label: string } => !!o?.value && !!o.label)
      .slice(0, STATE_LIMITS.options);
  }
  if (kind === "number") {
    if (typeof v.min === "number" && Number.isFinite(v.min)) s.min = v.min;
    if (typeof v.max === "number" && Number.isFinite(v.max)) s.max = v.max;
  }
  opt(s, "hint", str(v.hint, 200));
  return s;
}

function clean<T>(v: unknown, cap: number, f: (x: unknown) => T | null): T[] {
  return list(v, cap).map(f).filter((x): x is T => x !== null).slice(0, cap);
}

/** Validate a desktop snapshot. Returns the rebuilt state or an error message. */
export function parseSnapshot(body: unknown): { state: ComputerState } | { error: string } {
  if (!isObj(body)) return { error: "Expected a JSON object." };
  if (JSON.stringify(body).length > STATE_LIMITS.maxBytes) return { error: "The snapshot is too large." };
  const c = isObj(body.computer) ? body.computer : {};
  const platform = PLATFORMS.includes(c.platform as (typeof PLATFORMS)[number]) ? (c.platform as ComputerInfo["platform"]) : "other";
  const computer: ComputerInfo = { platform, appVersion: str(c.appVersion, 40) ?? "" };
  opt(computer, "name", str(c.name, 80));
  const todos = isObj(body.todos) ? body.todos : {};
  return {
    state: {
      v: 1,
      computer,
      todos: {
        open: clean(todos.open, STATE_LIMITS.openTodos, todoOpen),
        done: clean(todos.done, STATE_LIMITS.doneTodos, todoDone),
      },
      approvals: clean(body.approvals, STATE_LIMITS.approvals, approval),
      waiting: clean(body.waiting, STATE_LIMITS.waiting, waiting),
      sessions: clean(body.sessions, STATE_LIMITS.sessions, session),
      settings: clean(body.settings, STATE_LIMITS.settings, setting),
    },
  };
}

// ── phone → computer actions ────────────────────────────────────────────────

export const ACTION_KINDS = ["todo_done", "todo_reopen", "approve", "reject", "setting", "reply", "choose"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
/** `choose`: option labels for each question of the prompt, in order (`id` = the question's id). */
export type ChooseValue = { id?: string; answers: string[][] };
export type ActionIn = { kind: ActionKind; target: string; value: boolean | number | string | ChooseValue | null };

/** A typed reply: control characters dropped (newlines and tabs kept), trimmed, at most 4000 characters. */
function replyText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return t && t.length <= STATE_LIMITS.replyChars ? t : null;
}

function chooseValue(v: unknown): ChooseValue | null {
  if (!isObj(v) || !Array.isArray(v.answers)) return null;
  const answers = v.answers;
  if (!answers.length || answers.length > STATE_LIMITS.questions) return null;
  const out: string[][] = [];
  for (const a of answers) {
    if (!Array.isArray(a) || !a.length || a.length > 10) return null;
    const labels: string[] = [];
    for (const l of a) {
      if (typeof l !== "string") return null;
      const t = l.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
      if (!t || t.length > 200) return null;
      labels.push(t);
    }
    out.push(labels);
  }
  if (v.id === undefined) return { answers: out };
  const qid = id(v.id);
  return qid ? { id: qid, answers: out } : null;
}

/**
 * Validate a phone action. `setting` carries a value; `reply` the text for a Claude Code session;
 * `choose` the picked option labels. The computer re-checks everything (and only ever hands the
 * text to Claude as a prompt, never to a shell).
 */
export function parseAction(body: unknown): ActionIn | { error: string } {
  if (!isObj(body)) return { error: "Expected a JSON object." };
  const kind = ACTION_KINDS.includes(body.kind as ActionKind) ? (body.kind as ActionKind) : null;
  if (!kind) return { error: `kind must be one of ${ACTION_KINDS.join(", ")}.` };
  const target = id(body.target);
  if (!target) return { error: "Invalid target." };
  const v = body.value;
  if (kind === "reply") {
    const text = replyText(v);
    return text ? { kind, target, value: text } : { error: `A reply needs 1 to ${STATE_LIMITS.replyChars} characters.` };
  }
  if (kind === "choose") {
    const c = chooseValue(v);
    return c ? { kind, target, value: c } : { error: "Invalid choice." };
  }
  if (kind !== "setting") return { kind, target, value: null };
  if (typeof v === "boolean") return { kind, target, value: v };
  if (typeof v === "number" && Number.isFinite(v)) return { kind, target, value: v };
  if (typeof v === "string" && v.length <= 300) return { kind, target, value: v };
  return { error: "Invalid value." };
}

/** The computer republishes its snapshot at least every 5 minutes while Flo is open and signed in. */
const ONLINE_WITHIN_MS = 12 * 60_000;

export type WaitingReason = "no_computer" | "offline" | "busy";

function ago(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/**
 * Phone question still pending: say why, precisely. The usual cause is the computer being signed in
 * to a different Flo account than the phone, so name the phone's account.
 */
export function waitingHint(email: string, seenAt: string | null, now: Date = new Date()): { reason: WaitingReason; text: string } {
  if (!seenAt) {
    return {
      reason: "no_computer",
      text: `No computer is signed in to Flo as ${email}. Open Flo on your computer and sign in with ${email}.`,
    };
  }
  const age = now.getTime() - new Date(seenAt).getTime();
  if (!(age < ONLINE_WITHIN_MS)) {
    return { reason: "offline", text: `Your computer was last online ${ago(age)}. Open Flo on it, signed in as ${email}.` };
  }
  return { reason: "busy", text: "Your computer is online and should pick this up in a moment." };
}
