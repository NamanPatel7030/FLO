import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Apple, Download, KeyRound, LogIn, MonitorDown, MousePointerClick, ShieldCheck, Smartphone, Terminal } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { PastelBackdrop } from "@/components/site/Backdrop";
import { downloadUrl, gatedHref, type DownloadOS } from "@/lib/downloads";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Download" };
export const dynamic = "force-dynamic";

function detect(ua: string): DownloadOS {
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/linux|x11/i.test(ua)) return "linux";
  return "mac";
}

// file locations stay on the server; the page only links to the signed-in /api/download/<os> route
const BUILDS: { os: DownloadOS; label: string; sub: string; icon: typeof Apple; tint: string }[] = [
  { os: "mac", label: "macOS", sub: "Apple silicon (M1 or later) · macOS 13+", icon: Apple, tint: "from-[#a9dcff] to-[#d8ccff]" },
  { os: "android", label: "Android", sub: "Pair with your Mac by QR · alerts while you're away", icon: Smartphone, tint: "from-[#c4f0e2] to-[#a9dcff]" },
  { os: "windows", label: "Windows", sub: "Windows 10 and 11 · beta", icon: MonitorDown, tint: "from-[#ffd6c4] to-[#ffc6dc]" },
  { os: "linux", label: "Linux", sub: ".deb and AppImage · beta", icon: Terminal, tint: "from-[#e8dcff] to-[#ffd6c4]" },
];

export default async function DownloadPage() {
  const user = await getUser();
  if (!user) redirect("/signup?next=/download");
  const os = detect((await headers()).get("user-agent") ?? "");
  const builds = [...BUILDS].sort((a, b) => (a.os === os ? -1 : b.os === os ? 1 : 0));
  const first = user.name.split(" ")[0];

  return (
    <div className="v2 min-h-dvh px-4 py-6 sm:px-6">
      <PastelBackdrop />
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flo home">
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-tight ink">Flo</span>
        </Link>
        <SignOutButton />
      </header>

      <main className="mx-auto max-w-5xl pb-16 pt-12 md:pt-16">
        <div className="text-center">
          <span className="tag">
            <span className="tag-dot" />
            You&apos;re in{first ? `, ${first}` : ""}
          </span>
          <h1 className="mt-6 text-[clamp(44px,7vw,84px)] font-semibold leading-[0.95] tracking-[-0.05em] ink">
            Get <span className="serif-i grad-text pr-1">Flo.</span>
          </h1>
          <p className="mt-4 text-[15px] mut">Signed in as {user.email}</p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2" data-testid="downloads">
          {builds.map((b, i) => {
            const ready = !!downloadUrl(b.os);
            const primary = i === 0;
            return (
              <div key={b.os} className={`g relative flex flex-col overflow-hidden rounded-[30px] p-6 ${primary ? "sm:col-span-2 sm:flex-row sm:items-center sm:gap-6 sm:p-8" : ""}`} data-os={b.os}>
                <div className={`absolute inset-0 -z-10 bg-gradient-to-br opacity-50 ${b.tint}`} />
                <span className={`grid shrink-0 place-items-center rounded-2xl bg-[rgba(255,255,255,0.8)] text-[var(--v2-ink)] shadow-sm ${primary ? "h-16 w-16" : "h-12 w-12"}`}>
                  <b.icon size={primary ? 28 : 22} />
                </span>
                <div className="mt-4 flex-1 sm:mt-0">
                  <p className={`font-semibold tracking-tight ink ${primary ? "text-[26px]" : "text-[18px]"} ${primary ? "" : "mt-0"}`}>
                    {b.label}
                    {primary && <span className="ml-2 rounded-full bg-[rgba(255,255,255,0.8)] px-2.5 py-1 align-middle text-[11.5px] font-semibold ink-2">your device</span>}
                  </p>
                  <p className="mt-1 text-[14px] mut">{b.sub}</p>
                </div>
                <div className="mt-5 sm:mt-0">
                  {ready ? (
                    <a href={gatedHref(b.os)} data-launch={b.label} className={`btn ${primary ? "btn-primary h-14 px-7 text-[15px]" : "btn-glass h-11 px-5 text-[14px] ink"}`} data-testid={`download-${b.os}`}>
                      <Download size={17} /> Download{primary ? ` for ${b.label}` : ""}
                    </a>
                  ) : (
                    <span className="inline-flex h-11 items-center rounded-full bg-[rgba(255,255,255,0.6)] px-5 text-[13.5px] font-medium fnt" data-testid={`download-${b.os}`}>
                      Coming soon
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <section className="g mt-6 rounded-[30px] p-6 sm:p-8" aria-labelledby="steps">
          <h2 id="steps" className="text-[22px] font-semibold tracking-tight ink">
            Then, in <span className="serif-i grad-text">four steps</span>
          </h2>
          <ol className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              [Download, "Install", "Open the .dmg and drag Flo into Applications."],
              [
                ShieldCheck,
                "Allow it once",
                "Flo isn't notarized by Apple yet, so macOS blocks the first launch. Open System Settings → Privacy & Security, scroll down and click Open Anyway next to Flo.",
              ],
              [LogIn, "Sign in", "Open Flo and sign in with this account: Continue with Google, or the same email and password."],
              [KeyRound, "Talk", "Follow the short setup. Add your own AI key or use a local model, then hold ⌃ control and talk."],
            ].map(([I, t, d], k) => {
              const Icon = I as typeof Download;
              return (
                <li key={t as string} className="g-2 flex gap-4 rounded-2xl p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b1220] text-[#fff]">
                    <Icon size={18} />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold ink">
                      {k + 1}. {t as string}
                    </span>
                    <span className="mt-0.5 block text-[14px] leading-relaxed mut">{d as string}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 flex items-center gap-2 text-[13px] fnt">
            <MousePointerClick size={14} /> On macOS 14 or older you can also right-click Flo in Applications and choose Open.
          </p>
        </section>
      </main>
    </div>
  );
}
