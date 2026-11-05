import { AuthShell } from "@/components/AuthShell";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <AuthShell>
      <article className="glass max-w-2xl rounded-[28px] p-8 text-[15px] leading-relaxed text-muted">
        <h1 className="text-2xl font-semibold text-ink">Privacy policy</h1>
        <p className="mt-4">Flo is local-first. Your dictation, transcripts, meeting notes, to-dos, screen text, context documents and API keys stay on your computer, in an encrypted database and your system keychain.</p>
        <h2 className="mt-6 font-semibold text-ink">What this website stores</h2>
        <p className="mt-2">Your account: name, email, a bcrypt hash of your password (or your Google account id and picture), and short-lived one-time sign-in codes. That is all.</p>
        <h2 className="mt-6 font-semibold text-ink">What the app sends</h2>
        <p className="mt-2">Only what you choose: text to the AI provider you configure, with your own key, and sign-in requests to this website. Every request is listed in the app&apos;s network log. There is no telemetry.</p>
        <h2 className="mt-6 font-semibold text-ink">Deleting your account</h2>
        <p className="mt-2">Email hello@hellonaman.com and we will delete your account. Your local data is yours: uninstall Flo to remove it.</p>
      </article>
    </AuthShell>
  );
}
