"use client";

import { ArrowRight, Check, Hash, KeyRound, Lock, Monitor, MessageSquare, GripVertical, Video, Volume2, WifiOff } from "lucide-react";
import { LANGS, SIZES, SOUNDS, STYLES, type ChapterId } from "./chapters";
import { Caret, Keycap, Typewriter } from "./viz";

/** A small app window drawn in code: the "screen" the notch is acting on. */
function Win({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`stage-win overflow-hidden rounded-2xl ${className}`}>
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex items-center gap-1.5 text-[12px] text-white/50">
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
    <div className={`flex gap-2.5 rounded-xl p-1.5 transition-colors duration-500 ${hl ? "bg-brand-400/[0.09]" : ""}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-black" style={{ background: color }}>
        {who[0]}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-white/90">
          {who} <span className="ml-1 text-[11px] font-normal text-white/35">{time}</span>
        </div>
        <div className="text-[13.5px] leading-snug text-white/75">{text}</div>
      </div>
    </div>
  );
}

function Composer({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className={`mt-3 min-h-[64px] rounded-xl border px-3 py-2.5 text-[14px] leading-relaxed text-white/90 transition-colors duration-300 ${active ? "border-brand-300/50 bg-brand-400/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
      {children}
    </div>
  );
}

const DICTATED = "Shipped the new onboarding to staging. Can everyone test the signup flow before Friday and drop issues in this thread?";
const DRAFT =
  "Happy Dhanteras, team! Priya, Rahul and everyone, thank you for an amazing year so far. Kal 4 baje ke baad family ke saath time enjoy karo. May this festival bring good health and lots of wins.";

export function Stage({ id, phase, cycle, live }: { id: ChapterId; phase: number; cycle: number; live: boolean }) {
  switch (id) {
    case "dictation":
      return (
        <Win title="#launch" icon={<Hash size={12} />}>
          <Msg who="Aditi" color="#f5b3c8" time="10:02" text="Is the onboarding build up anywhere yet?" />
          <Composer active={phase === 0}>
            {phase === 2 ? (
              live ? <Typewriter key={cycle} text={DICTATED} speed={20} /> : DICTATED
            ) : (
              <span className="text-white/35">
                <Caret /> Message #launch
              </span>
            )}
          </Composer>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-white/45">
            <Keycap pressed={phase === 0}>fn</Keycap>
            {phase === 0 ? "held, listening…" : phase === 1 ? "released" : "typed where your cursor was"}
          </div>
        </Win>
      );

    case "languages": {
      const lang = LANGS[cycle % LANGS.length];
      return (
        <Win title="Notes" icon={<MessageSquare size={12} />}>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <span key={l.code} className={`rounded-full px-3 py-1 text-[13px] ring-1 transition-colors duration-300 ${l.code === lang.code ? "bg-brand-400/15 text-brand-100 ring-brand-300/40" : "text-white/45 ring-white/10"}`}>
                {l.name}
              </span>
            ))}
            <span className="rounded-full px-3 py-1 text-[13px] text-white/25 line-through ring-1 ring-white/5">اردو</span>
          </div>
          <Composer active={phase === 0}>
            <span lang={lang.code} className="text-[16px]">
              {phase === 2 ? live ? <Typewriter key={`${cycle}`} text={lang.text} speed={34} /> : lang.text : <span className="text-white/35"><Caret /> listening…</span>}
            </span>
          </Composer>
          <p className="mt-3 text-[12px] text-white/45">
            {phase === 2 ? `Detected ${lang.en} from your languages. Written in ${lang.en === "English" ? "Latin" : lang.en === "Hindi" ? "Devanagari" : "Gujarati"} script.` : "Choosing between Hindi, Gujarati and English…"}
          </p>
        </Win>
      );
    }

    case "assistant":
      return (
        <Win title="#team-general" icon={<Hash size={12} />}>
          <div className="flex flex-col gap-1">
            <Msg hl={phase === 1} who="Priya" color="#f59e9e" time="16:40" text="Kal Dhanteras hai! Office 4 baje band ho jayega 🎉" />
            <Msg hl={phase === 1} who="Rahul" color="#9ee2b8" time="16:42" text="Sweets ka order de diya hai, sab le jaana" />
          </div>
          <Composer active={phase === 2}>
            {phase === 2 ? (
              live ? <Typewriter key={cycle} text={DRAFT} speed={14} /> : DRAFT
            ) : (
              <span className="text-white/35">
                <Caret /> Message #team-general
              </span>
            )}
          </Composer>
        </Win>
      );

    case "learns":
      return (
        <div className="flex flex-col gap-3">
          <Win title="#eng" icon={<Hash size={12} />}>
            <div className="text-[15px] leading-relaxed text-white/85">
              Shipping the{" "}
              {phase === 0 ? (
                <span className="rounded bg-brand-400/30 px-0.5 underline decoration-red-400 decoration-wavy underline-offset-4">tory</span>
              ) : (
                <span className="rounded bg-brand-400/15 px-0.5 font-semibold text-brand-100">Tauri</span>
              )}{" "}
              build tonight.
            </div>
            <div className="mt-2 text-[12px] text-white/40">{phase === 0 ? "You fix the word Flo misheard…" : "…and Flo remembers it."}</div>
            {phase === 2 && (
              <div className="mt-3 border-t border-white/[0.07] pt-3 text-[15px] text-white/85">
                {live ? <Typewriter key={cycle} text="Tauri 2.1 is out, upgrading tomorrow." speed={30} /> : "Tauri 2.1 is out, upgrading tomorrow."}
              </div>
            )}
          </Win>
          <div className="stage-card rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300/80">Your dictionary</div>
            <div className="mt-2.5 flex flex-wrap gap-2 text-[13px]">
              {phase > 0 && <span className="chip-in rounded-full bg-brand-400/15 px-3 py-1 text-brand-100 ring-1 ring-brand-300/40">Tauri · just now</span>}
              {["Naman", "Supabase", "Dhanteras", "Kubernetes"].map((w) => (
                <span key={w} className="rounded-full px-3 py-1 text-white/60 ring-1 ring-white/10">
                  {w}
                </span>
              ))}
            </div>
          </div>
        </div>
      );

    case "todos": {
      const src = [
        { icon: Video, app: "Zoom · Design sync", quote: "“I'll send the Q3 deck tonight.”" },
        { icon: MessageSquare, app: "Slack · DM from Rahul", quote: "“Any update on the invoice?”" },
        { icon: Monitor, app: "On screen · GitHub", quote: "“Aditi requested your review on #482”" },
      ];
      return (
        <div className="flex flex-col gap-3">
          {src.map((s, i) => (
            <div key={s.app} className={`stage-card flex items-center gap-3 rounded-2xl p-3.5 transition-all duration-500 ${phase > 0 ? "opacity-100" : i === 0 ? "opacity-100" : "opacity-50"}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-brand-200 ring-1 ring-white/10">
                <s.icon size={16} />
              </span>
              <div className="min-w-0">
                <div className="text-[11.5px] text-white/45">{s.app}</div>
                <div className="truncate text-[14px] text-white/85">{s.quote}</div>
              </div>
              <span className={`ml-auto flex shrink-0 items-center gap-1 text-[12px] transition-opacity duration-500 ${phase > 0 ? "text-brand-200 opacity-100" : "opacity-0"}`}>
                <Check size={13} strokeWidth={3} /> To-do
              </span>
            </div>
          ))}
          <p className="px-1 text-[12px] text-white/40">Hover the to-do icon in the notch to open the list.</p>
        </div>
      );
    }

    case "deadlines":
      return (
        <div className="flex flex-col gap-3">
          <Win title="Client call · notes">
            <div className="flex flex-col gap-1.5 text-[14px] text-white/55">
              <p>Budget approved for phase one.</p>
              <p className={`rounded-lg px-1.5 py-0.5 transition-colors duration-500 ${phase === 0 ? "bg-brand-400/15 text-white" : "text-white/85"}`}>
                Client: send requirements <span className="font-semibold text-brand-200 underline decoration-brand-300/60 underline-offset-4">by next Monday</span>
              </p>
              <p>Design review moves to Thursday.</p>
            </div>
          </Win>
          <div className="stage-card rounded-2xl p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300/80">Flo reads deadlines like you do</div>
            <div className="mt-2 flex flex-col gap-1.5 text-[13.5px]">
              {[
                ["“by next Monday”", "Mon, 10:00"],
                ["“tomorrow at 5pm”", "Sun, 17:00"],
                ["“in 2 hours”", "Today, 12:40"],
              ].map(([a, b], i) => (
                <div key={a} className={`flex items-center gap-2 transition-opacity duration-500 ${i === 0 || phase > 0 ? "opacity-100" : "opacity-40"}`}>
                  <span className="text-white/75">{a}</span>
                  <ArrowRight size={13} className="text-white/30" />
                  <span className="font-mono text-[12.5px] text-brand-100">{b}</span>
                  <span className="ml-auto text-[11px] text-white/35">nudge 5 min early</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

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
                <span className="text-[12px] font-semibold" style={{ color: c }}>
                  {w}
                </span>
                <p className="text-[14px] leading-snug text-white/80">{t}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-white/[0.07] pt-3 text-[12px] text-white/45">
            {phase === 0 ? (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500" /> Transcribing on this Mac
              </>
            ) : (
              <>
                <Check size={13} className="text-brand-300" /> Summary and 3 action items ready
              </>
            )}
          </div>
        </Win>
      );
    }

    case "claude":
      return (
        <Win title="~/flo · claude" className="font-mono">
          <div className="flex flex-col gap-1 text-[12.5px] leading-relaxed">
            <span className="text-white/45">&gt; make the notch reminders snoozable</span>
            <span className="text-white/80">
              <span className="text-[#d97757]">●</span> Edited src/notch/reminder.rs
            </span>
            <span className="text-white/80">
              <span className="text-[#d97757]">●</span> Running tests in background (2 shells)
            </span>
            {phase === 0 ? (
              <span className="text-white/50">
                ◌ waiting for background shells… <span className="text-brand-300">Flo is waiting too</span>
              </span>
            ) : (
              <span className="text-[#9ee2b8]">✓ 142 tests passed · done</span>
            )}
            {phase === 2 && (
              <>
                <span className="mt-2 text-white/45">[api] &gt; publish the client</span>
                <span className="text-amber-200">? Allow Bash(npm publish)  [y/n]</span>
              </>
            )}
          </div>
        </Win>
      );

    case "widgets":
      return (
        <div className="stage-card rounded-2xl p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300/80">Widgets</div>
          <div className="mt-3 flex flex-col gap-1">
            {[
              ["Now Playing", true],
              ["Today's to-dos", true],
              ["Claude sessions", true],
              ["Weather", true],
              ["Calendar", false],
              ["Battery", false],
            ].map(([n, on]) => (
              <div key={n as string} className="flex items-center gap-3 rounded-xl px-2 py-2 text-[14px] hover:bg-white/[0.03]">
                <GripVertical size={14} className="text-white/25" />
                <span className={on ? "text-white/85" : "text-white/40"}>{n}</span>
                <span className={`ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? "bg-brand-400" : "bg-white/10"}`}>
                  <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case "custom":
      return (
        <div className="stage-card rounded-2xl p-5">
          <Label>Animation</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLES.map((s, i) => (
              <Pill key={s} on={i === phase}>
                {s}
              </Pill>
            ))}
            <Pill>+10 more</Pill>
          </div>
          <Label className="mt-5">Size</Label>
          <div className="mt-2 grid grid-cols-4 rounded-full bg-white/[0.04] p-1 ring-1 ring-white/10">
            {SIZES.map((s, i) => (
              <span key={s} className={`rounded-full py-1.5 text-center text-[12.5px] transition-colors duration-300 ${i === phase % 4 ? "bg-brand-400/20 text-brand-100" : "text-white/50"}`}>
                {s}
              </span>
            ))}
          </div>
          <Label className="mt-5">Sound</Label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {SOUNDS.map((s, i) => (
              <Pill key={s} on={i === phase % 4}>
                {i === phase % 4 && <Volume2 size={12} />} {s}
              </Pill>
            ))}
          </div>
          <Label className="mt-5">Colour</Label>
          <div className="mt-2 flex gap-2">
            {["#3dbbff", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"].map((c, i) => (
              <span key={c} className={`h-6 w-6 rounded-full ${i === 0 ? "ring-2 ring-white/80 ring-offset-2 ring-offset-black" : ""}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      );

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
              <p className="mt-1 text-[13px] leading-snug text-white/55">{c.b}</p>
            </div>
          ))}
        </div>
      );

    default:
      return null;
  }
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300/80 ${className}`}>{children}</div>;
}
function Pill({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] ring-1 transition-colors duration-300 ${on ? "bg-brand-400/15 text-brand-100 ring-brand-300/45" : "text-white/50 ring-white/10"}`}>
      {children}
    </span>
  );
}
