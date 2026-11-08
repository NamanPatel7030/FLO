/** Static backdrop for account pages: soft pools of the theme's colours over the page gradient. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 620px at 15% -10%, var(--pool-1), transparent 60%), radial-gradient(900px 600px at 100% 0%, var(--pool-2), transparent 60%), radial-gradient(1000px 700px at 50% 120%, var(--pool-3), transparent 60%), var(--page-grad)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: "var(--grain)",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}
