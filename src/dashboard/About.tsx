// Settings → About: product + a quiet maker card.
import { Globe, ShieldCheck } from "lucide-react";

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden>
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
const LinkedinIcon = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
);
import { Logo } from "./Logo";
import { MAKER_SITE, openExternal, Portrait, SignatureMark } from "./Signature";
import { Card } from "./ui";

const LINKS = [
  { icon: <Globe size={15} />, label: "hellonaman.com", url: MAKER_SITE },
  { icon: <GithubIcon />, label: "GitHub", url: "https://github.com/NamanPatel7030" },
  { icon: <LinkedinIcon />, label: "LinkedIn", url: "https://linkedin.com/in/naman-gundaniya" },
];

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <Card strong className="flex items-center gap-4 p-5">
        <Logo size={52} />
        <div>
          <div className="text-[18px] font-semibold tracking-tight">
            Flo <span className="font-normal text-muted">· Your Assistant</span>
          </div>
          <div className="mt-0.5 text-[12px] text-faint">Version 0.1.0</div>
        </div>
      </Card>

      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">Made by</div>
        <div className="relative flex items-start gap-4">
          <Portrait size={72} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold tracking-tight">Naman Gundaniya</div>
            <div className="mt-0.5 text-[12.5px] text-muted">Forward Deployed Engineer</div>
            <blockquote className="mt-3 border-l-2 border-brand-300/50 pl-3 text-[13.5px] italic leading-relaxed text-[var(--fg)]/85">
              I'm the human. AI is my leverage. Together, we build anything.
            </blockquote>
            <div className="mt-1 flex justify-end pr-2" aria-label="Naman">
              <SignatureMark id="about-sig" className="h-[26px] w-[60px]" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {LINKS.map((l) => (
                <button key={l.url} onClick={() => openExternal(l.url)} className="btn-glass flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12.5px]" title={l.url} aria-label={l.label}>
                  <span className="text-brand-300">{l.icon}</span>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 px-1 text-[12px] text-muted">
        <ShieldCheck size={14} className="text-brand-300" /> Local-first. Your data stays on your Mac.
      </div>
    </div>
  );
}
