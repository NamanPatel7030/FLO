// The finale: a big handwritten "Naman" draws itself, stroke by stroke, with a glowing pen tip,
// then "Invented by Naman" settles under it. About three seconds, then Flo opens.
import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { SIGNATURE_PATH } from "../Signature";
import { LogoMark } from "../Logo";
import { EASE } from "./parts";

const [NAME, FLOURISH] = SIGNATURE_PATH.split(/\s(?=M)/);
const DRAW = [0.65, 0, 0.35, 1] as const;

/** Timeline (seconds). Exported so the caller and tests agree on the length. */
export const FINALE = { name: [0.45, 1.45], flourish: [1.85, 0.42], text: 2.05, end: 3.2 } as const;

export function Finale({ onEnd }: { onEnd: () => void }) {
  const reduce = useReducedMotion();
  const nameRef = useRef<SVGPathElement>(null);
  const p1 = useMotionValue(reduce ? 1 : 0);
  const p2 = useMotionValue(reduce ? 1 : 0);
  const tipX = useMotionValue(6);
  const tipY = useMotionValue(30);
  const tipO = useMotionValue(0);
  // a zero-length stroke still paints its round caps, so each stroke stays hidden until it starts
  const o1 = useTransform(p1, (v) => (v > 0.002 ? 1 : 0));
  const o2 = useTransform(p2, (v) => (v > 0.002 ? 1 : 0));
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const t = setTimeout(() => endRef.current(), (reduce ? 1.8 : FINALE.end) * 1000);
    if (reduce) return () => clearTimeout(t);
    const el = nameRef.current;
    const len = el?.getTotalLength() ?? 0;
    const follow = p1.on("change", (v) => {
      if (!el) return;
      const pt = el.getPointAtLength(v * len);
      tipX.set(pt.x);
      tipY.set(pt.y);
    });
    const a = [
      animate(tipO, 1, { delay: FINALE.name[0], duration: 0.15 }),
      animate(p1, 1, { delay: FINALE.name[0], duration: FINALE.name[1], ease: DRAW }),
      animate(tipO, 0, { delay: FINALE.name[0] + FINALE.name[1], duration: 0.25 }),
      animate(p2, 1, { delay: FINALE.flourish[0], duration: FINALE.flourish[1], ease: [0.4, 0, 0.2, 1] }),
    ];
    return () => {
      clearTimeout(t);
      follow();
      a.forEach((x) => x.stop());
    };
  }, [reduce, p1, p2, tipO, tipX, tipY]);

  return (
    <motion.div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
      data-testid="finale"
      role="status"
      aria-label="Invented by Naman"
      style={{
        background:
          "radial-gradient(60% 60% at 50% 50%, #ffffff 0%, rgb(255 255 255 / 0.6) 45%, transparent 80%), radial-gradient(700px 520px at 0% 0%, #cfe9ff, transparent 70%), radial-gradient(700px 520px at 100% 0%, #e6deff, transparent 70%), radial-gradient(700px 520px at 100% 100%, #d9f5ea, transparent 70%), radial-gradient(700px 520px at 0% 100%, #ffe3d6, transparent 70%), #f7f8fc",
      }}
    >
      <motion.div initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.15, duration: 0.6, ease: EASE }}>
        <LogoMark size={40} style={{ borderRadius: 11, filter: "drop-shadow(0 8px 18px rgb(122 108 255 / 0.35))" }} />
      </motion.div>

      <motion.svg
        viewBox="0 0 92 40"
        className="onb-sig-ink mt-6 w-[min(600px,64vw)] overflow-visible"
        initial={{ scale: 0.96 }}
        animate={{ scale: 1 }}
        transition={{ duration: FINALE.end, ease: "easeOut" }}
        aria-hidden
        data-testid="finale-signature"
      >
        <defs>
          <linearGradient id="onb-sig" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#2f8cff" />
            <stop offset="0.55" stopColor="#7a6cff" />
            <stop offset="1" stopColor="#c264ff" />
          </linearGradient>
          <radialGradient id="onb-tip">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.45" stopColor="#b9a8ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#7a6cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <motion.path ref={nameRef} d={NAME} fill="none" stroke="url(#onb-sig)" strokeWidth={1.05} strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: p1, opacity: o1 }} />
        {FLOURISH && <motion.path d={FLOURISH} fill="none" stroke="url(#onb-sig)" strokeWidth={0.85} strokeLinecap="round" style={{ pathLength: p2, opacity: o2 }} />}
        <motion.circle r={3.2} fill="url(#onb-tip)" style={{ cx: tipX, cy: tipY, opacity: tipO }} />
        <motion.circle r={0.9} fill="#ffffff" style={{ cx: tipX, cy: tipY, opacity: tipO }} />
      </motion.svg>

      <motion.div
        className="mt-7 flex flex-col items-center"
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: reduce ? 0 : FINALE.text, duration: 0.6, ease: EASE }}
      >
        <span className="relative text-[13px] font-semibold uppercase tracking-[0.32em] text-[#5b6678]">
          Invented by Naman
          {!reduce && <span aria-hidden className="onb-shine absolute inset-0 [animation-delay:2.35s]" />}
        </span>
      </motion.div>
    </motion.div>
  );
}
