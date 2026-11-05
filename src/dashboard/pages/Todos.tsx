import { useState } from "react";
import { AnimatePresence } from "motion/react";
import clsx from "clsx";
import { CalendarClock, CheckCircle2, Eye, Plus, Sun } from "lucide-react";
import { api } from "../../lib/api";
import { groupTodos } from "../../lib/format";
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

  const add = async () => {
    if (!title.trim()) return;
    await api.addTodo(title.trim(), filter !== "all" ? filter : undefined);
    setTitle("");
  };

  return (
    <div>
      <PageHeader
        title="To-dos"
        subtitle="Everything you said, promised, or missed — gathered in one place."
        actions={
          <Select
            value={filter}
            onChange={setFilter}
            options={[{ value: "all", label: "All projects" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
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
          <Group title="Today" icon={<Sun size={15} />} items={g.today} empty="Nothing due today." />
          <Group
            title="From your screen"
            icon={<Eye size={15} />}
            items={g.screen}
            empty="Flo hasn't spotted anything you missed."
            hint="Found by Attention — stays on this device"
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
    <Card className={clsx("p-4", accent && "ring-1 ring-cyan-400/20")}>
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

