// `?mock&stress`: worst-case copy for layout review: long names, long titles and messages, and
// Hindi / Gujarati text (their matras and ascenders need taller lines than Latin text).
// Web visual review only; never used in a normal build.
import type { ComputerState, InboxItem } from './types';

const HI = 'कृपया कल सुबह तक रिपोर्ट भेज दीजिए';
const GU = 'મહેરબાની કરીને આવતીકાલ સુધીમાં રિપોર્ટ મોકલો';

export const STRESS_USER = { name: 'Maximiliana-Alexandrina Venkataraghavan', email: 'maximiliana.alexandrina.venkataraghavan@verylongcompanyname.example.com' };

export function stressInbox(items: InboxItem[]): InboxItem[] {
  const [a, b, c, ...rest] = items;
  return [
    { ...a, title: `Claude finished in payments-reconciliation-service-v2 after a very long run`, body: `${HI} · ${GU} · 3 files changed and every single test in the suite passes now.` },
    { ...b, title: HI, body: GU },
    { ...c, title: GU, body: `${HI} ${HI}` },
    ...rest,
  ];
}

export function stressState(st: ComputerState): ComputerState {
  return {
    ...st,
    todos: {
      open: [
        { ...st.todos.open[0], title: 'Review pull request #2140 for the upload limits, the retry policy and the new rate limiter config before Friday' },
        { ...st.todos.open[1], title: HI, person: 'Maximiliana-Alexandrina Venkataraghavan' },
        { ...st.todos.open[2], title: GU },
        ...st.todos.open.slice(3),
      ],
      done: [{ ...st.todos.done[0], title: `${GU} ${HI}` }, ...st.todos.done.slice(1)],
    },
    approvals: st.approvals.map((a, i) =>
      i === 0 ? { ...a, project: 'payments-reconciliation-service-v2', summary: 'Run: npm run migrate -- --env=production --tenant=all-customers-everywhere' } : a,
    ),
    sessions: st.sessions.map((s, i) =>
      i === 0
        ? {
            ...s,
            folder: 'payments-reconciliation-service-v2-experimental',
            project: 'payments-reconciliation-service-v2-experimental-monorepo',
            message: `${HI} I can store sessions in Postgres or SQLite or Redis, each with different tradeoffs for durability, cost and latency. Which do you want?`,
            question: s.question && {
              ...s.question,
              questions: [{ ...s.question.questions[0], question: `${GU} Which database should the session store use for production traffic?`, options: ['PostgreSQL with connection pooling (recommended)', 'SQLite', HI] }],
            },
          }
        : i === 2
          ? { ...s, message: `${GU} ${HI} Done. The notch now shows every session, and all of the tests pass on macOS, Windows and Linux.` }
          : s,
    ),
    settings: st.settings.map((s) =>
      s.key === 'autoAwayMinutes'
        ? { ...s, label: 'Switch to away mode after this many minutes of being idle at the computer' }
        : s.key === 'cleanupEnabled'
          ? { ...s, label: `${HI} (${GU})` }
          : s.key === 'llmModel'
            ? { ...s, value: 'qwen3:8b-instruct-q4_K_M-very-long-model-tag' }
            : s,
    ),
  };
}
