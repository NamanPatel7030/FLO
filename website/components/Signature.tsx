import { NamanAvatar } from "./NamanAvatar";

// "crafted by {handwritten Naman}" — subtle maker credit for the auth pages. Links to hellonaman.com.
const PATH =
  "M6 30 C8 22 10 12 12 6 C13 3 14 4 14 8 C15 16 18 26 21 30 C22 32 23 31 23 27 C24 18 25 10 26 5 " +
  "C27 14 28 22 31 25 C34 28 38 22 37 19 C36 16 32 17 31 21 C30 26 34 28 37 24 C38 22 39 20 40 19 " +
  "C40 23 40 26 41 28 C42 22 44 18 46 18 C48 18 48 23 48 28 C49 22 51 18 53 18 C55 18 55 23 55 28 " +
  "C57 25 59 20 62 19 C60 16 56 18 56 22 C56 27 61 27 63 23 C64 21 64 20 65 19 C65 23 65 26 67 27 " +
  "C68 22 70 18 73 18 C76 18 75 24 76 28 C78 29 82 26 85 22 " +
  "M10 36 C30 33 55 33 86 31";

export function MakerSignature() {
  return (
    <a
      href="https://hellonaman.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Crafted by Naman Gundaniya"
      title="hellonaman.com"
      className="group mt-10 flex items-center gap-1.5 text-white/35 opacity-70 transition hover:text-white/70 hover:opacity-100"
    >
      <span className="text-[9.5px] font-medium uppercase tracking-[0.14em]">crafted by</span>
      <NamanAvatar size={22} className="ring-1 ring-white/30" />
      <svg viewBox="0 0 92 40" className="h-[20px] w-[48px]" aria-hidden>
        <defs>
          <linearGradient id="naman-sig-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#e3f6ff" />
            <stop offset="0.55" stopColor="#66ceff" />
            <stop offset="1" stopColor="#1a9be0" />
          </linearGradient>
        </defs>
        <path
          d={PATH}
          pathLength={1}
          fill="none"
          stroke="url(#naman-sig-grad)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="naman-sig"
          style={{ filter: "drop-shadow(0 0 3px rgba(102,206,255,0.45))" }}
        />
      </svg>
    </a>
  );
}
