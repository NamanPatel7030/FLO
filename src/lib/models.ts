import type { LocalModel, Settings } from "./types";

/** MB taken by downloaded speech models other than the one in use (what "Free up space" removes). */
export function unusedModelMb(models: LocalModel[], inUse: string): number {
  return models.filter((m) => m.installed && m.id !== inUse).reduce((sum, m) => sum + m.sizeMb, 0);
}

/** What a fresh install uses (mirrors stt::DEFAULT_MODEL): Whisper Small, quantized, 190 MB. */
export const DEFAULT_MODEL = "small-q5_1";

/** The bigger, more precise downloads offered after setup, smallest first. */
export function advancedModels(models: LocalModel[]): LocalModel[] {
  return models.filter((m) => m.tier === "advanced").sort((a, b) => a.sizeMb - b.sizeMb);
}

/** The model setup gets ready (mirrors stt::setup_model): the chosen one when it's on disk,
 *  otherwise the small starter. */
export function setupTarget(models: LocalModel[], selected: string): string {
  return models.some((m) => m.id === selected && m.installed) ? selected : DEFAULT_MODEL;
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

/** "42 of 190 MB · 5.2 MB/s" (speed left out until there is one). */
export function progressText(received: number, total: number, bps: number): string {
  const base = `${mb(received)} of ${mb(total)} MB`;
  return bps > 0 ? `${base} · ${(bps / 1_000_000).toFixed(1)} MB/s` : base;
}

export interface Speed {
  at: number;
  bytes: number;
  bps: number;
}

/** Download speed from successive progress events, smoothed so the number doesn't jump around. */
export function nextSpeed(prev: Speed | null, at: number, bytes: number): Speed {
  if (!prev || bytes < prev.bytes) return { at, bytes, bps: 0 };
  const dt = (at - prev.at) / 1000;
  if (dt <= 0) return prev;
  const now = (bytes - prev.bytes) / dt;
  return { at, bytes, bps: prev.bps === 0 ? now : prev.bps * 0.6 + now * 0.4 };
}

/** Setup's first dictation only unlocks once the on-device model is downloaded and loaded. */
export function demoReady(s: { sttProvider: string; installed: boolean; loaded: boolean }): boolean {
  return s.sttProvider !== "local" || (s.installed && s.loaded);
}

/** The languages "Auto" chooses from unless the settings file says otherwise (mirrors
 *  stt::DEFAULT_AUTO_LANGUAGES). Gujarati is opt-in: "Auto + Gujarati". */
export const AUTO_LANGUAGES = ["en", "hi"];
export const AUTO_WITH_GUJARATI = ["en", "hi", "gu"];

export interface LanguageChoice {
  value: string;
  label: string;
  /** the language's own name / script, shown next to the label */
  native: string;
  /** shown in the second, smaller row */
  more?: boolean;
}

/** Settings → Voice → "Language you speak". English, Hindi, Gujarati and Hinglish first. */
export const LANGUAGE_CHOICES: LanguageChoice[] = [
  { value: "auto", label: "Auto (English + Hindi)", native: "" },
  { value: "en", label: "English", native: "" },
  { value: "hi", label: "Hindi", native: "हिंदी" },
  { value: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { value: "hi-en", label: "Hinglish", native: "Roman letters" },
  { value: "auto-gu", label: "Auto + Gujarati", native: "", more: true },
  { value: "es", label: "Spanish", native: "Español", more: true },
  { value: "de", label: "German", native: "Deutsch", more: true },
  { value: "fr", label: "French", native: "Français", more: true },
];

/** Settings patch for a language chip. Auto also sets what it picks from: English and Hindi, plus
 *  Gujarati for "Auto + Gujarati". */
export function pickLanguage(value: string): Partial<Settings> {
  if (value === "auto") return { language: "auto", autoLanguages: [...AUTO_LANGUAGES] };
  if (value === "auto-gu") return { language: "auto", autoLanguages: [...AUTO_WITH_GUJARATI] };
  return { language: value };
}

/** Is this chip the current setting? The two Auto chips differ by whether Auto includes Gujarati. */
export function languageActive(s: Pick<Settings, "language" | "autoLanguages">, value: string): boolean {
  const gu = (s.autoLanguages ?? AUTO_LANGUAGES).includes("gu");
  if (value === "auto") return s.language === "auto" && !gu;
  if (value === "auto-gu") return s.language === "auto" && gu;
  return s.language === value;
}

/** Gujarati on the on-device engine: Whisper has no usable Gujarati decoder, so Flo transcribes it
 * through Hindi and rewrites it in Gujarati script. Sarvam AI hears Gujarati natively. */
export function suggestSarvamForGujarati(s: Pick<Settings, "sttProvider" | "language" | "autoLanguages">): boolean {
  if (s.sttProvider !== "local") return false;
  if (s.language === "gu") return true;
  return s.language === "auto" && (s.autoLanguages ?? AUTO_LANGUAGES).includes("gu");
}

export function switchToSarvam(): Partial<Settings> {
  return { sttProvider: "sarvam", sttModel: "saaras:v3" };
}
