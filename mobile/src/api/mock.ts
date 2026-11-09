// In-memory mock of the Flo server, used by `?mock` on web (visual review)
// or EXPO_PUBLIC_FLO_MOCK=1. Never used in a normal build.
import { Platform } from 'react-native';
import type { FloApi } from './client';
import type { AskRequest, InboxItem, PairClaimResponse, Presence, Session } from './types';

function query(): URLSearchParams | null {
  if (Platform.OS !== 'web') return null;
  try {
    return new URLSearchParams(globalThis.location?.search ?? '');
  } catch {
    return null;
  }
}

export function isMockMode(): boolean {
  return query()?.has('mock') === true || process.env.EXPO_PUBLIC_FLO_MOCK === '1';
}

/** `?mock&screen=home|settings|welcome|code|scan` — jump straight to a screen for screenshots. */
export function mockStartScreen(): string | null {
  return query()?.get('screen') ?? null;
}

export function mockEmptyInbox(): boolean {
  return query()?.has('empty') === true;
}

export const MOCK_SESSION: Session = {
  server: 'https://flo.hellonaman.com',
  deviceToken: 'mock-device-token',
  user: { name: 'Parth Gundaniya', email: 'parth@flo.app' },
};

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function mockInbox(): InboxItem[] {
  return [
    {
      id: '108',
      kind: 'claude_done',
      title: 'Claude finished in api',
      body: '3 files changed · Added rate limiting to /v1/upload and tests pass (42/42).',
      data: { project: 'api' },
      createdAt: ago(2),
    },
    {
      id: '107',
      kind: 'claude_needs_you',
      title: 'Claude needs you in website',
      body: 'Waiting for approval to run `npm run migrate`.',
      data: { project: 'website' },
      createdAt: ago(14),
    },
    {
      id: '106',
      kind: 'reminder',
      title: 'Call Mom back',
      body: 'You asked Flo to remind you at 6:30 PM.',
      data: null,
      createdAt: ago(48),
    },
    {
      id: '105',
      kind: 'meeting_summary',
      title: 'Design sync — summary',
      body: 'Ship the notch onboarding Friday. Riya owns copy; you own the QR pairing flow. 2 action items.',
      data: null,
      createdAt: ago(130),
    },
    {
      id: '104',
      kind: 'skill_ran',
      title: 'Morning brief ran',
      body: 'Weather 18°, 3 meetings, 12 unread emails — 2 flagged from Alex.',
      data: null,
      createdAt: ago(320),
    },
    {
      id: '103',
      kind: 'todos_digest',
      title: 'Your to-dos for today',
      body: 'Review PR #214 · Book flights to Goa · Renew domain flo.app · Pay electricity bill',
      data: null,
      createdAt: ago(560),
    },
    {
      id: '102',
      kind: 'todo_due',
      title: 'Due now: Send invoice to Acme',
      body: 'From your to-do list.',
      data: null,
      createdAt: ago(60 * 26),
    },
  ];
}

export function createMockApi(): FloApi & { claim(): Promise<PairClaimResponse> } {
  let presence: Presence = { status: 'away', since: ago(42) };
  const inbox = mockEmptyInbox() ? [] : mockInbox();
  const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const asks = new Map<string, AskRequest>();
  return {
    async claim() {
      await wait(700);
      return { deviceToken: MOCK_SESSION.deviceToken, user: MOCK_SESSION.user, server: MOCK_SESSION.server };
    },
    async getPresence() {
      await wait();
      return presence;
    },
    async setPresence(status) {
      await wait(250);
      presence = { status, since: new Date().toISOString() };
      return presence;
    },
    async updatePushToken() {
      await wait();
    },
    async inbox(after) {
      await wait();
      if (!after) return inbox;
      const idx = inbox.findIndex((i) => i.id === after);
      return idx === -1 ? inbox : inbox.slice(0, idx);
    },
    async unpair() {
      await wait();
    },
    async ask(mode, text) {
      await wait(400);
      const id = String(Date.now());
      const answer =
        mode === 'todo' ? `Added to your to-dos: ${text}` : mode === 'note' ? 'Saved to your notes.' : 'You have 3 meetings today. The first is the Acme sync at 11:00.';
      asks.set(id, { id, mode, text, status: 'done', answer, createdAt: new Date().toISOString() });
      return { id, mode, text, status: 'pending', answer: null, createdAt: new Date().toISOString() };
    },
    async getAsk(id) {
      await wait(900);
      const r = asks.get(id);
      if (!r) throw new Error('Not found.');
      return r;
    },
  };
}
