// Context library: a custom system prompt + local docs (.md / .txt / pasted) the assistant can use.
// Backend sends only pinned docs (trimmed) + the most relevant chunks per request, so tokens stay low.
import { deviceWord } from "../../lib/os";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { BookText, ClipboardPaste, Eye, FileUp, Pin, PinOff, Save, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { formatNumber, relativeTime } from "../../lib/format";
import type { ContextDoc } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Empty, Input, PageHeader, Skeleton } from "../ui";

const MAX_FILE = 400 * 1024;
const PIN_BUDGET = 1200;
const PROMPT_STYLE_LIMIT = 300;

export default function ContextPage() {
  const { toast } = useStore();
  const [docs, setDocs] = useState<ContextDoc[] | null>(null);
  const refresh = useCallback(() => api.listContextDocs().then(setDocs), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const pinnedTokens = (docs ?? []).filter((d) => d.pinned && d.enabled).reduce((a, d) => a + d.tokens, 0);

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!/\.(md|markdown|txt)$/i.test(f.name)) {
        toast({ kind: "error", text: `${f.name}: only .md and .txt files` });
        continue;
      }
      if (f.size > MAX_FILE) {
        toast({ kind: "error", text: `${f.name} is over 400 KB. Split it into smaller notes.` });
        continue;
      }
      const text = await f.text();
      await api.addContextDoc(f.name.replace(/\.(md|markdown|txt)$/i, ""), text);
    }
    await refresh();
    toast({ kind: "success", text: "Added to your context" });
  };

  const patch = async (d: ContextDoc, p: Partial<Pick<ContextDoc, "title" | "enabled" | "pinned">>) => {
    setDocs((list) => (list ?? []).map((x) => (x.id === d.id ? { ...x, ...p } : x)));
    await api.updateContextDoc(d.id, p).catch(() => refresh());
  };

  const [viewing, setViewing] = useState<ContextDoc | null>(null);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Context" subtitle={`Teach Flo who you are and what you're working on. Stays on this ${deviceWord()}; only relevant bits are sent with each request.`} />
      <div className="flex flex-col gap-4">
        <SystemPromptCard />
        <UploadCard onFiles={addFiles} onPasted={refresh} />
        <Card className="p-5">
          <CardTitle
            icon={<BookText size={15} />}
            action={
              docs && docs.length > 0 ? (
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px]", pinnedTokens > PIN_BUDGET ? "bg-amber-400/15 text-amber-300" : "bg-[var(--glass-strong)] text-muted")}>
                  {formatNumber(pinnedTokens)} pinned tokens
                </span>
              ) : undefined
            }
          >
            Library
          </CardTitle>
          {pinnedTokens > PIN_BUDGET && (
            <p className="-mt-1 mb-3 text-[12px] text-amber-300/90">Pinned docs go with every request. Keep them under ~{formatNumber(PIN_BUDGET)} tokens to stay fast and cheap.</p>
          )}
          {!docs ? (
            <Skeleton className="h-28" />
          ) : docs.length === 0 ? (
            <Empty icon={<BookText size={18} />} title="No context yet" hint="Drop in notes about you, your projects or your clients. Flo picks the relevant parts when you ask." />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="context-docs">
              <AnimatePresence initial={false}>
                {docs.map((d) => (
                  <DocCard
                    key={d.id}
                    d={d}
                    onPatch={(p) => patch(d, p)}
                    onView={() => setViewing(d)}
                    onDelete={async () => {
                      setDocs((l) => (l ?? []).filter((x) => x.id !== d.id));
                      await api.deleteContextDoc(d.id).catch(() => refresh());
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </Card>
      </div>
      {viewing && <DocDrawer doc={viewing} onClose={() => setViewing(null)} onSaved={refresh} />}
    </div>
  );
}

function SystemPromptCard() {
  const { settings, setSettings } = useStore();
  const [value, setValue] = useState(settings?.systemPrompt ?? "");
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (settings && saved) setValue(settings.systemPrompt ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.systemPrompt]);
  const onChange = (v: string) => {
    setValue(v);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const s = useStore.getState().settings;
      if (s) await setSettings({ ...s, systemPrompt: v });
      setSaved(true);
    }, 600);
  };
  return (
    <Card strong className="p-5">
      <CardTitle
        icon={<Sparkles size={15} />}
        action={<span className="text-[11px] text-faint">{saved ? "Saved" : "Saving…"}</span>}
      >
        System prompt
      </CardTitle>
      <textarea
        aria-label="System prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="I'm Naman, a full-stack dev. Reply briefly and warmly. Use Hinglish with friends."
        className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none transition placeholder:text-[var(--fg-faint)] focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
      />
      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
        <span>{value.length <= PROMPT_STYLE_LIMIT ? "Short prompts (≤300 chars) also style your dictation." : "Used by the assistant. Keep it under 300 chars to also style dictation."}</span>
        <span className={clsx("tabular-nums", value.length > PROMPT_STYLE_LIMIT && "text-amber-300")}>{value.length}</span>
      </div>
    </Card>
  );
}

function UploadCard({ onFiles, onPasted }: { onFiles: (f: FileList | File[]) => void; onPasted: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { toast } = useStore();
  return (
    <Card className="p-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
        className={clsx(
          "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-7 text-center transition",
          over ? "border-brand-300/70 bg-brand-300/10" : "border-[var(--border-strong)] bg-[var(--glass)]",
        )}
        data-testid="dropzone"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-300/10 text-brand-300 shadow-[0_0_24px_-6px_rgba(102,206,255,0.6)]">
          <FileUp size={19} />
        </span>
        <div className="text-[13.5px] font-medium">Drop .md or .txt files here</div>
        <div className="text-[12px] text-muted">Notes about you, your projects or clients. Up to 400 KB each.</div>
        <div className="mt-1 flex gap-2">
          <Button variant="primary" size="sm" icon={<FileUp size={13} />} onClick={() => input.current?.click()}>
            Upload
          </Button>
          <Button size="sm" icon={<ClipboardPaste size={13} />} onClick={() => setPasting((v) => !v)}>
            Paste text
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/plain,text/markdown"
          multiple
          className="hidden"
          data-testid="context-file-input"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <AnimatePresence>
        {pasting && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 flex flex-col gap-2">
              <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Paste anything Flo should know"
                className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3 py-2 text-[13.5px] outline-none focus:border-brand-400/60"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Save size={13} />}
                  disabled={!text.trim()}
                  onClick={async () => {
                    await api.addContextDoc(title.trim() || text.trim().split("\n")[0].slice(0, 40), text);
                    setText("");
                    setTitle("");
                    setPasting(false);
                    onPasted();
                    toast({ kind: "success", text: "Added to your context" });
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function MiniSwitch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-[var(--fg)]"
    >
      <span className={clsx("relative h-[16px] w-[28px] rounded-full transition", on ? "accent-gradient" : "bg-[var(--border-strong)]")}>
        <span className="absolute top-[2px] h-3 w-3 rounded-full bg-[#fff] shadow transition-all" style={{ left: on ? 14 : 2 }} />
      </span>
      {label}
    </button>
  );
}

function DocCard({ d, onPatch, onView, onDelete }: { d: ContextDoc; onPatch: (p: Partial<ContextDoc>) => void; onView: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(d.title);
  useEffect(() => setTitle(d.title), [d.title]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={clsx("group flex flex-col gap-2 rounded-2xl border p-3.5 transition", d.pinned ? "border-brand-300/30 bg-brand-300/[0.06]" : "border-[var(--border)] bg-[var(--glass)]", !d.enabled && "opacity-60")}
      data-testid="context-doc"
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== d.title && onPatch({ title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13.5px] font-semibold outline-none focus:bg-[var(--glass)]"
        />
        <span className="shrink-0 rounded-full bg-[var(--glass-strong)] px-1.5 py-px text-[10.5px] tabular-nums text-muted">~{formatNumber(d.tokens)} tok</span>
        <button onClick={() => onPatch({ pinned: !d.pinned })} title={d.pinned ? "Unpin" : "Pin: always include"} aria-label={d.pinned ? "Unpin" : "Pin"} className={clsx("rounded-lg p-1 transition", d.pinned ? "text-brand-300" : "text-faint hover:text-[var(--fg)]")}>
          {d.pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
      </div>
      <p className="line-clamp-2 px-1 text-[12px] leading-relaxed text-muted">{d.preview}</p>
      <div className="mt-auto flex items-center gap-3 px-1">
        <MiniSwitch on={d.enabled} onChange={(v) => onPatch({ enabled: v })} label="Use" />
        <MiniSwitch on={d.pinned} onChange={(v) => onPatch({ pinned: v })} label="Pin" />
        <span className="ml-auto text-[10.5px] text-faint">{relativeTime(d.createdAt)}</span>
        <button onClick={onView} title="View and edit" aria-label="View" className="rounded-lg p-1 text-faint hover:text-[var(--fg)]">
          <Eye size={14} />
        </button>
        <button onClick={onDelete} title="Delete" aria-label="Delete" className="rounded-lg p-1 text-faint hover:text-red-400">
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}

function DocDrawer({ doc, onClose, onSaved }: { doc: ContextDoc; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api.getContextDoc(doc.id).then((r) => setContent(r.content)).catch(() => setContent(""));
  }, [doc.id]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
        className="relative flex h-full w-[min(560px,92vw)] flex-col glass-strong p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <BookText size={16} className="text-brand-300" />
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{doc.title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-faint hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>
        {content === null ? (
          <Skeleton className="h-full" />
        ) : (
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            className="selectable min-h-0 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--glass)] p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-brand-400/60"
          />
        )}
        <div className="mt-3 flex items-center justify-between text-[11.5px] text-faint">
          <span>{content !== null ? `~${formatNumber(Math.ceil(content.length / 4))} tokens` : ""}</span>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={13} />}
            disabled={!dirty}
            onClick={async () => {
              await api.updateContextDoc(doc.id, { content: content ?? "" });
              setDirty(false);
              onSaved();
            }}
          >
            Save
          </Button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
