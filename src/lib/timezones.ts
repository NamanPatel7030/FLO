// World clock for the notch Clock widget: a curated city → IANA zone list, persisted extra zones,
// and the (pure, unit-tested) formatting/offset maths. Persisted to localStorage and broadcast the
// same way as the widget list (src/lib/widgets.ts), so Settings edits show in the island live.

export interface ZoneCity {
  city: string;
  country: string;
  tz: string;
}

/** ~60 common cities, roughly west → east. */
export const CITIES: ZoneCity[] = [
  { city: "Honolulu", country: "United States", tz: "Pacific/Honolulu" },
  { city: "Anchorage", country: "United States", tz: "America/Anchorage" },
  { city: "Los Angeles", country: "United States", tz: "America/Los_Angeles" },
  { city: "San Francisco", country: "United States", tz: "America/Los_Angeles" },
  { city: "Seattle", country: "United States", tz: "America/Los_Angeles" },
  { city: "Vancouver", country: "Canada", tz: "America/Vancouver" },
  { city: "Denver", country: "United States", tz: "America/Denver" },
  { city: "Phoenix", country: "United States", tz: "America/Phoenix" },
  { city: "Mexico City", country: "Mexico", tz: "America/Mexico_City" },
  { city: "Chicago", country: "United States", tz: "America/Chicago" },
  { city: "Austin", country: "United States", tz: "America/Chicago" },
  { city: "New York", country: "United States", tz: "America/New_York" },
  { city: "Toronto", country: "Canada", tz: "America/Toronto" },
  { city: "Miami", country: "United States", tz: "America/New_York" },
  { city: "Bogotá", country: "Colombia", tz: "America/Bogota" },
  { city: "Lima", country: "Peru", tz: "America/Lima" },
  { city: "Santiago", country: "Chile", tz: "America/Santiago" },
  { city: "Buenos Aires", country: "Argentina", tz: "America/Argentina/Buenos_Aires" },
  { city: "São Paulo", country: "Brazil", tz: "America/Sao_Paulo" },
  { city: "Reykjavík", country: "Iceland", tz: "Atlantic/Reykjavik" },
  { city: "Lisbon", country: "Portugal", tz: "Europe/Lisbon" },
  { city: "London", country: "United Kingdom", tz: "Europe/London" },
  { city: "Dublin", country: "Ireland", tz: "Europe/Dublin" },
  { city: "Lagos", country: "Nigeria", tz: "Africa/Lagos" },
  { city: "Paris", country: "France", tz: "Europe/Paris" },
  { city: "Madrid", country: "Spain", tz: "Europe/Madrid" },
  { city: "Amsterdam", country: "Netherlands", tz: "Europe/Amsterdam" },
  { city: "Berlin", country: "Germany", tz: "Europe/Berlin" },
  { city: "Zurich", country: "Switzerland", tz: "Europe/Zurich" },
  { city: "Rome", country: "Italy", tz: "Europe/Rome" },
  { city: "Stockholm", country: "Sweden", tz: "Europe/Stockholm" },
  { city: "Warsaw", country: "Poland", tz: "Europe/Warsaw" },
  { city: "Athens", country: "Greece", tz: "Europe/Athens" },
  { city: "Cairo", country: "Egypt", tz: "Africa/Cairo" },
  { city: "Johannesburg", country: "South Africa", tz: "Africa/Johannesburg" },
  { city: "Istanbul", country: "Türkiye", tz: "Europe/Istanbul" },
  { city: "Nairobi", country: "Kenya", tz: "Africa/Nairobi" },
  { city: "Moscow", country: "Russia", tz: "Europe/Moscow" },
  { city: "Riyadh", country: "Saudi Arabia", tz: "Asia/Riyadh" },
  { city: "Tehran", country: "Iran", tz: "Asia/Tehran" },
  { city: "Dubai", country: "United Arab Emirates", tz: "Asia/Dubai" },
  { city: "Karachi", country: "Pakistan", tz: "Asia/Karachi" },
  { city: "Mumbai", country: "India", tz: "Asia/Kolkata" },
  { city: "Delhi", country: "India", tz: "Asia/Kolkata" },
  { city: "Bengaluru", country: "India", tz: "Asia/Kolkata" },
  { city: "Ahmedabad", country: "India", tz: "Asia/Kolkata" },
  { city: "Kathmandu", country: "Nepal", tz: "Asia/Kathmandu" },
  { city: "Dhaka", country: "Bangladesh", tz: "Asia/Dhaka" },
  { city: "Bangkok", country: "Thailand", tz: "Asia/Bangkok" },
  { city: "Jakarta", country: "Indonesia", tz: "Asia/Jakarta" },
  { city: "Singapore", country: "Singapore", tz: "Asia/Singapore" },
  { city: "Kuala Lumpur", country: "Malaysia", tz: "Asia/Kuala_Lumpur" },
  { city: "Hong Kong", country: "China", tz: "Asia/Hong_Kong" },
  { city: "Shanghai", country: "China", tz: "Asia/Shanghai" },
  { city: "Beijing", country: "China", tz: "Asia/Shanghai" },
  { city: "Taipei", country: "Taiwan", tz: "Asia/Taipei" },
  { city: "Manila", country: "Philippines", tz: "Asia/Manila" },
  { city: "Seoul", country: "South Korea", tz: "Asia/Seoul" },
  { city: "Tokyo", country: "Japan", tz: "Asia/Tokyo" },
  { city: "Perth", country: "Australia", tz: "Australia/Perth" },
  { city: "Adelaide", country: "Australia", tz: "Australia/Adelaide" },
  { city: "Brisbane", country: "Australia", tz: "Australia/Brisbane" },
  { city: "Sydney", country: "Australia", tz: "Australia/Sydney" },
  { city: "Melbourne", country: "Australia", tz: "Australia/Melbourne" },
  { city: "Auckland", country: "New Zealand", tz: "Pacific/Auckland" },
  { city: "UTC", country: "Coordinated Universal Time", tz: "UTC" },
];

/** Most extra zones the notch tile can show without getting cramped. */
export const MAX_ZONES = 5;

export interface ClockZone {
  city: string;
  tz: string;
}

// ── formatting (Intl formatters are expensive to build — cache one per zone/kind) ─────────────
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: "time" | "parts", tz: string | undefined): Intl.DateTimeFormat {
  const key = `${kind}|${tz ?? ""}`;
  let f = fmtCache.get(key);
  if (!f) {
    f =
      kind === "time"
        ? new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", timeZone: tz })
        : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz });
    fmtCache.set(key, f);
  }
  return f;
}

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `date` in `tz` (undefined = this Mac's zone). */
export function zoneParts(date: Date, tz?: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0 };
  for (const p of fmt("parts", tz).formatToParts(date)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0; // some engines render midnight as 24 even with h23
  return out;
}

/** The zone's UTC offset at `date`, in minutes (e.g. +330 for India, −300 for New York in winter). */
export function utcOffsetMinutes(date: Date, tz?: string): number {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const actual = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asUtc - actual) / 60000);
}

/** Calendar-day difference of `tz` relative to `baseTz` (local by default): −1, 0 or +1. */
export function dayOffset(date: Date, tz: string, baseTz?: string): number {
  const a = zoneParts(date, tz);
  const b = zoneParts(date, baseTz);
  const diff = (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86400000;
  return Math.round(diff);
}

/** "+1" / "−1" (true minus sign) / "" for the same day. */
export function dayOffsetLabel(n: number): string {
  if (n === 0) return "";
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Hours ahead/behind `baseTz`: "+5h", "−4h", "+5:30h", or "same" when equal. */
export function hourDiffLabel(date: Date, tz: string, baseTz?: string): string {
  const d = utcOffsetMinutes(date, tz) - utcOffsetMinutes(date, baseTz);
  if (d === 0) return "same";
  const sign = d > 0 ? "+" : "−";
  const abs = Math.abs(d);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}h`;
}

/** Local-style short time in `tz`, e.g. "9:05 PM" or "21:05" depending on the user's locale. */
export function formatZoneTime(date: Date, tz: string): string {
  return fmt("time", tz).format(date);
}

/** Daylight in the zone (06:00–17:59) — drives the little sun/moon dot. */
export function isDaytime(date: Date, tz: string): boolean {
  const h = zoneParts(date, tz).hour;
  return h >= 6 && h < 18;
}

/** Search the curated list by city, country or zone id; prefix matches first. */
export function searchCities(query: string, exclude: ClockZone[] = []): ZoneCity[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(exclude.map((z) => `${z.city}|${z.tz}`));
  const pool = CITIES.filter((c) => !taken.has(`${c.city}|${c.tz}`));
  if (!q) return pool;
  const score = (c: ZoneCity) => {
    const city = c.city.toLowerCase();
    if (city.startsWith(q)) return 0;
    if (city.split(/[\s-]/).some((w) => w.startsWith(q))) return 1;
    if (c.country.toLowerCase().startsWith(q)) return 2;
    if (city.includes(q) || c.country.toLowerCase().includes(q) || c.tz.toLowerCase().includes(q)) return 3;
    return 9;
  };
  return pool
    .map((c) => [score(c), c] as const)
    .filter(([s]) => s < 9)
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
}

// ── persistence + broadcast ────────────────────────────────────────────────────────────────────
export const ZONES_KEY = "flo.clockZones";
export const ZONES_EVENT = "flo:clockzones";

export function sanitizeZones(v: unknown): ClockZone[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: ClockZone[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const { city, tz } = x as Record<string, unknown>;
    if (typeof city !== "string" || typeof tz !== "string" || !city.trim() || !isValidZone(tz)) continue;
    const k = `${city}|${tz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ city: city.trim(), tz });
    if (out.length >= MAX_ZONES) break;
  }
  return out;
}

export function loadZones(): ClockZone[] {
  try {
    const raw = localStorage.getItem(ZONES_KEY);
    return raw ? sanitizeZones(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveZones(zones: ClockZone[]): void {
  const clean = sanitizeZones(zones);
  try {
    localStorage.setItem(ZONES_KEY, JSON.stringify(clean));
  } catch {
    /* storage unavailable */
  }
  try {
    window.dispatchEvent(new CustomEvent(ZONES_EVENT, { detail: clean }));
  } catch {
    /* no window (tests) */
  }
}

/** Subscribe to zone-list changes from this window or any other. Returns an unsubscribe fn. */
export function onZonesChange(cb: (zones: ClockZone[]) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ZONES_KEY) cb(loadZones());
  };
  const onCustom = () => cb(loadZones());
  window.addEventListener("storage", onStorage);
  window.addEventListener(ZONES_EVENT, onCustom as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ZONES_EVENT, onCustom as EventListener);
  };
}
