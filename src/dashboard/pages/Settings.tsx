import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Bell, Check, Download, KeyRound, Lock, Mic, Play, RotateCcw, ShieldCheck, Sparkles, Trash2, X, Keyboard, Palette, Volume2, LayoutGrid, GripVertical, ChevronUp, ChevronDown, Maximize2, Globe2, Plus, Search, SunMoon } from "lucide-react";
import { api, on } from "../../lib/api";
import { PERMISSION_ITEMS, usePermissions } from "../usePermissions";
import { formatHotkey, formatNumber, hotkeyWords, HOTKEY_OPTIONS, relativeTime } from "../../lib/format";
import { EV, ACCENT_PRESETS, type DictionaryEntry, type KeyProvider, type LocalModel, type ModelProgressEvent, type NetworkLogEntry, type Settings as S, type SttProvider, type HotkeyCombo, type NotchStyle, type NotchSize, type ThemeMode } from "../../lib/types";
import { NotchViz } from "../../island/Ribbon";
import { broadcastNotchPreview, deriveGradient, normalizeHex } from "../../lib/theme";
import { useStore } from "../store";
import { Button, Card, CardTitle, FieldHelp, InfoDot, Input, PageHeader, Select, Skeleton, Toggle } from "../ui";
import { About } from "../About";
import { Integrations } from "../Integrations";
import { AiProviderFields, PROVIDERS } from "../AiSetup";
import { accountApi, initials, refreshAccount, useAccount } from "../../lib/account";
import { playCue, SOUND_PACKS, type SoundPack } from "../../lib/cueSounds";
import { DEFAULT_WIDGETS, WIDGETS, loadWidgets, saveWidgets, type WidgetId } from "../../lib/widgets";
import { WidgetPreview } from "../../island/Widgets";
import { UpdateSettingsRow } from "../UpdateCard";
import { AvatarEditor } from "../AvatarEditor";
import { PresenceSettings } from "../Presence";
import { AutoContinueSettings } from "../AutoContinue";
import { formatZoneTime, hourDiffLabel, loadZones, MAX_ZONES, onZonesChange, saveZones, searchCities, type ClockZone, type ZoneCity } from "../../lib/timezones";

const TABS = ["General", "Appearance", "Shortcuts", "Voice", "AI", "Privacy", "Permissions", "Dictionary", "Integrations", "About"] as const;
type Tab = (typeof TABS)[number];
/** Tabs that were merged away: old links (#/settings/account, #/settings/notch) still land in the right place. */
const TAB_ALIASES: Record<string, Tab> = { account: "General", notch: "Appearance" };

function resolveSettingsTab(arg: string | undefined): Tab {
  const a = (arg ?? "").toLowerCase();
  return TAB_ALIASES[a] ?? (TABS.find((t) => t.toLowerCase() === a) as Tab | undefined) ?? "General";
}

export default function Settings() {
  const { settings, setSettings, pageArg, go } = useStore();
  const tab = resolveSettingsTab(pageArg);
  const set = (patch: Partial<S>) => settings && setSettings({ ...settings, ...patch });
  // rewrite a merged-away tab's URL to its new home so the address matches what's shown
  useEffect(() => {
    if (pageArg && TAB_ALIASES[pageArg.toLowerCase()]) go("settings", tab.toLowerCase());
  }, [pageArg]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className={tab === "About" ? "max-w-[940px]" : "max-w-3xl"}>
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

/** A titled group on the longer merged tabs (General, Appearance) so they stay scannable. */
function Section({ title, hint, children, first }: { title: string; hint?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <section className={clsx(!first && "pt-3")} aria-label={title}>
      <div className="mb-3 flex items-end gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-faint">{hint}</p>}
        </div>
        <span className="mb-1.5 h-px flex-1 bg-gradient-to-r from-[var(--border-strong)] to-transparent" />
      </div>
      <div className="space-y-4">{children}</div>
    </section>
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
        <span className="accent-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold text-white shadow-[0_0_24px_-6px_rgb(var(--accent-rgb)/0.7)]">
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
  { id: "neon", label: "Neon" },
  { id: "helix", label: "Helix" },
  { id: "bars", label: "Bars" },
  { id: "equalizer", label: "Equalizer" },
  { id: "spectrum", label: "Spectrum" },
  { id: "pulse", label: "Pulse" },
  { id: "orb", label: "Orb" },
  { id: "ripple", label: "Ripple" },
  { id: "aurora", label: "Aurora" },
  { id: "liquid", label: "Liquid" },
  { id: "comet", label: "Comet" },
  { id: "sparkle", label: "Sparkle" },
  { id: "constellation", label: "Constellation" },
];

/** A style animating across the full width of its box (measured), driven by a simulated voice. */
function StylePreview({ style, accent, height }: { style: NotchStyle; accent: string; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-xl bg-black" style={{ height }}>
      {w > 0 && <NotchViz key={style + accent + w} style={style} accent={accent} width={w} height={height} notchWidth={0} wing={Math.round(w / 2)} mode="listen" leftWing sim single />}
    </div>
  );
}

/**
 * A colour swatch that opens the system colour picker. The input covers the whole control: WebKit
 * (the app's web view) won't open a picker for a 0×0 input, which is why "Custom" did nothing.
 */
function ColorField({ value, onChange, label, round = true }: { value: string; onChange: (hex: string) => void; label: string; round?: boolean }) {
  return (
    <label className="relative inline-flex h-8 cursor-pointer items-center gap-2 overflow-hidden rounded-full glass px-3 text-[12px] text-muted transition hover:glass-strong hover:text-[var(--fg)]" title={label}>
      <span className={clsx("h-4 w-4 border border-white/25", round ? "rounded-full" : "rounded-[5px]")} style={{ background: value }} />
      {label}
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </label>
  );
}

/** Type a hex colour directly (works even where a native picker can't open). */
function HexField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim().replace(/^#?/, "#");
    if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
    else setDraft(value);
  };
  return (
    <input
      aria-label="Hex colour"
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-8 w-[92px] rounded-full glass px-3 font-mono text-[12px] uppercase text-[var(--fg)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
    />
  );
}

function Appearance({ s, set }: P) {
  return (
    <div className="space-y-6">
      <Section first title="Theme" hint="How Flo's window looks. The notch stays black: it's part of your Mac.">
        <ThemeCard s={s} set={set} />
      </Section>
      <Section title="Your avatar" hint="Flo's little face lives in your notch and reacts as you work. Make it yours.">
        <Card className="p-4">
          <AvatarEditor value={s.avatar} accent={s.accent} onChange={(avatar) => set({ avatar })} />
        </Card>
      </Section>
      <Section title="Colour" hint="One accent recolours everything: buttons, logo, charts and the notch.">
        <AccentCard s={s} set={set} />
        <NotchColoursCard s={s} set={set} />
      </Section>
      <Notch s={s} set={set} />
    </div>
  );
}

const THEMES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Frosted glass" },
  { id: "dark", label: "Dark", hint: "Deep ocean" },
  { id: "system", label: "System", hint: "Follows macOS" },
];

/** A tiny window drawn in the given look, so each option previews itself. */
function ThemeSwatch({ look }: { look: "light" | "dark" }) {
  const light = look === "light";
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: light
          ? "radial-gradient(70% 90% at 0% 0%, #bfe3ff, transparent 70%), radial-gradient(70% 90% at 100% 0%, #e2d8ff, transparent 70%), radial-gradient(70% 90% at 50% 120%, #ffdccb, transparent 70%), #f6f7fc"
          : "radial-gradient(70% 90% at 0% 0%, rgba(61,187,255,0.28), transparent 70%), linear-gradient(180deg, #08111c, #02050a)",
      }}
    >
      <div className="absolute inset-y-2 left-2 w-[26%] rounded-lg" style={{ background: light ? "rgba(255,255,255,0.7)" : "rgba(147,221,255,0.08)", border: `1px solid ${light ? "#fff" : "rgba(147,221,255,0.14)"}` }} />
      <div className="absolute left-[34%] right-2 top-2 h-[34%] rounded-lg" style={{ background: light ? "rgba(255,255,255,0.75)" : "rgba(147,221,255,0.08)", border: `1px solid ${light ? "#fff" : "rgba(147,221,255,0.14)"}` }} />
      <div className="absolute bottom-2 left-[34%] h-[30%] w-[30%] rounded-lg" style={{ background: light ? "rgba(255,255,255,0.75)" : "rgba(147,221,255,0.08)" }} />
      <div className="absolute bottom-[14%] right-3 h-2 w-9 rounded-full" style={{ background: light ? "#0b1220" : "var(--accent)" }} />
    </div>
  );
}

function ThemeCard({ s, set }: P) {
  const mode: ThemeMode = s.theme === "dark" || s.theme === "system" ? s.theme : "light";
  return (
    <Card className="p-4">
      <CardTitle icon={<SunMoon size={15} />}>Appearance</CardTitle>
      <div className="mt-3 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={mode === t.id}
            aria-label={t.label}
            onClick={() => set({ theme: t.id })}
            data-testid={`theme-${t.id}`}
            className={clsx("group rounded-2xl border p-2.5 text-left transition", mode === t.id ? "border-[var(--accent)] glass-strong" : "border-[var(--border)] glass hover:glass-strong")}
          >
            <div className="h-[78px] overflow-hidden rounded-xl ring-1 ring-black/5">
              {t.id === "system" ? (
                <div className="flex h-full">
                  <div className="h-full w-1/2 overflow-hidden"><div className="h-full w-[200%]"><ThemeSwatch look="light" /></div></div>
                  <div className="h-full w-1/2 overflow-hidden"><div className="h-full w-[200%] -translate-x-1/2"><ThemeSwatch look="dark" /></div></div>
                </div>
              ) : (
                <ThemeSwatch look={t.id} />
              )}
            </div>
            <div className="mt-2.5 flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold">{t.label}</span>
              {mode === t.id ? <Check size={14} className="text-[var(--accent)]" /> : <span className="text-[11.5px] text-faint">{t.hint}</span>}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function AccentCard({ s, set }: P) {
  const accent = normalizeHex(s.accent || "#3dbbff");
  const isPreset = ACCENT_PRESETS.some((pre) => normalizeHex(pre.accent) === accent);
  return (
    <div>
      <Card className="p-4">
        <CardTitle icon={<Palette size={15} />}>Accent</CardTitle>
        <p className="-mt-1 text-[12px] text-faint">Used across Flo and in the notch. Changes apply instantly, everywhere.</p>
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
          <span className="mx-1 h-6 w-px bg-[var(--border)]" />
          <span className={clsx("rounded-full", !isPreset && "ring-2 ring-[var(--fg)] ring-offset-2 ring-offset-[var(--bg)]")}>
            <ColorField label="Custom" value={accent} onChange={(v) => set({ accent: v })} />
          </span>
          <HexField value={accent} onChange={(v) => set({ accent: v })} />
        </div>
      </Card>
    </div>
  );
}

const SIZES: { id: NotchSize; label: string; hint: string; panel: number }[] = [
  { id: "small", label: "Small", hint: "Compact", panel: 0.88 },
  { id: "big", label: "Big", hint: "Default", panel: 1 },
  { id: "bigger", label: "Bigger", hint: "Easier to read", panel: 1.15 },
  { id: "biggest", label: "Biggest", hint: "Largest text", panel: 1.3 },
];

/** Everything about the notch in one place: size, animation, colours, sounds, notifications, widgets. */
function Notch({ s, set }: P) {
  const accent = normalizeHex(s.accent || "#3dbbff");
  const size = s.notchSize ?? "big";
  const pack = (s.soundPack ?? "chime") as SoundPack;
  const volume = s.soundVolume ?? 70;
  return (
    <>
      <Section title="Notch" hint="How the notch looks and moves when you hover it or talk to Flo.">
        <Card className="p-4">
          <CardTitle icon={<Maximize2 size={15} />}>Size</CardTitle>
          <p className="-mt-1 text-[12px] text-faint">How big things open when you hover the notch: your to-dos, Claude sessions and widgets.</p>
          <div className="mt-3 grid grid-cols-4 gap-3" role="radiogroup" aria-label="Notch size">
            {SIZES.map((z) => (
              <button
                key={z.id}
                role="radio"
                aria-checked={size === z.id}
                onClick={() => set({ notchSize: z.id })}
                className={clsx("rounded-2xl border p-3 text-left transition", size === z.id ? "border-[var(--accent)] glass-strong" : "border-[var(--border)] glass hover:glass-strong")}
              >
                {/* a tiny notch with the hover panel drawn to scale */}
                <div className="flex h-[64px] items-start justify-center overflow-hidden rounded-xl bg-black pt-0">
                  <div className="flex flex-col items-center">
                    <div className="h-[9px] w-[40px] rounded-b-[6px] bg-[#1b1b1f]" />
                    <div
                      className="mt-1 rounded-[7px] border border-white/10 bg-white/[0.06] p-1"
                      style={{ width: 64 * z.panel, height: 40 * z.panel, boxShadow: size === z.id ? `0 0 0 1px ${accent}55` : undefined }}
                    >
                      <div className="h-1 w-3/4 rounded-full" style={{ background: accent, opacity: 0.8 }} />
                      <div className="mt-1 h-1 w-1/2 rounded-full bg-white/25" />
                      <div className="mt-1 h-1 w-2/3 rounded-full bg-white/15" />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between px-0.5">
                  <span className="text-[12.5px] font-medium">{z.label}</span>
                  {size === z.id ? <Check size={14} className="text-[var(--accent)]" /> : <span className="text-[11px] text-faint">{z.hint}</span>}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <CardTitle icon={<Sparkles size={15} />}>Animation</CardTitle>
            <Button size="sm" variant="glass" icon={<Play size={12} />} onClick={() => broadcastNotchPreview(s.notchStyle)}>
              Preview in notch
            </Button>
          </div>
          <div className="relative mt-1">
            <StylePreview style={s.notchStyle} accent={accent} height={84} />
            <span className="pointer-events-none absolute left-3 top-2.5 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-white/70">
              {NOTCH_STYLES.find((n) => n.id === s.notchStyle)?.label ?? "Ribbon"} · live
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {NOTCH_STYLES.map((n) => (
              <button
                key={n.id}
                aria-label={n.label}
                aria-pressed={s.notchStyle === n.id}
                onClick={() => {
                  set({ notchStyle: n.id });
                  broadcastNotchPreview(n.id);
                }}
                className={clsx(
                  "rounded-2xl border p-1.5 text-left transition",
                  s.notchStyle === n.id ? "border-[var(--accent)] glass-strong shadow-[0_0_0_1px_var(--accent)]" : "border-[var(--border)] glass hover:glass-strong",
                )}
              >
                <StylePreview style={n.id} accent={accent} height={46} />
                <div className="mt-1.5 flex items-center justify-between px-1 pb-0.5">
                  <span className="text-[12.5px] font-medium">{n.label}</span>
                  {s.notchStyle === n.id && <Check size={13} className="text-[var(--accent)]" />}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[12px] text-faint">Every style reacts to your voice. Tap one to apply it and see it in the notch.</p>
        </Card>

      </Section>

      <Section title="Sounds & alerts" hint="What you hear, and how reminders and Claude Code reach you.">
        <Card className="p-4">
          <CardTitle icon={<Volume2 size={15} />}>Sounds</CardTitle>
          <Toggle label="All sounds" hint="Turn every Flo sound on or off. Pick each one below." checked={s.playSounds} onChange={(v) => set({ playSounds: v })} />
          <div className={clsx("mt-2 space-y-2.5 transition", !s.playSounds && "pointer-events-none opacity-40")}>
            <SoundRow
              label="Start listening"
              hint="When you press Fn or Control and Flo starts listening."
              on={s.startSoundOn ?? true}
              onToggle={(v) => set({ startSoundOn: v })}
              pack={(s.soundStart || pack) as SoundPack}
              onPack={(p) => set({ soundStart: p })}
              play={(p) => playCue("ready", true, p, volume / 100)}
            />
            <SoundRow
              label="Stop and done"
              hint="When you let go, Flo finishes, or something goes wrong."
              on={s.stopSoundOn ?? true}
              onToggle={(v) => set({ stopSoundOn: v })}
              pack={(s.soundStop || pack) as SoundPack}
              onPack={(p) => set({ soundStop: p })}
              play={(p) => {
                playCue("done", true, p, volume / 100);
                setTimeout(() => playCue("error", true, p, volume / 100), 700);
              }}
            />
            <SoundRow
              label="Notifications"
              hint="When a reminder or a Claude update appears in the notch."
              on={s.notifySound ?? true}
              onToggle={(v) => set({ notifySound: v })}
              pack={(s.soundNotify || pack) as SoundPack}
              onPack={(p) => set({ soundNotify: p })}
              play={(p) => playCue("notify", true, p, volume / 100)}
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Volume2 size={14} className="text-faint" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="Sound volume"
              onChange={(e) => set({ soundVolume: Number(e.target.value) })}
              onMouseUp={() => playCue("done", true, pack, volume / 100)}
              className="flo-range h-1 flex-1"
            />
            <span className="w-9 text-right text-[12px] tabular-nums text-muted">{volume}%</span>
          </div>
        </Card>

        <Card className="p-4">
          <CardTitle icon={<Bell size={15} />}>Notifications</CardTitle>
          <Toggle
            label="macOS notification banners"
            hint="Reminders also appear in Notification Centre. Off: only the notch shows them (with Done and Snooze)."
            checked={s.systemNotifications ?? true}
            onChange={(v) => set({ systemNotifications: v })}
          />
          <Toggle
            label="Allow or deny Claude Code from the notch"
            hint="When Claude Code asks for permission, answer in the notch instead of the terminal. Unanswered after 2 minutes, it asks in the terminal as usual."
            checked={s.claudeApprovals ?? true}
            onChange={(v) => set({ claudeApprovals: v })}
          />
          <AutoContinueSettings s={s} set={set} />
        </Card>
      </Section>

      <Section title="Widgets" hint="The panel that opens below the notch.">
        <WidgetsCard />
      </Section>
    </>
  );
}

function NotchColoursCard({ s, set }: P) {
  const accent = normalizeHex(s.accent || "#3dbbff");
  const auto = !(Array.isArray(s.notchGradient) && s.notchGradient.length === 2);
  const [gf, gt] = deriveGradient({ accent, notchGradient: s.notchGradient });
  return (
    <Card className="p-4">
      <CardTitle icon={<Palette size={15} />}>Notch colours</CardTitle>
      <Toggle label="Match my accent" hint="Use a gradient made from your accent colour." checked={auto} onChange={(v) => set({ notchGradient: v ? [] : [gf, gt] })} />
      {!auto && (
        <div className="mt-2 flex items-center gap-3">
          <ColorField label="From" round={false} value={gf} onChange={(v) => set({ notchGradient: [v, gt] })} />
          <ColorField label="To" round={false} value={gt} onChange={(v) => set({ notchGradient: [gf, v] })} />
          <div className="h-8 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${gf}, ${gt})` }} />
        </div>
      )}
    </Card>
  );
}

/** World clock: add/remove extra time zones shown in the notch Clock widget (searchable city list). */
function ClockZonesEditor({ zones, onChange }: { zones: ClockZone[]; onChange: (z: ClockZone[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchCities(q, zones).slice(0, 8);
  const full = zones.length >= MAX_ZONES;
  const now = new Date();
  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const add = (c: ZoneCity) => {
    onChange([...zones, { city: c.city, tz: c.tz }]);
    setQ("");
    if (zones.length + 1 >= MAX_ZONES) setOpen(false);
  };
  return (
    <div className="mt-2.5 rounded-xl border border-[var(--border)] bg-black/20 p-2.5" data-testid="clock-zones-editor">
      <div className="flex items-center gap-2">
        <Globe2 size={14} className="text-[var(--accent)]" />
        <span className="flex-1 text-[12.5px] font-medium">Time zones</span>
        <span className="text-[11px] text-faint">
          {zones.length}/{MAX_ZONES}
        </span>
        {!open && (
          <Button size="sm" variant="glass" icon={<Plus size={13} />} disabled={full} onClick={() => setOpen(true)}>
            Add time zone
          </Button>
        )}
      </div>
      {zones.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {zones.map((z) => (
            <span key={z.city + z.tz} className="inline-flex h-7 items-center gap-1.5 rounded-full glass pl-2.5 pr-1 text-[12px]">
              <span className="font-medium">{z.city}</span>
              <span className="tabular-nums text-faint">{formatZoneTime(now, z.tz)}</span>
              <button
                aria-label={`Remove ${z.city}`}
                onClick={() => onChange(zones.filter((x) => x !== z))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-[var(--fg)]"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {zones.length === 0 && !open && <p className="mt-1.5 text-[11.5px] text-faint">Show other cities next to your local time, like London, New York or Singapore.</p>}
      {open && (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                ref={inputRef}
                value={q}
                aria-label="Search cities"
                placeholder="Search a city or country…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHi((h) => Math.min(results.length - 1, h + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHi((h) => Math.max(0, h - 1));
                  } else if (e.key === "Enter" && results[hi]) add(results[hi]);
                  else if (e.key === "Escape") setOpen(false);
                }}
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--glass)] pl-8 pr-2 text-[12.5px] outline-none"
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
          <div role="listbox" aria-label="Cities" className="mt-1.5 max-h-[232px] overflow-y-auto rounded-lg">
            {results.length === 0 && <div className="px-2.5 py-2 text-[12px] text-faint">No city found. Try a country name.</div>}
            {results.map((c, i) => (
              <button
                key={c.city + c.tz}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onClick={() => add(c)}
                className={clsx("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition", i === hi ? "bg-[var(--accent)]/15" : "hover:bg-white/5")}
              >
                <span className="font-medium">{c.city}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{c.country}</span>
                <span className="text-[11px] tabular-nums text-faint">{hourDiffLabel(now, c.tz)}</span>
                <span className="w-[64px] text-right tabular-nums text-muted">{formatZoneTime(now, c.tz)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
  // world-clock zones for the Clock widget (also re-sizes its preview and the notch panel)
  const [zones, setZones] = useState<ClockZone[]>(() => loadZones());
  useEffect(() => onZonesChange(setZones), []);
  const applyZones = (next: ClockZone[]) => {
    setZones(next);
    saveZones(next);
  };
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
              {id === "clock" && <ClockZonesEditor zones={zones} onChange={applyZones} />}
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
    <div className="space-y-6">
      <Section first title="Account" hint="Who's signed in on this Mac.">
        <AccountTab />
      </Section>
      <Section title="Presence & phone" hint="Active means you're at your Mac. Away sends short notifications to your phone.">
        <PresenceSettings s={s} set={set} />
      </Section>
      <Section title="Preferences">
        <Card className="divide-y divide-[var(--border)] px-5 py-2">
          <UpdateSettingsRow />
          <Row label="Your name" hint="Used in greetings and to spot messages addressed to you.">
            <Input className="w-56" value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
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
      </Section>
    </div>
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

/** One customizable sound: on/off, a style (Chime / Glass / Soft / Pop) and a play button. */
function SoundRow({
  label,
  hint,
  on,
  onToggle,
  pack,
  onPack,
  play,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  pack: SoundPack;
  onPack: (p: SoundPack) => void;
  play: (p: SoundPack) => void;
}) {
  return (
    <div className="rounded-2xl glass p-3" data-testid={`sound-${label}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{label}</div>
          <div className="text-[11.5px] text-faint">{hint}</div>
        </div>
        <button
          aria-label={`Play ${label}`}
          onClick={() => play(pack)}
          disabled={!on}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[var(--fg)] transition hover:bg-white/20 disabled:opacity-40"
        >
          <Play size={11} className="ml-[1px]" />
        </button>
        <button
          role="switch"
          aria-checked={on}
          aria-label={`${label} sound`}
          onClick={() => onToggle(!on)}
          className={clsx("relative h-6 w-10 shrink-0 rounded-full transition", on ? "bg-[var(--accent)]" : "bg-white/15")}
        >
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
      <div className={clsx("mt-2.5 grid grid-cols-4 gap-1.5", !on && "pointer-events-none opacity-40")} role="radiogroup" aria-label={`${label} style`}>
        {SOUND_PACKS.map((sp) => (
          <button
            key={sp.id}
            role="radio"
            aria-checked={pack === sp.id}
            title={sp.hint}
            onClick={() => {
              onPack(sp.id);
              play(sp.id);
            }}
            className={clsx(
              "flex h-8 items-center justify-center gap-1 rounded-xl text-[12px] font-medium transition",
              pack === sp.id ? "bg-[var(--accent)]/20 text-[var(--fg)] shadow-[0_0_0_1px_var(--accent)]" : "bg-white/[0.04] text-muted hover:bg-white/10 hover:text-[var(--fg)]",
            )}
          >
            {pack === sp.id && <Check size={12} className="text-[var(--accent)]" />}
            {sp.label}
          </button>
        ))}
      </div>
    </div>
  );
}
