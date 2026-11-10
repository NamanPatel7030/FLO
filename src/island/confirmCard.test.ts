import { describe, expect, it } from "vitest";
import { settleConfirmedCard } from "./confirmCard";
import type { AssistantResponse } from "../lib/types";

const card = (o: Partial<AssistantResponse> = {}): AssistantResponse => ({
  id: "a1",
  query: "Send message to Dhru in Slack Hello",
  reply: 'Ready to send "Hello" to Dhruv Burada. Confirm in the notch to send.',
  actions: [{ type: "slack_send", to: "Dhru", text: "Hello" }],
  results: ["Waiting for you to confirm the Slack message to Dhruv Burada"],
  createdAt: "2026-11-10T08:00:00Z",
  mode: "quick",
  ...o,
});

describe("settleConfirmedCard", () => {
  it("replaces the 'ready to send' answer with what happened once the user confirms", () => {
    const c = settleConfirmedCard(card(), "Sent to Dhruv Burada");
    expect(c?.reply).toBe("Sent to Dhruv Burada");
    expect(c?.results).toEqual([]);
  });
  it("says cancelled when the user cancels", () => {
    expect(settleConfirmedCard(card(), "Cancelled")?.reply).toBe("Cancelled");
  });
  it("keeps other results and leaves unrelated cards alone", () => {
    const c = settleConfirmedCard(card({ results: ["Added a to-do", "Waiting for you to confirm the Slack message to Dhruv Burada"] }), "Sent to Dhruv Burada");
    expect(c?.results).toEqual(["Added a to-do"]);
    const other = card({ reply: "You have 3 to-dos.", results: [] });
    expect(settleConfirmedCard(other, "Sent to X")).toBe(other);
    expect(settleConfirmedCard(null, "Sent")).toBeNull();
  });
});
