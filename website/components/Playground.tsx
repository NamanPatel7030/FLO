"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownLeft, Hash, Mail, Send, Sparkles, SquareTerminal } from "lucide-react";

type AppId = "slack" | "gmail" | "vscode" | "terminal";
const APPS: { id: AppId; name: string; icon: typeof Hash; chip: string }[] = [
  { id: "slack", name: "Slack", icon: Hash, chip: "Sent to #launch" },
  { id: "gmail", name: "Gmail", icon: Mail, chip: "Draft ready" },
  { id: "vscode", name: "VS Code", icon: SquareTerminal, chip: "Inserted at cursor" },
  { id: "terminal", name: "Terminal", icon: SquareTerminal, chip: "Command ready" },
];
const TONES = ["Professional", "Friendly", "Short"] as const;
type Tone = (typeof TONES)[number];

const SAMPLE: Record<AppId, Record<Tone, string>> = {
  slack: {
    Professional: "Thanks for the update. I'll review the launch checklist today and flag any blockers by EOD.",
    Friendly: "On it! Giving the launch checklist a look now, will shout if anything's off 🙌",
    Short: "Reviewing the checklist now, will flag blockers by EOD.",
  },
  gmail: {
    Professional: "Hi Priya,\n\nThank you for the note. The onboarding flow is ready for review; I've attached the latest build and will walk you through it on our call.\n\nBest,\nNaman",
    Friendly: "Hi Priya,\n\nGood news — the onboarding is ready to look at! I'll attach the build and we can run through it on the call.\n\nCheers,\nNaman",
    Short: "Hi Priya — onboarding's ready for review. Build attached; let's walk it on the call. Thanks!",
  },
  vscode: {
    Professional: "// Debounce the resize handler so the notch only re-measures when the window settles\nconst onResize = debounce(measure, 120);",
    Friendly: "// quick one: debounce resize so we don't thrash on every pixel\nconst onResize = debounce(measure, 120);",
    Short: "const onResize = debounce(measure, 120);",
  },
  terminal: {
    Professional: "git switch -c feat/onboarding && git add -A && git commit -m 'feat: onboarding flow'",
    Friendly: "git switch -c feat/onboarding && git add -A && git commit -m 'feat: onboarding flow'",
    Short: "git commit -am 'feat: onboarding'",
  },
};

export function Playground() {
  const [app, setApp] = useState<AppId>("slack");
  const [tone, setTone] = useState<Tone>("Professional");
  const [prompt, setPrompt] = useState("Reply to Priya about the launch checklist");
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = () => {
    const full = SAMPLE[app][tone];
    setDone(false);
    setRunning(true);
    setOut("");
    let i = 0;
    timer.current && clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 2;
      setOut(full.slice(0, i));
      if (i >= full.length) {
        timer.current && clearInterval(timer.current);
        setRunning(false);
        setDone(true);
      }
    }, 18);
  };
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);
  useEffect(() => {
    setOut("");
    setDone(false);
  }, [app, tone]);

  const current = APPS.find((a) => a.id === app)!;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {APPS.map((a) => (
          <button
            key={a.id}
            onClick={() => setApp(a.id)}
            className={`relative rounded-full px-4 py-2 text-[13.5px] font-medium transition ${app === a.id ? "text-black" : "text-muted hover:text-ink"}`}
          >
            {app === a.id && <motion.span layoutId="pg-pill" className="absolute inset-0 rounded-full accent-bg" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className="relative flex items-center gap-1.5">
              <a.icon size={14} /> {a.name}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-full border border-white/10 p-1">
          {TONES.map((t) => (
            <button key={t} onClick={() => setTone(t)} className={`rounded-full px-3 py-1.5 text-[12.5px] transition ${tone === t ? "bg-white/10 text-ink" : "text-faint hover:text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        {/* instruction */}
        <div className="glass rounded-3xl p-5">
          <p className="eyebrow">You say</p>
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/10 bg-black/30 p-3.5">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-brand-300" />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint"
              aria-label="Instruction for Flo"
            />
          </div>
          <button onClick={run} disabled={running} className="btn btn-primary mt-3 w-full py-3 text-[14.5px] disabled:opacity-60">
            {running ? "Flo is working…" : <>Run in {current.name} <CornerDownLeft size={15} /></>}
          </button>
          <p className="mt-2 text-center text-[12px] text-faint">A preview. In the app, it types where your cursor is.</p>
        </div>

        {/* mock app */}
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b0f14]">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[12.5px] text-muted">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="ml-2 flex items-center gap-1.5">
              <current.icon size={13} /> {current.name}
            </span>
          </div>
          <div className="min-h-[180px] p-4">
            <AnimatePresence mode="wait">
              <motion.div key={app} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                {app === "gmail" && <div className="mb-2 text-[12px] text-faint">To: priya@team.com · Re: Launch checklist</div>}
                {app === "slack" && <div className="mb-2 flex items-center gap-1.5 text-[12px] text-faint"><Hash size={12} /> launch</div>}
                {(app === "vscode" || app === "terminal") && <div className="mb-2 text-[12px] text-faint">{app === "terminal" ? "~/flo — zsh" : "notch.ts — Flo"}</div>}
                <pre className={`whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink ${app === "vscode" || app === "terminal" ? "font-mono text-[13px]" : ""}`}>
                  {out}
                  {running && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] -translate-y-[2px] bg-brand-300 align-middle" style={{ animation: "flo-caret 1s steps(1) infinite" }} />}
                  {!out && !running && <span className="text-faint">Flo will type here…</span>}
                </pre>
                <AnimatePresence>
                  {done && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-300/15 px-3 py-1 text-[12px] text-brand-200">
                        <Check size={12} /> {current.chip}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[12px] text-muted">
                        <Send size={11} /> Added to-do: follow up
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
