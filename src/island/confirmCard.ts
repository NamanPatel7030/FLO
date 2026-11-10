import type { AssistantResponse } from "../lib/types";

/** The backend's result line while a drafted Slack message waits for Send (src-tauri/src/slack.rs). */
const WAITING = /^Waiting for you to confirm the Slack message/;

/**
 * The user pressed Send (or Cancel) on a staged Slack message: the answer card that said "Ready to
 * send … Confirm in the notch" now says what happened ("Sent to Dhruv Burada"), and the waiting chip
 * goes. Cards without a waiting message are returned unchanged.
 */
export function settleConfirmedCard(card: AssistantResponse | null, outcome: string): AssistantResponse | null {
  if (!card || !card.results.some((r) => WAITING.test(r))) return card;
  return { ...card, reply: outcome, results: card.results.filter((r) => !WAITING.test(r)) };
}
