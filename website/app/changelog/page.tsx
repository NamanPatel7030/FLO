import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import { PastelBackdrop } from "@/components/site/Backdrop";

export const metadata = { title: "What's new", description: "Every Flo release and what it brought." };
// refresh from GitHub every 10 minutes
export const revalidate = 600;

type Release = { tag_name: string; name: string | null; body: string | null; published_at: string; draft: boolean; prerelease: boolean };

const REPO = process.env.RELEASE_REPO || "NamanPatel7030/FLO";

async function releases(): Promise<Release[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    return ((await res.json()) as Release[]).filter((r) => !r.draft);
  } catch {
    return [];
  }
}

/** Release notes are short Markdown: paragraphs and "- " bullets, with **bold**. Render just that. */
function Notes({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold ink">{part.slice(2, -2)}</strong> : part));
  return (
    <div className="space-y-3 text-[15px] leading-relaxed mut">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-[#2f8cff] to-[#ff7eb0]" />
                  <span>{inline(l.replace(/^\s*[-*] /, ""))}</span>
                </li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

export default async function ChangelogPage() {
  const list = await releases();
  return (
    <div className="v2 min-h-dvh px-4 py-6 sm:px-6">
      <PastelBackdrop />
      <header className="mx-auto flex max-w-3xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flo home">
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-tight ink">Flo</span>
        </Link>
        <Link href="/" className="flex items-center gap-1.5 text-[14px] font-medium mut hover:text-[var(--v2-ink)]">
          <ArrowLeft size={15} /> Back to Flo
        </Link>
      </header>
      <main className="mx-auto max-w-3xl pb-20 pt-14">
        <span className="tag">
          <span className="tag-dot" />
          Changelog
        </span>
        <h1 className="mt-6 text-[clamp(44px,7vw,80px)] font-semibold leading-[0.95] tracking-[-0.05em] ink">
          What&apos;s <span className="serif-i grad-text pr-1">new.</span>
        </h1>
        <p className="v2-lead mt-5 max-w-xl">Every Flo release, newest first. Flo updates itself: when one lands, the notch offers it, it installs in the background, and one restart later you have it.</p>

        <ol className="relative mt-14 space-y-6 border-l border-[rgba(20,30,60,0.1)] pl-8" data-testid="changelog">
          {list.length === 0 && (
            <li className="g rounded-[28px] p-7">
              <p className="text-[15px] mut">Release notes will appear here with the next update.</p>
            </li>
          )}
          {list.map((r, i) => (
            <li key={r.tag_name} className="relative">
              <span className={`absolute -left-[41px] top-7 grid h-5 w-5 place-items-center rounded-full ${i === 0 ? "bg-[#0b1220] text-[#fff]" : "bg-[#fff] ring-1 ring-[rgba(20,30,60,0.15)]"}`}>
                {i === 0 && <Sparkles size={11} />}
              </span>
              <article className="g rounded-[28px] p-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[24px] font-semibold tracking-tight ink">{r.name || r.tag_name}</h2>
                  {i === 0 && <span className="rounded-full bg-[#0b1220] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#fff]">Latest</span>}
                  <time className="text-[13px] fnt" dateTime={r.published_at}>
                    {new Date(r.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </time>
                </div>
                <div className="mt-4">
                  <Notes text={r.body || ""} />
                </div>
              </article>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
