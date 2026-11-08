// 5-field cron (minute hour day-of-month month day-of-week) for the Schedule node's live preview
// and the "next run" on skill cards. Mirrors src-tauri/src/cron.rs, which is what actually runs it.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
  fields: string[];
}

function value(tok: string, names: string[], base: number, what: string): number {
  const t = tok.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const i = t.length >= 3 ? names.findIndex((n) => t.startsWith(n)) : -1;
  if (i < 0) throw new Error(`${what}: “${tok}” isn't a number`);
  return i + base;
}

function field(src: string, lo: number, hi: number, names: string[], what: string): Set<number> {
  const out = new Set<number>();
  const isDow = what === "day of week";
  const max = isDow ? 7 : hi;
  for (const raw of src.split(",")) {
    const item = raw.trim();
    if (!item) throw new Error(`${what}: empty list item`);
    const [range, stepStr] = item.split("/");
    let step = 1;
    if (stepStr !== undefined) {
      if (!/^\d+$/.test(stepStr.trim())) throw new Error(`${what}: step “${stepStr}” isn't a number`);
      step = Number(stepStr);
      if (step === 0) throw new Error(`${what}: step can't be 0`);
    }
    const base = names.length === 12 ? 1 : 0;
    let a: number, b: number;
    if (range === "*") [a, b] = [lo, hi];
    else if (range.includes("-")) {
      const [x, y] = range.split("-");
      [a, b] = [value(x, names, base, what), value(y, names, base, what)];
    } else {
      a = value(range, names, base, what);
      b = step > 1 ? hi : a;
    }
    if (a < lo || a > max || b < lo || b > max) throw new Error(`${what} must be between ${lo} and ${hi}`);
    if (a > b) throw new Error(`${what}: range ${a}-${b} runs backwards`);
    for (let v = a; v <= b; v += step) out.add(isDow && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const e = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
  const f = e.split(/\s+/).filter(Boolean);
  if (f.length !== 5) throw new Error("A schedule needs 5 parts: minute hour day month weekday");
  return {
    minutes: field(f[0], 0, 59, [], "minute"),
    hours: field(f[1], 0, 23, [], "hour"),
    dom: field(f[2], 1, 31, [], "day of month"),
    months: field(f[3], 1, 12, MONTHS, "month"),
    dow: field(f[4], 0, 6, DAYS, "day of week"),
    domAny: f[2].startsWith("*"),
    dowAny: f[4].startsWith("*"),
    fields: f,
  };
}

export function cronError(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function dayOk(c: Cron, d: Date): boolean {
  const dom = c.dom.has(d.getDate());
  const dow = c.dow.has(d.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow;
}

/** First matching minute strictly after `after` (local time), or null if it never runs. */
export function nextRun(expr: string | Cron, after: Date = new Date()): Date | null {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  const t = new Date(after);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 200_000; i++) {
    if (!c.months.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayOk(c, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const single = (s: string) => /^\d+$/.test(s);
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "every weekday at 09:00", "every 15 minutes", "every Monday at 08:30"… */
export function describeCron(expr: string): string {
  let c: Cron;
  try {
    c = parseCron(expr);
  } catch {
    return "Not a valid schedule";
  }
  const [mi, ho, dm, mo, dw] = c.fields;
  const allDays = dm === "*" && mo === "*" && dw === "*";
  // minute-level
  if (mi === "*" && ho === "*" && allDays) return "every minute";
  const everyN = mi.match(/^\*\/(\d+)$/);
  if (everyN && ho === "*" && allDays) return `every ${everyN[1]} minutes`;
  if (single(mi) && ho === "*" && allDays) return Number(mi) === 0 ? "every hour" : `every hour at :${pad(Number(mi))}`;
  const everyH = ho.match(/^\*\/(\d+)$/);
  if (single(mi) && everyH && allDays) return `every ${everyH[1]} hours${Number(mi) ? ` at :${pad(Number(mi))}` : ""}`;

  // times of day
  if (!single(mi) || c.hours.size > 6 || ho.includes("/")) return `on a custom schedule (${c.fields.join(" ")})`;
  const times = andList(sorted(c.hours).map((h) => `${pad(h)}:${pad(Number(mi))}`));
  const days = sorted(c.dow);
  let when: string;
  if (dm === "*" && dw === "*") when = "every day";
  else if (dm === "*" && days.join() === "1,2,3,4,5") when = "every weekday";
  else if (dm === "*" && days.join() === "0,6") when = "every weekend";
  else if (dm === "*" && days.length === 1) when = `every ${DAY_NAMES[days[0]]}`;
  else if (dm === "*") when = `every ${andList(days.map((d) => DAY_NAMES[d].slice(0, 3)))}`;
  else if (dw === "*" && single(dm)) when = `on the ${ordinal(Number(dm))} of every month`;
  else return `on a custom schedule (${c.fields.join(" ")})`;
  if (mo !== "*") when += ` in ${andList(sorted(c.months).map((m) => MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)))}`;
  return `${when} at ${times}`;
}

/** "Mon 10 Nov 09:00"; with `relative`, today / tomorrow get their names. */
export function formatRun(d: Date, now: Date = new Date(), relative = true): string {
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86_400_000);
  if (relative && diff === 0) return `today ${time}`;
  if (relative && diff === 1) return `tomorrow ${time}`;
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)} ${time}`;
}

// ── friendly presets for the Schedule node ───────────────────────────────────

export type SchedulePreset = "hourly" | "minutes" | "weekdays" | "daily" | "weekly" | "custom";

export interface ScheduleForm {
  preset: SchedulePreset;
  /** "HH:MM" for weekdays / daily / weekly */
  time: string;
  /** 0-6 for weekly */
  day: number;
  /** every N minutes */
  every: number;
}

export const PRESETS: { id: SchedulePreset; label: string }[] = [
  { id: "hourly", label: "Every hour" },
  { id: "weekdays", label: "Every weekday at…" },
  { id: "daily", label: "Every day at…" },
  { id: "weekly", label: "Every week on…" },
  { id: "minutes", label: "Every N minutes" },
  { id: "custom", label: "Custom (cron)" },
];

export const WEEKDAYS = DAY_NAMES;

export function cronFromForm(f: ScheduleForm): string {
  const [h, m] = (f.time || "09:00").split(":").map((x) => Number(x) || 0);
  switch (f.preset) {
    case "hourly":
      return "0 * * * *";
    case "minutes":
      return `*/${Math.min(59, Math.max(1, Math.round(f.every) || 15))} * * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${f.day}`;
    case "custom":
      return "";
  }
}

/** Recognise a cron as one of the presets (so a saved or AI-made schedule opens on the right one). */
export function formFromCron(expr: string): ScheduleForm {
  const base: ScheduleForm = { preset: "custom", time: "09:00", day: 1, every: 15 };
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5 || cronError(expr)) return base;
  const [mi, ho, dm, mo, dw] = f;
  if (mo !== "*" || dm !== "*") return base;
  if (mi === "0" && ho === "*" && dw === "*") return { ...base, preset: "hourly" };
  const n = mi.match(/^\*\/(\d+)$/);
  if (n && ho === "*" && dw === "*") return { ...base, preset: "minutes", every: Number(n[1]) };
  if (!single(mi) || !single(ho)) return base;
  const time = `${pad(Number(ho))}:${pad(Number(mi))}`;
  if (dw === "*") return { ...base, preset: "daily", time };
  if (dw === "1-5") return { ...base, preset: "weekdays", time };
  if (single(dw)) return { ...base, preset: "weekly", time, day: Number(dw) % 7 };
  return base;
}
