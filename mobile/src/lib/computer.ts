// Your computer on the phone: parse the snapshot the desktop publishes, overlay the phone's own
// changes while they're on the way, and reconcile them with what the computer reports back.
// Pure functions (unit-tested in __tests__/computer.test.ts).
import type {
  ActionKind,
  Approval,
  ComputerPlatform,
  ComputerSetting,
  ComputerSnapshot,
  ComputerState,
  PhoneAction,
  SettingKind,
  TodoDone,
  TodoOpen,
  WaitingSession,
} from '../api/types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const idOf = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : null);
function keep<T>(list: unknown, f: (x: Record<string, unknown>) => T | null): T[] {
  return arr(list)
    .map((x) => (isObj(x) ? f(x) : null))
    .filter((x): x is T => x !== null);
}

const PLATFORMS: ComputerPlatform[] = ['macos', 'windows', 'linux'];
const KINDS: SettingKind[] = ['toggle', 'select', 'number', 'text', 'list'];
const ACTION_KINDS: ActionKind[] = ['todo_done', 'todo_reopen', 'approve', 'reject', 'setting'];
const STATUSES = ['pending', 'taken', 'done', 'failed'] as const;

function parseState(r: unknown): ComputerState | null {
  if (!isObj(r)) return null;
  const c = isObj(r.computer) ? r.computer : {};
  const todos = isObj(r.todos) ? r.todos : {};
  return {
    computer: {
      platform: PLATFORMS.includes(c.platform as ComputerPlatform) ? (c.platform as ComputerPlatform) : 'other',
      appVersion: s(c.appVersion),
    },
    todos: {
      open: keep<TodoOpen>(todos.open, (t) => {
        const id = idOf(t.id);
        const title = s(t.title).trim();
        if (!id || !title) return null;
        const o: TodoOpen = { id, title, createdAt: s(t.createdAt) };
        if (typeof t.due === 'string') o.due = t.due;
        if (typeof t.source === 'string') o.source = t.source;
        if (typeof t.person === 'string') o.person = t.person;
        return o;
      }),
      done: keep<TodoDone>(todos.done, (t) => {
        const id = idOf(t.id);
        const title = s(t.title).trim();
        return id && title ? { id, title, completedAt: s(t.completedAt) } : null;
      }),
    },
    approvals: keep<Approval>(r.approvals, (a) => {
      const id = idOf(a.id);
      const summary = s(a.summary).trim();
      if (!id || !summary) return null;
      return { id, project: s(a.project, 'Claude Code'), summary, tool: s(a.tool), at: s(a.at), expiresAt: s(a.expiresAt) };
    }),
    waiting: keep<WaitingSession>(r.waiting, (w) => {
      const id = s(w.id);
      if (!id) return null;
      return { id, project: s(w.project, 'Claude Code'), message: s(w.message), status: w.status === 'needs_approval' ? 'needs_approval' : 'waiting_reply', at: s(w.at) };
    }),
    settings: keep<ComputerSetting>(r.settings, (x) => {
      const kind = KINDS.includes(x.kind as SettingKind) ? (x.kind as SettingKind) : null;
      const key = s(x.key);
      const label = s(x.label);
      if (!kind || !key || !label) return null;
      const v = x.value;
      const ok =
        (kind === 'toggle' && typeof v === 'boolean') ||
        (kind === 'number' && typeof v === 'number') ||
        ((kind === 'select' || kind === 'text') && typeof v === 'string') ||
        (kind === 'list' && Array.isArray(v));
      if (!ok) return null;
      const out: ComputerSetting = {
        key,
        label,
        section: s(x.section, 'General'),
        kind,
        value: kind === 'list' ? (v as unknown[]).filter((i): i is string => typeof i === 'string') : (v as boolean | number | string),
        editable: x.editable === true,
      };
      if (kind === 'select') out.options = keep(x.options, (o) => (typeof o.value === 'string' && typeof o.label === 'string' ? { value: o.value, label: o.label } : null));
      if (typeof x.min === 'number') out.min = x.min;
      if (typeof x.max === 'number') out.max = x.max;
      if (typeof x.hint === 'string') out.hint = x.hint;
      return out;
    }),
  };
}

function toAction(a: Record<string, unknown>): PhoneAction | null {
  if (typeof a.id !== 'number' && typeof a.id !== 'string') return null;
  const kind = ACTION_KINDS.includes(a.kind as ActionKind) ? (a.kind as ActionKind) : null;
  if (!kind) return null;
  const v = a.value;
  return {
    id: String(a.id),
    kind,
    target: s(a.target),
    value: typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : null,
    status: STATUSES.includes(a.status as (typeof STATUSES)[number]) ? (a.status as PhoneAction['status']) : 'pending',
    message: typeof a.message === 'string' ? a.message : null,
    createdAt: s(a.createdAt),
  };
}

/** GET /api/mobile/state → snapshot (never throws on odd data). */
export function parseComputer(json: unknown): ComputerSnapshot {
  if (!isObj(json)) return { state: null, updatedAt: null, actions: [] };
  return {
    state: parseState(json.state),
    updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
    actions: keep(json.actions, toAction),
  };
}

/** `{action: {...}}` from POST /api/mobile/actions. */
export function parseAction(json: unknown): PhoneAction {
  const a = isObj(json) && isObj(json.action) ? toAction(json.action) : null;
  if (!a) throw new Error('The server sent an unexpected reply.');
  return a;
}

// ── what's on the way ─────────────────────────────────────────────────────────

/** A change the phone sent and is still showing optimistically. */
export interface Pending {
  /** one per thing: todo:<id> | approval:<id> | setting:<key> */
  key: string;
  kind: ActionKind;
  target: string;
  value: boolean | number | string | null;
  /** phone clock, ms */
  createdAt: number;
  /** server id once the POST returned */
  actionId?: string;
  /** first poll that saw it done: the snapshot's updatedAt then, and when */
  doneSeen?: { updatedAt: string | null; at: number };
}

export const pendingKey = (kind: ActionKind, target: string) =>
  `${kind === 'todo_done' || kind === 'todo_reopen' ? 'todo' : kind === 'setting' ? 'setting' : 'approval'}:${target}`;

const GIVE_UP_MS = 90_000;
const TRUST_DONE_MS = 15_000;

/** Questions the computer is still holding (it hands them back to the terminal after 2 minutes). */
export function liveApprovals(state: ComputerState, now = Date.now()): Approval[] {
  return state.approvals.filter((a) => {
    const t = Date.parse(a.expiresAt);
    return Number.isNaN(t) || t > now;
  });
}

/** The snapshot with the phone's own changes applied on top. */
export function overlay(state: ComputerState, pending: Pending[], now = Date.now()): ComputerState {
  let open = state.todos.open;
  let done = state.todos.done;
  let approvals = state.approvals;
  let settings = state.settings;
  for (const p of pending) {
    if (p.kind === 'todo_done') {
      const t = open.find((x) => x.id === p.target);
      if (t) {
        open = open.filter((x) => x.id !== p.target);
        done = [{ id: t.id, title: t.title, completedAt: new Date(now).toISOString() }, ...done.filter((x) => x.id !== t.id)];
      }
    } else if (p.kind === 'todo_reopen') {
      const t = done.find((x) => x.id === p.target);
      if (t) {
        done = done.filter((x) => x.id !== p.target);
        open = [{ id: t.id, title: t.title, createdAt: t.completedAt }, ...open.filter((x) => x.id !== t.id)];
      }
    } else if (p.kind === 'approve' || p.kind === 'reject') {
      const kind = p.kind;
      approvals = approvals.map((a) => (a.id === p.target ? { ...a, sending: kind } : a));
    } else if (p.kind === 'setting') {
      settings = settings.map((x) => (x.key === p.target && p.value !== null ? { ...x, value: p.value, sending: true } : x));
    }
  }
  return { ...state, todos: { open, done }, approvals, settings };
}

/** Match what's on the way against a fresh poll → what's still pending + messages for failures. */
export function reconcile(
  pending: Pending[],
  polled: { updatedAt: string | null; actions: PhoneAction[] },
  now = Date.now(),
): { pending: Pending[]; failures: string[] } {
  const failures: string[] = [];
  const next: Pending[] = [];
  for (const p of pending) {
    if (!p.actionId) {
      if (now - p.createdAt < GIVE_UP_MS) next.push(p);
      continue;
    }
    const a = polled.actions.find((x) => x.id === p.actionId);
    if (!a) continue; // too old for the server to list: trust the snapshot
    if (a.status === 'failed') {
      failures.push(a.message || "Your computer couldn't do that.");
      continue;
    }
    if (a.status === 'done') {
      if (!p.doneSeen) next.push({ ...p, doneSeen: { updatedAt: polled.updatedAt, at: now } });
      else if (polled.updatedAt === p.doneSeen.updatedAt && now - p.doneSeen.at < TRUST_DONE_MS) next.push(p);
      continue;
    }
    if (now - p.createdAt > GIVE_UP_MS) {
      failures.push("Your computer hasn't picked this up yet. It will once Flo is open there.");
      continue;
    }
    next.push(p);
  }
  return { pending: next, failures };
}

// ── labels ────────────────────────────────────────────────────────────────────

export function computerName(p: ComputerPlatform): string {
  return p === 'macos' ? 'Mac' : p === 'windows' ? 'Windows PC' : p === 'linux' ? 'Linux computer' : 'computer';
}

/** The computer republishes every 5 minutes while Flo runs there. */
export function freshness(updatedAt: string | null, now = Date.now()): { offline: boolean; ageMs: number } {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(t)) return { offline: true, ageMs: Infinity };
  const ageMs = Math.max(0, now - t);
  return { offline: ageMs > 12 * 60_000, ageMs };
}

export function groupSettings(list: ComputerSetting[]): { section: string; items: ComputerSetting[] }[] {
  const out: { section: string; items: ComputerSetting[] }[] = [];
  for (const x of list) {
    const g = out.find((o) => o.section === x.section);
    if (g) g.items.push(x);
    else out.push({ section: x.section, items: [x] });
  }
  return out;
}

export function settingText(x: ComputerSetting): string {
  const v = x.value;
  if (x.kind === 'toggle') return v ? 'On' : 'Off';
  if (x.kind === 'select') return x.options?.find((o) => o.value === v)?.label ?? String(v);
  if (x.kind === 'list') return Array.isArray(v) && v.length ? v.join(', ') : 'None';
  const t = String(v);
  return t || 'Not set';
}

const TIME = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Today 6:30 PM", "Tomorrow 9:00 AM", "Overdue · Nov 7", "Fri 9:00 AM". */
export function dueLabel(due: string | undefined, now = Date.now()): string {
  const t = due ? Date.parse(due) : NaN;
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(today)) / 86_400_000);
  if (t < now && diff < 0) return `Overdue · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  if (diff === 0) return `Today ${TIME(d)}`;
  if (diff === 1) return `Tomorrow ${TIME(d)}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${TIME(d)}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
