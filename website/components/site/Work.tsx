"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BellRing, Check, CircleDot, FileText, MessageSquare, Mic, Terminal, Video } from "lucide-react";
import { DEADLINES, FILED, PROJECTS } from "./data";
import { ClaudeMark, EASE, Heading, Reveal, Section, Wave, useLoop } from "./ui";

/* ── 07 + 08 To-dos and reminders: a bento ─────────────────────────────────────────────── */

const TODOS = [
  { t: "Send the demo to the client by 10", from: "Said on Zoom · Acme weekly", icon: Video },
  { t: "Reply to Jon about the logo", from: "Unanswered Slack DM", icon: MessageSquare },
  { t: "Review Priya's onboarding PR", from: "Spotted on screen · GitHub", icon: CircleDot },
  { t: "Book the dentist", from: "Said to Flo", icon: Mic },
];

function TodoList() {
  const [done, setDone] = useState<number[]>([3]);
  const toggle = (k: number) => setDone((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  return (
    <ul className="mt-6 space-y-2">
      {TODOS.map((x, k) => {
        const on = done.includes(k);
        const Icon = x.icon;
        return (
          <li key={x.t}>
            <button type="button" onClick={() => toggle(k)} aria-pressed={on} className="g-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-white/90">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-all ${on ? "bg-[#3fbf98] text-white" : "ring-[1.5px] ring-black/15"}`}>{on && <Check size={13} strokeWidth={3.5} />}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14.5px] font-medium transition ${on ? "fnt line-through" : "ink"}`}>{x.t}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12px] fnt">
                  <Icon size={12} /> {x.from}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TodosSection() {
  const { ref, i } = useLoop(DEADLINES.length, 2600, 0);
  const d = DEADLINES[i];
  return (
    <Section id="work">
      <Heading
        tag="07 · To-dos from everywhere"
        title="The promises you make get written down."
        accent="written down."
        lead="Flo catches what you commit to in meetings, in Slack and on screen, and keeps it behind a tray icon in your notch. Every item says why it's there."
      />
      <div ref={ref} className="mt-14 grid gap-4 md:grid-cols-6 md:grid-rows-[auto_auto]">
        <Reveal className="g rounded-[32px] p-6 sm:p-7 md:col-span-3 md:row-span-2">
          <div className="flex items-center justify-between">
            <p className="text-[18px] font-semibold tracking-tight ink">Today</p>
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[12px] font-semibold mut">Tap to tick</span>
          </div>
          <TodoList />
        </Reveal>
        <Reveal delay={0.06} className="g relative overflow-hidden rounded-[32px] p-6 sm:p-7 md:col-span-3">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_90%_at_100%_0%,rgba(200,185,255,0.55),transparent_70%)]" />
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[#7a6cff]">08 · Deadlines become reminders</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <AnimatePresence mode="wait">
              <motion.span key={d.say} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }} className="serif-i text-[34px] leading-none ink">
                “{d.say}”
              </motion.span>
            </AnimatePresence>
            <ArrowRight size={20} className="fnt" />
            <AnimatePresence mode="wait">
              <motion.span key={d.due} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: 0.15 }} className="rounded-2xl bg-[#0b1220] px-4 py-2 text-[16px] font-semibold text-white">
                {d.due}
              </motion.span>
            </AnimatePresence>
          </div>
          <p className="mt-4 text-[14px] mut">It works out the real date and time, then taps you on the shoulder 5 minutes early, at {d.ring}.</p>
        </Reveal>
        <Reveal delay={0.1} className="g rounded-[32px] p-6 md:col-span-2">
          <div className="hw-notch rounded-[22px] p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-[#c9b8ff]">
              <BellRing size={14} className="bell-ring" /> Reminder · in 5 min
            </p>
            <p className="mt-1.5 text-[15px] font-semibold">Send the demo to the client</p>
            <div className="mt-3 flex gap-2">
              <span className="rounded-full bg-white/12 px-3 py-1 text-[12px] font-semibold">Snooze 10m</span>
              <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black">Done</span>
            </div>
          </div>
          <p className="mt-4 text-[13.5px] mut">Right in the notch, wherever you are.</p>
        </Reveal>
        <Reveal delay={0.14} className="g flex flex-col justify-between rounded-[32px] p-6 md:col-span-1">
          <MessageSquare size={22} className="text-[#2f8cff]" />
          <p className="mt-6 text-[14px] font-semibold leading-snug ink">Unanswered Slack asks, caught for you</p>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 09 Projects: items fly into the right client column ───────────────────────────────── */

export function ProjectsSection() {
  const { ref, i } = useLoop(FILED.length + 2, 1500, FILED.length + 1);
  const landed = Math.min(FILED.length, i);
  const incoming = i < FILED.length ? FILED[i] : null;
  return (
    <Section id="projects">
      <div className="grid items-end gap-6 md:grid-cols-2">
        <Heading align="left" tag="09 · Projects & clients" title="Everything files itself under the right client." accent="files itself" />
        <Reveal delay={0.05}>
          <p className="v2-lead md:pb-2">
            Give a project its client and a few keywords. From then on, the to-dos, notes and meetings that mention them land there on their own. Open Acme and see everything Acme.
          </p>
        </Reveal>
      </div>
      <div ref={ref} className="mt-12">
        <div className="flex h-14 items-center justify-center">
          <AnimatePresence mode="wait">
            {incoming && (
              <motion.div
                key={incoming.text}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30, scale: 0.9 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="hw-notch flex items-center gap-2.5 rounded-full px-4 py-2 text-[13.5px]"
              >
                <span className="text-white/55">{incoming.from}</span>
                <span className="font-semibold">{incoming.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PROJECTS.map((p, k) => {
            const items = FILED.slice(0, landed).filter((f) => f.to === k);
            return (
              <Reveal key={p.name} delay={k * 0.06} className="g min-h-[260px] rounded-[30px] p-5">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-2xl" style={{ background: `linear-gradient(135deg, ${p.color}, #ffffff)` }} />
                  <div>
                    <p className="text-[16px] font-semibold ink">{p.client || "Personal"}</p>
                    <p className="text-[12.5px] mut">{p.name}</p>
                  </div>
                  <span className="ml-auto text-[13px] font-semibold ink-2">{Math.round(p.done * 100)}%</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${p.done * 100}%`, background: p.color }} />
                </div>
                <ul className="mt-4 space-y-2">
                  <AnimatePresence>
                    {items.map((f) => (
                      <motion.li
                        key={f.text}
                        layout
                        initial={{ opacity: 0, y: -16, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="g-2 rounded-2xl px-3.5 py-2.5"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider fnt">{f.kind}</p>
                        <p className="text-[13.5px] font-medium ink">{f.text}</p>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ── 10 Meetings: an audio track across the top, transcript and summary below ─────────── */

const LINES = [
  { who: "Jon", c: "#2f8cff", t: "Can we get the homepage copy before the weekend?" },
  { who: "You", c: "#7a6cff", t: "Yes, I'll send it tonight." },
  { who: "Priya", c: "#ff7eb0", t: "And Nimbus asked for dark mode in v1." },
];
const BARS = Array.from({ length: 90 }, (_, k) => Math.round((0.25 + Math.abs(Math.sin(k * 0.55) * Math.cos(k * 0.21)) * 0.75) * 100));

export function MeetingsSection() {
  const { ref, i } = useLoop(5, 1600, 4);
  return (
    <Section id="meetings">
      <Heading
        tag="10 · Meeting notes"
        title="Listen. Flo takes the notes."
        accent="takes the notes."
        lead="When a Zoom, Meet or Teams call starts, the notch offers to take notes. Flo transcribes live on your Mac, then hands you a summary and the action items when the call ends."
      />
      <div ref={ref} className="mt-14">
        <Reveal className="g rounded-[32px] p-5 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-full bg-[#ff5d6c]/10 px-3 py-1 text-[12px] font-semibold text-[#e0405a]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff5d6c]" /> Recording · on device
            </span>
            <span className="text-[13px] font-semibold ink-2">Acme weekly · Zoom</span>
            <span className="ml-auto text-[13px] tabular-nums mut">00:{String(12 + i * 7).padStart(2, "0")}</span>
          </div>
          <div className="mt-5 flex h-16 items-center gap-[3px]" aria-hidden>
            {BARS.map((h, k) => (
              <span key={k} className="flex-1 rounded-full transition-colors duration-700" style={{ height: `${h}%`, backgroundImage: k / BARS.length < (i + 1) / 5 ? "linear-gradient(180deg,#7a6cff,#2f8cff)" : "linear-gradient(rgb(20 40 80 / 0.1),rgb(20 40 80 / 0.1))" }} />
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[1.3fr_1fr]">
            <div className="g-inset space-y-3 rounded-[22px] p-4">
              {LINES.map((l, k) => (
                <motion.div key={k} initial={false} animate={{ opacity: i > k ? 1 : 0.25 }} transition={{ duration: 0.5 }} className="flex gap-3">
                  <span className="mt-0.5 h-6 shrink-0 rounded-full px-2.5 text-[11.5px] font-bold leading-6 text-white" style={{ background: l.c }}>
                    {l.who}
                  </span>
                  <p className="text-[14.5px] ink">{l.t}</p>
                </motion.div>
              ))}
            </div>
            <div className={`rounded-[22px] p-4 transition-all duration-700 ${i >= 4 ? "bg-[#0b1220] text-white" : "g-inset"}`}>
              <p className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider ${i >= 4 ? "text-[#c9b8ff]" : "fnt"}`}>
                <FileText size={14} /> {i >= 4 ? "Summary · ready" : "Summary after the call"}
              </p>
              {i >= 4 ? (
                <ul className="mt-3 space-y-2 text-[14px]">
                  <li className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 text-[#5fd3b0]" /> <span><b>You:</b> send Acme the homepage copy tonight</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 text-[#5fd3b0]" /> <span><b>Note:</b> Nimbus wants dark mode in v1</span>
                  </li>
                  <li className="mt-3 text-[12.5px] text-white/60">Action items saved to your to-dos.</li>
                </ul>
              ) : (
                <div className="mt-4 space-y-2">
                  {[80, 64, 72].map((w) => (
                    <span key={w} className="block h-2.5 rounded-full bg-black/[0.06]" style={{ width: `${w}%` }} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.08} className="mt-5 flex flex-wrap justify-center gap-2">
          {["Name a voice once and Flo remembers it", "Action items land in your to-dos", "Transcription happens on device"].map((t) => (
            <span key={t} className="chip2 cursor-default">
              <Check size={14} className="text-[#3fbf98]" /> {t}
            </span>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 11 Claude Code: a frosted terminal and an Allow / Deny card ──────────────────────── */

const SESSIONS = [
  { name: "flo-website", state: "Needs permission", c: "#ffb020" },
  { name: "api-server", state: "Running · 4m", c: "#2f8cff" },
  { name: "mobile", state: "Finished", c: "#3fbf98" },
];

export function ClaudeSection() {
  const [answer, setAnswer] = useState<"allow" | "deny" | null>(null);
  return (
    <Section id="claude">
      <div className="g relative overflow-hidden rounded-[40px] p-6 sm:p-10 md:p-14">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_0%_100%,rgba(255,200,170,0.5),transparent_70%),radial-gradient(50%_60%_at_100%_0%,rgba(190,210,255,0.6),transparent_70%)]" />
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Heading
              align="left"
              tag="11 · Claude Code in your notch"
              title="Stop babysitting terminals."
              accent="babysitting"
              lead="Your Claude Code sessions sit in the notch tray with a live count. When one finishes or needs your permission, the notch tells you. And it doesn't cry wolf: if Claude is still working, Flo waits."
            />
            <ul className="mt-7 space-y-2.5 text-[14.5px] font-medium ink-2">
              {["Allow or deny a permission ask from the notch", "Click to jump straight to that session", "Codex and Cursor sessions show up too"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3fbf98]" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <Reveal className="space-y-4">
            <div className="g-2 rounded-[24px] p-4 font-mono text-[12.5px]">
              <p className="flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-wider fnt">
                <Terminal size={13} /> Sessions
              </p>
              <ul className="mt-3 space-y-2">
                {SESSIONS.map((s) => (
                  <li key={s.name} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.c, boxShadow: `0 0 0 3px ${s.c}22` }} />
                    <span className="ink">{s.name}</span>
                    <span className="ml-auto fnt">{s.state}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hw-notch rounded-[26px] p-5" data-testid="permission-card">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d97757]/20">
                  <ClaudeMark size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold">Claude wants to run a command</p>
                  <p className="truncate text-[12px] text-white/55">flo-website · Bash · waiting 12s</p>
                </div>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-white/[0.07] px-3.5 py-2.5 font-mono text-[12.5px] text-white/85">npm run test -- --watch=false</pre>
              <div className="mt-4 flex gap-2">
                <AnimatePresence mode="wait">
                  {answer ? (
                    <motion.p key="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[13.5px] font-semibold">
                      <Check size={16} className={answer === "allow" ? "text-[#5fd3b0]" : "text-[#ff8fa3]"} />
                      {answer === "allow" ? "Allowed. Claude carries on." : "Denied. Claude will try another way."}
                      <button type="button" className="ml-2 text-[12px] font-medium text-white/50 underline" onClick={() => setAnswer(null)}>
                        Reset
                      </button>
                    </motion.p>
                  ) : (
                    <motion.div key="b" className="flex gap-2" exit={{ opacity: 0 }}>
                      <button type="button" onClick={() => setAnswer("allow")} className="rounded-full bg-white px-5 py-2 text-[13.5px] font-semibold text-black transition hover:bg-white/90" data-testid="allow">
                        Allow
                      </button>
                      <button type="button" onClick={() => setAnswer("deny")} className="rounded-full bg-white/10 px-5 py-2 text-[13.5px] font-semibold text-white transition hover:bg-white/15">
                        Deny
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-1 text-[13px] mut">
              <Wave bars={4} color="#7a6cff" on={false} /> Flo waits until background work is really done.
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
