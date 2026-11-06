import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, Download, KeyRound, Lock, Mic, RotateCcw, ShieldCheck, Sparkles, Trash2, X, Keyboard, Palette, Volume2, LayoutGrid, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { api, on } from "../../lib/api";
import { PERMISSION_ITEMS, usePermissions } from "../usePermissions";
import { formatHotkey, formatNumber, hotkeyWords, HOTKEY_OPTIONS, relativeTime } from "../../lib/format";
import { EV, ACCENT_PRESETS, type DictionaryEntry, type KeyProvider, type LocalModel, type ModelProgressEvent, type NetworkLogEntry, type Settings as S, type SttProvider, type HotkeyCombo, type NotchStyle } from "../../lib/types";
import { NotchViz } from "../../island/Ribbon";
import { broadcastNotchPreview, deriveGradient, normalizeHex } from "../../lib/theme";
import { useStore } from "../store";
import { Button, Card, CardTitle, FieldHelp, InfoDot, Input, PageHeader, Select, Skeleton, Toggle } from "../ui";
import { About } from "../About";
import { Integrations } from "../Integrations";
import { AiProviderFields, PROVIDERS } from "../AiSetup";
import { accountApi, initials, refreshAccount, useAccount } from "../../lib/account";
import { playCue } from "../../lib/cueSounds";
import { DEFAULT_WIDGETS, WIDGETS, loadWidgets, saveWidgets, type WidgetId } from "../../lib/widgets";
import { WidgetPreview } from "../../island/Widgets";

const TABS = ["Account", "General", "Appearance", "Shortcuts", "Voice", "AI", "Privacy", "Permissions", "Dictionary", "Integrations", "About"] as const;
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
            {tab === "Account" && <AccountTab />}
            {tab === "General" && <General s={settings} set={set} />}
            {tab === "Appearance" && <Appearance s={settings} set={set} />}
            {tab === "Shortcuts" && <Shortcuts s={settings} set={set} />}
            {tab === "Voice" && <Voice s={settings} set={set} />}
            {tab === "AI" && <AI s={settings} set={set} />}
            {tab === "Privacy" && <Privacy s={settings} set={set} />}
            {tab === "Permissions" && <PermissionsTab />}
            {tab === "Dictionary" && <Dictionary />}
            {tab === "Integrations" && <Integrations />}
            {tab === "About" && <About />}
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

function KeyPicker({ value, other, onChange }: { value: HotkeyCombo; other: HotkeyCombo; onChange: (v: HotkeyCombo) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {HOTKEY_OPTIONS.map((k) => {
        const active = k === value;
        const taken = k === other;
        return (
          <button
            key={k}
            disabled={taken}
            title={taken ? "Already used by the other shortcut" : hotkeyWords(k)}
            onClick={() => onChange(k)}
            className={clsx("keycap", active && "keycap-active", taken && "opacity-35")}
          >
            {formatHotkey(k)}
          </button>
        );
      })}
    </div>
  );
}

function Shortcuts({ s, set }: P) {
  const clash = s.hotkeyDictation === s.hotkeyAssistant;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <CardTitle>Push-to-talk keys</CardTitle>
        <p className="-mt-1 mb-4 text-[12px] text-muted">Hold the key, speak, release. Pressing any other key while holding cancels, so your normal shortcuts keep working.</p>
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13.5px] font-medium">Dictation key</span>
              <span className="text-[12px] text-muted">types what you say into any app</span>
            </div>
            <KeyPicker value={s.hotkeyDictation} other={s.hotkeyAssistant} onChange={(v) => set({ hotkeyDictation: v })} />
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13.5px] font-medium">Assistant key</span>
              <span className="text-[12px] text-muted">ask Flo or tell it to do something</span>
            </div>
            <KeyPicker value={s.hotkeyAssistant} other={s.hotkeyDictation} onChange={(v) => set({ hotkeyAssistant: v })} />
          </div>
          {clash && <p className="text-[12px] text-amber-300">Dictation and Assistant can't use the same key. Pick a different one.</p>}
          {(s.hotkeyDictation === "fn" || s.hotkeyAssistant === "fn") && (
            <p className="text-[12px] text-faint">Using fn? Settings → Permissions → “Free the fn key” stops it from opening the emoji picker.</p>
          )}
        </div>
      </Card>
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <Toggle label="Detect meetings" hint="When Zoom, Meet, Teams, Slack or FaceTime starts using the mic, Flo offers to take notes." checked={s.meetingDetection} onChange={(v) => set({ meetingDetection: v })} />
        <Toggle label="Learn from my corrections" hint="If you fix a word Flo typed, it offers to remember the right spelling." checked={s.learnCorrections} onChange={(v) => set({ learnCorrections: v })} />
      </Card>
    </div>
  );
}

function AccountTab() {
  const { status } = useAccount();
  const [busy, setBusy] = useState(false);
  const u = status?.user;
  return (
    <Card className="p-5" >
      <div className="flex items-center gap-4" data-testid="account-card">
        <span className="accent-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold text-white shadow-[0_0_24px_-6px_rgba(61,187,255,0.7)]">
          {u?.image ? <img src={u.image} alt="" className="h-full w-full rounded-full object-cover" /> : initials(u)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{u?.name || "Signed out"}</div>
          <div className="truncate text-[12.5px] text-muted">{u?.email}</div>
          {status?.offline && <div className="mt-0.5 text-[11.5px] text-amber-500 dark:text-amber-300">Offline: using your saved sign-in</div>}
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await accountApi.logout().catch(() => {});
            await refreshAccount();
            setBusy(false);
          }}
        >
          Sign out
        </Button>
      </div>
      <p className="mt-4 text-[12px] text-faint">Your account only signs you in. Dictations, notes, to-dos and keys stay on this computer.</p>
    </Card>
  );
}

const NOTCH_STYLES: { id: NotchStyle; label: string }[] = [
  { id: "ribbon", label: "Ribbon" },
  { id: "wave", label: "Wave" },
  { id: "bars", label: "Bars" },
  { id: "pulse", label: "Pulse" },
  { id: "orb", label: "Orb" },
  { id: "aurora", label: "Aurora" },
  { id: "spectrum", label: "Spectrum" },
  { id: "comet", label: "Comet" },
  { id: "ripple", label: "Ripple" },
  { id: "liquid", label: "Liquid" },
  { id: "constellation", label: "Constellation" },
];

function NotchPreview({ style, accent, w = 176, h = 44 }: { style: NotchStyle; accent: string; w?: number; h?: number }) {
  // `sim` drives a synthetic speaking envelope so each style visibly animates without a mic
  return (
    <div className="relative overflow-hidden rounded-xl bg-black" style={{ width: "100%", height: h }}>
      <NotchViz style={style} accent={accent} width={w} height={h} notchWidth={0} wing={Math.round(w / 2)} mode="listen" leftWing sim />
    </div>
  );
}

function Appearance({ s, set }: P) {
  const accent = normalizeHex(s.accent || "#3dbbff");
  const auto = !(Array.isArray(s.notchGradient) && s.notchGradient.length === 2);
  const [gf, gt] = deriveGradient({ accent, notchGradient: s.notchGradient });
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <CardTitle icon={<Palette size={15} />}>Accent</CardTitle>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {ACCENT_PRESETS.map((pre) => (
            <button
              key={pre.name}
              title={pre.name}
              aria-label={pre.name}
              onClick={() => set({ accent: pre.accent })}
              className={clsx("h-8 w-8 rounded-full ring-offset-2 ring-offset-[var(--bg)] transition", accent === normalizeHex(pre.accent) ? "ring-2 ring-[var(--fg)]" : "ring-0 hover:scale-110")}
              style={{ background: `linear-gradient(135deg, ${pre.gradient[0]}, ${pre.gradient[1]})` }}
            />
          ))}
          <label className="ml-1 flex h-8 cursor-pointer items-center gap-2 rounded-full glass px-3 text-[12px] text-muted" title="Custom colour">
            <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: accent }} />
            Custom
            <input type="color" value={accent} onChange={(e) => set({ accent: e.target.value })} className="h-0 w-0 opacity-0" />
          </label>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <CardTitle>Notch animation</CardTitle>
          <Button size="sm" variant="glass" icon={<Sparkles size={13} />} onClick={() => broadcastNotchPreview(s.notchStyle)}>
            Preview in notch
          </Button>
        </div>
        {/* big live preview of the selected style, animating a simulated voice */}
        <div className="relative mt-3 flex h-[72px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-black">
          <NotchViz key={s.notchStyle + accent} style={s.notchStyle} accent={accent} width={560} height={72} notchWidth={0} wing={280} mode="listen" leftWing sim />
          <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[10.5px] font-medium text-white/50">Live preview</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {NOTCH_STYLES.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                set({ notchStyle: n.id });
                broadcastNotchPreview(n.id);
              }}
              className={clsx(
                "group rounded-2xl border p-2 text-left transition",
                s.notchStyle === n.id ? "border-[var(--accent)] glass-strong" : "border-[var(--border)] glass hover:glass-strong",
              )}
            >
              <NotchPreview style={n.id} accent={accent} />
              <div className="mt-2 flex items-center justify-between px-0.5">
                <span className="text-[12.5px] font-medium">{n.label}</span>
                {s.notchStyle === n.id && <Check size={14} className="text-[var(--accent)]" />}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-faint">Tap a style to preview and apply it. The notch uses your accent and shows it live.</p>
      </Card>

      <Card className="p-4">
        <CardTitle>Notch gradient</CardTitle>
        <Toggle
          label="Auto from accent"
          hint="Derive the two-colour gradient from your accent."
          checked={auto}
          onChange={(v) => set({ notchGradient: v ? [] : [gf, gt] })}
        />
        {!auto && (
          <div className="mt-2 flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <span className="h-6 w-6 rounded-md border border-white/15" style={{ background: gf }} />
              From
              <input type="color" value={gf} onChange={(e) => set({ notchGradient: [e.target.value, gt] })} className="h-0 w-0 opacity-0" />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <span className="h-6 w-6 rounded-md border border-white/15" style={{ background: gt }} />
              To
              <input type="color" value={gt} onChange={(e) => set({ notchGradient: [gf, e.target.value] })} className="h-0 w-0 opacity-0" />
            </label>
            <div className="h-6 flex-1 rounded-md" style={{ background: `linear-gradient(90deg, ${gf}, ${gt})` }} />
          </div>
        )}
      </Card>

      <WidgetsCard />
    </div>
  );
}

/** Pick and order the widgets that appear in the notch panel. Persisted + broadcast to the island. */
function WidgetsCard() {
  const [ids, setIds] = useState<WidgetId[]>(() => loadWidgets());
  const apply = (next: WidgetId[]) => {
    setIds(next);
    saveWidgets(next);
  };
  const enabled = new Set(ids);
  const toggle = (id: WidgetId) => apply(enabled.has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    apply(next);
  };
  const off = WIDGETS.filter((w) => !enabled.has(w.id));
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <CardTitle icon={<LayoutGrid size={15} />}>Notch widgets</CardTitle>
        <Button size="sm" variant="glass" icon={<RotateCcw size={13} />} onClick={() => apply([...DEFAULT_WIDGETS])}>
          Reset
        </Button>
      </div>
      <p className="mt-1 text-[12px] text-faint">Choose what shows in the panel below the notch, and drag the order with the arrows. Changes apply instantly.</p>

      <div className="mt-3 space-y-2.5">
        {ids.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-[12.5px] text-muted">No widgets shown. Add some below.</div>}
        {ids.map((id, i) => {
          const w = WIDGETS.find((x) => x.id === id);
          if (!w) return null;
          return (
            <div key={id} className="rounded-xl glass p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <GripVertical size={14} className="text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{w.label}</div>
                  <div className="truncate text-[11.5px] text-faint">{w.hint}</div>
                </div>
                <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-md p-1 text-muted hover:bg-white/10 hover:text-[var(--fg)] disabled:opacity-30">
                  <ChevronUp size={15} />
                </button>
                <button aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)} className="rounded-md p-1 text-muted hover:bg-white/10 hover:text-[var(--fg)] disabled:opacity-30">
                  <ChevronDown size={15} />
                </button>
                <button onClick={() => toggle(id)} className="ml-1 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--accent)] hover:bg-white/10">
                  Remove
                </button>
              </div>
              <WidgetPreview id={id} />
            </div>
          );
        })}
      </div>

      {off.length > 0 && (
        <>
          <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Available — tap to add</div>
          <div className="grid grid-cols-2 gap-2.5">
            {off.map((w) => (
              <button key={w.id} onClick={() => toggle(w.id)} className="group rounded-xl glass p-2.5 text-left transition hover:glass-strong">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-medium">{w.label}</span>
                  <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">+ Add</span>
                </div>
                <div className="pointer-events-none">
                  <WidgetPreview id={w.id} />
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function General({ s, set }: P) {
  return (
    <Card className="divide-y divide-[var(--border)] px-5 py-2">
      <Row label="Your name" hint="Used in greetings and to spot messages addressed to you.">
        <Input className="w-56" value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
      </Row>
      <Toggle label="Sounds" hint="Soft chimes when recording starts and stops." checked={s.playSounds} onChange={(v) => set({ playSounds: v })} />
      <Row label="Test sound" hint="Hear the ready, done and error cues.">
        <Button
          size="sm"
          variant="glass"
          icon={<Volume2 size={13} />}
          onClick={() => {
            playCue("ready", true);
            setTimeout(() => playCue("done", true), 650);
            setTimeout(() => playCue("error", true), 1350);
          }}
        >
          Play
        </Button>
      </Row>
      <Row label="Setup" hint="Walk through permissions, voice, AI and shortcuts again.">
        <Button size="sm" icon={<Sparkles size={13} />} onClick={() => set({ onboarded: false })}>
          Run setup again
        </Button>
      </Row>
      <Row label="Your typing speed" hint="Used to calculate time saved.">
        <div className="flex items-center gap-2">
          <Input type="number" className="w-20" value={s.typingWpm} onChange={(e) => set({ typingWpm: Number(e.target.value) || 40 })} />
          <span className="text-[12px] text-muted">wpm</span>
          <Button size="sm" icon={<Keyboard size={13} />} onClick={() => useStore.getState().go("typing")}>
            Measure
          </Button>
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
      <Card className="p-4">
        <CardTitle icon={<Mic size={15} />}>How Flo hears you</CardTitle>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--glass)] p-3">
            <div className="mb-1 text-[12.5px] font-semibold">On-device (Whisper)</div>
            <p className="text-[12px] leading-relaxed text-muted">Private and free, works offline. Your audio never leaves this Mac. Needs a one-time model download and can be a touch slower on older machines.</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--glass)] p-3">
            <div className="mb-1 text-[12.5px] font-semibold">Cloud (OpenAI / Groq)</div>
            <p className="text-[12px] leading-relaxed text-muted">Fast and very accurate, nothing to download. Your audio is sent to that provider under your own key.</p>
          </div>
        </div>
      </Card>
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
      </Card>

      <Card className="p-4">
        <CardTitle icon={<Mic size={15} />}>Language you speak</CardTitle>
        <FieldHelp>For best accuracy in Hindi or Gujarati, pick the language instead of Auto. Auto can drift to English on mixed or accented speech.</FieldHelp>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { value: "auto", label: "Auto-detect", native: "" },
            { value: "en", label: "English", native: "" },
            { value: "hi", label: "Hindi", native: "हिंदी" },
            { value: "gu", label: "Gujarati", native: "ગુજરાતી" },
            { value: "hi-en", label: "Hinglish", native: "" },
            { value: "es", label: "Spanish", native: "Español" },
            { value: "de", label: "German", native: "Deutsch" },
            { value: "fr", label: "French", native: "Français" },
          ].map((l) => {
            const active = s.language === l.value;
            return (
              <button
                key={l.value}
                onClick={() => set({ language: l.value })}
                aria-pressed={active}
                className={clsx(
                  "flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition",
                  active ? "border-[var(--accent)] glass-strong text-[var(--fg)]" : "border-[var(--border)] glass text-muted hover:text-[var(--fg)]",
                )}
              >
                {l.label}
                {l.native && <span className={clsx("text-[12px]", active ? "text-[var(--accent)]" : "text-faint")}>{l.native}</span>}
              </button>
            );
          })}
        </div>
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

function AI({ s, set }: P) {
  const toast = useStore((x) => x.toast);
  const [testing, setTesting] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <CardTitle icon={<Sparkles size={15} />}>Which model should Flo use?</CardTitle>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--glass)] p-3">
            <div className="mb-1 text-[12.5px] font-semibold">On-device (Ollama / LM Studio)</div>
            <p className="text-[12px] leading-relaxed text-muted">Everything stays on your Mac. Free and private, works offline. Needs a one-time setup and a reasonably capable machine, and can be a little slower.</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--glass)] p-3">
            <div className="mb-1 text-[12.5px] font-semibold">Bring your own cloud key</div>
            <p className="text-[12px] leading-relaxed text-muted">OpenAI, Anthropic, Gemini, Groq, MiniMax, Qwen or OpenRouter for the smartest, fastest replies. Your text goes directly to that provider under your key, never through Flo servers.</p>
          </div>
        </div>
        <FieldHelp>
          Good picks: Anthropic Claude and OpenAI for the best quality; Groq for very fast replies; Gemini Flash for low cost; Ollama to stay fully local.
        </FieldHelp>
      </Card>
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <AiProviderFields
          s={s}
          set={set}
          row={(label, hint, node) => (
            <Row key={label} label={label} hint={hint}>
              {node}
            </Row>
          )}
        />
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
        <CardTitle icon={<KeyRound size={15} />}>
          API keys
          <InfoDot text="Keys are stored in your OS keychain and never leave your Mac, except the request you make directly to that provider. Flo has no server in between." />
        </CardTitle>
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
          goes through one gate, see it below.
        </div>
      </Card>
      <Card className="divide-y divide-[var(--border)] px-5 py-2">
        <Toggle label="Assistant may use your cloud AI (BYOK)" hint="On: your question, any selected text and screen text are sent to the cloud provider you chose (with your key). Off: the assistant uses a local model only and nothing leaves this Mac." checked={s.assistantCloudAllowed} onChange={(v) => set({ assistantCloudAllowed: v })} />
        <Toggle label="Assistant can see the active window" hint="On: when you ask, a screenshot of the front window is read for context (sent to the cloud only if the toggle above is on). Off: the assistant never looks at your screen." checked={s.assistantScreenContext} onChange={(v) => set({ assistantScreenContext: v })} />
        <Toggle label="Attention" hint="On: Flo quietly reads what is on screen to spot things you should do, and turns them into to-dos. Off: it never watches your screen." checked={s.attentionEnabled} onChange={(v) => set({ attentionEnabled: v })} />
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
                    <td className="px-3 py-2 text-right tabular-nums text-faint">
                      {l.tokensIn != null || l.tokensOut != null ? (
                        <span title={`${l.tokensIn ?? 0} tokens in · ${l.tokensOut ?? 0} tokens out`}>
                          <span className="text-brand-300">{formatNumber(l.tokensIn ?? 0)}</span> → {formatNumber(l.tokensOut ?? 0)} tok
                        </span>
                      ) : l.bytes ? (
                        `${formatNumber(l.bytes / 1024)} KB`
                      ) : (
                        "·"
                      )}
                    </td>
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
  const p = usePermissions(2000);
  const needsRestart = !!p && p.accessibility && p.inputMonitoring && !p.hotkeyActive;
  return (
    <div className="flex flex-col gap-4">
      {needsRestart && (
        <Card className="flex items-center gap-4 border-brand-400/30 p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-400/15 text-brand-300">
            <RotateCcw size={15} />
          </span>
          <div className="flex-1">
            <div className="text-[13.5px] font-medium">Restart Flo to activate the fn key</div>
            <div className="text-[12px] text-muted">macOS applies Accessibility and Input Monitoring after a relaunch.</div>
          </div>
          <Button size="sm" variant="primary" onClick={() => api.restartApp()}>
            Restart Flo
          </Button>
        </Card>
      )}
      <Card className="flex flex-col gap-2 p-4">
        {!p && <Skeleton className="h-44" />}
        {p &&
          PERMISSION_ITEMS.map((it) => (
            <div key={it.key} className="flex items-center gap-4 rounded-xl bg-[var(--glass)] p-3">
              <span className={clsx("flex h-8 w-8 items-center justify-center rounded-full", p[it.key] ? "bg-brand-400/15 text-brand-300" : "bg-amber-500/15 text-amber-400")}>
                {p[it.key] ? <Check size={15} /> : <Lock size={14} />}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  {it.label}
                  {!it.required && <span className="rounded-full bg-[var(--glass-strong)] px-1.5 py-px text-[10.5px] font-normal text-faint">optional</span>}
                </div>
                <div className="text-[12px] text-muted">{it.why}</div>
              </div>
              {p[it.key] ? (
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-brand-300">
                  Granted <Check size={13} strokeWidth={3} />
                </span>
              ) : (
                <Button size="sm" variant="primary" onClick={() => api.openPermissionSettings(it.kind)}>
                  Grant
                </Button>
              )}
            </div>
          ))}
        <div className="mt-1 flex items-center gap-3 rounded-xl border border-brand-300/15 bg-brand-300/[0.05] p-3">
          <div className="flex-1 text-[12px] leading-relaxed text-muted">
            <span className="font-medium text-[var(--fg)]">Turned it on but still see “Grant”?</span> System Settings may be showing a switch from an
            older Flo build. Repair clears Flo’s old privacy entries (only Flo’s) and restarts. Then press Grant once for each.
          </div>
          <RepairButton />
        </div>
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
      <p className="-mt-1 mb-3 text-[12px] text-muted">Names, jargon and spellings Flo should always get right. Add a “heard as” to fix common mis-hearings, Flo also learns these when you correct it.</p>
      <form
        className="mb-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!word.trim()) return;
          // backend applies entries as word → replacement (heard → correct)
          if (rep.trim()) await api.addDictionary(rep.trim(), word.trim());
          else await api.addDictionary(word.trim());
          setWord("");
          setRep("");
          load();
        }}
      >
        <Input placeholder="Word (e.g. Flo)" value={word} onChange={(e) => setWord(e.target.value)} />
        <Input placeholder="Heard as (optional)" value={rep} onChange={(e) => setRep(e.target.value)} />
        <Button type="submit" variant="primary">
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {items?.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full glass-strong px-3 py-1 text-[12.5px]">
            {d.replacement ? (
              <>
                <span className="text-faint line-through">{d.word}</span>
                <span className="text-faint">→</span>
                <span className="font-medium text-brand-200">{d.replacement}</span>
                <span className="rounded-full bg-brand-300/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">learned</span>
              </>
            ) : (
              d.word
            )}
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

function RepairButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button size="sm" variant={armed ? "primary" : "glass"} onClick={() => (armed ? api.repairPermissions() : setArmed(true))}>
      {armed ? "Click again to reset & restart" : "Repair permissions"}
    </Button>
  );
}
