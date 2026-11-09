import { MotionConfig } from "motion/react";
import { AgentSection, AssistantSection, SkillsSection } from "@/components/site/Assistant";
import { PastelBackdrop } from "@/components/site/Backdrop";
import { CompareSection, FaqSection, FinalCTA, MakerSection, MoreSection, PrivacySection, SiteFooter } from "@/components/site/Closing";
import { AppsMarquee, Hero } from "@/components/site/Hero";
import { CustomSection, WidgetsSection } from "@/components/site/Notch";
import { SiteNav } from "@/components/site/SiteNav";
import { Dictation, LanguagesSection, LearnsWords } from "@/components/site/Voice";
import { ClaudeSection, MeetingsSection, ProjectsSection, TodosSection } from "@/components/site/Work";
import { getUser } from "@/lib/supabase/server";

export default async function Home() {
  const signedIn = !!(await getUser());
  return (
    <MotionConfig reducedMotion="user">
      <div className="v2">
      <PastelBackdrop />
      <SiteNav signedIn={signedIn} />
      <main>
        <Hero />
        <AppsMarquee />
        <Dictation />
        <LanguagesSection />
        <AssistantSection />
        <SkillsSection />
        <AgentSection />
        <LearnsWords />
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
