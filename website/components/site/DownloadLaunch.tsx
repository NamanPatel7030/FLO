"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Download, MousePointerClick, ShieldCheck, X } from "lucide-react";
import { Mascot } from "./Mascot";
import { EASE, Wave } from "./ui";

/**
 * The download moment. Any link marked `data-launch="<platform label>"` opens this instead of
 * navigating straight away: the page frosts over, the notch drops from the top edge and grows into
 * a card with a live wave and a progress line, then the download starts. The card stays to show
 * the next steps (a file download doesn't leave the page; a sign-up redirect does).
 */
export function DownloadLaunch() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<{ href: string; label: string; phase: "go" | "done" } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[data-launch]") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      timers.current.forEach(clearTimeout);
      const href = a.href;
      setState({ href, label: a.dataset.launch || "your Mac", phase: "go" });
      // Phones (and reduced motion): start the download inside the tap itself. Mobile browsers,
      // Android Chrome especially, may drop a file download that starts after a delay.
      const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (phone || reduce) {
        window.location.assign(href);
        setState({ href, label: a.dataset.launch || "your Mac", phase: "done" });
        return;
      }
      const wait = 1500;
      timers.current = [
        setTimeout(() => window.location.assign(href), wait),
        setTimeout(() => setState((s) => (s ? { ...s, phase: "done" } : s)), wait + 700),
      ];
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      timers.current.forEach(clearTimeout);
    };
  }, [reduce]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && state.phase === "done" && setState(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const done = state?.phase === "done";
  return (
    <AnimatePresence>
      {state && (
        <motion.div
          key="launch"
          className="v2 fixed inset-0 z-[300] flex justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          role="dialog"
          aria-modal="true"
          aria-label={done ? "Your download has started" : `Getting Flo ready for ${state.label}`}
          data-testid="download-launch"
        >
          {/* the page frosts over */}
          <motion.div
            className="absolute inset-0"
            initial={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(244,246,251,0)" }}
            animate={{ backdropFilter: "blur(18px)", backgroundColor: "rgba(244,246,251,0.55)" }}
            transition={{ duration: 0.5 }}
            onClick={() => done && setState(null)}
          />
          {/* coloured light pouring out of the notch */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[70vh] w-[90vw] -translate-x-1/2"
            style={{ background: "radial-gradient(50% 60% at 50% 0%, rgba(122,108,255,0.35), rgba(47,140,255,0.18) 45%, transparent 75%)" }}
            initial={{ opacity: 0, scaleY: 0.3 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.9, ease: EASE }}
          />
          {/* the notch grows into the card */}
          <motion.div
            className="hw-notch relative mt-0 flex flex-col items-center overflow-hidden text-center"
            initial={{ width: 200, height: 34, borderRadius: "0 0 18px 18px" }}
            animate={
              reduce
                ? { width: "min(440px, 92vw)", height: done ? 330 : 270, borderRadius: "0 0 34px 34px" }
                : { width: ["200px", "260px", "min(440px, 92vw)"], height: [34, 34, done ? 330 : 270], borderRadius: ["0 0 18px 18px", "0 0 18px 18px", "0 0 34px 34px"] }
            }
            transition={{ duration: reduce ? 0 : 0.75, times: [0, 0.25, 1], ease: EASE }}
          >
            <motion.div className="flex w-full flex-1 flex-col items-center px-8 pt-9" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : 0.55, duration: 0.4 }}>
              <div className="relative">
                <motion.span
                  aria-hidden
                  className="absolute -inset-3 rounded-[22px]"
                  style={{ background: "conic-gradient(from 0deg, #2f8cff, #7a6cff, #ff7eb0, #ffb38a, #2f8cff)", filter: "blur(12px)" }}
                  animate={reduce || done ? { opacity: 0.55 } : { rotate: 360, opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                />
                <span className="relative block">
                  <Mascot mood={done ? "celebrate" : "excited"} size={64} />
                </span>
              </div>
              <AnimatePresence mode="wait">
                {done ? (
                  <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 w-full">
                    <p className="flex items-center justify-center gap-2 text-[19px] font-semibold">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#5fd3b0] text-[#05221a]">
                        <Check size={14} strokeWidth={3.5} />
                      </span>
                      Your download has started
                    </p>
                    <ul className="mt-5 space-y-2.5 text-left text-[13.5px] text-[rgba(255,255,255,0.75)]">
                      {state.label === "Android" ? (
                        <>
                          <li className="flex gap-2.5">
                            <Download size={15} className="mt-0.5 shrink-0 text-[#8fd0ff]" /> If Chrome asks, tap Download anyway. The file is about 30 MB.
                          </li>
                          <li className="flex gap-2.5">
                            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#c9b8ff]" /> Open it from your notifications or Files, Downloads, then allow installs from your browser.
                          </li>
                        </>
                      ) : (
                        <>
                          <li className="flex gap-2.5">
                            <Download size={15} className="mt-0.5 shrink-0 text-[#8fd0ff]" /> Open the .dmg and drag Flo into Applications.
                          </li>
                          <li className="flex gap-2.5">
                            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#c9b8ff]" /> First launch: System Settings, Privacy &amp; Security, Open Anyway.
                          </li>
                        </>
                      )}
                      <li className="flex gap-2.5">
                        <MousePointerClick size={15} className="mt-0.5 shrink-0 text-[#ff9ec4]" /> Sign in, hold control and talk.
                      </li>
                    </ul>
                    <button type="button" onClick={() => setState(null)} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.2)]" aria-label="Close">
                      <X size={15} />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="go" exit={{ opacity: 0 }} className="mt-5 flex w-full flex-col items-center">
                    <p className="text-[19px] font-semibold">
                      Getting Flo ready <span className="serif-i text-[22px] text-[#c9b8ff]">for {state.label}</span>
                    </p>
                    <div className="mt-4">
                      <Wave bars={9} color="#8fd0ff" />
                    </div>
                    <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]">
                      <motion.div
                        className="h-full origin-left rounded-full bg-gradient-to-r from-[#8fd0ff] via-[#b9a8ff] to-[#ff9ec4]"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: reduce ? 0 : 0.5, duration: reduce ? 0.1 : 1, ease: EASE }}
                      />
                    </div>
                    <p className="mt-3 text-[12px] text-[rgba(255,255,255,0.5)]">Signed and checked. Starting your download…</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
