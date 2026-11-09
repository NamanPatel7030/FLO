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
