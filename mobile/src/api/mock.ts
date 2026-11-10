// In-memory mock of the Flo server, used by `?mock` on web (visual review)
// or EXPO_PUBLIC_FLO_MOCK=1. Never used in a normal build.
import { Platform } from 'react-native';
import type { FloApi } from './client';
import { parseComputer } from '../lib/computer';
import type { AskRequest, ComputerSnapshot, InboxItem, PairClaimResponse, PhoneAction, Presence, Session } from './types';
import { STRESS_USER, stressInbox, stressState } from './mockStress';

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

/** `?mock&tab=todos|needs|settings|computer`: open a tab (or the computer settings) for screenshots. */
export function mockStartTab(): string | null {
  return query()?.get('tab') ?? null;
}

export function mockEmptyInbox(): boolean {
  return query()?.has('empty') === true;
}

/** `?mock&stress`: long names and titles plus Hindi / Gujarati copy, for layout review. */
const stress = (): boolean => query()?.has('stress') === true;

export const MOCK_SESSION: Session = {
  server: 'https://flo.hellonaman.com',
  deviceToken: 'mock-device-token',
  user: stress() ? STRESS_USER : { name: 'Parth Gundaniya', email: 'parth@flo.app' },
};

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function mockInbox(): InboxItem[] {
  const items: InboxItem[] = [
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
  return stress() ? stressInbox(items) : items;
}

const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

/** What a computer would publish (same shape as the server's GET /api/mobile/state). */
export function mockComputer(): ComputerSnapshot {
  // `?mock&nocomputer`: the computer hasn't published anything yet
  if (query()?.has('nocomputer')) return { state: null, updatedAt: null, actions: [] };
  const at = (h: number, m = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const opts = (...o: [string, string][]) => o.map(([value, label]) => ({ value, label }));
  const snap = parseComputer({
    state: {
      v: 1,
      computer: { platform: 'macos', appVersion: '0.9.1' },
      todos: {
        open: [
          { id: 't1', title: 'Review PR #214 for the upload limits', due: at(16, 30), source: 'voice', createdAt: ago(90) },
          { id: 't2', title: 'Send invoice to Acme', due: ago(60 * 26), source: 'meeting', person: 'Riya', createdAt: ago(60 * 30) },
          { id: 't3', title: 'Book flights to Goa', source: 'phone', createdAt: ago(240) },
          { id: 't4', title: 'Renew the flo.app domain', source: 'slack', createdAt: ago(60 * 20) },
          { id: 't5', title: 'Reply to Alex about the design sync', source: 'slack', person: 'Alex', createdAt: ago(60 * 5) },
        ],
        done: [
          { id: 't0', title: 'Pay the electricity bill', completedAt: ago(35) },
          { id: 't9', title: 'Call Mom back', completedAt: ago(60 * 22) },
        ],
      },
      approvals: [
        { id: 'q1', project: 'website', summary: 'Run: npm run migrate', tool: 'Bash', at: ago(0.3), expiresAt: ahead(1.7) },
        { id: 'q2', project: 'api', summary: 'Edit rate_limit.rs', tool: 'Edit', at: ago(0.1), expiresAt: ahead(1.9) },
      ],
      waiting: [{ id: 's1', project: 'mobile', message: 'Claude is waiting for your input', status: 'waiting_reply', at: ago(6) }],
      sessions: [
        {
          id: 'c1', project: 'api', folder: 'api', state: 'waiting_reply', updatedAt: ago(0.4), reply: 'answer',
          message: 'I can store sessions in Postgres or SQLite. Which do you want?',
          question: { id: 'aq1', questions: [{ question: 'Which database should the session store use?', header: 'Database', multiSelect: false, options: ['Postgres', 'SQLite', 'Redis'] }] },
        },
        { id: 'c2', project: 'website', folder: 'website', state: 'needs_approval', updatedAt: ago(0.3), reply: 'answer', approvalId: 'q1', message: 'Ready to run the migration.' },
        { id: 'c3', project: 'Flo', folder: 'flo-mvp', state: 'done', updatedAt: ago(4), reply: 'instant', message: 'Done. The notch now shows every session, and tests pass.' },
        { id: 'c4', project: 'mobile', folder: 'mobile', state: 'working', updatedAt: ago(1), reply: 'queued', message: 'Running the Jest suite.' },
        { id: 'c5', project: 'docs', folder: 'docs', state: 'idle', updatedAt: ago(90), reply: 'none', replyHint: 'This session finished before Flo last started, so it isn\'t listening for your phone. Send it anything in its terminal once and your phone can reply after that.', message: 'Updated the README.' },
      ],
      settings: [
        { key: 'theme', label: 'Theme', section: 'Appearance', kind: 'select', value: 'light', editable: true, options: opts(['light', 'Light'], ['dark', 'Dark'], ['system', 'System']) },
        { key: 'notchStyle', label: 'Notch animation', section: 'Appearance', kind: 'select', value: 'ribbon', editable: true, options: opts(['ribbon', 'Ribbon'], ['wave', 'Wave'], ['bars', 'Bars'], ['pulse', 'Pulse'], ['orb', 'Orb'], ['aurora', 'Aurora']) },
        { key: 'avatar.enabled', label: 'Notchling in the notch', section: 'Appearance', kind: 'toggle', value: true, editable: true },
        { key: 'accent', label: 'Accent colour', section: 'Appearance', kind: 'text', value: '#3dbbff', editable: false, hint: 'Change this on your computer.' },
        { key: 'playSounds', label: 'Play sounds', section: 'Sounds and alerts', kind: 'toggle', value: true, editable: true },
        { key: 'soundPack', label: 'Sound style', section: 'Sounds and alerts', kind: 'select', value: 'chime', editable: true, options: opts(['chime', 'Chime'], ['glass', 'Glass'], ['soft', 'Soft'], ['pop', 'Pop']) },
        { key: 'soundVolume', label: 'Volume', section: 'Sounds and alerts', kind: 'number', value: 70, editable: true, min: 0, max: 100 },
        { key: 'systemNotifications', label: 'System notifications', section: 'Sounds and alerts', kind: 'toggle', value: true, editable: true },
        { key: 'hotkeyDictation', label: 'Dictation key', section: 'Dictation', kind: 'text', value: 'ctrl', editable: false, hint: 'Change this on your computer.' },
        { key: 'cleanupEnabled', label: 'Clean up what you say', section: 'Dictation', kind: 'toggle', value: true, editable: true },
        { key: 'autoLanguages', label: 'Languages to listen for', section: 'Dictation', kind: 'list', value: ['en', 'hi', 'gu'], editable: false, hint: 'Change this on your computer.' },
        { key: 'llmModel', label: 'Assistant model', section: 'Assistant', kind: 'text', value: 'qwen3:8b', editable: false, hint: 'Change this on your computer.' },
        { key: 'assistantCloudAllowed', label: 'Allow cloud models', section: 'Assistant', kind: 'toggle', value: true, editable: false, hint: 'A privacy setting. Change it on your computer.' },
        { key: 'claudeApprovals', label: 'Allow or deny from Flo', section: 'Claude Code', kind: 'toggle', value: true, editable: true },
        { key: 'claudeAutoContinue', label: 'Continue after usage limits reset', section: 'Claude Code', kind: 'toggle', value: false, editable: true },
        { key: 'meetingDetection', label: 'Notice meetings', section: 'Meetings and to-dos', kind: 'toggle', value: true, editable: true },
        { key: 'autoAwayMinutes', label: 'Away after (minutes idle)', section: 'Away mode', kind: 'number', value: 10, editable: true, min: 1, max: 240 },
        { key: 'attentionEnabled', label: 'Screen awareness', section: 'Privacy', kind: 'toggle', value: false, editable: false, hint: 'A privacy setting. Change it on your computer.' },
      ],
    },
    updatedAt: ago(0.5),
    actions: [],
  });
  if (stress() && snap.state) snap.state = stressState(snap.state);
  return snap;
}

export function createMockApi(): FloApi & { claim(): Promise<PairClaimResponse> } {
  let presence: Presence = { status: 'away', since: ago(42) };
  const inbox = mockEmptyInbox() ? [] : mockInbox();
  const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const asks = new Map<string, AskRequest>();
  const computer = mockComputer();
  const actions: PhoneAction[] = [];
  /** what the desktop does with an action a moment later */
  const applyLater = (a: PhoneAction) =>
    setTimeout(() => {
      const st = computer.state;
      if (!st) return;
      if (a.kind === 'todo_done') {
        const t = st.todos.open.find((x) => x.id === a.target);
        if (t) {
          st.todos.open = st.todos.open.filter((x) => x.id !== t.id);
          st.todos.done = [{ id: t.id, title: t.title, completedAt: new Date().toISOString() }, ...st.todos.done];
        }
      } else if (a.kind === 'todo_reopen') {
        const t = st.todos.done.find((x) => x.id === a.target);
        if (t) {
          st.todos.done = st.todos.done.filter((x) => x.id !== t.id);
          st.todos.open = [{ id: t.id, title: t.title, createdAt: new Date().toISOString() }, ...st.todos.open];
        }
      } else if (a.kind === 'approve' || a.kind === 'reject') {
        st.approvals = st.approvals.filter((x) => x.id !== a.target);
      } else if (a.kind === 'setting') {
        const v = a.value;
        if (v !== null && typeof v !== 'object') st.settings = st.settings.map((x) => (x.key === a.target ? { ...x, value: v } : x));
      } else if (a.kind === 'reply' || a.kind === 'choose') {
        const sess = st.sessions.find((x) => x.id === a.target);
        if (sess) {
          a.message = sess.reply === 'queued' ? `Queued for ${sess.folder}. Claude gets it when it finishes what it's doing.` : `Sent to ${sess.folder}. Claude is on it.`;
          st.sessions = st.sessions.map((x) => (x.id === a.target ? { ...x, state: 'working', question: undefined, approvalId: undefined, reply: 'queued' } : x));
        }
      }
      a.status = 'done';
      computer.updatedAt = new Date().toISOString();
    }, 1500);
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
    async getComputer() {
      await wait(250);
      return JSON.parse(JSON.stringify({ ...computer, actions })) as ComputerSnapshot;
    },
    async sendAction(kind, target, value) {
      await wait(300);
      const a: PhoneAction = { id: String(Date.now()), kind, target, value: value ?? null, status: 'pending', message: null, createdAt: new Date().toISOString() };
      actions.unshift(a);
      applyLater(a);
      return { ...a };
    },
    async getAsk(id) {
      await wait(900);
      const r = asks.get(id);
      if (!r) throw new Error('Not found.');
      return r;
    },
  };
}
