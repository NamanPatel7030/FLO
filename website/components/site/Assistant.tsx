"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookText, Check, CornerDownLeft, Globe, Hand, Mic, Plug, ScanEye, Square, Zap } from "lucide-react";
import { AGENT, INSTANT, PROMPTS, SKILLS } from "./data";
import { EASE, GlassWindow, Heading, Reveal, Section, Wave, useLoop, useTyped } from "./ui";

/* ── 03 Assistant: a wide chat window; pick a prompt, watch it read then draft ────────── */

const THREAD = [
  { who: "Rahul", c: "from-[#7ad7ff] to-[#2f8cff]", t: "Office closes at 4 tomorrow for Dhanteras 🪔" },
  { who: "Priya", c: "from-[#ffb38a] to-[#ff7eb0]", t: "Sweets are on me! Ordered for everyone, pick yours up before you leave." },
];

export function AssistantSection() {
  const [p, setP] = useState(0);
  const [stage, setStage] = useState<"read" | "draft">("read");
  const { ref, inView } = useLoop(1, 100000);
  useEffect(() => {
    if (!inView) return;
    setStage("read");
    const t = setTimeout(() => setStage("draft"), 1300);
    return () => clearTimeout(t);
  }, [p, inView]);
  const draft = useTyped(PROMPTS[p].draft, stage === "draft", 14);
  return (
    <Section id="assistant">
      <Heading
        tag="05 · Assistant that reads your screen"
        title="Ask for a draft. It reads the room first."
        accent="reads the room"
        lead="Hold fn and say what you need. Flo reads the conversation on screen and types the draft into the box you're in, in the thread's language and tone, with people's real names."
      />
      <div ref={ref} className="relative mx-auto mt-14 max-w-4xl">
        <Reveal>
          <GlassWindow
            title="# team-mumbai"
            right={
              <AnimatePresence mode="wait">
                <motion.span
                  key={stage}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="hw-notch flex items-center gap-2 rounded-full px-3 py-1 text-[11.5px] font-semibold"
                >
                  {stage === "read" ? (
                    <>
                      <ScanEye size={13} className="text-[#8fd0ff]" /> Reading the thread…
                    </>
                  ) : (
                    <>
                      <Wave bars={4} color="#c9b8ff" /> Drafting
                    </>
                  )}
                </motion.span>
              </AnimatePresence>
            }
          >
            <div className="space-y-4 p-5 sm:p-7">
              {THREAD.map((m, k) => (
                <div key={k} className={`flex items-start gap-3 transition-all duration-500 ${stage === "read" ? "rounded-2xl bg-[#2f8cff]/[0.06] ring-1 ring-[#2f8cff]/20" : ""} p-2`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-[13px] font-bold text-[#fff] ${m.c}`}>{m.who[0]}</span>
                  <div>
                    <p className="text-[13px] font-semibold ink">{m.who}</p>
                    <p className="text-[14.5px] ink-2">{m.t}</p>
                  </div>
                </div>
              ))}
              <div className="g-2 rounded-2xl p-4">
                <div className="min-h-[72px] text-[15px] leading-relaxed ink" aria-live="polite">
                  {draft || <span className="fnt">Message #team-mumbai</span>}
                  {stage === "draft" && draft.length < PROMPTS[p].draft.length && <span className="caret-v2" />}
                </div>
                <div className="mt-3 flex items-center justify-between text-[12px] fnt">
                  <span className="flex items-center gap-1.5">
                    <Mic size={13} /> You said: <span className="font-semibold ink-2">“{PROMPTS[p].say}”</span>
                  </span>
                  <span className="kbd">
                    <CornerDownLeft size={12} />
                  </span>
                </div>
              </div>
            </div>
          </GlassWindow>
        </Reveal>
        <div className="mt-6 flex flex-wrap justify-center gap-2" role="group" aria-label="Try a request">
          {PROMPTS.map((x, k) => (
            <button key={x.say} type="button" className="chip2" aria-pressed={k === p} onClick={() => setP(k)}>
              <Mic size={14} /> {x.say}
            </button>
          ))}
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            [ScanEye, "Reads the focused window only when you ask"],
            [Globe, "Go deeper or search the web from any answer"],
            [Plug, "Uses your own AI key or a local model"],
          ].map(([I, t], k) => {
            const Icon = I as typeof ScanEye;
            return (
              <Reveal key={k} delay={k * 0.06} className="flex items-center gap-3 rounded-2xl px-2 text-[14px] font-medium ink-2">
                <span className="g-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#7a6cff]">
                  <Icon size={18} />
                </span>
                {t as string}
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ── 04 Skills: a node canvas on a dotted board ───────────────────────────────────────── */

const ATTACH_ICON = { platform: Square, mcp: Plug, doc: BookText } as const;

export function SkillsSection() {
  const [s, setS] = useState(0);
  const { ref, i } = useLoop(5, 1100, 4);
  const sk = SKILLS[s];
  return (
    <Section id="skills">
      <div className="grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="lg:sticky lg:top-28">
          <Heading
            align="left"
            tag="06 · Skills & MCP tools"
            title="Teach it once. Then just ask."
            accent="just ask."
            lead="Draw a skill on a canvas: the phrases that start it, the steps, the apps it works in, the MCP tools it may call and the docs it can read. The way you like things done stops living in your head."
          />
          <div className="mt-8 flex flex-col gap-2" role="tablist" aria-label="Example skills">
            {SKILLS.map((x, k) => (
              <button
                key={x.name}
                role="tab"
                aria-selected={k === s}
                onClick={() => setS(k)}
                className={`flex items-center justify-between rounded-2xl px-4 py-3.5 text-left transition-all ${k === s ? "g" : "hover:bg-[rgba(255,255,255,0.5)]"}`}
              >
                <span>
                  <span className="block text-[15px] font-semibold ink">{x.name}</span>
                  <span className="text-[13px] mut">“{x.say}”</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${x.mode === "Do" ? "bg-[#ffe1d0] text-[#b4532a]" : "bg-[#dfe6ff] text-[#3b4bc4]"}`}>{x.mode} mode</span>
              </button>
            ))}
          </div>
        </div>
        <Reveal>
          <div ref={ref} className="g dotgrid relative overflow-hidden rounded-[32px] p-6 sm:p-10" data-testid="skill-canvas">
            <AnimatePresence mode="wait">
              <motion.div key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="relative flex flex-col items-center">
                {/* trigger */}
                <div className="hw-notch flex items-center gap-2.5 rounded-full px-4 py-2.5 text-[14px] font-medium">
                  <Mic size={15} className="text-[#8fd0ff]" /> “{sk.say}”
                </div>
                <span className="h-7 w-px bg-gradient-to-b from-[#7a6cff]/60 to-[#2f8cff]/40" />
                {/* steps */}
                <div className="flex w-full max-w-md flex-col items-center">
                  {sk.steps.map((st, k) => {
                    const lit = i > k;
                    return (
                      <div key={st} className="flex w-full flex-col items-center">
                        <div className={`g-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-500 ${lit ? "ring-2 ring-[#7a6cff]/40" : ""}`}>
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold transition-colors duration-500 ${lit ? "bg-[#7a6cff] text-[#fff]" : "bg-[#fff] text-[var(--v2-muted)] ring-1 ring-black/5"}`}>
                            {lit ? <Check size={14} strokeWidth={3} /> : k + 1}
                          </span>
                          <span className="text-[14.5px] font-medium ink">{st}</span>
                          {k < sk.attach.length && (
                            <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.8)] px-2.5 py-1 text-[11.5px] font-semibold mut sm:flex">
                              {(() => {
                                const I = ATTACH_ICON[sk.attach[k][0] as keyof typeof ATTACH_ICON];
                                return <I size={12} />;
                              })()}
                              {sk.attach[k][1]}
                            </span>
                          )}
                        </div>
                        {k < sk.steps.length - 1 && <span className="h-5 w-px bg-[#7a6cff]/30" />}
                      </div>
                    );
                  })}
                </div>
                <span className="h-7 w-px bg-[#7a6cff]/30" />
                <div className={`rounded-2xl px-5 py-3 text-[14px] font-semibold transition-all duration-500 ${i >= 4 ? "bg-[#0b1220] text-[#fff] shadow-lg" : "g-2 mut"}`}>
                  {i >= 4 ? (
                    <span className="flex items-center gap-2">
                      <Check size={15} className="text-[#5fd3b0]" strokeWidth={3} /> {sk.result}
                    </span>
                  ) : (
                    sk.out
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 05 Hands-free agent: steps fill a timeline, then it asks before sending ──────────── */

export function AgentSection() {
  const { ref, i } = useLoop(7, 1200, 6);
  const shown = Math.min(AGENT.steps.length, i);
  const asking = i >= AGENT.steps.length + 1;
  return (
    <Section id="agent">
      <Heading
        tag="07 · Hands-free agent"
        title="Double-tap. Say it. Watch it happen."
        accent="Watch it happen."
        lead="Double-tap fn and Flo keeps listening, no key held. It opens apps, searches, clicks and types, and the notch shows every move. It never sends, posts, buys or deletes until you say “yes” out loud."
      />
      <div ref={ref} className="mt-14 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <Reveal className="g rounded-[32px] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="kbd">fn</span>
            <span className="kbd">fn</span>
            <span className="text-[13px] font-semibold mut">then</span>
            <span className="hw-notch flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium">
              <Wave bars={4} color="#8fd0ff" /> “{AGENT.say}”
            </span>
          </div>
          <ol className="relative mt-7 space-y-3 pl-8">
            <span className="absolute bottom-3 left-[11px] top-3 w-px bg-black/[0.08]" />
            <motion.span className="absolute left-[11px] top-3 w-px origin-top bg-gradient-to-b from-[#2f8cff] to-[#7a6cff]" animate={{ height: `${(shown / AGENT.steps.length) * 88}%` }} transition={{ duration: 0.6, ease: EASE }} />
            {AGENT.steps.map((s, k) => (
              <li key={s} className="relative">
                <span className={`absolute -left-8 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full transition-all duration-500 ${k < shown ? "bg-[#2f8cff] text-[#fff]" : "bg-[#fff] ring-1 ring-black/10"}`}>
                  {k < shown && <Check size={12} strokeWidth={3.5} />}
                </span>
                <div className={`g-2 rounded-2xl px-4 py-3 text-[14.5px] font-medium transition-all duration-500 ${k < shown ? "ink" : "opacity-50 fnt"}`}>{s}</div>
              </li>
            ))}
          </ol>
        </Reveal>
        <div className="flex flex-col gap-4">
          <Reveal delay={0.08} className="g relative flex-1 overflow-hidden rounded-[32px] p-6 sm:p-8">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_70%_at_100%_0%,rgba(255,190,210,0.5),transparent_70%)]" />
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[#d14d84]">
              <Hand size={14} /> Asks before it acts
            </p>
            <p className="mt-4 text-[24px] font-semibold leading-tight tracking-tight ink">{AGENT.confirm}</p>
            <div className={`mt-6 flex gap-2 transition-opacity duration-500 ${asking ? "opacity-100" : "opacity-40"}`}>
              <span className="btn btn-primary h-11 px-5 text-[14px]">Yes, send</span>
              <span className="btn btn-glass h-11 px-5 text-[14px] ink">Not yet</span>
            </div>
            <p className="mt-4 text-[13px] mut">Say “stop” at any moment and it stops.</p>
          </Reveal>
          <Reveal delay={0.14} className="g rounded-[32px] p-6">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[#2f8cff]">
              <Zap size={14} /> Instant and offline
            </p>
            <ul className="mt-3 space-y-2">
              {INSTANT.map((x) => (
                <li key={x.say} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="font-medium ink">“{x.say}”</span>
                  <span className="truncate text-[12.5px] mut">{x.did}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
