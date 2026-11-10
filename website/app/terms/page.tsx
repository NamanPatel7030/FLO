import { LegalBlock, LegalShell } from "@/components/site/Legal";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalShell tag="Terms of use" title="The short" accent="version." lead="Flo is free. Use it kindly, and you're responsible for the AI providers you connect.">
      <article className="g rounded-[28px] p-6 sm:p-9">
        <LegalBlock title="Using Flo">
          <p>Flo is provided as is, free of charge. You are responsible for the AI providers you connect and for what you send them under your own keys.</p>
        </LegalBlock>
        <LegalBlock title="Respect other people">
          <p>Don&apos;t use Flo to break the law or other people&apos;s privacy. Meeting notes record audio: tell participants and follow the rules where you live.</p>
        </LegalBlock>
        <LegalBlock title="Changes">
          <p>We may update these terms; we&apos;ll note the date here. Last updated November 2026.</p>
        </LegalBlock>
      </article>
    </LegalShell>
  );
}
