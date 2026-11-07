// Skills: things you teach Flo once and then just ask for ("use my Upwork proposal skill").
// Each skill has the phrases that invoke it, your instructions, the platforms it works on, and a
// mode: Write (compose from what's on screen and type it into the field) or Do (operate the screen).
// The old Context page lives on as the Knowledge tab: documents Flo can draw on for any answer.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { BookText, Briefcase, Globe, Mail, Users, MessageSquare, MonitorSmartphone, MousePointerClick, PenLine, Plus, Sparkles, Trash2, Wand2, X, Zap } from "lucide-react";
import { api } from "../../lib/api";
import type { Skill } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, Empty, PageHeader, Skeleton, Toggle } from "../ui";
import ContextPage from "./Context";

export const PLATFORMS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "upwork", label: "Upwork", icon: <Briefcase size={13} /> },
  { id: "slack", label: "Slack", icon: <MessageSquare size={13} /> },
  { id: "gmail", label: "Gmail", icon: <Mail size={13} /> },
  { id: "linkedin", label: "LinkedIn", icon: <Users size={13} /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageSquare size={13} /> },
  { id: "browser", label: "Any website", icon: <Globe size={13} /> },
  { id: "any", label: "Any app", icon: <MonitorSmartphone size={13} /> },
];

/** Starting points: tap one to prefill the editor. */
const TEMPLATES: Omit<Skill, "id" | "uses" | "createdAt">[] = [
  {
    name: "Upwork proposal",
    triggers: "proposal for this job, apply to this job",
    instructions:
      "Read the job post on screen. Write a 250-350 word proposal in a human voice: open with the client's actual problem, show I've solved something similar (cite 2 relevant projects), answer every question they asked, and end with one sharp question. No fluff, no 'I hope this finds you well'.",
    platforms: ["upwork", "browser"],
    mode: "write",
    enabled: true,
  },
  {
    name: "Slack reply",
    triggers: "reply on slack, answer this thread",
    instructions: "Reply to the latest message in the thread on screen. Short, friendly, direct. Match the thread's language. Confirm next steps with a time if one was discussed.",
    platforms: ["slack"],
    mode: "write",
    enabled: true,
  },
  {
    name: "Follow-up email",
    triggers: "follow up email, follow-up",
    instructions: "Write a polite follow-up to the email on screen: one line of context, the ask, a clear deadline. Sign off with my name.",
    platforms: ["gmail"],
    mode: "write",
    enabled: true,
  },
  {
    name: "Find and open",
    triggers: "find me, look up",
    instructions: "Open Chrome, search Google for what I asked, open the most relevant result and scroll to the part that answers it. Stop before buying, sending or signing in.",
    platforms: ["browser"],
    mode: "do",
    enabled: true,
  },
];

const EMPTY: Skill = { id: "", name: "", triggers: "", instructions: "", platforms: [], mode: "write", enabled: true, uses: 0, createdAt: "" };

export default function SkillsPage() {
  const { pageArg, go } = useStore();
  const tab: "skills" | "knowledge" = pageArg === "knowledge" ? "knowledge" : "skills";
  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl glass p-1" role="tablist" aria-label="Skills sections">
        {(["skills", "knowledge"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => go("skills", t === "skills" ? undefined : t)}
            className={clsx("relative h-8 rounded-lg px-4 text-[13px] font-medium transition", tab === t ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
          >
            {tab === t && <motion.span layoutId="skills-tab" className="absolute inset-0 rounded-lg glass-strong" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">
              {t === "skills" ? <Zap size={13} /> : <BookText size={13} />}
              {t === "skills" ? "Skills" : "Knowledge"}
            </span>
          </button>
        ))}
      </div>
      {tab === "skills" ? <SkillsList /> : <ContextPage />}
    </div>
  );
}

function SkillsList() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const load = () => api.listSkills().then(setSkills).catch(() => setSkills([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <PageHeader
        title="Skills"
        subtitle="Teach Flo something once, then just ask: “use my Upwork proposal skill”. Write skills read your screen and type the result; Do skills operate your Mac."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing({ ...EMPTY })}>
            New skill
          </Button>
        }
      />
      {!skills ? (
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          {skills.length === 0 && (
            <Card className="mb-4 p-6">
              <Empty icon={<Sparkles size={18} />} title="No skills yet" hint="Start from a template below, or create your own." />
            </Card>
          )}
          <div className="grid grid-cols-2 gap-4" data-testid="skills-grid">
            {skills.map((k) => (
              <SkillCard key={k.id} k={k} onEdit={() => setEditing(k)} />
            ))}
          </div>
          <div className="mt-7 mb-3 text-[11.5px] font-semibold uppercase tracking-wider text-faint">Start from a template</div>
          <div className="grid grid-cols-4 gap-3">
            {TEMPLATES.map((t) => (
              <button key={t.name} onClick={() => setEditing({ ...EMPTY, ...t })} className="rounded-2xl glass p-3 text-left transition hover:glass-strong">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {t.mode === "do" ? <MousePointerClick size={13} className="text-brand-300" /> : <PenLine size={13} className="text-brand-300" />}
                  {t.name}
                </div>
                <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-faint">{t.instructions}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {createPortal(
        <AnimatePresence>
          {editing && (
            <SkillEditor
              initial={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                load();
              }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function SkillCard({ k, onEdit }: { k: Skill; onEdit: () => void }) {
  const first = k.triggers.split(",")[0]?.trim();
  return (
    <Card onClick={onEdit} className={clsx("relative h-full p-5", !k.enabled && "opacity-55")}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-brand-200">
          {k.mode === "do" ? <MousePointerClick size={16} /> : <PenLine size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{k.name}</span>
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-muted">{k.mode === "do" ? "Does it" : "Writes it"}</span>
            {!k.enabled && <span className="shrink-0 text-[10.5px] text-faint">Off</span>}
          </div>
          <div className="mt-1 text-[12px] text-faint">Say “{first || k.name}”</div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{k.instructions}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {k.platforms.map((p) => {
          const pl = PLATFORMS.find((x) => x.id === p);
          return (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted">
              {pl?.icon} {pl?.label ?? p}
            </span>
          );
        })}
        <span className="ml-auto text-[11px] text-faint">{k.uses ? `used ${k.uses}×` : "not used yet"}</span>
      </div>
    </Card>
  );
}

function SkillEditor({ initial, onClose, onSaved }: { initial: Skill; onClose: () => void; onSaved: () => void }) {
  const [k, setK] = useState<Skill>(initial);
  const [err, setErr] = useState("");
  const set = (patch: Partial<Skill>) => setK((x) => ({ ...x, ...patch }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const save = async () => {
    if (!k.name.trim()) return setErr("Give the skill a name.");
    if (!k.instructions.trim()) return setErr("Tell Flo what to do.");
    try {
      await api.saveSkill(k);
      onSaved();
    } catch (e) {
      setErr(String(e));
    }
  };
  const field = "w-full rounded-xl bg-white/[0.05] px-3 py-2.5 text-[13.5px] outline-none ring-1 ring-white/10 transition placeholder:text-faint focus:ring-[var(--accent)]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Skill editor" data-testid="skill-editor">
      <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{ background: "linear-gradient(180deg, #0f1b27 0%, #0a121b 100%)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{initial.id ? "Edit skill" : "New skill"}</div>
            <h2 className="mt-1 text-[18px] font-semibold">{k.name || "Untitled skill"}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-faint hover:bg-white/10 hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Name</span>
            <input aria-label="Skill name" className={field} placeholder="Upwork proposal" value={k.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Say this to use it</span>
            <input aria-label="Trigger phrases" className={field} placeholder="proposal for this job, apply to this job" value={k.triggers} onChange={(e) => set({ triggers: e.target.value })} />
            <span className="mt-1 block text-[11.5px] text-faint">Comma-separated. Saying the skill's name always works too.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">What should Flo do?</span>
            <textarea
              aria-label="Instructions"
              rows={6}
              className={field + " resize-y leading-relaxed"}
              placeholder="Read the job post on screen. Write a 250-350 word proposal that…"
              value={k.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">How</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Skill mode">
              {(
                [
                  { id: "write", title: "Write it for me", hint: "Reads your screen and types the result where your cursor is.", icon: <PenLine size={15} /> },
                  { id: "do", title: "Do it on screen", hint: "Operates your Mac: opens apps, clicks, types. Asks before sending or buying.", icon: <MousePointerClick size={15} /> },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={k.mode === m.id}
                  onClick={() => set({ mode: m.id })}
                  className={clsx(
                    "rounded-2xl border p-3 text-left transition",
                    k.mode === m.id ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[13px] font-medium">
                    <span className="text-brand-300">{m.icon}</span> {m.title}
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-faint">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Works on</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
              {PLATFORMS.map((p) => {
                const on = k.platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    aria-pressed={on}
                    onClick={() => set({ platforms: on ? k.platforms.filter((x) => x !== p.id) : [...k.platforms, p.id] })}
                    className={clsx(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition",
                      on ? "bg-[var(--accent)]/20 text-[var(--fg)] shadow-[0_0_0_1px_var(--accent)]" : "bg-white/[0.05] text-muted hover:bg-white/10 hover:text-[var(--fg)]",
                    )}
                  >
                    {p.icon} {p.label}
                  </button>
                );
              })}
            </div>
            <span className="mt-1.5 flex items-center gap-1 text-[11.5px] text-faint">
              <Wand2 size={11} /> Flo uses your existing connections (Slack in Integrations, your browser and apps). Nothing new to sign in to.
            </span>
          </div>

          <Toggle label="Enabled" hint="Off: Flo ignores this skill's phrases." checked={k.enabled} onChange={(v) => set({ enabled: v })} />
        </div>

        {err && <div className="mt-3 text-[12.5px] text-red-300">{err}</div>}
        <div className="mt-5 flex items-center gap-2">
          {initial.id && (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.deleteSkill(initial.id);
                onSaved();
              }}
            >
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {initial.id ? "Save" : "Create skill"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
