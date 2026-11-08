import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Apple, Download, KeyRound, LogIn, MonitorDown, Terminal } from "lucide-react";
import { auth } from "@/auth";
import { AuthShell } from "@/components/AuthShell";
import { SignOutButton } from "@/components/SignOutButton";
import { downloadUrl, gatedHref } from "@/lib/downloads";

export const metadata = { title: "Download" };
export const dynamic = "force-dynamic";

type OS = "mac" | "windows" | "linux";

function detect(ua: string): OS {
  if (/windows/i.test(ua)) return "windows";
  if (/linux|x11/i.test(ua) && !/android/i.test(ua)) return "linux";
  return "mac";
}

// file locations stay on the server; the page only links to the signed-in /api/download/<os> route
const BUILDS: { os: OS; label: string; sub: string; icon: typeof Apple }[] = [
  { os: "mac", label: "macOS", sub: "Apple silicon and Intel · macOS 13+", icon: Apple },
  { os: "windows", label: "Windows", sub: "Windows 10 and 11 · beta", icon: MonitorDown },
  { os: "linux", label: "Linux", sub: ".deb and AppImage · beta", icon: Terminal },
];

export default async function DownloadPage() {
  const session = await auth();
  if (!session?.user) redirect("/signup?next=/download");
  const os = detect((await headers()).get("user-agent") ?? "");
  const builds = [...BUILDS].sort((a, b) => (a.os === os ? -1 : b.os === os ? 1 : 0));
  const first = session.user.name?.split(" ")[0];

  return (
    <AuthShell>
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <p className="eyebrow">You&apos;re in{first ? `, ${first}` : ""}</p>
          <h1 className="mt-3 text-[34px] font-semibold tracking-tight sm:text-[44px]">Download Flo</h1>
          <p className="mt-3 text-muted">Signed in as {session.user.email}</p>
        </div>

        <div className="mt-10 flex flex-col gap-3" data-testid="downloads">
          {builds.map((b, i) => {
            const ready = !!downloadUrl(b.os);
            const primary = i === 0;
            return (
              <div key={b.os} className={`${primary ? "glass-strong" : "glass"} flex items-center gap-4 rounded-3xl p-5`} data-os={b.os}>
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${primary ? "accent-bg text-[#001522]" : "bg-white/5 text-brand-200"}`}>
                  <b.icon size={22} />
                </span>
                <div className="flex-1">
                  <p className="text-[17px] font-semibold">
                    {b.label} {primary && <span className="ml-1 rounded-full bg-brand-300/15 px-2 py-0.5 align-middle text-[11px] font-medium text-brand-200">your computer</span>}
                  </p>
                  <p className="text-[13.5px] text-muted">{b.sub}</p>
                </div>
                {ready ? (
                  <a href={gatedHref(b.os)} className={`btn ${primary ? "btn-primary" : "btn-glass"} px-5 py-2.5 text-[14px]`} data-testid={`download-${b.os}`}>
                    <Download size={16} /> Download
                  </a>
                ) : (
                  <span className="rounded-full border border-white/10 px-4 py-2 text-[13px] text-faint" data-testid={`download-${b.os}`}>
                    Coming soon
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="glass mt-6 rounded-3xl p-6">
          <h2 className="text-[17px] font-semibold">Then, in three steps</h2>
          <ol className="mt-4 flex flex-col gap-4 text-[14.5px] text-muted">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-300/15 text-[13px] font-semibold text-brand-200">1</span>
              Open the download and drag Flo into Applications.
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-300/15 text-[13px] font-semibold text-brand-200">2</span>
              <span>
                Open Flo and <span className="text-ink"><LogIn size={14} className="mb-0.5 inline" /> sign in with this account</span>: the same email and password, or Continue with Google.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-300/15 text-[13px] font-semibold text-brand-200">3</span>
              <span>
                Follow the short setup. Add your own AI key <KeyRound size={14} className="mb-0.5 inline" /> or use a local model, then hold ⌃ and talk.
              </span>
            </li>
          </ol>
        </div>
        <div className="mt-6 text-center">
          <SignOutButton />
        </div>
      </div>
    </AuthShell>
  );
}
