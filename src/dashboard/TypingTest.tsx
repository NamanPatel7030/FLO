// Reusable typing test (Monkeytype-style): word-based, gliding caret, 3 lines, soft key sounds.
// Used by the Typing page and inline in Onboarding. Preserves data-testids: typing-passage, typing-result.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Check, Flame, Gauge, Keyboard, RotateCcw, Timer } from "lucide-react";
import { buildPracticeWords, computeWpm, initialTyping, minutesSavedPer1000, typeKey, wordLetters, type TypingState } from "../lib/typing";
import { playChime, playKey } from "../lib/keySounds";
import { useStore } from "./store";
import { Button, Card } from "./ui";

const LINE = 42;
const WINDOW = 90;
const FLARES = [10, 25, 50];

export function TypingTest({
  minutes = 5,
  compact = false,
  autoApply = false,
  onApplied,
}: {
  minutes?: number;
  compact?: boolean;
  /** save the measured wpm automatically on finish (used in onboarding) */
  autoApply?: boolean;
  onApplied?: (wpm: number) => void;
}) {
  const { settings, setSettings } = useStore();
  const [seed, setSeed] = useState(() => Date.now());
  const words = useMemo(() => buildPracticeWords(seed), [seed]);
  const [st, setSt] = useState<TypingState>(initialTyping);
  const stRef = useRef<TypingState>(st);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [applied, setApplied] = useState<number | null>(null);
  const [flare, setFlare] = useState<number | null>(null);
  const [base, setBase] = useState(0);
  const [shift, setShift] = useState(0);
  const inner = useRef<HTMLDivElement>(null);
  const wordEls = useRef<Map<number, HTMLSpanElement>>(new Map());
  const caret = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const limitMs = minutes * 60_000;
  const elapsed = startedAt ? Math.min(limitMs, now - startedAt) : 0;
  const finished = !!startedAt && elapsed >= limitMs;
  const stats = computeWpm(words, st, elapsed);
  const left = Math.max(0, limitMs - elapsed);
  const idx = st.typed.length;

  const reset = useCallback((fresh: boolean) => {
    stRef.current = initialTyping();
    setSt(stRef.current);
    setStartedAt(null);
    setApplied(null);
    setFlare(null);
    setBase(0);
    setShift(0);
    if (fresh) setSeed((s) => s + 1);
    setTimeout(() => input.current?.focus(), 0);
  }, []);
  const restart = useCallback(() => reset(false), [reset]);

  useEffect(() => {
    if (!startedAt || finished) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt, finished]);

  const apply = useCallback(async () => {
    if (!settings) return;
    await setSettings({ ...settings, typingWpm: stats.net });
    setApplied(stats.net);
    onApplied?.(stats.net);
  }, [settings, setSettings, stats.net, onApplied]);

  useEffect(() => {
    if (!finished) return;
    playChime();
    if (autoApply && applied === null && stats.net > 0) void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return restart();
      if (finished || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key === "Spacebar" ? " " : e.key;
      if (k !== "Backspace" && k.length !== 1) return;
      e.preventDefault();
      if (!startedAt && k !== "Backspace" && k !== " ") {
        setStartedAt(Date.now());
        setNow(Date.now());
      }
      const prev = stRef.current;
      const next = typeKey(prev, words, k);
      if (next === prev) return;
      stRef.current = next;
      setSt(next);
      if (k === " ") playKey(next.typed[next.typed.length - 1] === words[next.typed.length - 1] ? "space" : "error");
      else if (k === "Backspace") playKey("key");
      else playKey(next.correctKeys > prev.correctKeys ? "key" : "error");
      if (next.streak > prev.streak && FLARES.includes(next.streak)) setFlare(next.streak);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [words, startedAt, finished, restart]);

  useEffect(() => {
    if (flare === null) return;
    const t = setTimeout(() => setFlare(null), 1600);
    return () => clearTimeout(t);
  }, [flare]);

  useLayoutEffect(() => {
    const host = inner.current;
    const el = wordEls.current.get(idx);
    if (!host || !el || !caret.current) return;
    const letters = el.querySelectorAll<HTMLSpanElement>("[data-l]");
    const pos = st.current.length;
    let x: number;
    if (pos < letters.length) x = el.offsetLeft + letters[pos].offsetLeft;
    else if (letters.length) {
      const last = letters[letters.length - 1];
      x = el.offsetLeft + last.offsetLeft + last.offsetWidth;
    } else x = el.offsetLeft;
    const y = el.offsetTop;
    const line = Math.round(y / LINE);
    if (line >= 2) {
      let firstOnLine2 = idx;
      for (let i = base; i <= idx; i++) {
        const w = wordEls.current.get(i);
        if (w && Math.round(w.offsetTop / LINE) >= 1) {
          firstOnLine2 = i;
          break;
        }
      }
      setBase(firstOnLine2);
      setShift((s) => s + 1);
      return;
    }
    caret.current.style.transform = `translate(${x - 1}px, ${y + 7}px)`;
  });

  const caretGlow = st.streak >= 25 ? 18 : st.streak >= 10 ? 12 : st.streak >= 5 ? 8 : 4;
  const visible = words.slice(base, base + WINDOW);

  return (
    <div className={compact ? "mx-auto w-full max-w-[640px]" : ""}>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Metric icon={<Gauge size={15} />} label="WPM" value={startedAt ? String(stats.net) : "0"} />
        <Metric icon={<Check size={15} />} label="Accuracy" value={`${stats.accuracy}%`} />
        <Metric icon={<Flame size={15} />} label="Combo" value={String(st.streak)} hot={st.streak >= 10} />
        <Metric icon={<Timer size={15} />} label="Time left" value={`${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`} />
      </div>

      {!finished ? (
        <Card strong className="relative px-7 py-6" onClick={() => input.current?.focus()}>
          {flare !== null && (
            <div key={flare} className="flo-flare pointer-events-none absolute right-5 top-3 rounded-full border border-brand-300/40 bg-brand-300/15 px-2.5 py-0.5 text-[12px] font-semibold text-brand-200">
              {flare} in a row
            </div>
          )}
          <div
            className="relative overflow-hidden"
            style={{
              height: LINE * 3,
              maskImage: "linear-gradient(180deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)",
              WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%)",
            }}
            data-testid="typing-passage"
          >
            <div ref={inner} key={shift} className={clsx("relative", shift > 0 && "flo-line-up")} style={{ lineHeight: `${LINE}px`, ["--line" as string]: `${LINE}px` } as React.CSSProperties}>
              {visible.map((w, k) => {
                const i = base + k;
                const committed = i < idx;
                const typedWord = committed ? st.typed[i] : i === idx ? st.current : undefined;
                const wrongWord = committed && st.typed[i] !== w;
                return (
                  <span
                    key={i}
                    ref={(el) => {
                      if (el) wordEls.current.set(i, el);
                      else wordEls.current.delete(i);
                    }}
                    className={clsx("relative mr-[0.55em] inline-block text-[22px]", wrongWord && "underline decoration-red-400/60 decoration-[1.5px] underline-offset-[7px]")}
                    data-word={i}
                    data-state={committed ? (wrongWord ? "wrong" : "correct") : i === idx ? "current" : "pending"}
                  >
                    {wordLetters(w, typedWord, committed).map((l, j) => (
                      <span
                        key={j}
                        data-l
                        className={
                          l.state === "correct"
                            ? "text-[var(--fg)]"
                            : l.state === "wrong"
                              ? "text-red-400"
                              : l.state === "extra"
                                ? "text-red-400/60"
                                : "text-[var(--fg-faint)]"
                        }
                      >
                        {l.ch}
                      </span>
                    ))}
                  </span>
                );
              })}
              <div
                ref={caret}
                aria-hidden
                className="absolute left-0 top-0 h-[28px] w-[2.5px] rounded-full bg-brand-300"
                style={{
                  transition: "transform 90ms cubic-bezier(.2,.8,.2,1), box-shadow 300ms ease",
                  boxShadow: `0 0 ${caretGlow}px rgba(102,206,255,${st.streak >= 10 ? 0.95 : 0.7})`,
                }}
              />
            </div>
          </div>
          <input ref={input} aria-label="Typing input" className="absolute h-0 w-0 opacity-0" autoFocus readOnly />
          {!startedAt && (
            <div className="pointer-events-none mt-4 flex items-center justify-center gap-2 text-[12.5px] text-muted">
              <Keyboard size={14} className="text-brand-300" /> Start typing to begin. Space moves to the next word. Esc restarts.
            </div>
          )}
        </Card>
      ) : (
        <Results
          net={stats.net}
          raw={stats.raw}
          accuracy={stats.accuracy}
          correctWords={stats.correctWords}
          wrongWords={stats.wrongWords}
          before={settings?.typingWpm ?? 40}
          applied={applied}
          autoApplied={autoApply}
          onRetry={restart}
          onApply={apply}
        />
      )}
    </div>
  );
}

function useCountUp(to: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

function Results(p: {
  net: number;
  raw: number;
  accuracy: number;
  correctWords: number;
  wrongWords: number;
  before: number;
  applied: number | null;
  autoApplied?: boolean;
  onRetry: () => void;
  onApply: () => void;
}) {
  const net = useCountUp(p.net);
  const acc = useCountUp(Math.round(p.accuracy));
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card strong className="relative overflow-hidden p-7 text-center">
        <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-72 -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl" />
        <div className="relative mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-faint">Your speed</div>
        <div className="relative text-[64px] font-semibold leading-none tracking-tight accent-text" data-testid="typing-result" data-wpm={p.net}>
          {net}
          <span className="ml-2 text-[20px] font-medium text-muted">wpm</span>
        </div>
        <div className="relative mt-3 flex justify-center gap-6 text-[13px] text-muted">
          <span>
            <b className="text-[var(--fg)]">{acc}%</b> accuracy
          </span>
          <span>
            <b className="text-[var(--fg)]">{p.raw}</b> raw
          </span>
          <span>
            <b className="text-[var(--fg)]">{p.correctWords}</b> words · <span className="text-red-300">{p.wrongWords} missed</span>
          </span>
        </div>
        <div className="relative mx-auto mt-5 max-w-md rounded-2xl border border-brand-300/20 bg-brand-300/[0.06] p-4 text-[13.5px]">
          Speaking at ~150 wpm, Flo saves you about <b className="text-brand-200">{minutesSavedPer1000(p.net)} min</b> for every 1,000 words.
        </div>
        <div className="relative mt-5 flex items-center justify-center gap-2">
          <Button icon={<RotateCcw size={13} />} onClick={p.onRetry}>
            Try again
          </Button>
          {!p.autoApplied && (
            <Button variant="primary" icon={<Check size={13} />} disabled={p.net <= 0 || p.applied !== null} onClick={p.onApply}>
              {p.applied !== null ? "Saved" : "Use this speed"}
            </Button>
          )}
        </div>
        <div className="relative mt-3 text-[12px] text-faint">
          {p.applied !== null ? `Typing speed updated: ${p.before === p.applied ? p.before : `${p.before} → ${p.applied}`} wpm. Time saved in Analytics now uses it.` : `Current setting: ${p.before} wpm`}
        </div>
      </Card>
    </motion.div>
  );
}

function Metric({ icon, label, value, hot }: { icon: React.ReactNode; label: string; value: string; hot?: boolean }) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className={clsx("flex h-8 w-8 items-center justify-center rounded-xl transition", hot ? "bg-brand-300/25 text-brand-200 shadow-[0_0_14px_rgba(102,206,255,0.5)]" : "bg-brand-300/10 text-brand-300")}>{icon}</span>
      <div>
        <div className="text-[11px] text-faint">{label}</div>
        <div className="text-[18px] font-semibold tabular-nums" aria-label={label}>
          {value}
        </div>
      </div>
    </Card>
  );
}
