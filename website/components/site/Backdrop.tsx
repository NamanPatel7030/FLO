/**
 * The page backdrop: a pale canvas with four big pastel blobs drifting slowly behind the glass.
 * Pure CSS (transform animations only), so it costs almost nothing and is static under reduced motion.
 */
export function PastelBackdrop({ fixed = true }: { fixed?: boolean }) {
  return (
    <div aria-hidden className={`pointer-events-none ${fixed ? "fixed" : "absolute"} inset-0 -z-10 overflow-hidden`} style={{ background: "var(--page-grad)" }}>
      <div className="blob" style={{ width: "46vw", height: "46vw", top: "-14vw", left: "-10vw", background: "radial-gradient(circle, #a9dcff 0%, #cfe9ff 55%, transparent 72%)", animation: "blob-a 26s ease-in-out infinite" }} />
      <div className="blob" style={{ width: "42vw", height: "42vw", top: "-6vw", right: "-12vw", background: "radial-gradient(circle, #d8ccff 0%, #ebe3ff 55%, transparent 72%)", animation: "blob-b 30s ease-in-out infinite" }} />
      <div className="blob" style={{ width: "40vw", height: "40vw", bottom: "-16vw", left: "18vw", background: "radial-gradient(circle, #ffd6c4 0%, #ffe8dc 55%, transparent 72%)", animation: "blob-c 34s ease-in-out infinite" }} />
      <div className="blob" style={{ width: "34vw", height: "34vw", bottom: "-8vw", right: "-6vw", background: "radial-gradient(circle, #c4f0e2 0%, #e2f8f0 55%, transparent 72%)", animation: "blob-a 38s ease-in-out infinite reverse" }} />
      {/* grain keeps the gradients from banding */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}
