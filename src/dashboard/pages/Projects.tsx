import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { FolderKanban, Plus, StickyNote, X, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, relativeTime } from "../../lib/format";
import type { Project, ProjectStatus } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Empty, Input, PageHeader, ProgressRing, Select, Skeleton, StatusPill } from "../ui";
import { TodoRow } from "../components";

export default function Projects() {
  const { projects, pageArg, go } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const selected = projects?.find((p) => p.id === pageArg);

  const create = async () => {
    if (!name.trim()) return;
    const p = await api.createProject(name.trim(), desc.trim() || undefined);
    setCreating(false);
    setName("");
    setDesc("");
    go("projects", p.id);
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Say “what's the status of Apollo?” or “mark Hermes as blocked” — Flo keeps these in sync."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card strong className="mb-4 flex gap-2 p-3">
              <Input autoFocus placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
              <Input placeholder="Short description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
              <Button variant="primary" onClick={create}>
                Create
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </Card>
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
              <ProjectCard p={p} onClick={() => go("projects", p.id)} />
            </motion.div>
          ))}
        </div>
      )}

      {createPortal(<AnimatePresence>{selected && <Drawer p={selected} onClose={() => go("projects")} />}</AnimatePresence>, document.body)}
    </div>
  );
}

function ProjectCard({ p, onClick }: { p: Project; onClick: () => void }) {
  const total = p.openTodos + p.doneTodos;
  const pct = total ? p.doneTodos / total : 0;
  return (
    <Card onClick={onClick} className="relative h-full overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-30 blur-2xl" style={{ background: p.color }} />
      <div className="relative flex items-start justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-semibold text-white" style={{ background: p.color }}>
          {p.name[0]}
        </div>
        <ProgressRing value={pct} color={p.color}>
          {Math.round(pct * 100)}%
        </ProgressRing>
      </div>
      <div className="relative mt-3 text-[16px] font-semibold tracking-tight">{p.name}</div>
      <div className="relative mt-0.5 line-clamp-2 min-h-[34px] text-[12.5px] text-muted">{p.description}</div>
      <div className="relative mt-3 flex items-center justify-between">
        <StatusPill status={p.status} />
        <span className="text-[11.5px] text-faint">
          {p.openTodos} open · {relativeTime(p.updatedAt)}
        </span>
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
      <motion.div className="fixed inset-0 z-30 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        initial={{ x: 480, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="glass-strong fixed bottom-3 right-3 top-3 z-40 flex w-[440px] flex-col overflow-hidden rounded-3xl"
        style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
      >
        <div className="relative p-5">
          <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full opacity-35 blur-3xl" style={{ background: p.color }} />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[20px] font-semibold tracking-tight">{p.name}</div>
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
