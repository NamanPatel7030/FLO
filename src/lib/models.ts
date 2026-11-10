import type { LocalModel, Settings } from "./types";

/** MB taken by downloaded speech models other than the one in use (what "Free up space" removes). */
export function unusedModelMb(models: LocalModel[], inUse: string): number {
  return models.filter((m) => m.installed && m.id !== inUse).reduce((sum, m) => sum + m.sizeMb, 0);
}

/** The languages "Auto" chooses from unless the settings file says otherwise. */
export const AUTO_LANGUAGES = ["en", "hi", "gu"];

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
  { value: "auto", label: "Auto (English + Hindi + Gujarati)", native: "" },
  { value: "en", label: "English", native: "" },
  { value: "hi", label: "Hindi", native: "हिंदी" },
  { value: "gu", label: "Gujarati", native: "ગુજરાતી" },
  { value: "hi-en", label: "Hinglish", native: "Roman letters" },
  { value: "es", label: "Spanish", native: "Español", more: true },
  { value: "de", label: "German", native: "Deutsch", more: true },
  { value: "fr", label: "French", native: "Français", more: true },
];

/** Settings patch for a language chip. Auto also resets what it picks from (English, Hindi, Gujarati). */
export function pickLanguage(value: string): Partial<Settings> {
  return value === "auto" ? { language: "auto", autoLanguages: [...AUTO_LANGUAGES] } : { language: value };
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
