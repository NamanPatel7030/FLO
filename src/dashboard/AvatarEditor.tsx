// "Your notch avatar": pick how Notchling looks. Used in Settings → Appearance and in onboarding.
import clsx from "clsx";
import { Notchling } from "../lib/NotchlingFace";
import { GLOWS, normalizeAvatar, type AvatarAccessory, type AvatarEyes, type AvatarGlow, type AvatarMouth, type AvatarSettings, type NotchlingMood } from "../lib/notchling";

const EYES: { id: AvatarEyes; label: string }[] = [
  { id: "pill", label: "Classic" },
  { id: "round", label: "Round" },
  { id: "happy", label: "Smiley" },
  { id: "anime", label: "Sparkly" },
  { id: "visor", label: "Visor" },
];
const MOUTHS: { id: AvatarMouth; label: string }[] = [
  { id: "wave", label: "Voice wave" },
  { id: "smile", label: "Smile" },
  { id: "cat", label: "Cat" },
];
const ACCESSORIES: { id: AvatarAccessory; label: string }[] = [
  { id: "none", label: "None" },
  { id: "headphones", label: "Headphones" },
  { id: "halo", label: "Halo" },
  { id: "sparkle", label: "Sparkle" },
];
const GLOW_IDS: AvatarGlow[] = ["lucid", "aurora", "mint", "sunset", "accent"];
const PREVIEW: { mood: NotchlingMood; label: string }[] = [
  { mood: "happy", label: "Ready" },
  { mood: "listen", label: "Listening" },
  { mood: "think", label: "Thinking" },
  { mood: "celebrate", label: "Goal hit" },
];

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={clsx(
            "whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition",
            value === o.id ? "border-transparent bg-[var(--fg)] text-[var(--bg-solid,#fff)]" : "border-[var(--border)] text-muted hover:text-[var(--fg)]",
          )}
          data-testid={`avatar-${label.toLowerCase().replace(/\s+/g, "-")}-${o.id}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AvatarEditor({ value, accent, onChange, compact = false }: { value?: Partial<AvatarSettings>; accent?: string; onChange: (a: AvatarSettings) => void; compact?: boolean }) {
  const a = normalizeAvatar(value);
  const set = (p: Partial<AvatarSettings>) => onChange({ ...a, ...p });
  const row = "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between";
  return (
    <div className={clsx("grid gap-5", !compact && "lg:grid-cols-[260px_minmax(0,1fr)]")} data-testid="avatar-editor">
      {/* live preview: the same character in a few moods */}
      <div className="flex flex-col justify-center rounded-2xl p-4" style={{ background: "linear-gradient(135deg, #a9dcff, #c7b6ff 50%, #ffc2d6)" }}>
        <div className="flex justify-center">
          <Notchling mood="happy" avatar={a} accent={accent} size={compact ? 96 : 120} testId="avatar-preview" />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {PREVIEW.map((p) => (
            <div key={p.mood} className="flex flex-col items-center gap-1">
              <Notchling mood={p.mood} avatar={a} accent={accent} size={44} />
              <span className="text-[10.5px] font-semibold text-[#2a2f45]">{p.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {!compact && (
          <label className="flex cursor-pointer items-center justify-between gap-6">
            <div>
              <div className="text-[13.5px] font-medium">Show my avatar in the notch</div>
              <div className="mt-0.5 text-[12px] text-muted">It listens while you talk, thinks while Flo works and smiles when the text lands.</div>
            </div>
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="avatar-enabled" />
          </label>
        )}
        <div className={row}>
          <span className="text-[13px] font-medium">Eyes</span>
          <Chips label="Eyes" value={a.eyes} options={EYES} onChange={(v) => set({ eyes: v })} />
        </div>
        <div className={row}>
          <span className="text-[13px] font-medium">Glow</span>
          <div role="radiogroup" aria-label="Eye glow" className="flex flex-wrap gap-2">
            {GLOW_IDS.map((g) => {
              const st = g === "accent" ? ["#ffffff", accent ?? "#3dbbff", accent ?? "#3dbbff"] : GLOWS[g].stops;
              return (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={a.glow === g}
                  aria-label={GLOWS[g].label}
                  title={GLOWS[g].label}
                  onClick={() => set({ glow: g })}
                  className={clsx("h-8 w-8 rounded-full ring-offset-2 ring-offset-[var(--bg-solid,#fff)] transition", a.glow === g ? "scale-110 ring-2 ring-[var(--fg)]" : "ring-1 ring-black/10 hover:scale-105")}
                  style={{ background: `linear-gradient(160deg, ${st[0]}, ${st[1]} 55%, ${st[2]})` }}
                  data-testid={`avatar-glow-${g}`}
                />
              );
            })}
          </div>
        </div>
        <div className={row}>
          <span className="text-[13px] font-medium">Mouth</span>
          <Chips label="Mouth" value={a.mouth} options={MOUTHS} onChange={(v) => set({ mouth: v })} />
        </div>
        <div className={row}>
          <span className="text-[13px] font-medium">Extra</span>
          <Chips label="Extra" value={a.accessory} options={ACCESSORIES} onChange={(v) => set({ accessory: v })} />
        </div>
        <label className={clsx(row, "cursor-pointer")}>
          <span className="text-[13px] font-medium">Rosy cheeks</span>
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={a.blush} onChange={(e) => set({ blush: e.target.checked })} data-testid="avatar-blush" />
        </label>
      </div>
    </div>
  );
}
