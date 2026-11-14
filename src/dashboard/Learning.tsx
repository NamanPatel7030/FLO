// Settings → Dictionary → Learning: the three learning switches and "What Flo learned" (words read on
// screen, fixes from your edits, per-app style), each with delete, plus Clear all. Everything here
// lives in Flo's local database (learning.rs); nothing is synced.
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Brain, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { deviceWord } from "../lib/os";
import type { LearningOverview, Settings as S } from "../lib/types";
import { Button, Card, CardTitle, Toggle } from "./ui";

type Tab = "words" | "fixes" | "style";
const EMPTY: LearningOverview = { terms: [], fixes: [], styles: [] };

export function LearningSettings({ s, set }: { s: S; set: (patch: Partial<S>) => void }) {
  return (
    <Card className="px-5 py-4">
      <div data-testid="learning-settings">
        <CardTitle icon={<Brain size={15} />}>Learning</CardTitle>
        <p className="-mt-1 mb-2 text-[12px] text-muted">
          Flo gets better at your names and words by itself. It all stays on this {deviceWord()}, and it never reads apps on your Attention denylist or password fields.
        </p>
        <div className="divide-y divide-[var(--border)]">
          <Toggle
            label="Learn from screen"
            hint="When you dictate, Flo reads the names and terms around where you're typing to spell them right."
            checked={s.learnFromScreen ?? true}
            onChange={(v) => set({ learnFromScreen: v })}
          />
          <Toggle
            label="Learn from my edits"
            hint="If you fix a word Flo typed, it offers to remember it, and applies it by itself the second time."
            checked={s.learnCorrections}
            onChange={(v) => set({ learnCorrections: v })}
          />
          <Toggle
            label="Per-app style"
            hint="Remembers how you write in each app (short and casual in Slack, a sign-off in Mail) for AI cleanup."
            checked={s.learnAppStyle ?? true}
            onChange={(v) => set({ learnAppStyle: v })}
          />
        </div>
        <LearnedPanel />
      </div>
    </Card>
  );
}

/** "What Flo learned": lists with delete per item and Clear all. */
export function LearnedPanel() {
  const [data, setData] = useState<LearningOverview | null>(null);
  const [tab, setTab] = useState<Tab>("words");
  const load = useCallback(() => {
    api.learningOverview().then(setData).catch(() => setData(EMPTY));
  }, []);
  useEffect(load, [load]);
  const forget = (kind: "term" | "fix" | "style", id: string) => api.learningForget(kind, id).then(setData).catch(load);
  const d = data ?? EMPTY;
  const total = d.terms.length + d.fixes.length + d.styles.length;
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "words", label: "Words", n: d.terms.length },
    { id: "fixes", label: "Fixes", n: d.fixes.length },
    { id: "style", label: "Style", n: d.styles.length },
  ];
  return (
    <section className="mt-3 border-t border-[var(--border)] pt-3" data-testid="learned-panel" aria-label="What Flo learned">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-medium">What Flo learned</div>
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={total === 0} onClick={() => api.learningClear().then(setData).catch(load)}>
          Clear all
        </Button>
      </div>
      <div className="mb-2 inline-flex rounded-lg bg-[var(--glass)] p-0.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx("h-7 rounded-md px-2.5 text-[12px] font-medium transition", tab === t.id ? "glass-strong text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
          >
            {t.label} <span className="text-faint">{t.n}</span>
          </button>
        ))}
      </div>
      {data === null ? (
        <p className="py-3 text-[12px] text-muted">Loading…</p>
      ) : tab === "words" ? (
        <Rows empty="No words yet. Dictate somewhere with names on screen and they'll show up here.">
          {d.terms.map((t) => (
            <Row key={t.id} testId="learned-term" onDelete={() => forget("term", t.id)} label={`Forget ${t.term}`}>
              <span className="font-medium">{t.term}</span>
              <Meta>
                {t.app} · seen {t.count}× · {relativeTime(t.lastSeen)}
              </Meta>
            </Row>
          ))}
        </Rows>
      ) : tab === "fixes" ? (
        <Rows empty="No fixes yet. When you correct a word Flo typed, it lands here.">
          {d.fixes.map((f) => (
            <Row key={f.id} testId="learned-fix" onDelete={() => forget("fix", f.id)} label={`Forget ${f.heard} → ${f.corrected}`}>
              <span>
                <span className="text-muted line-through decoration-[var(--border-strong)]">{f.heard}</span> → <span className="font-medium">{f.corrected}</span>
              </span>
              <Meta>
                {f.app || "Any app"} · {f.count}× · {f.blocked ? "won't change again" : f.applied ? "applied" : "waiting for a second time"} · {relativeTime(f.lastSeen)}
              </Meta>
            </Row>
          ))}
        </Rows>
      ) : (
        <Rows empty="No style yet. Flo learns it from what you keep after dictating.">
          {d.styles.map((st) => (
            <Row key={st.app} testId="learned-style" onDelete={() => forget("style", st.app)} label={`Forget style for ${st.app}`}>
              <span className="font-medium">{st.app}</span>
              <Meta>{st.hint ? st.hint.replace(/^In .+? the user writes: /, "").replace(/ Match that.*$/, "") : `Learning (${st.samples} so far)`}</Meta>
            </Row>
          ))}
        </Rows>
      )}
    </section>
  );
}

function Rows({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="py-3 text-[12px] text-muted">{empty}</p>;
  return <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto">{children}</ul>;
}

function Row({ children, onDelete, label, testId }: { children: React.ReactNode; onDelete: () => void; label: string; testId: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-[13px]" data-testid={testId}>
      <div className="flex min-w-0 flex-col">{children}</div>
      <Button size="sm" variant="ghost" aria-label={label} title={label} icon={<Trash2 size={13} />} onClick={onDelete} />
    </li>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-[11.5px] text-muted">{children}</span>;
}
