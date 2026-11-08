// Skills: things you teach Flo once and then just ask for ("use my Upwork proposal skill").
// Each skill has the phrases that invoke it, your instructions, the platforms it works on, and a
// mode: Write (compose from what's on screen and type it into the field) or Do (operate the screen).
// The old Context page lives on as the Knowledge tab: documents Flo can draw on for any answer.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { BookText, CheckCircle2, Clock, Loader2, MousePointerClick, PenLine, Play, Plug, Plus, Sparkles, Trash2, X, Zap } from "lucide-react";
import { api } from "../../lib/api";
import { cronError, describeCron, formatRun, nextRun } from "../../lib/cron";
import type { Connection, McpTool, Skill } from "../../lib/types";
import { SkillCanvasEditor } from "../SkillCanvas";
import { useStore } from "../store";
import { Button, Card, Empty, PageHeader, Skeleton } from "../ui";
import ContextPage from "./Context";

export { PLATFORMS } from "../platforms";
import { PLATFORMS } from "../platforms";

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

const EMPTY: Skill = { id: "", name: "", triggers: "", instructions: "", platforms: [], mode: "write", enabled: true, uses: 0, createdAt: "", graph: "", connections: [] };

export default function SkillsPage() {
  const { pageArg, go } = useStore();
  const tab: "skills" | "connections" | "knowledge" = pageArg === "knowledge" ? "knowledge" : pageArg === "connections" ? "connections" : "skills";
  return (
    <div>
      <div className="mb-5 inline-flex rounded-xl glass p-1" role="tablist" aria-label="Skills sections">
        {(["skills", "connections", "knowledge"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => go("skills", t === "skills" ? undefined : t)}
            className={clsx("relative h-8 rounded-lg px-4 text-[13px] font-medium transition", tab === t ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
          >
            {tab === t && <motion.span layoutId="skills-tab" className="absolute inset-0 rounded-lg glass-strong" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">
              {t === "skills" ? <Zap size={13} /> : t === "connections" ? <Plug size={13} /> : <BookText size={13} />}
              {t === "skills" ? "Skills" : t === "connections" ? "Connections" : "Knowledge"}
            </span>
          </button>
        ))}
      </div>
      {tab === "skills" ? <SkillsList /> : tab === "connections" ? <ConnectionsPanel /> : <ContextPage />}
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
              <SkillCard key={k.id} k={k} onEdit={() => setEditing(k)} onRan={load} />
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
            <SkillCanvasEditor
              initial={editing}
              onClose={() => setEditing(null)}
              onSave={async (k) => {
                await api.saveSkill(k);
                setEditing(null);
                load();
              }}
              onDelete={
                editing.id
                  ? async () => {
                      await api.deleteSkill(editing.id);
                      setEditing(null);
                      load();
                    }
                  : undefined
              }
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/** "Every weekday at 09:00 · next tomorrow 09:00" for a scheduled skill. */
function scheduleLine(cron: string): { when: string; next: string } | null {
  if (cronError(cron)) return null;
  const n = nextRun(cron);
  const when = describeCron(cron);
  return { when: when.charAt(0).toUpperCase() + when.slice(1), next: n ? formatRun(n) : "never" };
}

function SkillCard({ k, onEdit, onRan }: { k: Skill; onEdit: () => void; onRan: () => void }) {
  const first = k.triggers.split(",")[0]?.trim();
  const [run, setRun] = useState<{ busy: boolean; reply?: string; error?: string }>({ busy: false });
  const sched = k.schedule ? scheduleLine(k.schedule) : null;
  const runNow = async () => {
    setRun({ busy: true });
    try {
      const r = await api.runSkillNow(k.id);
      // the backend toasts "<name> ran" (same as a scheduled run)
      setRun({ busy: false, reply: r.reply });
      onRan();
    } catch (e) {
      setRun({ busy: false, error: String(e) });
    }
  };
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
          <div className="mt-1 text-[12px] text-faint">{first ? `Say “${first}”` : sched ? "Runs on its schedule" : `Say “${k.name}”`}</div>
        </div>
        {sched && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!run.busy) runNow();
            }}
            aria-label={`Run ${k.name} now`}
            disabled={run.busy}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)]/15 px-3 text-[12px] font-medium text-brand-100 ring-1 ring-[var(--accent)]/30 transition hover:bg-[var(--accent)]/25 disabled:opacity-70"
          >
            {run.busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} className="fill-current" />}
            {run.busy ? "Running…" : "Run now"}
          </button>
        )}
      </div>
      {sched && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#ff8a5c]/[0.08] px-3 py-2 text-[12px] ring-1 ring-[#ff8a5c]/20" data-testid="skill-schedule">
          <Clock size={13} className="shrink-0 text-[#ffb08f]" />
          <span className="truncate text-[var(--fg)]">{sched.when}</span>
          <span className="ml-auto shrink-0 text-faint">next {sched.next}</span>
        </div>
      )}
      {(run.reply || run.error) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={clsx("mt-2 line-clamp-3 whitespace-pre-line rounded-xl px-3 py-2 text-[12px] leading-relaxed", run.error ? "bg-red-500/10 text-red-200" : "bg-white/[0.04] text-muted")}
          data-testid="skill-run-result"
        >
          {run.error ? run.error : run.reply}
        </div>
      )}
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

const EMPTY_CONN: Connection = { id: "", name: "", kind: "mcp", transport: "stdio", command: "", args: [], url: "", env: {}, description: "", enabled: true, createdAt: "" };

/** Custom platforms and MCP servers that skills can use. */
function ConnectionsPanel() {
  const [list, setList] = useState<Connection[] | null>(null);
  const [editing, setEditing] = useState<Connection | null>(null);
  const load = () => api.listConnections().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="Add MCP servers and your own platforms. Skills can then use their tools: wire them in on the skill canvas."
        actions={
          <div className="flex gap-2">
            <Button icon={<Plus size={15} />} onClick={() => setEditing({ ...EMPTY_CONN, kind: "platform" })}>
              Platform
            </Button>
            <Button variant="primary" icon={<Plug size={15} />} onClick={() => setEditing({ ...EMPTY_CONN })}>
              MCP server
            </Button>
          </div>
        }
      />
      {!list ? (
        <Skeleton className="h-32" />
      ) : list.length === 0 ? (
        <Card className="p-6">
          <Empty icon={<Plug size={18} />} title="No connections yet" hint="Add an MCP server (a local command or a URL) or a platform Flo doesn't know yet." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4" data-testid="connections-grid">
          {list.map((c) => (
            <Card key={c.id} onClick={() => setEditing(c)} className={clsx("p-4", !c.enabled && "opacity-55")}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#a78bfa]/15 text-[#cbbcff]">{c.kind === "mcp" ? <Plug size={15} /> : <Sparkles size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{c.name}</div>
                  <div className="truncate text-[11.5px] text-faint">
                    {c.kind === "mcp" ? (c.transport === "http" ? c.url : [c.command, ...c.args].join(" ")) : c.url || c.description || "Custom platform"}
                  </div>
                </div>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-muted">{c.kind === "mcp" ? (c.transport === "http" ? "MCP · URL" : "MCP · local") : "Platform"}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {createPortal(
        <AnimatePresence>
          {editing && (
            <ConnectionEditor
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

/** "KEY=value" lines ↔ a map (env vars for local servers, headers for URL servers). */
const toLines = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join("\n");
const fromLines = (t: string) =>
  Object.fromEntries(
    t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
/** Split a command line the way a shell would for simple cases ("quoted args" kept together). */
export const splitArgs = (t: string) => (t.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ""));

function ConnectionEditor({ initial, onClose, onSaved }: { initial: Connection; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState<Connection>(initial);
  const [cmdLine, setCmdLine] = useState([initial.command, ...initial.args].filter(Boolean).join(" "));
  const [envText, setEnvText] = useState(toLines(initial.env));
  const [test, setTest] = useState<{ busy: boolean; tools?: McpTool[]; error?: string }>({ busy: false });
  const [err, setErr] = useState("");
  const set = (patch: Partial<Connection>) => setC((x) => ({ ...x, ...patch }));
  const built = (): Connection => {
    const parts = splitArgs(cmdLine);
    return { ...c, command: parts[0] ?? "", args: parts.slice(1), env: fromLines(envText) };
  };
  const field = "w-full rounded-xl bg-white/[0.05] px-3 py-2.5 text-[13.5px] outline-none ring-1 ring-white/10 transition placeholder:text-faint focus:ring-[var(--accent)]";
  const isMcp = c.kind === "mcp";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Connection" data-testid="connection-editor">
      <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{ background: "linear-gradient(180deg, #0f1b27 0%, #0a121b 100%)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{isMcp ? "MCP server" : "Custom platform"}</div>
            <h2 className="mt-1 text-[18px] font-semibold">{c.name || (isMcp ? "New MCP server" : "New platform")}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-faint hover:bg-white/10 hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Name</span>
            <input aria-label="Connection name" className={field} placeholder={isMcp ? "Notion" : "Fiverr"} value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          {isMcp ? (
            <>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to reach it">
                {(
                  [
                    { id: "stdio", title: "Local command", hint: "Flo starts it on your Mac (npx, uvx, python…)" },
                    { id: "http", title: "URL", hint: "A remote server (Streamable HTTP)" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={c.transport === t.id}
                    onClick={() => set({ transport: t.id })}
                    className={clsx("rounded-2xl border p-3 text-left transition", c.transport === t.id ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")}
                  >
                    <div className="text-[13px] font-medium">{t.title}</div>
                    <div className="mt-0.5 text-[11.5px] text-faint">{t.hint}</div>
                  </button>
                ))}
              </div>
              {c.transport === "http" ? (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">Server URL</span>
                  <input aria-label="Server URL" className={field + " font-mono text-[12.5px]"} placeholder="https://mcp.example.com/mcp" value={c.url} onChange={(e) => set({ url: e.target.value })} />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">Command</span>
                  <input aria-label="Command" className={field + " font-mono text-[12.5px]"} placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents" value={cmdLine} onChange={(e) => setCmdLine(e.target.value)} />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">{c.transport === "http" ? "Headers (one per line)" : "Environment (one per line)"}</span>
                <textarea
                  aria-label="Environment"
                  rows={3}
                  className={field + " resize-y font-mono text-[12px]"}
                  placeholder={c.transport === "http" ? "Authorization=Bearer …" : "NOTION_TOKEN=secret_…"}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                />
                <span className="mt-1 block text-[11px] text-faint">Stored encrypted on this Mac. Only sent to this server.</span>
              </label>
              <div className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/10" data-testid="connection-test">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[12.5px] text-muted">{test.tools ? `Connected · ${test.tools.length} tool${test.tools.length === 1 ? "" : "s"}` : test.error ? "Couldn't connect" : "Check that Flo can reach it and see its tools."}</span>
                  <Button
                    size="sm"
                    icon={test.busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    disabled={test.busy}
                    onClick={async () => {
                      setTest({ busy: true });
                      try {
                        setTest({ busy: false, tools: await api.testConnection(built()) });
                      } catch (e) {
                        setTest({ busy: false, error: String(e) });
                      }
                    }}
                  >
                    Test
                  </Button>
                </div>
                {test.error && <div className="mt-2 text-[12px] text-red-300">{test.error}</div>}
                {test.tools && test.tools.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {test.tools.map((t) => (
                      <div key={t.name} className="flex gap-2 text-[12px]">
                        <span className="shrink-0 font-mono text-[#cbbcff]">{t.name}</span>
                        <span className="truncate text-faint">{t.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Website or app</span>
                <input aria-label="Website" className={field} placeholder="https://www.fiverr.com" value={c.url} onChange={(e) => set({ url: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Notes for Flo</span>
                <textarea aria-label="Notes" rows={3} className={field + " resize-y"} placeholder="Where things are, how you use it…" value={c.description} onChange={(e) => set({ description: e.target.value })} />
              </label>
            </>
          )}
        </div>
        {err && <div className="mt-3 text-[12.5px] text-red-300">{err}</div>}
        <div className="mt-5 flex items-center gap-2">
          {initial.id && (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.deleteConnection(initial.id);
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
          <Button
            variant="primary"
            onClick={async () => {
              if (!c.name.trim()) return setErr("Give it a name.");
              try {
                await api.saveConnection(built());
                onSaved();
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            {initial.id ? "Save" : "Add"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
