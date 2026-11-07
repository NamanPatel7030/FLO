"use client";

import { MotionConfig } from "motion/react";
import { MenuBar } from "./story/MenuBar";
import { Outro } from "./story/Outro";
import { FixedNotch, Rail, Story } from "./story/Story";
import { StoryProvider } from "./story/StoryContext";

/**
 * The landing page is one story told through the notch: a menu bar with a real-looking notch in it,
 * and a scroll track where each screen is a feature. The notch morphs into the UI Flo shows for it.
 */
export function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <MotionConfig reducedMotion="user">
      <StoryProvider>
        <MenuBar signedIn={signedIn} />
        <FixedNotch />
        <Rail />
        <main>
          <Story signedIn={signedIn} />
          <Outro signedIn={signedIn} />
        </main>
      </StoryProvider>
    </MotionConfig>
  );
}
