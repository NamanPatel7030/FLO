import { MotionConfig } from "motion/react";
import { AgentSection, AssistantSection, SkillsSection } from "@/components/site/Assistant";
import { PastelBackdrop } from "@/components/site/Backdrop";
import { Dock, TopNotch } from "@/components/site/Chrome";
import { CompareSection, FaqSection, FinalCTA, MakerSection, MoreSection, PrivacySection, SiteFooter } from "@/components/site/Closing";
import { AppsMarquee, Hero } from "@/components/site/Hero";
import { MeetNotchling } from "@/components/site/MeetNotchling";
import { CustomSection, WidgetsSection } from "@/components/site/Notch";
import { Dictation, LanguagesSection } from "@/components/site/Voice";
import { PreciseSection, PrivateByDesign, TrustStrip } from "@/components/site/Trust";
import { ClaudeSection, MeetingsSection, ProjectsSection, TodosSection } from "@/components/site/Work";
import { getUser } from "@/lib/supabase/server";

export default async function Home() {
  const signedIn = !!(await getUser());
  return (
    <MotionConfig reducedMotion="user">
      <div className="v2">
      <PastelBackdrop />
      <TopNotch />
      <Dock signedIn={signedIn} />
      <main>
        <Hero />
        <AppsMarquee />
        <TrustStrip />
        <MeetNotchling />
        <Dictation />
        <PreciseSection />
        <LanguagesSection />
        <PrivateByDesign />
        <AssistantSection />
        <SkillsSection />
        <AgentSection />
        <TodosSection />
        <ProjectsSection />
        <MeetingsSection />
        <ClaudeSection />
        <WidgetsSection />
        <CustomSection />
        <PrivacySection />
        <MoreSection />
        <CompareSection />
        <MakerSection />
        <FaqSection />
        <FinalCTA />
      </main>
      <SiteFooter />
      </div>
    </MotionConfig>
  );
}
