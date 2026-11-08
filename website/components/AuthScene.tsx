"use client";

// A living illustration for the auth pages: the notch listens, a greeting is "dictated" into a glass
// card, a to-do lands and gets ticked, and a language bubble translates itself. Original SVG/CSS only.
// Kept identical to the app's copy (src/dashboard/SignInScene.tsx). Static final frame under reduced motion.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const greetFor = (h: number) => (h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Working late");
const STEPS = 6; // 0 listen+type · 1 to-do lands · 2 tick · 3 bubble · 4 translation · 5 rest

function useTimeline(reduce: boolean, phrase: string) {
  const [step, setStep] = useState(reduce ? STEPS - 1 : 0);
  const [typed, setTyped] = useState(reduce ? phrase.length : 0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduce) {
      setStep(STEPS - 1);
      setTyped(phrase.length);
      return;
    }
    setStep(0);
    setTyped(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
    // type like someone talking: a little faster than reading, with a beat at commas
    let t = 700;
    for (let i = 1; i <= phrase.length; i++) {
      const ch = phrase[i - 1];
      t += ch === "," || ch === "." ? 210 : 38 + ((i * 17) % 23);
      at(t, () => setTyped(i));
    }
    at(t + 650, () => setStep(1));
    at(t + 1700, () => setStep(2));
    at(t + 2700, () => setStep(3));
    at(t + 3700, () => setStep(4));
    at(t + 4600, () => setStep(5));
    at(t + 8200, () => setCycle((c) => c + 1));
    return () => timers.forEach(clearTimeout);
  }, [reduce, phrase, cycle]);

  return { step, typed, cycle };
}

function Wave({ live }: { live: boolean }) {
  return (
    <span className="flo-scene-wave" data-live={live || undefined} aria-hidden>
      {[0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.75].map((h, i) => (
        <i key={i} style={{ ["--h" as string]: h, animationDelay: `${-i * 0.13}s` }} />
      ))}
    </span>
  );
}

function Check({ on, reduce }: { on: boolean; reduce: boolean }) {
  return (
    <span
      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full transition-all duration-300"
      style={{
        background: on ? "linear-gradient(135deg,#c2ecff,#66ceff 45%,#1a9be0)" : "transparent",
        border: on ? "1px solid rgba(194,236,255,0.7)" : "1.5px solid rgba(194,236,255,0.32)",
        boxShadow: on ? "0 0 14px -2px rgba(102,206,255,0.8)" : "none",
      }}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
        <motion.path
          d="M3.5 8.4 6.6 11.2 12.5 4.9"
          fill="none"
          stroke="#00243a"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
        />
      </svg>
    </span>
  );
}

const card = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.025) 45%, rgba(120,205,255,0.05)), rgba(8,24,42,0.62)",
  border: "1px solid rgba(190,230,255,0.16)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 24px 50px -28px rgba(0,0,0,0.9)",
  backdropFilter: "blur(18px) saturate(170%)",
  WebkitBackdropFilter: "blur(18px) saturate(170%)",
} as const;

export function AuthScene({ greeting, name, compact = false }: { greeting?: string; name?: string; compact?: boolean }) {
  const reduce = !!useReducedMotion();
  // no greeting given: use the local time, after mount (keeps server and client markup equal)
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!greeting) setLocal(greetFor(new Date().getHours()));
  }, [greeting]);
  const phrase = `${greeting ?? local ?? "Hello"}${name ? `, ${name}` : ""}. Remind me to call Mom at six.`;
  const { step, typed, cycle } = useTimeline(reduce, phrase);
  const listening = step === 0 && typed < phrase.length;
  const pop = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 14, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -6, transition: { duration: 0.25 } },
    transition: { duration: reduce ? 0 : 0.5, ease: EASE, delay },
  });

  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-hidden select-none" aria-hidden data-testid="signin-scene">
      <style>{SCENE_CSS}</style>
      {/* the screen's top edge + the notch */}
      <div className="relative z-10 flex w-full justify-center">
        <motion.div
          className="relative flex items-center justify-between overflow-hidden rounded-b-[22px] bg-black px-4"
          style={{ height: compact ? 34 : 38, boxShadow: listening ? "0 12px 44px -4px rgba(102,206,255,0.6), 0 0 0 1px rgba(102,206,255,0.22)" : "0 10px 34px -8px rgba(102,206,255,0.4), 0 0 0 1px rgba(102,206,255,0.1)" }}
          initial={false}
          animate={{ width: listening ? (compact ? 220 : 252) : compact ? 176 : 200 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
        >
          <span className="flex items-center gap-2">
            <span className="relative grid h-[9px] w-[9px] place-items-center">
              <span className="flo-scene-ping absolute inset-0 rounded-full" data-live={listening || undefined} />
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: listening ? "#66ceff" : "#34d399", boxShadow: listening ? "0 0 10px #66ceff" : "0 0 8px rgba(52,211,153,0.8)" }} />
            </span>
            <span className="text-[10.5px] font-semibold tracking-wide" style={{ color: listening ? "#c2ecff" : "rgba(226,240,255,0.55)" }}>
              {listening ? "Listening" : step === 3 ? "Translating" : "Done"}
            </span>
          </span>
          <Wave live={listening || step === 3} />
        </motion.div>
      </div>

      <div className={`relative z-10 flex w-full flex-1 justify-center ${compact ? "items-start pt-5" : "items-center py-8"}`}>
      <div className={`flex w-full flex-col px-6 ${compact ? "max-w-[400px] gap-3" : "max-w-[470px] gap-4"}`}>
        {/* dictation */}
        <div className="rounded-[20px] px-5 py-4" style={card}>
          <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#93ddff" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <rect x="9" y="2.5" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
            </svg>
            Dictating into Notes
          </div>
          <p className={`${compact ? "min-h-[44px] text-[14px]" : "min-h-[54px] text-[17.5px]"} leading-snug font-medium`} style={{ color: "#f3f9ff" }}>
            {phrase.slice(0, typed)}
            {typed < phrase.length && <span className="flo-scene-caret" />}
          </p>
        </div>

        {/* to-dos */}
        <div className="rounded-[20px] px-5 py-4" style={card}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#93ddff" }}>
              Today
            </span>
            <span className="text-[11px]" style={{ color: "rgba(226,240,255,0.5)" }}>
              {step >= 2 ? "1 of 3 done" : "0 of " + (step >= 1 ? 3 : 2) + " done"}
            </span>
          </div>
          <ul className={`flex flex-col gap-2.5 ${compact ? "text-[13.5px]" : "text-[14.5px]"}`} style={{ color: "rgba(243,249,255,0.92)" }}>
            <li className="flex items-center gap-3">
              <Check on={step >= 2} reduce={reduce} />
              <span className="relative transition-colors duration-300" style={{ color: step >= 2 ? "rgba(226,240,255,0.45)" : undefined }}>
                Send the deck to Priya
                <span className="absolute left-0 top-1/2 h-px origin-left transition-transform duration-500" style={{ width: "100%", background: "rgba(226,240,255,0.5)", transform: `scaleX(${step >= 2 ? 1 : 0})` }} />
              </span>
            </li>
            <li className="flex items-center gap-3">
              <Check on={false} reduce={reduce} />
              Book flights to Lisbon
            </li>
            <AnimatePresence initial={false}>
              {step >= 1 && (
                <motion.li key={`new-${cycle}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1" style={{ background: "rgba(102,206,255,0.10)", boxShadow: "inset 0 0 0 1px rgba(102,206,255,0.22)" }} {...pop()}>
                  <Check on={false} reduce={reduce} />
                  <span className="flex-1">Call Mom</span>
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: "rgba(102,206,255,0.16)", color: "#93ddff" }}>
                    6:00 PM
                  </span>
                </motion.li>
              )}
            </AnimatePresence>
          </ul>
        </div>

        {/* language bubble */}
        <div className={compact ? "min-h-[86px]" : "min-h-[104px]"}>
          <AnimatePresence initial={false}>
            {step >= 3 && (
              <motion.div key={`lang-${cycle}`} className="ml-auto w-[86%] rounded-[20px] rounded-br-[6px] px-4 py-3" style={card} {...pop()}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-medium" style={{ color: "#f3f9ff" }}>
                    ¿Nos vemos mañana a las diez?
                  </span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(226,240,255,0.7)" }}>
                    ES → EN
                  </span>
                </div>
                <motion.div
                  className="overflow-hidden"
                  initial={false}
                  animate={{ height: step >= 4 ? "auto" : 0, opacity: step >= 4 ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                >
                  <div className="mt-2 border-t pt-2 text-[13.5px]" style={{ borderColor: "rgba(190,230,255,0.12)", color: "#93ddff" }}>
                    See you tomorrow at ten?
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      </div>
    </div>
  );
}

const SCENE_CSS = `
.flo-scene-wave{display:inline-flex;align-items:center;gap:2.5px;height:16px}
.flo-scene-wave i{display:block;width:2.5px;height:16px;border-radius:2px;background:linear-gradient(180deg,#c2ecff,#66ceff 55%,#1a9be0);transform:scaleY(.18);transform-origin:center;opacity:.55;transition:opacity .3s}
.flo-scene-wave[data-live] i{opacity:1;animation:flo-scene-bar 1.05s ease-in-out infinite}
@keyframes flo-scene-bar{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(var(--h))}}
.flo-scene-ping[data-live]{background:rgba(102,206,255,.55);animation:flo-scene-ping 1.6s cubic-bezier(0,0,.2,1) infinite}
@keyframes flo-scene-ping{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.6);opacity:0}}
.flo-scene-caret{display:inline-block;width:2px;height:1.05em;margin-left:2px;vertical-align:-0.15em;border-radius:1px;background:#66ceff;box-shadow:0 0 8px #66ceff;animation:flo-scene-blink 1s steps(2,start) infinite}
@keyframes flo-scene-blink{to{visibility:hidden}}
@media (prefers-reduced-motion: reduce){.flo-scene-wave[data-live] i,.flo-scene-ping[data-live],.flo-scene-caret{animation:none}.flo-scene-wave[data-live] i{transform:scaleY(var(--h))}}
`;
