"use client";

import { Fragment, useRef, useState } from "react";
import {
  AppWindow,
  ArrowRight,
  BookText,
  Check,
  ChevronDown,
  FileText,
  FolderKanban,
  GripVertical,
  Hash,
  KeyRound,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Mic,
  Monitor,
  MousePointerClick,
  Paperclip,
  Play,
  Plug,
  RotateCcw,
  Send,
  Square,
  Type,
  Video,
  Volume2,
  WifiOff,
  Zap,
} from "lucide-react";
import { AGENT, CHAPTER_INDEX, DEADLINES, FEATURED_STYLES, FILED, INSTANT, LANGS, PALETTES, PROJECTS, PROMPTS, SIZES, SKILLS, SOUNDS, STYLES, WIDGETS, type ChapterId } from "./chapters";
import { playSound } from "./sound";
import { useStory, type Derived } from "./StoryContext";
import { Caret, Keycap, StyleViz, Typewriter } from "./viz";

/** A small app window drawn in code: the "screen" the notch is acting on. */
function Win({ title, icon, children, className = "", hl }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string; hl?: boolean }) {
  return (
    <div className={`stage-win overflow-hidden rounded-2xl transition-shadow duration-500 ${hl ? "stage-hl" : ""} ${className}`}>
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex items-center gap-1.5 text-[12px] text-white/60">
          {icon}
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Msg({ who, color, text, time, hl }: { who: string; color: string; text: React.ReactNode; time: string; hl?: boolean }) {
  return (
    <div className={`flex gap-2.5 rounded-xl p-1.5 transition-colors duration-500 ${hl ? "bg-brand-400/[0.12]" : ""}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-black" style={{ background: color }}>
        {who[0]}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-white/90">
          {who} <span className="ml-1 text-[11px] font-normal text-white/45">{time}</span>
        </div>
        <div className="text-[13.5px] leading-snug text-white/80">{text}</div>
      </div>
    </div>
  );
}

function Composer({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className={`mt-3 min-h-[64px] rounded-xl border px-3 py-2.5 text-[14px] leading-relaxed text-white/90 transition-colors duration-300 ${active ? "border-brand-300/55 bg-brand-400/[0.08]" : "border-white/12 bg-white/[0.04]"}`}>
      {children}
    </div>
  );
}

/** Hint line under a stage, telling the visitor what they can poke. */
function Try({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-1.5 px-1 text-[12px] text-brand-100/80">
      <span className="try-dot" aria-hidden />
      {children}
    </p>
  );
}

const DICTATED = "Shipped the new onboarding to staging. Can everyone test the signup flow before Friday and drop issues in this thread?";

/** Press-and-hold button (pointer + Space/Enter). */
function HoldToTalk({ onDown, onUp, held }: { onDown: () => void; onUp: () => void; held: boolean }) {
  const down = useRef(false);
  const start = () => {
    if (down.current) return;
    down.current = true;
    onDown();
  };
  const end = () => {
    if (!down.current) return;
    down.current = false;
    onUp();
  };
  return (
    <button
      type="button"
      data-testid="hold-to-talk"
      aria-pressed={held}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") end();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`hold select-none ${held ? "is-held" : ""}`}
    >
      <span className="hold-ring" aria-hidden />
      <Mic size={16} />
      {held ? "Listening… let go to type" : "Hold to talk"}
    </button>
  );
}

export function Stage({ id, phase, cycle, live, d, manual }: { id: ChapterId; phase: number; cycle: number; live: boolean; d: Derived; manual: boolean }) {
  const { interact, setPhase, setDemo, play } = useStory();
  const ch = CHAPTER_INDEX[id];

  switch (id) {
    case "dictation": {
      const held = manual && phase === 0;
      return (
        <div>
          <Win title="#launch" icon={<Hash size={12} />}>
            <Msg who="Aditi" color="#f5b3c8" time="10:02" text="Is the onboarding build up anywhere yet?" />
            <Composer active={phase === 0}>
              {phase === 2 ? (
                live ? <Typewriter key={cycle} text={DICTATED} speed={20} /> : DICTATED
              ) : (
                <span className="text-white/45">
                  <Caret /> Message #launch
                </span>
              )}
            </Composer>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[12px] text-white/60">
                <Keycap pressed={phase === 0}>control</Keycap>
                {phase === 0 ? "held, listening…" : phase === 1 ? "released" : "typed where your cursor was"}
              </span>
              <HoldToTalk
                held={held}
                onDown={() => {
                  interact(ch, 60_000);
                  setPhase(ch, 0, true);
                }}
                onUp={() => play(ch, [[1, 900], [2]])}
              />
            </div>
          </Win>
          <Try>Press and hold the button, like holding Control, then let go.</Try>
        </div>
      );
    }

    case "languages": {
      const lang = LANGS[d.lang % LANGS.length];
      return (
        <div>
          <Win title="Notes" icon={<MessageSquare size={12} />}>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Language to speak">
              {LANGS.map((l, k) => (
                <button
                  type="button"
                  key={l.code}
                  role="radio"
                  aria-checked={k === d.lang}
                  data-testid={`lang-${l.code}`}
                  onClick={() => {
                    setDemo({ lang: k });
                    play(ch, [[0, 900], [1, 700], [2]]);
                  }}
                  className="chip text-[13px]"
                >
                  {l.name}
                </button>
              ))}
              <span className="rounded-full px-3 py-1 text-[13px] text-white/35 line-through ring-1 ring-white/10" title="Hindi is never mistaken for Urdu">
                اردو
              </span>
            </div>
            <Composer active={phase === 0}>
              <span lang={lang.code} className="text-[16px]">
                {phase === 2 ? (
                  live ? (
                    <Typewriter key={`${cycle}-${lang.code}`} text={lang.text} speed={34} />
                  ) : (
                    lang.text
                  )
                ) : (
                  <span className="text-white/45">
                    <Caret /> listening…
                  </span>
                )}
              </span>
            </Composer>
            <p className="mt-3 text-[12px] text-white/60">
              {phase === 2 ? `Detected ${lang.en} from your languages. Written in ${lang.en === "English" ? "Latin" : lang.en === "Hindi" ? "Devanagari" : "Gujarati"} script.` : "Choosing between Hindi, Gujarati and English…"}
            </p>
          </Win>
          <Try>Tap a language and speak it to Flo.</Try>
        </div>
      );
    }

    case "assistant": {
      const pr = PROMPTS[d.prompt];
      return (
        <div>
          <Win title="#team-general" icon={<Hash size={12} />}>
            <div className="flex flex-col gap-1">
              <Msg hl={phase === 1} who="Priya" color="#f59e9e" time="16:40" text="Kal Dhanteras hai! Office 4 baje band ho jayega 🎉" />
              <Msg hl={phase === 1} who="Rahul" color="#9ee2b8" time="16:42" text="Sweets ka order de diya hai, sab le jaana" />
            </div>
            <Composer active={phase === 2}>
              {phase === 2 ? (
                live ? <Typewriter key={`${cycle}-${d.prompt}`} text={pr.draft} speed={14} /> : pr.draft
              ) : (
                <span className="text-white/45">
                  <Caret /> Message #team-general
                </span>
              )}
            </Composer>
          </Win>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Try saying">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">Try saying</span>
            {PROMPTS.map((p, k) => (
              <button
                type="button"
                key={p.say}
                aria-pressed={manual && k === d.prompt}
                data-testid={`prompt-${k}`}
                onClick={() => {
                  setDemo({ prompt: k });
                  play(ch, [[0, 2200], [1, 1800], [2]]);
                }}
                className="chip"
              >
                <Play size={11} className="opacity-70" /> “{p.say}”
              </button>
            ))}
          </div>
        </div>
      );
    }

    case "skills":
      return <SkillCanvas ch={ch} phase={phase} cycle={cycle} d={d} manual={manual} />;

    case "agent": {
      const ask = phase === 2 && d.agent === "ask";
      const filled = phase >= 1;
      return (
        <div>
          <Win title="Mail · New message" icon={<Mail size={12} />} hl={ask}>
            <div className="flex flex-col gap-2 text-[13.5px]">
              <div className="flex items-center gap-2 border-b border-white/[0.07] pb-2">
                <span className="w-14 shrink-0 text-white/45">To</span>
                {filled ? (
                  <span key={`to-${cycle}`} className="chip-in rounded-full bg-brand-400/15 px-2.5 py-0.5 text-brand-100 ring-1 ring-brand-300/30" style={{ animationDelay: phase === 1 ? "0.9s" : "0s" }}>
                    Priya Shah
                  </span>
                ) : (
                  <span className="text-white/35">
                    <Caret />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 border-b border-white/[0.07] pb-2">
                <span className="w-14 shrink-0 text-white/45">Subject</span>
                {filled && (
                  <span key={`su-${cycle}`} className="chip-in text-white/90" style={{ animationDelay: phase === 1 ? "1.7s" : "0s" }}>
                    Q3 deck
                  </span>
                )}
              </div>
              <div className="min-h-[44px] text-white/80">
                {filled && (
                  <span key={`bo-${cycle}`} className="chip-in block" style={{ animationDelay: phase === 1 ? "2s" : "0s" }}>
                    Hi Priya, here&apos;s the Q3 deck we went through this morning.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="relative">
                  {filled && (
                    <span key={`at-${cycle}`} className="chip-in inline-flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 py-1 text-[12px] text-white/85 ring-1 ring-white/12" style={{ animationDelay: phase === 1 ? "2.6s" : "0s" }}>
                      <Paperclip size={12} /> Q3-deck.pdf
                    </span>
                  )}
                  {phase === 1 && <Cursor key={`c1-${cycle}`} className="pointer-in-late absolute left-16 top-3" />}
                </span>
                <span className="relative">
                  <span
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold transition-colors ${
                      phase === 2 && d.agent === "yes" ? "bg-emerald-400/90 text-[#00140a]" : ask ? "agent-send bg-gradient-to-b from-brand-200 to-brand-400 text-[#001522]" : "bg-white/[0.1] text-white/70"
                    }`}
                  >
                    {phase === 2 && d.agent === "yes" ? (
                      <>
                        <Check size={13} strokeWidth={3} /> Sent
                      </>
                    ) : phase === 2 && d.agent === "no" ? (
                      "Kept as draft"
                    ) : (
                      <>
                        <Send size={12} /> Send
                      </>
                    )}
                  </span>
                  {ask && <Cursor key={`c2-${cycle}`} className="pointer-in absolute left-10 top-4" />}
                </span>
              </div>
            </div>
          </Win>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Agent controls">
            {ask ? (
              <>
                <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">Say it</span>
                <button
                  type="button"
                  className="chip"
                  data-testid="stage-agent-yes"
                  onClick={() => {
                    interact(ch);
                    setDemo({ agent: "yes" });
                  }}
                >
                  <Mic size={11} /> “Yes”
                </button>
                <button
                  type="button"
                  className="chip"
                  data-testid="stage-agent-no"
                  onClick={() => {
                    interact(ch);
                    setDemo({ agent: "no" });
                  }}
                >
                  <Mic size={11} /> “No”
                </button>
              </>
            ) : (
              <button
                type="button"
                className="chip"
                data-testid="agent-run"
                onClick={() => {
                  setDemo({ agent: "ask", instant: -1 });
                  play(ch, [[0, 2600], [1, 4200], [2]]);
                }}
              >
                <Play size={11} className="opacity-70" /> “{AGENT.say}”
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Instant commands">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">Instant</span>
            {INSTANT.map((x, k) => (
              <button
                type="button"
                key={x.say}
                aria-pressed={manual && phase === 0 && d.instant === k}
                data-testid={`instant-${k}`}
                onClick={() => {
                  setDemo({ instant: k });
                  interact(ch);
                  setPhase(ch, 0, true);
                }}
                className="chip"
              >
                <Zap size={11} className="opacity-70" /> “{x.say}”
              </button>
            ))}
          </div>
        </div>
      );
    }

    case "projects": {
      const cur = d.project % FILED.length;
      const filedUpTo = phase >= 1 ? cur : cur - 1;
      const base = [4, 2, 3];
      const counts = PROJECTS.map((_, p) => base[p] + FILED.filter((f, k) => k <= filedUpTo && f.to === p).length);
      return (
        <div className="flex flex-col gap-3">
          <div className="stage-card rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200/90">Captured today · tap one to file it</div>
            <div className="mt-2 flex flex-col gap-1">
              {FILED.map((f, k) => {
                const on = k === cur;
                const filed = k <= filedUpTo;
                const pj = PROJECTS[f.to];
                return (
                  <button
                    type="button"
                    key={f.text}
                    data-testid={`file-${k}`}
                    aria-pressed={on}
                    onClick={() => {
                      setDemo({ project: k });
                      play(ch, [[0, 1500], [1, 2800], [2]]);
                    }}
                    className={`row-btn flex items-center gap-3 rounded-xl px-2.5 py-2 text-left ${on ? "is-on" : ""}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-brand-200 ring-1 ring-white/10">
                      {f.kind === "Note" ? <FileText size={14} /> : <ListChecks size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-white/90">{f.text}</span>
                      <span className="block truncate text-[11px] text-white/50">{f.from}</span>
                    </span>
                    <span
                      className={`spk flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all duration-500 ${filed ? "opacity-100" : "translate-x-1 opacity-0"}`}
                      style={{ ["--spk" as string]: pj.color, background: `color-mix(in srgb, ${pj.color} 14%, transparent)` }}
                    >
                      <ArrowRight size={11} /> {pj.client || pj.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PROJECTS.map((p, k) => {
              const hit = phase >= 1 && FILED[cur].to === k;
              return (
                <div key={p.name} className={`stage-card relative min-w-0 rounded-2xl p-3 transition-transform duration-500 ${hit ? "stage-hl -translate-y-0.5" : ""}`}>
                  <FolderKanban size={15} className="spk" style={{ ["--spk" as string]: p.color }} />
                  <div className="mt-2 truncate text-[13px] font-semibold">{p.client || "Personal"}</div>
                  <div className="truncate text-[11px] text-white/55">{p.client ? p.name : "No client"}</div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-display text-[20px] font-semibold tabular-nums">{counts[k]}</span>
                    <span className="text-[11px] text-white/50">items</span>
                  </div>
                  {hit && (
                    <span key={`${cur}-${cycle}`} className="chip-in absolute right-2.5 top-2.5 rounded-full bg-brand-400/20 px-1.5 text-[10.5px] font-semibold text-brand-100">
                      +1
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "learns": {
      const fixed = phase > 0 && d.learned !== "undone";
      return (
        <div className="flex flex-col gap-3">
          <Win title="#eng" icon={<Hash size={12} />}>
            <div className="text-[15px] leading-relaxed text-white/90">
              Shipping the{" "}
              {phase === 0 ? (
                <button
                  type="button"
                  data-testid="fix-word"
                  onClick={() => play(ch, [[1]])}
                  className="cursor-pointer rounded bg-brand-400/30 px-0.5 underline decoration-red-400 decoration-wavy underline-offset-4 transition-colors hover:bg-brand-400/45"
                  title="Fix this word"
                >
                  tory
                </button>
              ) : fixed ? (
                <span className="rounded bg-brand-400/15 px-0.5 font-semibold text-brand-100">Tauri</span>
              ) : (
                <span className="px-0.5">tory</span>
              )}{" "}
              build tonight.
            </div>
            <div className="mt-2 text-[12px] text-white/55">
              {phase === 0 ? "Click the misheard word to fix it, like you would after dictating…" : phase === 1 ? "…Flo noticed. Undo or keep it, right in the notch." : d.learned === "undone" ? "Undone. Nothing was learned." : "…and Flo remembers it."}
            </div>
            {phase === 2 && d.learned !== "undone" && (
              <div className="mt-3 border-t border-white/[0.08] pt-3 text-[15px] text-white/90">
                {live ? <Typewriter key={cycle} text="Tauri 2.1 is out, upgrading tomorrow." speed={30} /> : "Tauri 2.1 is out, upgrading tomorrow."}
              </div>
            )}
            {phase === 2 && manual && (
              <button
                type="button"
                onClick={() => {
                  setDemo({ learned: "pending" });
                  interact(ch);
                  setPhase(ch, 0, true);
                }}
                className="chip mt-3"
              >
                <RotateCcw size={12} /> Try again
              </button>
            )}
          </Win>
          <div className="stage-card rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200/90">Your dictionary</div>
            <div className="mt-2.5 flex flex-wrap gap-2 text-[13px]">
              {fixed && <span className="chip-in rounded-full bg-brand-400/20 px-3 py-1 text-brand-100 ring-1 ring-brand-300/45">Tauri · just now</span>}
              {["Naman", "Supabase", "Dhanteras", "Kubernetes"].map((w) => (
                <span key={w} className="rounded-full px-3 py-1 text-white/70 ring-1 ring-white/12">
                  {w}
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case "todos": {
      const src = [
        { icon: Video, app: "Zoom · Design sync", quote: "“I'll send the Q3 deck tonight.”" },
        { icon: MessageSquare, app: "Slack · DM from Rahul", quote: "“Any update on the invoice?”" },
        { icon: Monitor, app: "On screen · GitHub", quote: "“Aditi requested your review on #482”" },
      ];
      return (
        <div className="flex flex-col gap-3">
          {src.map((s, i) => (
            <button
              type="button"
              key={s.app}
              onClick={() => {
                interact(ch);
                setPhase(ch, 1);
              }}
              className={`stage-card stage-press flex items-center gap-3 rounded-2xl p-3.5 text-left transition-all duration-500 ${phase > 0 || i === 0 ? "opacity-100" : "opacity-60"}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-brand-200 ring-1 ring-white/12">
                <s.icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] text-white/55">{s.app}</span>
                <span className="block truncate text-[14px] text-white/90">{s.quote}</span>
              </span>
              <span className={`ml-auto flex shrink-0 items-center gap-1 text-[12px] transition-opacity duration-500 ${phase > 0 ? "text-brand-200 opacity-100" : "opacity-0"}`}>
                <Check size={13} strokeWidth={3} /> {d.todos[i] ? "Done" : "To-do"}
              </span>
            </button>
          ))}
          <Try>Hover or tap the to-do icon in the notch to open the list, then tick items off.</Try>
        </div>
      );
    }

    case "deadlines": {
      const dl = DEADLINES[d.deadline];
      return (
        <div className="flex flex-col gap-3">
          <Win title="Client call · notes">
            <div className="flex flex-col gap-1.5 text-[14px] text-white/65">
              <p>Budget approved for phase one.</p>
              <p className={`rounded-lg px-1.5 py-0.5 transition-colors duration-500 ${phase === 0 ? "bg-brand-400/15 text-white" : "text-white/90"}`}>
                Client: send requirements <span className="font-semibold text-brand-200 underline decoration-brand-300/60 underline-offset-4">{dl.say}</span>
              </p>
              <p>Design review moves to Thursday.</p>
            </div>
          </Win>
          <div className="stage-card rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200/90">Pick a deadline. Flo reads it like you do</div>
            <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="Deadline phrase">
              {DEADLINES.map((x, i) => {
                const on = i === d.deadline;
                return (
                  <button
                    type="button"
                    key={x.say}
                    role="radio"
                    aria-checked={on}
                    data-testid={`deadline-${i}`}
                    onClick={() => {
                      setDemo({ deadline: i, reminder: "ring" });
                      play(ch, [[0, 1000], [1, 1900], [2]]);
                    }}
                    className={`row-btn flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13.5px] ${on ? "is-on" : ""}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-brand-300 bg-brand-300 text-[#001522]" : "border-white/35"}`}>{on && <Check size={9} strokeWidth={3.5} />}</span>
                    <span className="text-white/90">“{x.say}”</span>
                    <ArrowRight size={13} className="text-white/40" />
                    <span className="font-mono text-[12.5px] text-brand-100">{x.due}</span>
                    <span className="ml-auto hidden text-[11px] text-white/50 sm:inline">nudge at {x.ring}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    case "meetings": {
      const lines = [
        ["Priya", "#f59e9e", "I'll finish the onboarding deck by Thursday."],
        ["Rahul", "#9ee2b8", "API timeline is almost done, I'll share it Friday."],
        ["You", "#66ceff", "And I'll send the client the requirements before Monday."],
      ];
      return (
        <Win title="Design sync · live transcript" icon={<Video size={12} />}>
          <div className="flex flex-col gap-2.5">
            {lines.map(([w, c, t], i) => (
              <div key={`${cycle}-${w}`} className={live && phase === 0 ? "line-in" : ""} style={{ animationDelay: `${0.3 + i * 1.1}s` }}>
                <span className="spk text-[12px] font-semibold" style={{ ["--spk" as string]: c }}>
                  {w}
                </span>
                <p className="text-[14px] leading-snug text-white/85">{t}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3 text-[12px] text-white/60">
            {phase === 0 ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Transcribing on this Mac
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Check size={13} className="text-brand-300" /> Summary and 3 action items ready
              </span>
            )}
            <button
              type="button"
              data-testid="rec-toggle"
              onClick={() => {
                interact(ch);
                setPhase(ch, phase === 0 ? 1 : 0, phase !== 0);
              }}
              className={`rec-pill ${phase === 0 ? "is-rec" : ""}`}
            >
              {phase === 0 ? <Square size={10} className="fill-current" /> : <span className="h-2.5 w-2.5 rounded-full bg-red-500" />}
              {phase === 0 ? "Stop recording" : "Start recording"}
            </button>
          </div>
        </Win>
      );
    }

    case "claude":
      return (
        <div>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-full bg-white/[0.05] p-1 ring-1 ring-white/12" role="tablist" aria-label="Claude session state">
            {["Running", "Finished", "Needs you"].map((t, k) => (
              <button
                type="button"
                key={t}
                role="tab"
                aria-selected={phase === k}
                data-testid={`claude-tab-${k}`}
                onClick={() => {
                  setDemo({ claude: "ask", opened: false });
                  interact(ch);
                  setPhase(ch, k);
                }}
                className={`seg ${phase === k ? "is-on" : ""}`}
              >
                {t}
              </button>
            ))}
          </div>
          <Win title={`~/flo · claude${d.opened && phase === 1 ? " · focused" : ""}`} className="island term font-mono" hl={d.opened && phase === 1}>
            <div className="flex flex-col gap-1 text-[12.5px] leading-relaxed">
              <span className="text-white/55">&gt; make the notch reminders snoozable</span>
              <span className="text-white/85">
                <span className="text-[#d97757]">●</span> Edited src/notch/reminder.rs
              </span>
              <span className="text-white/85">
                <span className="text-[#d97757]">●</span> Running tests in background (2 shells)
              </span>
              {phase === 0 ? (
                <span className="text-white/60">
                  ◌ waiting for background shells… <span className="text-brand-300">Flo is waiting too</span>
                </span>
              ) : (
                <span className="text-[#9ee2b8]">✓ 142 tests passed · done</span>
              )}
              {phase === 2 && (
                <>
                  <span className="mt-2 text-white/55">[api] &gt; publish the client</span>
                  {d.claude === "ask" && <span className="text-amber-200">? Allow Bash(npm publish)  [y/n]</span>}
                  {d.claude === "allowed" && (
                    <>
                      <span className="text-[#9ee2b8]">✓ Allowed from the notch</span>
                      <span className="chip-in text-white/85">+ flo-client@1.4.0 published</span>
                    </>
                  )}
                  {d.claude === "denied" && <span className="text-red-300">✗ Denied from the notch · Claude is trying another way</span>}
                </>
              )}
            </div>
          </Win>
          <Try>{phase === 2 && d.claude === "ask" ? "Allow or deny it from the notch." : "Switch states above, then answer Claude from the notch."}</Try>
        </div>
      );

    case "widgets":
      return (
        <div className="stage-card rounded-2xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200/90">Widgets · tap to toggle</div>
          <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
            {WIDGETS.map((n, i) => {
              const on = d.widgets[i];
              return (
                <button
                  type="button"
                  key={n}
                  role="switch"
                  aria-checked={on}
                  data-testid={`widget-${i}`}
                  onClick={() => {
                    interact(ch);
                    setDemo((x) => ({ widgets: x.widgets.map((v, k) => (k === i ? !v : v)) }));
                  }}
                  className="row-btn flex items-center gap-3 rounded-xl px-2 py-2 text-left text-[14px]"
                >
                  <GripVertical size={14} className="text-white/35" />
                  <span className={`truncate ${on ? "text-white/90" : "text-white/55"}`}>{n}</span>
                  <span className={`ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? "bg-brand-400" : "bg-white/15"}`}>
                    <span className={`h-4 w-4 rounded-full bg-[#fff] shadow transition-transform ${on ? "translate-x-4" : ""}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );

    case "custom":
      return <Customise ch={ch} d={d} manual={manual} />;

    case "privacy":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: Lock, t: "Encrypted on disk", b: "History, notes and to-dos live in an encrypted database. The key sits in your Keychain." },
            { icon: KeyRound, t: "Bring your own key", b: "Claude, OpenAI, Gemini, Groq and more. You pay them directly, we never proxy." },
            { icon: WifiOff, t: "Fully local mode", b: "Run dictation and the assistant with Ollama or LM Studio. No internet needed." },
            { icon: Monitor, t: "See every request", b: "The network log shows each call: which host, why, and how many tokens." },
          ].map((c) => (
            <div key={c.t} className="stage-card rounded-2xl p-4">
              <c.icon size={18} className="text-brand-300" />
              <div className="mt-2.5 text-[14.5px] font-semibold">{c.t}</div>
              <p className="mt-1 text-[13px] leading-snug text-white/70">{c.b}</p>
            </div>
          ))}
          <p className="flex items-center gap-1.5 px-1 text-[12px] text-brand-100/80 sm:col-span-2">
            <span className="try-dot" aria-hidden />
            Hover a host in the notch to see why it&apos;s allowed.
          </p>
        </div>
      );

    default:
      return null;
  }
}

/** Chapter 10: real controls for the notch's look and sound. */
function Customise({ ch, d, manual }: { ch: number; d: Derived; manual: boolean }) {
  const { interact, setDemo } = useStory();
  const [more, setMore] = useState(false);
  const pick = (patch: Partial<{ style: number; size: number; sound: number; color: number }>) => {
    interact(ch);
    // start from what's on screen right now so taking over never jumps
    setDemo({ custom: { style: d.style, size: d.size, sound: d.sound, color: d.color, ...patch } });
  };
  const styles = more ? STYLES.map((_, i) => i) : STYLES.slice(0, FEATURED_STYLES).map((_, i) => i);
  const pal = PALETTES[d.color];
  return (
    <div className="stage-card rounded-2xl p-5" data-testid="customise">
      <div
        className="island mb-4 flex h-12 items-center gap-3 rounded-full bg-black px-4 shadow-[inset_0_-1px_0_rgb(150_220_255/0.2),0_10px_30px_-12px_rgb(0_0_0/0.9)]"
        style={{ ["--vh" as string]: pal.hi, ["--va" as string]: pal.a, ["--vb" as string]: pal.b }}
        aria-label={`Preview: ${STYLES[d.style]}, ${SIZES[d.size]}, ${pal.name}`}
        data-testid="custom-preview"
        data-style={STYLES[d.style]}
      >
        <Mic size={14} style={{ color: pal.a }} className="shrink-0" />
        <div className="flex flex-1 justify-center overflow-hidden" key={d.style}>
          <StyleViz style={d.style} w={200} h={28} />
        </div>
        <span className="shrink-0 text-[10.5px] text-white/60">{manual ? "Your notch" : "Preview"}</span>
      </div>

      <Label>Animation</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        {styles.map((i) => (
          <button type="button" key={STYLES[i]} aria-pressed={i === d.style} onClick={() => pick({ style: i })} className="chip" data-testid={`style-${i}`}>
            {STYLES[i]}
          </button>
        ))}
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="chip chip-ghost" data-testid="style-more">
          {more ? "Show fewer" : `+${STYLES.length - FEATURED_STYLES} more`}
          <ChevronDown size={12} className={`transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
      </div>
      <Label className="mt-5">Size</Label>
      <div className="mt-2 grid grid-cols-4 gap-1 rounded-full bg-white/[0.05] p-1 ring-1 ring-white/12" role="radiogroup" aria-label="Notch size">
        {SIZES.map((s, i) => (
          <button type="button" key={s} role="radio" aria-checked={i === d.size} onClick={() => pick({ size: i })} className={`seg ${i === d.size ? "is-on" : ""}`} data-testid={`size-${i}`}>
            {s}
          </button>
        ))}
      </div>
      <Label className="mt-5">Sound · tap to hear</Label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {SOUNDS.map((s, i) => (
          <button
            type="button"
            key={s}
            aria-pressed={i === d.sound}
            onClick={() => {
              pick({ sound: i });
              playSound(i);
            }}
            className="chip"
            data-testid={`sound-${i}`}
          >
            <Volume2 size={12} className={i === d.sound ? "" : "opacity-50"} /> {s}
          </button>
        ))}
      </div>
      <Label className="mt-5">Colour</Label>
      <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Notch colour">
        {PALETTES.map((c, i) => (
          <button
            type="button"
            key={c.name}
            role="radio"
            aria-checked={i === d.color}
            aria-label={c.name}
            title={c.name}
            onClick={() => pick({ color: i })}
            className={`h-7 w-7 cursor-pointer rounded-full transition-transform hover:scale-110 ${i === d.color ? "ring-2 ring-white/90 ring-offset-2 ring-offset-[var(--ring-offset)]" : "ring-1 ring-white/20"}`}
            style={{ background: c.swatch }}
            data-testid={`color-${i}`}
          />
        ))}
      </div>
    </div>
  );
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-200/90 ${className}`}>{children}</div>;
}

/** A mini skill canvas: Trigger → Steps → Output down the left, Platform / MCP / Knowledge nodes attached on the right. */
function SkillCanvas({ ch, phase, cycle, d, manual }: { ch: number; phase: number; cycle: number; d: Derived; manual: boolean }) {
  const { play, setDemo } = useStory();
  const sk = SKILLS[d.skill % SKILLS.length];
  const ATTACH_ICON = { platform: <AppWindow size={13} />, mcp: <Plug size={13} />, doc: <BookText size={13} /> } as const;
  const ATTACH_SUB = { platform: "Platform", mcp: "MCP tool", doc: "Knowledge" } as const;
  // lit: 0 = idle, 1 = running now (staggered), 2 = done
  const lit = (row: number) => (phase === 2 ? 2 : phase === 1 ? (row === 0 ? 2 : 1) : row === 0 ? 1 : 0);
  const rows: { kind: "trigger" | "step" | "output"; sub: string; label: string; icon: React.ReactNode; attach?: (typeof sk.attach)[number] }[] = [
    { kind: "trigger", sub: "Trigger", label: `“${sk.say}”`, icon: <Mic size={13} /> },
    ...sk.steps.map((st, k) => ({ kind: "step" as const, sub: `Step ${k + 1}`, label: st, icon: <span className="text-[11px] font-bold">{k + 1}</span>, attach: sk.attach[k] })),
    { kind: "output", sub: `Output · ${sk.mode}`, label: sk.out, icon: sk.mode === "Do" ? <MousePointerClick size={13} /> : <Type size={13} /> },
  ];
  return (
    <div>
      <div className="stage-card canvas-grid relative overflow-hidden rounded-2xl p-4" data-testid="skill-canvas">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-white/60">
          <Zap size={13} className="text-brand-300" /> Skill canvas · <span className="text-white/90">{sk.name}</span>
          <span className="ml-auto rounded-full bg-white/[0.07] px-2 py-0.5 text-[10.5px] text-white/70 ring-1 ring-white/12">{sk.mode} mode</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-5 gap-y-3" key={`${sk.name}-${cycle}`}>
          {rows.map((r, i) => (
            <Fragment key={r.sub}>
              <div className={`cnode cnode-${r.kind} ${i < rows.length - 1 ? "cnode-link" : ""}`} data-lit={lit(i)} style={{ ["--d" as string]: `${(i - 1) * 0.75}s` }}>
                <span className="cnode-ico">{r.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{r.sub}</span>
                  <span className="block text-[12.5px] leading-tight text-white/90">{r.label}</span>
                </span>
              </div>
              {r.attach ? (
                <div className={`cnode cnode-att cnode-${r.attach[0]}`} data-lit={lit(i)} style={{ ["--d" as string]: `${(i - 1) * 0.75 + 0.3}s` }}>
                  <span className="cnode-ico">{ATTACH_ICON[r.attach[0]]}</span>
                  <span className="min-w-0">
                    <span className="block text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{ATTACH_SUB[r.attach[0]]}</span>
                    <span className="block truncate text-[12px] leading-tight text-white/85">{r.attach[1]}</span>
                  </span>
                </div>
              ) : (
                <div aria-hidden />
              )}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Run a skill">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-200/80">Run a skill</span>
        {SKILLS.map((s, k) => (
          <button
            type="button"
            key={s.name}
            aria-pressed={manual && k === d.skill % SKILLS.length}
            data-testid={`skill-${k}`}
            onClick={() => {
              setDemo({ skill: k });
              play(ch, [[0, 2000], [1, 3600], [2]]);
            }}
            className="chip"
          >
            <Play size={11} className="opacity-70" /> {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Cursor({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" className={`pointer-events-none ${className}`} aria-hidden>
      <path d="M1 1l0 15 4-4 3 7 3-1.4-3-6.6h5.5z" fill="#fff" stroke="#0b1220" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
