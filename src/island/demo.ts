// Browser-only demo for the island. ?demo=1 cycles through every state;
// ?demo=listening|assistant|working|claude|card|meeting|meetingExpanded|peek pins one state (for screenshots).
import { api } from "../lib/api";
import { mockClaudeEvent, mockInvoke } from "../lib/mock";

export interface DemoHooks {
  setHover: (v: boolean) => void;
  setMeetingOpen: (v: boolean) => void;
}

export function runDemo(kind: string, hooks: DemoHooks): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));

  switch (kind) {
    case "peek":
      at(300, () => hooks.setHover(true));
      break;
    case "listening":
      at(300, () => api.startSession("dictation"));
      break;
    case "assistant":
      at(300, () => api.startSession("assistant"));
      break;
    case "working":
      at(300, () => api.startSession("assistant"));
      at(600, () => api.stopSession());
      break;
    case "card":
      at(300, () => mockInvoke("ask_assistant", { text: "Add a to-do to Apollo: send the deck by Friday" }));
      break;
    case "claude":
      at(300, () => mockClaudeEvent("stop", "Flo", "Built the island UI and glass dashboard — all tests pass."));
      at(400, () => mockClaudeEvent("notification", "hermes-api", "Claude needs your permission to run `npm publish`."));
      break;
    case "meeting":
    case "meetingExpanded":
      at(300, () => api.startMeeting("Design sync"));
      if (kind === "meetingExpanded") at(500, () => hooks.setMeetingOpen(true));
      break;
    default: {
      const cycle = () => {
        at(1500, () => api.startSession("dictation"));
        at(4000, () => api.stopSession());
        at(6000, () => mockClaudeEvent("stop", "Flo", "Built the island UI and glass dashboard — all tests pass."));
        at(11000, () => api.startSession("assistant"));
        at(13500, () => api.stopSession());
        at(17000, () => mockClaudeEvent("notification", "hermes-api", "Claude needs your permission to run `npm publish`."));
        at(20000, () => api.startMeeting("Design sync"));
        at(30000, () => api.stopMeeting());
        at(33000, cycle);
      };
      cycle();
    }
  }
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
