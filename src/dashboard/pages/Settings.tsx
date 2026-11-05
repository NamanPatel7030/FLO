import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, Download, KeyRound, Lock, Plug, ShieldCheck, Trash2, X, Terminal, Keyboard } from "lucide-react";
import { api, on, type Permissions } from "../../lib/api";
import { formatNumber, relativeTime } from "../../lib/format";
import { EV, type ClaudeHookStatus, type DictionaryEntry, type KeyProvider, type LlmProvider, type LocalModel, type ModelProgressEvent, type NetworkLogEntry, type Settings as S, type SttProvider } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Input, PageHeader, Select, Skeleton, Toggle } from "../ui";

const TABS = ["General", "Voice", "AI", "Privacy", "Permissions", "Dictionary", "Integrations"] as const;
type Tab = (typeof TABS)[number];

export default function Settings() {
  const { settings, setSettings, pageArg, go } = useStore();
  const tab: Tab = (TABS.find((t) => t.toLowerCase() === pageArg) ?? "General") as Tab;
  const set = (patch: Partial<S>) => settings && setSettings({ ...settings, ...patch });

  return (
    <div>
      <PageHeader title="Settings" subtitle="Everything runs on your machine. Bring your own keys only if you want cloud models." />
      <div className="glass mb-5 inline-flex rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => go("settings", t.toLowerCase())}
            className={clsx("relative h-8 rounded-lg px-3.5 text-[13px] font-medium transition", tab === t ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
          >
            {tab === t && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-lg glass-strong" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{t}</span>
          </button>
        ))}
      </div>
      {!settings ? (
        <Skeleton className="h-80" />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="max-w-3xl">
            {tab === "General" && <General s={settings} set={set} />}
            {tab === "Voice" && <Voice s={settings} set={set} />}
            {tab === "AI" && <AI s={settings} set={set} />}
            {tab === "Privacy" && <Privacy s={settings} set={set} />}
            {tab === "Permissions" && <PermissionsTab />}
            {tab === "Dictionary" && <Dictionary />}
            {tab === "Integrations" && <Integrations />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

type P = { s: S; set: (p: Partial<S>) => void };

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div>
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General({ s, set }: P) {
  return (
    <Card className="divide-y divide-[var(--border)] px-5 py-2">
      <Row label="Your name" hint="Used in greetings and to spot messages addressed to you.">
        <Input className="w-56" value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
      </Row>
      <Toggle label="Sounds" hint="Soft chimes when recording starts and stops." checked={s.playSounds} onChange={(v) => set({ playSounds: v })} />
      <Row label="Your typing speed" hint="Used to calculate time saved.">
        <div className="flex items-center gap-2">
          <Input type="number" className="w-20" value={s.typingWpm} onChange={(e) => set({ typingWpm: Number(e.target.value) || 40 })} />
          <span className="text-[12px] text-muted">wpm</span>
        </div>
      </Row>
    </Card>
  );
}

function Voice({ s, set }: P) {
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [progress, setProgress] = useState<Record<string, ModelProgressEvent>>({});
  const toast = useStore((x) => x.toast);
  useEffect(() => {
    api.listModels().then(setModels);
    return on<ModelProgressEvent>(EV.modelProgress, (e) => {
      setProgress((p) => ({ ...p, [e.id]: e }));
      if (e.done) {
        api.listModels().then(setModels);
        if (e.error) toast({ kind: "error", text: e.error });
        else toast({ kind: "success", text: "Model ready" });
      }
    });
  }, [toast]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <Row label="Speech-to-text engine" hint={s.sttProvider === "local" ? "On-device. Audio never leaves this computer." : "Uses your API key; audio is sent to the provider."}>
          <Select<SttProvider>
            value={s.sttProvider}
            onChange={(v) => set({ sttProvider: v, sttModel: v === "local" ? "large-v3-turbo-q5_0" : v === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe" })}
            options={[
              { value: "local", label: "On-device (private)" },
              { value: "groq", label: "Groq Whisper (BYOK)" },
              { value: "openai", label: "OpenAI (BYOK)" },
            ]}
          />
        </Row>
        {s.sttProvider !== "local" && (
          <Row label="Model">
            <Input className="w-64" value={s.sttModel} onChange={(e) => set({ sttModel: e.target.value })} />
          </Row>
        )}
        <Row label="Language" hint="Auto-detect handles mixed languages (e.g. Hindi + English).">
          <Select
            value={s.language}
            onChange={(v) => set({ language: v })}
            options={[
              { value: "auto", label: "Auto-detect" },
              { value: "en", label: "English" },
              { value: "hi", label: "Hindi" },
              { value: "gu", label: "Gujarati" },
              { value: "es", label: "Spanish" },
              { value: "de", label: "German" },
              { value: "fr", label: "French" },
            ]}
          />
        </Row>
      </Card>
      {s.sttProvider === "local" && (
        <Card className="p-5">
          <CardTitle>On-device models</CardTitle>
          <div className="flex flex-col gap-2">
            {!models && <Skeleton className="h-28" />}
            {models?.map((m) => {
              const pr = progress[m.id];
              const downloading = pr && !pr.done;
              const active = s.sttModel === m.id;
              return (
                <div key={m.id} className={clsx("flex items-center gap-4 rounded-xl p-3 transition", active ? "glass-strong ring-1 ring-brand-400/40" : "bg-[var(--glass)]")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13.5px] font-medium">
                      {m.label}
                      {active && <span className="rounded-full bg-brand-500/20 px-1.5 text-[10.5px] text-brand-500 dark:text-brand-300">In use</span>}
                    </div>
                    <div className="text-[12px] text-faint">
                      {m.languages} · {m.sizeMb} MB
                    </div>
                    {downloading && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-strong)]">
                        <motion.div className="h-full accent-gradient" animate={{ width: `${(pr.received / Math.max(1, pr.total)) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  {m.installed ? (
                    <div className="flex gap-1.5">
                      {!active && (
                        <Button size="sm" onClick={() => set({ sttModel: m.id })}>
                          Use
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => api.deleteModel(m.id).then(() => api.listModels().then(setModels))} />
                    </div>
                  ) : (
                    <Button size="sm" variant="primary" disabled={!!downloading} icon={<Download size={13} />} onClick={() => api.downloadModel(m.id)}>
                      {downloading ? `${Math.round((pr.received / Math.max(1, pr.total)) * 100)}%` : "Download"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

const PROVIDERS: { value: LlmProvider; label: string; model: string; key?: KeyProvider }[] = [
  { value: "ollama", label: "Ollama (local)", model: "qwen3:8b" },
  { value: "lmstudio", label: "LM Studio (local)", model: "local-model" },
  { value: "openai", label: "OpenAI", model: "gpt-5-mini", key: "openai" },
  { value: "anthropic", label: "Anthropic", model: "claude-haiku-5-5", key: "anthropic" },
  { value: "gemini", label: "Google Gemini", model: "gemini-flash-latest", key: "gemini" },
  { value: "groq", label: "Groq", model: "openai/gpt-oss-120b", key: "groq" },
  { value: "openrouter", label: "OpenRouter", model: "openai/gpt-oss-120b", key: "openrouter" },
  { value: "none", label: "None (raw transcripts)", model: "" },
];

function AI({ s, set }: P) {
  const toast = useStore((x) => x.toast);
  const [testing, setTesting] = useState(false);
  const local = s.llmProvider === "ollama" || s.llmProvider === "lmstudio";
  return (
    <div className="flex flex-col gap-4">
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <Row label="Language model" hint={local ? "Runs on your machine — nothing leaves it." : s.llmProvider === "none" ? "Dictation is pasted as transcribed." : "Called directly with your key. No Flo servers in between."}>
          <Select<LlmProvider>
            value={s.llmProvider}
            onChange={(v) => set({ llmProvider: v, llmModel: PROVIDERS.find((p) => p.value === v)?.model ?? "", localLlmUrl: v === "lmstudio" ? "http://localhost:1234" : v === "ollama" ? "http://localhost:11434" : s.localLlmUrl })}
            options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Row>
        {s.llmProvider !== "none" && (
          <Row label="Model">
            <Input className="w-64" value={s.llmModel} onChange={(e) => set({ llmModel: e.target.value })} />
          </Row>
        )}
        {local && (
          <Row label="Server URL">
            <Input className="w-64" value={s.localLlmUrl} onChange={(e) => set({ localLlmUrl: e.target.value })} />
          </Row>
        )}
        <Toggle label="Polish dictation" hint="Remove filler words, fix punctuation, apply your dictionary." checked={s.cleanupEnabled} onChange={(v) => set({ cleanupEnabled: v })} />
        {s.llmProvider !== "none" && (
          <Row label="Connection">
            <Button
              size="sm"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                try {
                  toast({ kind: "success", text: await api.testLlm() });
                } catch (e) {
                  toast({ kind: "error", text: String(e) });
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? "Testing…" : "Test"}
            </Button>
          </Row>
        )}
      </Card>
      <Card className="p-5">
        <CardTitle icon={<KeyRound size={15} />}>API keys</CardTitle>
        <p className="-mt-1 mb-3 text-[12px] text-muted">Stored in your {navigator.platform.includes("Win") ? "Windows Credential Manager" : "macOS Keychain"}. Never written to disk in plain text.</p>
        <div className="flex flex-col gap-2">
          {PROVIDERS.filter((p) => p.key).map((p) => (
            <KeyRow key={p.key} provider={p.key!} label={p.label} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function KeyRow({ provider, label }: { provider: KeyProvider; label: string }) {
  const toast = useStore((x) => x.toast);
  const [has, setHas] = useState<boolean | null>(null);
  const [val, setVal] = useState("");
  useEffect(() => {
    api.hasApiKey(provider).then(setHas);
  }, [provider]);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-[var(--glass)] px-3 py-2">
      <div className="w-28 text-[13px] font-medium">{label}</div>
      {has ? (
        <>
          <div className="flex flex-1 items-center gap-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-300">
            <Lock size={12} /> Saved in keychain
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api.deleteApiKey(provider);
              setHas(false);
            }}
          >
            Remove
          </Button>
        </>
      ) : (
        <form
          className="flex flex-1 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!val.trim()) return;
            await api.setApiKey(provider, val.trim());
            setVal("");
            setHas(true);
            toast({ kind: "success", text: `${label} key saved` });
          }}
        >
          <Input type="password" autoComplete="off" placeholder="Paste key…" value={val} onChange={(e) => setVal(e.target.value)} />
          <Button size="sm" type="submit" disabled={!val.trim()}>
            Save
          </Button>
        </form>
      )}
    </div>
  );
}

function Privacy({ s, set }: P) {
  const [log, setLog] = useState<NetworkLogEntry[] | null>(null);
  const [deny, setDeny] = useState("");
  useEffect(() => {
    const load = () => api.networkLog().then(setLog);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 p-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-emerald-500" />
        <div className="text-[13px] text-muted">
          <span className="font-medium text-[var(--fg)]">Local-first by design.</span> Your history, notes, to-dos and screen text are stored encrypted on this device. No account, no telemetry. Every network request
          goes through one gate — see it below.
        </div>
      </Card>
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <Toggle label="Let Assistant use cloud models" hint="Selected text and your request may go to your chosen provider (with your key)." checked={s.assistantCloudAllowed} onChange={(v) => set({ assistantCloudAllowed: v })} />
        <Toggle label="Assistant can see the active window" hint="A screenshot of the front window is added as context when you ask." checked={s.assistantScreenContext} onChange={(v) => set({ assistantScreenContext: v })} />
        <Toggle label="Attention" hint="Notice things you might miss on screen and turn them into to-dos." checked={s.attentionEnabled} onChange={(v) => set({ attentionEnabled: v })} />
        {s.attentionEnabled && (
          <>
            <Row label="Look every" hint="Also looks when you switch apps.">
              <Select
                value={String(s.attentionIntervalSec)}
                onChange={(v) => set({ attentionIntervalSec: Number(v) })}
                options={[10, 20, 30, 60, 120].map((n) => ({ value: String(n), label: n < 60 ? `${n} seconds` : `${n / 60} min` }))}
              />
            </Row>
            <div className="py-3">
              <div className="text-[13.5px] font-medium">Never look at</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.attentionDenylist.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full glass-strong px-2.5 py-1 text-[12px]">
                    {a}
                    <button onClick={() => set({ attentionDenylist: s.attentionDenylist.filter((x) => x !== a) })} className="text-faint hover:text-[var(--fg)]">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (deny.trim()) set({ attentionDenylist: [...s.attentionDenylist, deny.trim()] });
                    setDeny("");
                  }}
                >
                  <input value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="+ Add app" className="h-7 w-28 rounded-full border border-dashed border-[var(--border-strong)] bg-transparent px-3 text-[12px] outline-none" />
                </form>
              </div>
            </div>
            <Toggle label="Let Attention use cloud models" hint="Off = screen text is only processed by your local model. Screenshots never leave the device either way." checked={s.attentionCloudAllowed} onChange={(v) => set({ attentionCloudAllowed: v })} />
          </>
        )}
      </Card>
      <Card className="p-5">
        <CardTitle>Network log</CardTitle>
        {!log ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[var(--glass)] text-[11px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                  <th className="px-3 py-2 text-right font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {log.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-faint">{relativeTime(l.at)}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      <span className="inline-flex items-center gap-1.5">
                        {l.allowed ? <Check size={12} className="text-emerald-500" /> : <X size={12} className="text-red-400" />}
                        {l.host}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{l.purpose}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-faint">{l.bytes ? `${formatNumber(l.bytes / 1024)} KB` : "—"}</td>
                  </tr>
                ))}
                {log.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-faint">
                      No network requests. Fully offline.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PermissionsTab() {
  const toast = useStore((x) => x.toast);
  const geo = useStore((x) => x.geo);
  const [p, setP] = useState<Permissions | null>(null);
  useEffect(() => {
    const load = () => api.checkPermissions().then(setP);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  const items: { k: keyof Permissions; label: string; why: string }[] = [
    { k: "microphone", label: "Microphone", why: "To hear you when you hold the hotkey or record a meeting." },
    { k: "accessibility", label: "Accessibility", why: "To catch the hotkey, read selected text, and paste into any app." },
    { k: "screen", label: "Screen Recording", why: "For Attention and screen-aware answers. Images stay on this device." },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-4">
        {!p && <Skeleton className="h-36" />}
        {p &&
          items.map((it) => (
            <div key={it.k} className="flex items-center gap-4 rounded-xl bg-[var(--glass)] p-3">
              <span className={clsx("flex h-8 w-8 items-center justify-center rounded-full", p[it.k] ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
                {p[it.k] ? <Check size={15} /> : <Lock size={14} />}
              </span>
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">{it.label}</div>
                <div className="text-[12px] text-muted">{it.why}</div>
              </div>
              {p[it.k] ? (
                <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-300">Granted</span>
              ) : (
                <Button size="sm" variant="primary" onClick={() => api.openPermissionSettings(it.k)}>
                  Grant
                </Button>
              )}
            </div>
          ))}
      </Card>
      {geo?.platform !== "windows" && (
        <Card className="flex items-center gap-4 p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/15 text-brand-500">
            <Keyboard size={15} />
          </span>
          <div className="flex-1">
            <div className="text-[13.5px] font-medium">Free the fn key</div>
            <div className="text-[12px] text-muted">Sets “Press 🌐 key to: Do Nothing” so holding fn doesn't open the emoji picker or dictation.</div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.fixFnKey();
                toast({ kind: "success", text: "fn key is free for Flo" });
              } catch (e) {
                toast({ kind: "error", text: String(e) });
              }
            }}
          >
            Free fn key
          </Button>
        </Card>
      )}
    </div>
  );
}

function Dictionary() {
  const [items, setItems] = useState<DictionaryEntry[] | null>(null);
  const [word, setWord] = useState("");
  const [rep, setRep] = useState("");
  const load = () => api.listDictionary().then(setItems);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card className="p-5">
      <CardTitle>Personal dictionary</CardTitle>
      <p className="-mt-1 mb-3 text-[12px] text-muted">Names, jargon and spellings Flo should always get right. Add a “heard as” to fix common mis-hearings.</p>
      <form
        className="mb-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!word.trim()) return;
          await api.addDictionary(word.trim(), rep.trim() || undefined);
          setWord("");
          setRep("");
          load();
        }}
      >
        <Input placeholder="Word (e.g. Flo Flow)" value={word} onChange={(e) => setWord(e.target.value)} />
        <Input placeholder="Heard as (optional)" value={rep} onChange={(e) => setRep(e.target.value)} />
        <Button type="submit" variant="primary">
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {items?.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full glass-strong px-3 py-1 text-[12.5px]">
            {d.replacement && <span className="text-faint line-through">{d.replacement}</span>}
            {d.word}
            <button
              className="text-faint hover:text-[var(--fg)]"
              onClick={async () => {
                await api.removeDictionary(d.id);
                load();
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
    </Card>
  );
}

function Integrations() {
  const toast = useStore((x) => x.toast);
  const [st, setSt] = useState<ClaudeHookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.claudeHookStatus().then(setSt);
  }, []);
  const act = async (fn: () => Promise<ClaudeHookStatus>, msg: string) => {
    setBusy(true);
    try {
      setSt(await fn());
      toast({ kind: "success", text: msg });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#d97757] opacity-25 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d97757] text-white">
            <Terminal size={18} />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              Claude Code
              {st && (
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", st.installed ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-[var(--glass-strong)] text-muted")}>
                  {st.installed ? "Connected" : "Not connected"}
                </span>
              )}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              Get a notch reminder whenever a Claude Code session finishes or needs your input. Flo listens on 127.0.0.1 only; Claude Code hooks ping it when a session stops or needs input.
            </p>
            {st ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <Info label="Listener" value={st.listening ? "Listening" : "Stopped"} ok={st.listening} />
                <Info label="Port" value={`127.0.0.1:${st.port}`} />
                <Info label="Config" value={st.configPath} mono />
              </div>
            ) : (
              <Skeleton className="mt-3 h-12" />
            )}
            <div className="mt-4 flex gap-2">
              {st?.installed ? (
                <Button variant="glass" disabled={busy} onClick={() => act(api.uninstallClaudeHook, "Claude Code disconnected")}>
                  Disconnect
                </Button>
              ) : (
                <Button variant="primary" icon={<Plug size={14} />} disabled={busy || !st} onClick={() => act(api.installClaudeHook, "Claude Code connected")}>
                  Connect
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
      <Card className="p-4 text-[12.5px] text-muted">
        <span className="font-medium text-[var(--fg)]">Coming later:</span> WhatsApp and Slack — so Attention can catch messages you haven't replied to, even when the app isn't on screen.
      </Card>
    </div>
  );
}

function Info({ label, value, ok, mono }: { label: string; value: string; ok?: boolean; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-[var(--glass)] px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-faint">{label}</div>
      <div className={clsx("mt-0.5 truncate", mono && "font-mono text-[11.5px]", ok === true && "text-emerald-600 dark:text-emerald-300")}>{value}</div>
    </div>
  );
}
