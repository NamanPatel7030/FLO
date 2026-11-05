// Browser-only demo for the island. ?demo=1 cycles through every state; other values pin one state
// for screenshots: listening|assistant|working|result|error|history|claude|card|meeting|meetingExpanded|
// peek|swell|tray|trayTooltip|correction|meetingPrompt.
// Note: the query must come BEFORE the hash, e.g. /?demo=tray&nh=38#/island
import { api } from "../lib/api";
import { mockClaudeEvent, mockClaudeSession, mockCorrection, mockEmit, mockInvoke, mockMeetingDetected } from "../lib/mock";
import { trayLayout } from "../lib/format";
import { EV, type HoverEvent, type IslandGeometry } from "../lib/types";

export interface DemoHooks {
  setPos: (p: HoverEvent) => void;
  setMeetingOpen: (v: boolean) => void;
  openHistory: () => void;
}

const LONG_ERROR =
  "Assistant is set to stay on-device. Turn on “Assistant may use your cloud AI (BYOK)” in Settings → Privacy, or pick a local model in Settings → AI.";

export function runDemo(kind: string, hooks: DemoHooks): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
  // pin the cursor somewhere over the island (pauses auto-dismiss timers)
  const pin = (x = 10, y = 60) => at(250, () => hooks.setPos({ inside: true, x, y }));

  switch (kind) {
    case "swell":
      at(300, () => hooks.setPos({ inside: true, x: 4, y: 4 }));
      // keep re-entering so the dwell never completes → stays swollen for screenshots
      for (let t = 400; t < 60000; t += 150) at(t, () => hooks.setPos({ inside: false }));
      for (let t = 420; t < 60000; t += 150) at(t, () => hooks.setPos({ inside: true, x: 4, y: 4 }));
      break;
    case "peek":
      at(300, () => hooks.setPos({ inside: true, x: 30, y: 60 }));
      break;
    case "tray":
      break; // mock sessions + urgent to-dos show up on load
    case "trayTooltip":
      at(600, async () => {
        const geo = (await mockInvoke("get_island_geometry")) as IslandGeometry;
        const sessions = (await mockInvoke("list_claude_sessions")) as unknown[];
        const s = trayLayout(geo, Math.min(5, sessions.length), 1).slots[1];
        // like the backend: keep re-sending the cursor relative to the *current* window width
        const tick = () => {
          const root = document.querySelector("[data-island-root]") as HTMLElement | null;
          const w = root?.getBoundingClientRect().width ?? 0;
          hooks.setPos({ inside: true, x: w / 2 + s.cx, y: geo.notchHeight / 2 });
        };
        for (let t = 0; t < 60000; t += 100) at(600 + t, tick);
      });
      break;
    case "correction":
      pin();
      at(300, () => mockCorrection("tory", "Tauri"));
      break;
    case "meetingPrompt":
      pin();
      at(300, () => mockMeetingDetected("Zoom", true));
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
      pin();
      at(300, () => {
        mockEmit(EV.state, { phase: "transcribing", mode: "dictation" });
        mockEmit(EV.transcript, {
          text: "Hey Rahul, the invoice is attached, can you confirm the amount by Friday so we can close the month? Thanks!",
          final: true,
        });
        mockEmit(EV.state, { phase: "done", mode: "dictation" });
      });
      break;
    case "error":
      pin();
      at(300, () => mockEmit(EV.state, { phase: "error", mode: "assistant", message: LONG_ERROR }));
      break;
    case "history":
      at(300, () => hooks.openHistory());
      break;
    case "card":
      at(300, () => mockInvoke("ask_assistant", { text: "Add a to-do to Apollo: send the deck by Friday" }));
      break;
    case "claude":
      at(300, () => mockClaudeEvent("stop", "Flo", "Built the island UI and glass dashboard, all tests pass."));
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
        at(7500, () => mockCorrection("tory", "Tauri"));
        at(12000, () => mockClaudeSession("waiting_reply"));
        at(14000, () => mockMeetingDetected("Zoom", true));
        at(20000, () => mockMeetingDetected("Zoom", false));
        at(21000, () => mockClaudeEvent("stop", "Flo", "Built the island UI and glass dashboard, all tests pass."));
        at(26000, () => api.startSession("assistant"));
        at(28500, () => api.stopSession());
        at(32000, () => hooks.openHistory());
        at(37000, cycle);
      };
      cycle();
    }
  }
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
