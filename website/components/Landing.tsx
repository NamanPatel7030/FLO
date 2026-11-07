"use client";

import { MotionConfig } from "motion/react";
import { Dock } from "./story/Dock";
import { Outro } from "./story/Outro";
import { FixedNotch, Rail, Story } from "./story/Story";
import { StoryProvider } from "./story/StoryContext";

/**
 * The landing page is one story told through the notch: a real-looking notch pinned to the top
 * edge, a scroll track where each screen is a live, clickable feature demo, and a floating dock.
 */
export function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <MotionConfig reducedMotion="user">
      <StoryProvider>
        <FixedNotch />
        <Rail />
        <main>
          <Story />
          <Outro />
        </main>
        <Dock signedIn={signedIn} />
      </StoryProvider>
    </MotionConfig>
  );
}
