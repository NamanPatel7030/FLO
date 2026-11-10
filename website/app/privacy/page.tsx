import { Cloud, Laptop, Server } from "lucide-react";
import { LegalBlock, LegalShell } from "@/components/site/Legal";

export const metadata = { title: "Privacy" };

const AT_A_GLANCE = [
  {
    icon: Laptop,
    tint: "text-[#3fbf98]",
    title: "On your computer",
    items: ["Dictation and transcripts", "Meeting notes and to-dos", "Screen text and context docs", "Your dictionary and corrections", "API keys, in your keychain"],
  },
  {
    icon: Cloud,
    tint: "text-[#7a6cff]",
    title: "Only if you turn it on",
    items: ["Sync: an end-to-end encrypted backup", "Text to the AI provider you set up, with your own key"],
  },
  {
    icon: Server,
    tint: "text-[#2f8cff]",
    title: "On our server",
    items: ["Name and email, or your Google id and picture", "A hashed password, if you use one", "When your app first and last signed in"],
  },
];

export default function PrivacyPage() {
  return (
    <LegalShell
      tag="Privacy policy"
      title="Privacy, in"
      accent="plain words."
      lead="Flo is local-first. Your voice is turned into text on your computer, and what you say stays there unless you choose otherwise. There is no telemetry."
    >
      <div className="grid gap-3 md:grid-cols-3" data-testid="privacy-glance">
        {AT_A_GLANCE.map((g) => (
          <div key={g.title} className="g-2 rounded-[24px] p-5">
            <span className={`grid h-10 w-10 place-items-center rounded-xl bg-[rgba(255,255,255,0.85)] shadow-sm ${g.tint}`}>
              <g.icon size={18} />
            </span>
            <h2 className="mt-4 text-[15.5px] font-semibold tracking-tight ink">{g.title}</h2>
            <ul className="mt-2.5 space-y-1.5 text-[13.5px] leading-snug mut">
              {g.items.map((i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-[#2f8cff] to-[#ff7eb0]" />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <article className="g mt-6 rounded-[28px] p-6 sm:p-9">
        <LegalBlock title="What stays on your computer">
          <p>Flo is local-first. Your dictation, transcripts, meeting notes, to-dos, screen text, context documents and API keys stay on your computer, in an encrypted database and your system keychain, unless you turn on Sync (below).</p>
        </LegalBlock>
        <LegalBlock title="What this website stores">
          <p>Your account: name, email and a securely hashed password (or your Google account id and picture), held by our sign-in provider Supabase, plus short-lived one-time sign-in codes and the first and last time your Flo app signed in (used only for our total user counts). If you turn on Sync, it also stores your encrypted sync data, described next.</p>
        </LegalBlock>
        <LegalBlock title="Sync (off unless you turn it on)">
          <p>Sync backs up your to-dos, notes and meetings, dictionary, skills, projects and dictation history, and keeps your Macs in step. Everything is encrypted on your Mac before it is sent, with a key that stays in your keychain and is shown to you once as a recovery key. We store only ciphertext we cannot read, and we cannot recover your key. Delete your synced copy any time in Settings, Privacy; deleting your account deletes it too.</p>
        </LegalBlock>
        <LegalBlock title="What the app sends">
          <p>Only what you choose: text to the AI provider you configure, with your own key, and sign-in requests to this website. Every request, including Sync, is listed in the app&apos;s network log. There is no telemetry.</p>
        </LegalBlock>
        <LegalBlock title="Deleting your account">
          <p>
            Email{" "}
            <a href="mailto:hello@hellonaman.com" className="font-semibold text-[#2f8cff] hover:underline">
              hello@hellonaman.com
            </a>{" "}
            and we will delete your account. Your local data is yours: uninstall Flo to remove it.
          </p>
        </LegalBlock>
      </article>
    </LegalShell>
  );
}
