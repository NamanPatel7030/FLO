import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import clsx from "clsx";
import { Bell, CalendarClock, CheckCheck, CheckCircle2, Eye, Plus, Sun, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { formatDue, groupTodos, upcomingReminders } from "../../lib/format";
import type { Todo } from "../../lib/types";
import { useStore } from "../store";
import { Card, CardTitle, Input, PageHeader, Select, Skeleton, Button } from "../ui";
import { TodoRow } from "../components";

export default function Todos() {
  const { todos, projects } = useStore();
  const [filter, setFilter] = useState<string>("all");
  const [title, setTitle] = useState("");
  const [showDone, setShowDone] = useState(false);

  const filtered = todos?.filter((t) => filter === "all" || t.projectId === filter) ?? null;
  const g = filtered ? groupTodos(filtered) : null;
  const reminders = filtered ? upcomingReminders(filtered) : [];
  const open = g ? [...g.today, ...g.screen, ...g.upcoming] : [];
  // bulk actions ask once, in place: first click arms, second click (within 4 s) does it
  const [armed, setArmed] = useState<"done" | "clear" | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const markAllDone = async () => {
    if (armed !== "done") return setArmed("done");
    setArmed(null);
    await Promise.all(open.map((t) => api.updateTodo(t.id, { status: "done" }).catch(() => {})));
  };
  const clearDone = async () => {
    if (armed !== "clear") return setArmed("clear");
    setArmed(null);
    await Promise.all((g?.done ?? []).map((t) => api.deleteTodo(t.id).catch(() => {})));
  };

  const add = async () => {
    if (!title.trim()) return;
    await api.addTodo(title.trim(), filter !== "all" ? filter : undefined);
    setTitle("");
  };

  return (
    <div>
      <PageHeader
        title="To-dos"
        subtitle="Everything you said, promised, or missed, gathered in one place."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="glass" icon={<CheckCheck size={14} />} disabled={!open.length} onClick={markAllDone} aria-label="Mark all done">
              {armed === "done" ? `Mark ${open.length} done?` : "Mark all done"}
            </Button>
            <Button size="sm" variant="glass" icon={<Trash2 size={14} />} disabled={!g?.done.length} onClick={clearDone} aria-label="Clear done">
              {armed === "clear" ? `Delete ${g?.done.length} done?` : "Clear done"}
            </Button>
          <Select
            value={filter}
            onChange={setFilter}
            options={[{ value: "all", label: "All projects" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
          </div>
        }
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="mb-5 flex gap-2"
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a to-do… (or just say it)" />
        <Button type="submit" variant="primary" icon={<Plus size={15} />}>
          Add
        </Button>
      </form>

      {!g ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2" data-testid="reminders">
          <Card className="p-4">
            <CardTitle icon={<Bell size={15} />}>
              Reminders <span className="text-faint">{reminders.length}</span>
            </CardTitle>
            {reminders.length === 0 ? (
              <div className="py-3 text-[12.5px] text-faint">
                No reminders yet. Give a to-do a time, like "send the deck tomorrow at 5pm" or "by next Monday", and Flo reminds you 5 minutes early in the notch.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4">
                {reminders.map((t) => (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="w-[132px] shrink-0 rounded-lg bg-[var(--glass)] px-2 py-1 text-center text-[11.5px] font-medium tabular-nums text-brand-200">{formatDue(t.remindAt!)}</span>
                    <div className="min-w-0 flex-1">
                      <TodoRow todo={t} compact />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </div>
          <Group title="Today" icon={<Sun size={15} />} items={g.today} empty="Nothing due today." />
          <Group
            title="From your screen"
            icon={<Eye size={15} />}
            items={g.screen}
            empty="Flo hasn't spotted anything you missed."
            hint="Found by Attention, stays on this device"
            accent
          />
          <Group title="Upcoming" icon={<CalendarClock size={15} />} items={g.upcoming} empty="No upcoming deadlines." />
          <Card className="p-4">
            <CardTitle
              icon={<CheckCircle2 size={15} />}
              action={
                <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "Hide" : "Show"}
                </Button>
              }
            >
              Done <span className="text-faint">{g.done.length}</span>
            </CardTitle>
            {showDone && (
              <AnimatePresence initial={false}>
                {g.done.map((t) => (
                  <TodoRow key={t.id} todo={t} />
                ))}
              </AnimatePresence>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Group({ title, icon, items, empty, hint, accent }: { title: string; icon: React.ReactNode; items: Todo[]; empty: string; hint?: string; accent?: boolean }) {
  return (
    <Card className={clsx("p-4", accent && "ring-1 ring-brand-400/20")}>
      <CardTitle icon={icon}>
        {title} <span className="text-faint">{items.length}</span>
      </CardTitle>
      {hint && <div className="-mt-2 mb-2 text-[11.5px] text-faint">{hint}</div>}
      {items.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-faint">{empty}</div>
      ) : (
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <TodoRow key={t.id} todo={t} />
          ))}
        </AnimatePresence>
      )}
    </Card>
  );
}

