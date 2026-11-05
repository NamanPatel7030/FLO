/* eslint-disable @next/next/no-img-element */
export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/logo.svg" alt="" width={size} height={size} className="rounded-[28%]" style={{ width: size, height: size }} />;
}
