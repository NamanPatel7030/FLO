import "server-only";
import { generateText } from "ai";
import type { User } from "./db";
import type { ComputerState } from "./desktop-state";
import { dropPushToken, pushTargets, storeNotification, type MobileRequest } from "./mobile";
import { CLOUD_MODEL, CLOUD_TIMEOUT_MS, cleanPhoneAnswer, phoneAnswerSystem, phoneAnswerUser } from "./phone-ask";
import { pushConfigured, sendPush } from "./push";

const TITLE = { ask: "Flo answered", todo: "Added to your to-dos", note: "Saved to your notes" } as const;

/** A finished phone request: add it to the phone inbox and push it to the phones right away. */
export async function notifyAnswer(userId: string, r: MobileRequest, ok: boolean, answer: string): Promise<void> {
  const title = ok ? TITLE[r.mode] : "Flo couldn't do that";
  const body = answer.length > 400 ? `${answer.slice(0, 397)}...` : answer;
  const data: Record<string, string> = { requestId: String(r.id), mode: r.mode };
  if (r.answeredBy === "cloud") data.answeredBy = "cloud";
  const item = await storeNotification(userId, "flo_answer", title, body, data);
  if (!pushConfigured()) return;
  const targets = await pushTargets(userId);
  if (!targets.length) return;
  const res = await sendPush(
    targets.map((t) => t.pushToken),
    { title, body, data: { kind: "flo_answer", id: String(item.id), requestId: String(r.id) } },
  );
  await Promise.all(res.unregistered.map(dropPushToken));
}

/** Server-wide switch for the cloud fallback (a per-user opt-out can come later). On by default. */
export const cloudAnswersEnabled = () => process.env.FLO_CLOUD_ANSWERS !== "off";

/** The little the server knows without the computer: name, date, open to-dos from the last snapshot. */
function cloudContext(user: User, state: ComputerState | null, now = new Date()): string {
  let c = `Today: ${now.toISOString().slice(0, 10)} (UTC)\n`;
  if (user.name) c += `User: ${user.name}\n`;
  const open = state?.todos?.open ?? [];
  if (open.length) c += `\nOpen to-dos (from their computer, may be out of date):\n${open.slice(0, 15).map((t) => `- ${t.title}`).join("\n")}\n`;
  return c;
}

/**
 * Answer a phone ask with cloud AI through the Vercel AI Gateway (OIDC on Vercel, or
 * AI_GATEWAY_API_KEY elsewhere), using the same direct-answer prompt as the computer and the phone's
 * screen text. Returns null when the gateway fails (no credits, timeout, not configured): the caller
 * hands the request back to the computer.
 */
export async function answerInCloud(user: User, question: string, screen: string | null, state: ComputerState | null): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: CLOUD_MODEL,
      instructions: phoneAnswerSystem(cloudContext(user, state)),
      prompt: phoneAnswerUser(question, screen),
      maxOutputTokens: 1000,
      timeout: CLOUD_TIMEOUT_MS,
    });
    const answer = cleanPhoneAnswer(text);
    return answer || null;
  } catch (e) {
    // never the question or the screen text in the log
    console.warn("cloud answer failed:", e instanceof Error ? e.name + ": " + e.message.slice(0, 200) : "unknown");
    return null;
  }
}
