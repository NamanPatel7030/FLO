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
  /** While pending: why the computer hasn't picked it up yet (other account, offline, busy). */
  hint?: string;
  /** 'cloud' when the server answered because the computer was off. */
  answeredBy?: 'computer' | 'cloud';
  /** A to-do / note saved on the server until the computer is back online (hint says so). */
  queued?: boolean;
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
/** working | waiting for a reply or a choice | waiting for Allow / Deny | finished in the last 30 minutes | quiet */
export type SessionState = 'working' | 'waiting_reply' | 'needs_approval' | 'done' | 'idle';
/** How a reply reaches the session right now (none: replyHint says why). */
export type SessionReply = 'instant' | 'queued' | 'answer' | 'resume' | 'none';
export interface SessionQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: string[];
}
/** One Claude Code session on the computer. */
export interface ClaudeSessionView {
  id: string;
  project: string;
  folder: string;
  state: SessionState;
  message: string;
  updatedAt: string;
  reply: SessionReply;
  replyHint?: string;
  /** its Allow / Deny question (an id in `approvals`) */
  approvalId?: string;
  /** a multiple-choice question Claude is asking */
  question?: { id: string; questions: SessionQuestion[] };
  /** set on the phone while a reply or choice is on the way */
  sending?: { kind: 'reply' | 'choose'; text: string; since: number };
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
/** An upcoming calendar event from the computer (Connect Google), soonest first. */
export interface Meeting {
  id: string;
  title: string;
  /** ISO 8601 */
  start: string;
  end: string;
  /** other people invited */
  attendees: number;
  /** has a join link (Meet, Zoom, Teams) */
  join: boolean;
}
export interface ComputerState {
  computer: { platform: ComputerPlatform; appVersion: string };
  todos: { open: TodoOpen[]; done: TodoDone[] };
  approvals: Approval[];
  waiting: WaitingSession[];
  sessions: ClaudeSessionView[];
  settings: ComputerSetting[];
  /** at most 3; [] when Google isn't connected */
  meetings: Meeting[];
}
export type ActionKind = 'todo_done' | 'todo_reopen' | 'approve' | 'reject' | 'setting' | 'reply' | 'choose';
/** `choose`: option labels for each question, in order (`id` = the question's id). */
export interface ChooseValue {
  id?: string;
  answers: string[][];
}
export type ActionValue = boolean | number | string | ChooseValue;
export interface PhoneAction {
  id: string;
  kind: ActionKind;
  target: string;
  value: ActionValue | null;
  status: AskStatus;
  message: string | null;
  createdAt: string;
}
export interface ComputerSnapshot {
  state: ComputerState | null;
  updatedAt: string | null;
  actions: PhoneAction[];
}
