import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Briefcase, FolderKanban, Plus, StickyNote, X, Trash2, Wand2 } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, relativeTime } from "../../lib/format";
import type { Project, ProjectStatus } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Empty, Input, PageHeader, ProgressRing, Select, Skeleton, StatusPill } from "../ui";
import { TodoRow } from "../components";
import { CodeChip, CodeSection, requestAddCode } from "../ProjectCode";

export default function Projects() {
  const { projects, pageArg, go } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [client, setClient] = useState("");
  const [details, setDetails] = useState("");
  const [keywords, setKeywords] = useState("");
  const selected = projects?.find((p) => p.id === pageArg);

  const create = async () => {
    if (!name.trim()) return;
    const p = await api.createProject(name.trim(), desc.trim() || undefined, {
      client: client.trim() || undefined,
      clientDetails: details.trim() || undefined,
      keywords: keywords.trim() || undefined,
    });
    setCreating(false);
    setName("");
    setDesc("");
    setClient("");
    setDetails("");
    setKeywords("");
    go("projects", p.id);
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Say “what's the status of Apollo?” or “mark Hermes as blocked”, Flo keeps these in sync."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div data-testid="new-project">
            <Card strong className="mb-4 p-4">
              <div className="grid grid-cols-2 gap-2.5">
                <Input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                <Input aria-label="Description" placeholder="Short description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
                <Input aria-label="Client" placeholder="Client or company (optional)" value={client} onChange={(e) => setClient(e.target.value)} />
                <Input aria-label="Client details" placeholder="Contact, email, phone, website (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
                <div className="col-span-2">
                  <Input aria-label="Keywords" placeholder="Keywords: people, Slack channels, domains, nicknames (comma-separated)" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="flex flex-1 items-center gap-1.5 text-[12px] text-faint">
                  <Wand2 size={13} /> To-dos and notes that mention the project, client or a keyword are filed here automatically.
                </span>
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={create}>
                  Create
                </Button>
              </div>
            </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!projects ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className="p-6">
          <Empty icon={<FolderKanban size={18} />} title="No projects yet" hint="Create one, or say “create a project called …”." />
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <ProjectCard
                p={p}
                onClick={() => go("projects", p.id)}
                onAddCode={() => {
                  requestAddCode(p.id);
                  go("projects", p.id);
                }}
              />
            </motion.div>
          ))}
        </div>
      )}

      {createPortal(<AnimatePresence>{selected && <Drawer p={selected} onClose={() => go("projects")} />}</AnimatePresence>, document.body)}
    </div>
  );
}

function ProjectCard({ p, onClick, onAddCode }: { p: Project; onClick: () => void; onAddCode: () => void }) {
  const total = p.openTodos + p.doneTodos;
  const pct = total ? p.doneTodos / total : 0;
  return (
    <Card onClick={onClick} className="relative isolate flex h-full flex-col overflow-hidden p-5 [clip-path:inset(0_round_16px)]">
      {/* soft colour wash in the corner: a gradient (no blur filter), so it stays inside the rounded card */}
      <div className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(180px 140px at 100% 0%, ${p.color}33, transparent 70%)` }} />
      <div className="relative flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl text-[16px] font-semibold text-white shadow-sm" style={{ background: p.color }}>
          {p.name[0]?.toUpperCase()}
        </div>
        <ProgressRing value={pct} color={p.color} size={48} stroke={4}>
          <span className="text-[10.5px] tabular-nums tracking-tight">{Math.round(pct * 100)}%</span>
        </ProgressRing>
      </div>
      <div className="relative mt-4 truncate text-[16px] font-semibold tracking-tight">{p.name}</div>
      {/* fixed-height meta block so every card's footer lines up */}
      <div className="relative mt-1 h-[54px]">
        {p.client && (
          <div className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-[var(--accent)]">
            <Briefcase size={12} className="shrink-0" /> {p.client}
          </div>
        )}
        {p.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{p.description}</div>}
      </div>
      <div className="relative mt-auto flex items-center justify-between pt-3">
        <StatusPill status={p.status} />
        <span className="text-[11.5px] text-faint">
          {p.openTodos} open · {relativeTime(p.updatedAt)}
        </span>
      </div>
      <div className="relative mt-3.5 flex items-center border-t border-[var(--border)] pt-3.5">
        <CodeChip p={p} onAdd={onAddCode} />
      </div>
    </Card>
  );
}

function Drawer({ p, onClose }: { p: Project; onClose: () => void }) {
  const { todos, notes } = useStore();
  const [t, setT] = useState("");
  const ptodos = todos?.filter((x) => x.projectId === p.id && (x.status === "open" || x.status === "done")) ?? [];
  const pnotes = notes?.filter((n) => n.projectId === p.id) ?? [];
  return (
    <>
      <motion.div className="fixed inset-0 z-30 bg-[rgb(15_22_40/0.25)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        initial={{ x: 480, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        // solid surface: a translucent drawer let the project cards behind it show through its fields
        // solid, theme-aware surface: a translucent drawer let the cards behind show through its fields
        className="fixed bottom-3 right-3 top-3 z-40 flex w-[440px] flex-col overflow-clip rounded-3xl border border-[var(--border-strong)] shadow-[0_30px_80px_-24px_rgb(15_25_50/0.35)]"
        style={{ background: "var(--sheet-bg)" }}
      >
        <div className="relative p-5">
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(260px 180px at 100% 0%, ${p.color}2e, transparent 70%)` }} />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[20px] font-semibold tracking-tight text-[var(--fg)]">{p.name}</div>
              <div className="mt-1 text-[13px] text-muted">{p.description}</div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-[var(--glass)]">
              <X size={16} />
            </button>
          </div>
          <div className="relative mt-3 flex items-center gap-2">
            <Select<ProjectStatus>
              value={p.status}
              onChange={(status) => api.updateProject(p.id, { status })}
              options={[
                { value: "active", label: "Active" },
                { value: "paused", label: "Paused" },
                { value: "blocked", label: "Blocked" },
                { value: "done", label: "Done" },
              ]}
            />
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.deleteProject(p.id);
                onClose();
              }}
            >
              Delete
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <ClientSection p={p} />
          <CodeSection key={p.id} p={p} />
          <CardTitle>To-dos</CardTitle>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!t.trim()) return;
              await api.addTodo(t.trim(), p.id);
              setT("");
            }}
            className="mb-2"
          >
            <Input value={t} onChange={(e) => setT(e.target.value)} placeholder={`Add to ${p.name}…`} />
          </form>
          <AnimatePresence initial={false}>
            {ptodos.map((x) => (
              <TodoRow key={x.id} todo={x} />
            ))}
          </AnimatePresence>
          {ptodos.length === 0 && <div className="py-4 text-center text-[12.5px] text-faint">No to-dos yet.</div>}
          <div className="mt-5">
            <CardTitle icon={<StickyNote size={14} />}>Notes</CardTitle>
            {pnotes.length === 0 && <div className="text-[12.5px] text-faint">No notes linked to this project.</div>}
            {pnotes.map((n) => (
              <div key={n.id} className="mb-2 rounded-xl bg-[var(--glass)] p-3">
                <div className="text-[13px] font-medium">{n.title}</div>
                <div className="text-[11px] text-faint">
                  {relativeTime(n.createdAt)} · {formatDuration(n.durationSec)}
                </div>
                <p className="mt-1 line-clamp-3 text-[12px] text-muted">{n.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.aside>
    </>
  );
}

/** Client details, edited in place (saved when a field loses focus). */
function ClientSection({ p }: { p: Project }) {
  const [client, setClient] = useState(p.client ?? "");
  const [details, setDetails] = useState(p.clientDetails ?? "");
  const [keywords, setKeywords] = useState(p.keywords ?? "");
  useEffect(() => {
    setClient(p.client ?? "");
    setDetails(p.clientDetails ?? "");
    setKeywords(p.keywords ?? "");
  }, [p.id, p.client, p.clientDetails, p.keywords]);
  const save = (patch: { client?: string; clientDetails?: string; keywords?: string }) => api.updateProject(p.id, patch).catch(() => {});
  const field = "w-full rounded-xl bg-[var(--glass)] px-3 py-2 text-[13px] outline-none ring-1 ring-[var(--border-strong)] transition placeholder:text-faint focus:ring-[var(--accent)]";
  return (
    <div className="mb-5 rounded-2xl glass p-3.5" data-testid="client-section">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
        <Briefcase size={13} /> Client
      </div>
      <div className="space-y-2">
        <input aria-label="Client" className={field} placeholder="Client or company" value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== (p.client ?? "") && save({ client })} />
        <textarea
          aria-label="Client details"
          rows={2}
          className={field + " resize-none"}
          placeholder="Contact person, email, phone, website…"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          onBlur={() => details !== (p.clientDetails ?? "") && save({ clientDetails: details })}
        />
        <input
          aria-label="Keywords"
          className={field}
          placeholder="Keywords: people, channels, domains (comma-separated)"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          onBlur={() => keywords !== (p.keywords ?? "") && save({ keywords })}
        />
      </div>
      <div className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-faint">
        <Wand2 size={12} className="mt-[2px] shrink-0" /> Anything Flo catches (screen, Slack, meetings, voice) that mentions {p.name}
        {client ? `, ${client}` : ""} or a keyword lands in this project by itself.
      </div>
    </div>
  );
}
