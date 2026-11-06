"use client";

import { useEffect, useRef } from "react";

/**
 * A fading light trail that follows the cursor — a soundwave made of motion. One rAF loop,
 * canvas, pointer-events none, disabled on touch / reduced-motion, paused when the tab is hidden.
 */
export function DictationTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (coarse || reduce) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    type P = { x: number; y: number; life: number };
    const pts: P[] = [];
    let mx = -100;
    let my = -100;
    let moved = false;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      moved = true;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (moved) {
        pts.push({ x: mx, y: my, life: 1 });
        moved = false;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.life -= 0.045;
        if (p.life <= 0) {
          pts.splice(i, 1);
          continue;
        }
      }
      // draw as a soft gradient stroke through recent points
      if (pts.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(102,206,255,${b.life * 0.5})`;
          ctx.lineWidth = b.life * 9;
          ctx.shadowColor = "rgba(61,187,255,0.8)";
          ctx.shadowBlur = 12 * b.life;
          ctx.stroke();
        }
      }
      ctx.restore();
      if (pts.length > 60) pts.splice(0, pts.length - 60);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[5] hidden sm:block" style={{ mixBlendMode: "screen" }} />;
}
