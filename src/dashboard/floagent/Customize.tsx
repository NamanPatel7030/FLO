// Flo Agent → Customize: persona, standing instructions, memory, what it may use, and how often
// it asks. Confirmation before send / post / pay / delete is always on and can't be turned off.
import { useEffect, useState } from "react";
import { Lock, MousePointerClick, Plug, Zap } from "lucide-react";
import type { AgentConfig } from "../../lib/floAgent";
import { useStore } from "../store";
import { Button, Card, CardTitle, PageHeader, Skeleton, Toggle } from "../ui";

const PERSONAS = ["Calm and precise. Short answers, no filler.", "Friendly and upbeat, like a helpful teammate.", "Formal and thorough. Explain what you did."];

export function Customize({ cfg, save }: { cfg: AgentConfig | null; save: (c: AgentConfig) => Promise<AgentConfig> }) {
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<AgentConfig | null>(cfg);
  useEffect(() => setDraft(cfg), [cfg]);
  if (!cfg || !draft) return <Skeleton className="h-96" />;
  const dirty = draft.persona !== cfg.persona || draft.instructions !== cfg.instructions;
  // switches save right away; the two text fields save with the button
  const flip = (patch: Partial<AgentConfig>) => {
    const next = { ...cfg, ...patch };
    setDraft({ ...draft, ...patch });
    save(next).catch((e) => toast({ kind: "error", text: String(e) }));
  };
  const area = "w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3 py-2.5 text-[13.5px] leading-relaxed outline-none transition placeholder:text-[var(--fg-faint)] focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20";
  return (
    <div data-testid="agent-customize">
      <PageHeader title="Customize" subtitle="Make Flo Agent yours. Applies to every run, on Flo's engine and on Hermes." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle>Persona</CardTitle>
          <textarea rows={3} className={area} aria-label="Persona" placeholder="Who should Flo Agent be? e.g. A calm, precise operator who keeps answers short." value={draft.persona} onChange={(e) => setDraft({ ...draft, persona: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERSONAS.map((p) => (
              <button key={p} onClick={() => setDraft({ ...draft, persona: p })} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11.5px] text-muted transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]">
                {p}
              </button>
            ))}
          </div>
          <div className="mt-5">
            <CardTitle>Standing instructions</CardTitle>
            <textarea rows={5} className={area} aria-label="Standing instructions" placeholder={"Things to always do, e.g.\nWrite in English. Keep LinkedIn posts under 120 words. Use Chrome, not Safari."} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(cfg)}>
                Discard
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={async () => {
                await save({ ...cfg, persona: draft.persona, instructions: draft.instructions });
                toast({ kind: "success", text: "Flo Agent updated" });
              }}
            >
              Save
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card className="px-5 pb-2 pt-5">
            <CardTitle>What it can use</CardTitle>
            <Row icon={<MousePointerClick size={14} />}>
              <Toggle checked={draft.allowScreen} onChange={(v) => flip({ allowScreen: v })} label="Screen control" hint="Open apps and pages, click, type and scroll on your Mac." />
            </Row>
            <Row icon={<Plug size={14} />}>
              <Toggle checked={draft.allowTools} onChange={(v) => flip({ allowTools: v })} label="Connected apps" hint="Use the tools of your MCP servers when you name the app." />
            </Row>
            <Row icon={<Zap size={14} />}>
              <Toggle checked={draft.allowSkills} onChange={(v) => flip({ allowSkills: v })} label="Skills" hint="Run a skill you built when a request matches it." />
            </Row>
          </Card>
          <Card className="px-5 pb-2 pt-5">
            <CardTitle>Memory</CardTitle>
            <Toggle checked={draft.memory} onChange={(v) => flip({ memory: v })} label="Remember recent runs" hint="Flo Agent uses what you asked recently as context. On Hermes, this also turns its own memory on or off." />
          </Card>
          <Card className="px-5 pb-2 pt-5">
            <CardTitle>Confirmations</CardTitle>
            <div className="flex items-center justify-between gap-6 py-2.5" data-testid="confirm-locked">
              <div>
                <div className="text-[13.5px] font-medium">Ask before sending, posting, paying or deleting</div>
                <div className="mt-0.5 text-[12px] text-muted">Always on. Flo Agent stops and waits for your yes.</div>
              </div>
              <span className="flex h-[22px] items-center gap-1 rounded-full bg-emerald-400/12 px-2 text-[11px] font-medium text-emerald-300">
                <Lock size={10} /> Always
              </span>
            </div>
            <Toggle checked={draft.confirmEveryStep} onChange={(v) => flip({ confirmEveryStep: v })} label="Also ask before every step" hint="Slower, but you approve each click and keystroke on screen." />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-strong)] text-muted">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
