// Types mirroring docs/mobile-api.md (the server contract).

export type PresenceStatus = 'active' | 'away';

export interface Presence {
  status: PresenceStatus;
  /** ISO timestamp of the last status change. */
  since: string;
}

export type NotificationKind =
  | 'claude_done'
  | 'claude_needs_you'
  | 'todo_due'
  | 'todos_digest'
  | 'reminder'
  | 'skill_ran'
  | 'meeting_summary';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'claude_done',
  'claude_needs_you',
  'todo_due',
  'todos_digest',
  'reminder',
  'skill_ran',
  'meeting_summary',
];

export interface InboxItem {
  /** Opaque id from the server; normalised to a string on the client. */
  id: string;
  /** Usually a NotificationKind; unknown kinds are kept and shown generically. */
  kind: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface PairUser {
  name: string;
  email: string;
}

export interface PairClaimRequest {
  code: string;
  deviceName: string;
  platform: 'android';
  pushToken?: string;
}

export interface PairClaimResponse {
  deviceToken: string;
  user: PairUser;
  server: string;
}

/** What the phone persists after pairing. */
export interface Session {
  server: string;
  deviceToken: string;
  user: PairUser;
}

/** Ask Flo / Dictate: a request the phone queues for the paired Mac. */
export type AskMode = 'ask' | 'todo' | 'note';
export type AskStatus = 'pending' | 'taken' | 'done' | 'failed';
export interface AskRequest {
  id: string;
  mode: AskMode;
  text: string;
  status: AskStatus;
  answer: string | null;
  createdAt: string;
}

/** Your computer, as the paired desktop app last published it (GET /api/mobile/state). */
export type ComputerPlatform = 'macos' | 'windows' | 'linux' | 'other';
export interface TodoOpen {
  id: string;
  title: string;
  due?: string;
  source?: string;
  person?: string;
  createdAt: string;
}
export interface TodoDone {
  id: string;
  title: string;
  completedAt: string;
}
/** A Claude Code permission prompt waiting for Allow / Deny on the computer. */
export interface Approval {
  id: string;
  project: string;
  summary: string;
  tool: string;
  at: string;
  expiresAt: string;
  /** set on the phone while its answer is on the way */
  sending?: 'approve' | 'reject';
}
/** A session waiting for a typed reply (answer it on the computer). */
export interface WaitingSession {
  id: string;
  project: string;
  message: string;
  status: 'waiting_reply' | 'needs_approval';
  at: string;
}
export type SettingKind = 'toggle' | 'select' | 'number' | 'text' | 'list';
export type SettingValue = boolean | number | string | string[];
export interface ComputerSetting {
  key: string;
  label: string;
  section: string;
  kind: SettingKind;
  value: SettingValue;
  editable: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  hint?: string;
  /** set on the phone while a change is on the way */
  sending?: boolean;
}
export interface ComputerState {
  computer: { platform: ComputerPlatform; appVersion: string };
  todos: { open: TodoOpen[]; done: TodoDone[] };
  approvals: Approval[];
  waiting: WaitingSession[];
  settings: ComputerSetting[];
}
export type ActionKind = 'todo_done' | 'todo_reopen' | 'approve' | 'reject' | 'setting';
export interface PhoneAction {
  id: string;
  kind: ActionKind;
  target: string;
  value: boolean | number | string | null;
  status: AskStatus;
  message: string | null;
  createdAt: string;
}
export interface ComputerSnapshot {
  state: ComputerState | null;
  updatedAt: string | null;
  actions: PhoneAction[];
}
