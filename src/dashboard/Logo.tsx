import logoUrl from "../assets/logo.svg";

/** Flo mark — navy→black glass tile with a light-blue flow wave. */
export function Logo({ size = 36, glow = true, className = "" }: { size?: number; glow?: boolean; className?: string }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Flo"
      draggable={false}
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        filter: glow ? "drop-shadow(0 6px 18px rgba(61,187,255,0.35))" : undefined,
      }}
    />
  );
}
