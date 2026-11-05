// Typing speed test: measures real WPM so "minutes saved" analytics use your actual speed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Check, Gauge, Keyboard, RotateCcw, Timer } from "lucide-react";
import { buildPracticeText, computeWpm, minutesSavedPer1000 } from "../../lib/typing";
import { useStore } from "../store";
import { Button, Card, PageHeader } from "../ui";

const DURATIONS = [1, 3, 5] as const;

export default function Typing() {
  const { settings, setSettings } = useStore();
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>(5);
  const [seed, setSeed] = useState(() => Date.now());
  const target = useMemo(() => buildPracticeText(seed), [seed]);
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<HTMLSpanElement>(null);

  const limitMs = minutes * 60_000;
  const elapsed = startedAt ? Math.min(limitMs, now - startedAt) : 0;
  const stats = computeWpm(typed, target, elapsed);
  const left = Math.max(0, limitMs - elapsed);
  // finished when time is up (derived, so it never depends on an interval tick landing)
  const finished = done || (!!startedAt && elapsed >= limitMs);

  const reset = useCallback(() => {
    setTyped("");
    setStartedAt(null);
    setDone(false);
    setApplied(null);
    setSeed(Date.now());
    setTimeout(() => input.current?.focus(), 0);
  }, []);

  // clock
  useEffect(() => {
    if (!startedAt || done) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - startedAt >= limitMs) setDone(true);
    }, 200);
    return () => clearInterval(t);
  }, [startedAt, done, limitMs]);

  // keep the caret line in view
  useEffect(() => {
    caret.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [Math.floor(typed.length / 40)]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && reset();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  const onChange = (v: string) => {
    if (finished) return;
    if (!startedAt && v.length) {
      setStartedAt(Date.now());
      setNow(Date.now());
    }
    setTyped(v.slice(0, target.length));
    if (v.length >= target.length) setDone(true);
  };

  const visibleEnd = Math.min(target.length, typed.length + 420);
  const before = settings?.typingWpm ?? 40;

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Typing test"
        subtitle="Measure your real typing speed. Flo uses it to show how much time speaking saves you."
        actions={
          <div className="glass inline-flex rounded-xl p-1">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setMinutes(d);
                  reset();
                }}
                className={clsx("relative h-8 rounded-lg px-3 text-[13px] font-medium transition", minutes === d ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
                aria-pressed={minutes === d}
              >
                {minutes === d && <motion.span layoutId="typing-dur" className="absolute inset-0 rounded-lg glass-strong" />}
                <span className="relative">{d} min</span>
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Metric icon={<Gauge size={15} />} label="WPM" value={startedAt ? String(stats.net) : "0"} />
        <Metric icon={<Check size={15} />} label="Accuracy" value={`${stats.accuracy}%`} />
        <Metric icon={<Timer size={15} />} label="Time left" value={`${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`} />
      </div>

      {/* plain conditional (enter animations only): never stuck waiting on an exit animation */}
      <>
        {!finished ? (
          <motion.div key="test" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Card strong className="relative p-6" onClick={() => input.current?.focus()}>
              <div className="h-[7.6em] overflow-hidden text-[19px] leading-[1.9em] tracking-[0.005em]" data-testid="typing-passage">
                {Array.from(target.slice(0, visibleEnd)).map((ch, i) => {
                  const t = typed[i];
                  const cls =
                    i >= typed.length ? "text-[var(--fg-faint)]" : t === ch ? "text-[var(--fg)]" : "rounded-[3px] bg-red-500/20 text-red-300 underline decoration-red-400/70";
                  return (
                    <span key={i} className={cls}>
                      {i === typed.length && <span ref={caret} className="flo-caret -ml-[1px] mr-[1px]" aria-hidden />}
                      {ch}
                    </span>
                  );
                })}
              </div>
              <textarea
                ref={input}
                aria-label="Typing input"
                value={typed}
                onChange={(e) => onChange(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="absolute inset-0 h-full w-full resize-none opacity-0"
              />
              {!startedAt && (
                <div className="pointer-events-none mt-4 flex items-center justify-center gap-2 text-[12.5px] text-muted">
                  <Keyboard size={14} className="text-brand-300" /> Start typing to begin. Esc restarts.
                </div>
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
            <Card strong className="relative overflow-hidden p-7 text-center">
              <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-72 -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl" />
              <div className="relative text-[12px] font-semibold uppercase tracking-[0.16em] text-faint">Your speed</div>
              <div className="relative mt-1 text-[64px] font-semibold leading-none tracking-tight accent-text" data-testid="typing-result">
                {stats.net}
                <span className="ml-2 text-[20px] font-medium text-muted">wpm</span>
              </div>
              <div className="relative mt-2 text-[13px] text-muted">
                {stats.accuracy}% accuracy · {stats.gross} gross wpm · {stats.errors} errors
              </div>
              <div className="relative mx-auto mt-5 max-w-md rounded-2xl border border-brand-300/20 bg-brand-300/[0.06] p-4 text-[13.5px]">
                Speaking at ~150 wpm, Flo saves you about <b className="text-brand-200">{minutesSavedPer1000(stats.net)} min</b> for every 1,000 words.
              </div>
              <div className="relative mt-5 flex items-center justify-center gap-2">
                <Button icon={<RotateCcw size={13} />} onClick={reset}>
                  Try again
                </Button>
                <Button
                  variant="primary"
                  icon={<Check size={13} />}
                  disabled={!settings || stats.net <= 0 || applied !== null}
                  onClick={async () => {
                    if (!settings) return;
                    await setSettings({ ...settings, typingWpm: stats.net });
                    setApplied(stats.net);
                  }}
                >
                  {applied !== null ? "Saved" : "Use this speed"}
                </Button>
              </div>
              <div className="relative mt-3 text-[12px] text-faint">
                {applied !== null ? `Typing speed updated: ${before === applied ? before : `${before} → ${applied}`} wpm. Time saved in Analytics now uses it.` : `Current setting: ${before} wpm`}
              </div>
            </Card>
          </motion.div>
        )}
      </>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-300/10 text-brand-300">{icon}</span>
      <div>
        <div className="text-[11px] text-faint">{label}</div>
        <div className="text-[18px] font-semibold tabular-nums" aria-label={label}>
          {value}
        </div>
      </div>
    </Card>
  );
}
