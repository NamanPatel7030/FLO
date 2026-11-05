// Browser-only demo for the island. ?demo=1 cycles through every state; other values pin one state
// for screenshots: listening|assistant|working|result|error|history|claude|card|meeting|meetingExpanded|peek.
// Note: the query must come BEFORE the hash, e.g. /?demo=error&nh=38#/island
import { api } from "../lib/api";
import { mockClaudeEvent, mockEmit, mockInvoke } from "../lib/mock";
import { EV } from "../lib/types";

export interface DemoHooks {
  setHover: (v: boolean) => void;
  setMeetingOpen: (v: boolean) => void;
  openHistory: () => void;
}

const LONG_ERROR =
  "Assistant is set to stay on-device. Turn on “Assistant may use your cloud AI (BYOK)” in Settings → Privacy, or pick a local model in Settings → AI.";

export function runDemo(kind: string, hooks: DemoHooks): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
  const pinHover = () => at(250, () => hooks.setHover(true)); // hover pauses auto-dismiss

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
      at(300, () => mockEmit(EV.state, { phase: "transcribing", mode: "dictation" }));
      break;
    case "result":
      pinHover();
      at(300, () => {
        mockEmit(EV.state, { phase: "transcribing", mode: "dictation" });
        mockEmit(EV.transcript, {
          text: "Hey Rahul, the invoice is attached — can you confirm the amount by Friday so we can close the month? Thanks!",
          final: true,
        });
        mockEmit(EV.state, { phase: "done", mode: "dictation" });
      });
      break;
    case "error":
      pinHover();
      at(300, () => mockEmit(EV.state, { phase: "error", mode: "assistant", message: LONG_ERROR }));
      break;
    case "history":
      at(300, () => hooks.openHistory());
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
        at(7500, () => mockEmit(EV.state, { phase: "error", mode: "assistant", message: LONG_ERROR }));
        at(13000, () => mockClaudeEvent("stop", "Flo", "Built the island UI and glass dashboard — all tests pass."));
        at(18000, () => api.startSession("assistant"));
        at(20500, () => api.stopSession());
        at(24000, () => hooks.openHistory());
        at(29000, () => api.startMeeting("Design sync"));
        at(37000, () => api.stopMeeting());
        at(40000, cycle);
      };
      cycle();
    }
  }
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
