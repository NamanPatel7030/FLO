// AI provider + model picker + key, shared by Settings → AI and the first-run wizard.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Lock,
  Pencil,
  Search,
} from "lucide-react";
import { api } from "../lib/api";
import type { KeyProvider, LlmProvider, Settings } from "../lib/types";
import { useStore } from "./store";
import { Button, Input, Select, Skeleton } from "./ui";
import { openExternal } from "./Signature";
import { copyText } from "../lib/clipboard";

export interface ProviderInfo {
  value: LlmProvider;
  label: string;
  model: string;
  key?: KeyProvider;
  keyUrl?: string;
  local?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { value: "ollama", label: "Ollama (local)", model: "qwen3:8b", local: true },
  {
    value: "lmstudio",
    label: "LM Studio (local)",
    model: "local-model",
    local: true,
  },
  {
    value: "openai",
    label: "OpenAI",
    model: "gpt-5-mini",
    key: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    model: "claude-haiku-5-5",
    key: "anthropic",
    keyUrl: "https://console.anthropic.com",
  },
  {
    value: "gemini",
    label: "Google Gemini",
    model: "gemini-flash-latest",
    key: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    value: "groq",
    label: "Groq",
    model: "openai/gpt-oss-120b",
    key: "groq",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    model: "openai/gpt-oss-120b",
    key: "openrouter",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    value: "minimax",
    label: "MiniMax",
    model: "MiniMax-M2",
    key: "minimax",
    keyUrl: "https://platform.minimax.io",
  },
  {
    value: "qwen",
    label: "Qwen (Alibaba DashScope)",
    model: "qwen-plus",
    key: "qwen",
    keyUrl: "https://dashscope.console.aliyun.com",
  },
  {
    value: "ollama_cloud",
    label: "Ollama Cloud",
    model: "gpt-oss:120b",
    key: "ollama_cloud",
    keyUrl: "https://ollama.com/settings/keys",
  },
  { value: "none", label: "None (raw transcripts)", model: "" },
];

export const providerInfo = (p: LlmProvider) =>
  PROVIDERS.find((x) => x.value === p);

/** Settings patch for switching provider (default model + local URL). */
export function switchProvider(s: Settings, v: LlmProvider): Partial<Settings> {
  return {
    llmProvider: v,
    llmModel: providerInfo(v)?.model ?? "",
    localLlmUrl:
      v === "lmstudio"
        ? "http://localhost:1234"
        : v === "ollama"
          ? "http://localhost:11434"
          : s.localLlmUrl,
  };
}

/** Models for a provider. Local Ollama: only what's pulled ([] = none / unreachable). */
async function loadModels(provider: LlmProvider): Promise<string[]> {
  if (provider === "ollama") {
    const pulled = await api.localModels();
    if (pulled) return pulled;
  }
  return api.providerModels(provider);
}

const PULL_CMD = "ollama pull qwen3:8b";

/** Searchable model combobox: skeleton while loading, filter, current highlighted, Custom… free text. */
export function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: LlmProvider;
  value: string;
  onChange: (m: string) => void;
}) {
  const [models, setModels] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState(false);
  const [hot, setHot] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let live = true;
    setModels(null);
    setCustom(false);
    loadModels(provider)
      .then((m) => live && setModels(m))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [provider]);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) =>
      !box.current?.contains(e.target as Node) &&
      !menu.current?.contains(e.target as Node) &&
      setOpen(false);
    // the menu is portalled at a fixed position: close it if the page scrolls or resizes
    const close = (e: Event) =>
      !menu.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const list = useMemo(() => {
    const all = models ?? [];
    const f = q.trim().toLowerCase();
    return f ? all.filter((m) => m.toLowerCase().includes(f)) : all;
  }, [models, q]);

  if (!models) return <Skeleton className="h-9 w-72" />;

  if (provider === "ollama" && models.length === 0)
    return (
      <div className="flex w-72 flex-col gap-1.5" data-testid="ollama-install">
        <p className="text-[12px] text-muted">
          No local models found. Install Ollama, then run:
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-[var(--glass)] px-3 py-1.5">
          <code className="flex-1 font-mono text-[12.5px]">{PULL_CMD}</code>
          <CopyChip text={PULL_CMD} />
        </div>
        <button
          className="self-start text-[12px] text-brand-500 hover:underline dark:text-brand-300"
          onClick={() => openExternal("https://ollama.com/download")}
        >
          Get Ollama
        </button>
      </div>
    );

  if (custom)
    return (
      <div className="flex w-72 items-center gap-1.5">
        <Input
          autoFocus
          aria-label="Custom model"
          placeholder="model name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button size="sm" variant="ghost" onClick={() => setCustom(false)}>
          List
        </Button>
      </div>
    );

  const items = [...list, "__custom"];
  const pick = (m: string) => {
    if (m === "__custom") setCustom(true);
    else onChange(m);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative w-72">
      <button
        role="combobox"
        aria-expanded={open}
        aria-label="Model"
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3 text-left text-[13.5px] outline-none focus:border-brand-400/60"
        onClick={() => {
          setRect(box.current?.getBoundingClientRect() ?? null);
          setOpen((o) => !o);
          setHot(Math.max(0, list.indexOf(value)));
        }}
      >
        <span className="min-w-0 flex-1 truncate">
          {value || <span className="text-faint">Choose a model</span>}
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menu}
            className="fixed z-[60] overflow-hidden rounded-xl border border-[var(--border)] shadow-xl"
            style={{ top: rect.bottom + 4, left: rect.left, width: rect.width, background: "var(--menu-bg)" }}
            data-testid="model-menu"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
              <Search size={13} className="text-faint" />
              <input
                autoFocus
                aria-label="Search models"
                placeholder="Search models"
                className="h-9 flex-1 bg-transparent text-[13px] outline-none focus:shadow-none focus:outline-none focus:ring-0"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHot(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown")
                    setHot((h) => Math.min(items.length - 1, h + 1));
                  else if (e.key === "ArrowUp")
                    setHot((h) => Math.max(0, h - 1));
                  else if (e.key === "Enter") pick(items[hot]);
                  else if (e.key === "Escape") setOpen(false);
                  else return;
                  e.preventDefault();
                }}
              />
            </div>
            <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
              {list.length === 0 && (
                <li className="px-3 py-2 text-[12.5px] text-faint">No match</li>
              )}
              {items.map((m, i) => (
                <li
                  key={m}
                  role="option"
                  aria-selected={m === value}
                  onMouseEnter={() => setHot(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  className={clsx(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px]",
                    i === hot && "bg-[var(--glass-strong)]",
                    m === value && "text-brand-500 dark:text-brand-300",
                    m === "__custom" &&
                      "border-t border-[var(--border)] text-muted",
                  )}
                >
                  {m === "__custom" ? (
                    <>
                      <Pencil size={12} /> Custom…
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                        {m}
                      </span>
                      {m === value && <Check size={13} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      aria-label="Copy command"
      title="Copy"
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1300);
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/** API key for one provider: saved state or a paste field, plus "Get key". */
export function ProviderKey({ info }: { info: ProviderInfo }) {
  const toast = useStore((x) => x.toast);
  const [has, setHas] = useState<boolean | null>(null);
  const [val, setVal] = useState("");
  useEffect(() => {
    setHas(null);
    if (info.key) api.hasApiKey(info.key).then(setHas);
  }, [info.key]);
  if (!info.key) return null;
  const getKey = info.keyUrl && (
    <button
      className="flex shrink-0 items-center gap-1 text-[12px] text-brand-500 hover:underline dark:text-brand-300"
      onClick={() => openExternal(info.keyUrl!)}
    >
      Get key <ExternalLink size={11} />
    </button>
  );
  if (has === null) return <Skeleton className="h-9 w-72" />;
  return has ? (
    <div className="flex w-72 items-center gap-2" data-testid="key-saved">
      <span className="flex flex-1 items-center gap-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-300">
        <Lock size={12} /> Saved in keychain
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await api.deleteApiKey(info.key!);
          setHas(false);
        }}
      >
        Remove
      </Button>
    </div>
  ) : (
    <form
      className="flex w-72 items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!val.trim()) return;
        await api.setApiKey(info.key!, val.trim());
        setVal("");
        setHas(true);
        toast({ kind: "success", text: `${info.label} key saved` });
      }}
    >
      <Input
        type="password"
        autoComplete="off"
        aria-label={`${info.label} API key`}
        placeholder="Paste key"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      {val.trim() ? (
        <Button size="sm" type="submit">
          Save
        </Button>
      ) : (
        getKey
      )}
    </form>
  );
}

/** Provider dropdown + model picker + key (if any) + local URL. Rows are rendered by the caller's `row`. */
export function AiProviderFields({
  s,
  set,
  row,
}: {
  s: Settings;
  set: (p: Partial<Settings>) => void;
  row: (
    label: string,
    hint: string | undefined,
    node: React.ReactNode,
  ) => React.ReactNode;
}) {
  const info = providerInfo(s.llmProvider);
  const local = !!info?.local;
  return (
    <>
      {row(
        "Language model",
        local
          ? "Runs on your machine, nothing leaves it."
          : s.llmProvider === "none"
            ? "Dictation is pasted as transcribed."
            : "Called directly with your key. No Flo servers in between.",
        <Select<LlmProvider>
          value={s.llmProvider}
          onChange={(v) => set(switchProvider(s, v))}
          options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
        />,
      )}
      {info?.key && row("API key", undefined, <ProviderKey info={info} />)}
      {s.llmProvider !== "none" &&
        row(
          "Model",
          undefined,
          <ModelPicker
            provider={s.llmProvider}
            value={s.llmModel}
            onChange={(m) => set({ llmModel: m })}
          />,
        )}
      {local &&
        row(
          "Server URL",
          undefined,
          <Input
            className="w-72"
            value={s.localLlmUrl}
            onChange={(e) => set({ localLlmUrl: e.target.value })}
          />,
        )}
    </>
  );
}
