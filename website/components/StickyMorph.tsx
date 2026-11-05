"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Bot, ListTodo, Mic, NotebookPen, ScanEye } from "lucide-react";
import { AgentVignette, AssistantVignette, DictationVignette, MeetingVignette, TodoVignette } from "./Vignettes";

const PILLARS = [
  { key: "dictation", icon: Mic, kbd: "⌃", title: "Dictation anywhere", body: "Hold Control and speak. Clean, punctuated text lands exactly where your cursor is, in any app. Add Space to go hands-free.", V: DictationVignette },
  { key: "assistant", icon: ScanEye, kbd: "fn", title: "An assistant that sees your screen", body: "Hold fn and ask. Flo reads the window you are on, goes deeper on request, and searches the web with sources.", V: AssistantVignette },
  { key: "meeting", icon: NotebookPen, kbd: "●", title: "Meeting notes, live", body: "A transcript streams as people talk. A rolling summary assembles itself and action items become to-dos.", V: MeetingVignette },
  { key: "agent", icon: Bot, kbd: "✦", title: "Every agent in your notch", body: "Claude Code, Codex and Cursor sessions sit in the notch with live status. Hover to read them, click to jump back.", V: AgentVignette },
  { key: "todo", icon: ListTodo, kbd: "✓", title: "Nothing slips", body: "Flo notices the asks, deadlines and replies you owe, on device, and quietly adds them to your list.", V: TodoVignette },
];

export function StickyMorph() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const i = Math.min(PILLARS.length - 1, Math.floor(p * PILLARS.length));
    setActive(i);
  });
  const Active = PILLARS[active].V;

  return (
    <section id="features" className="relative px-5" data-testid="features">
      {/* tall driver: one viewport per pillar */}
      <div ref={ref} style={{ height: `${PILLARS.length * 90}vh` }}>
        <div className="sticky top-0 flex min-h-screen items-center">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2">
            {/* left: morphing copy + pillar rail */}
            <div>
              <p className="eyebrow">One key, everything</p>
              <div className="relative mt-5 min-h-[180px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={PILLARS[active].key}
                    initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -18, filter: "blur(8px)" }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <h2 className="text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.08]">{PILLARS[active].title}</h2>
                    <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted">{PILLARS[active].body}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="mt-8 flex flex-col gap-1.5">
                {PILLARS.map((p, i) => (
                  <div key={p.key} className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-[13px] transition ${
                        i === active ? "bg-brand-500/20 text-brand-100 ring-1 ring-brand-300/40" : "bg-white/[0.03] text-faint"
                      }`}
                    >
                      <p.icon size={15} />
                    </span>
                    <span className={`text-[14px] transition ${i === active ? "text-ink" : "text-faint"}`}>{p.title}</span>
                    <span className="relative ml-auto h-[2px] flex-1 overflow-hidden rounded-full bg-white/5">
                      {i === active && <motion.span layoutId="pillar-underline" className="absolute inset-0 bg-gradient-to-r from-brand-500 to-brand-200" />}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* right: pinned demo that cross-fades */}
            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[40px] opacity-70 blur-3xl" style={{ background: "radial-gradient(circle at 50% 40%, rgb(61 187 255 / 0.2), transparent 70%)" }} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={PILLARS[active].key}
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -12 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Active />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
