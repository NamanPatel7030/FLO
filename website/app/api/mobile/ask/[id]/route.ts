import { waitingHint } from "@/lib/desktop-state";
import { claimForCloud, finishInCloud, getDesktopState, getRequest, mobileCaller, releaseFromCloud, unauthorized, type MobileRequest, type StoredRequest } from "@/lib/mobile";
import { answerInCloud, cloudAnswersEnabled, notifyAnswer } from "@/lib/phone-answer";
import { QUEUED_TEXT, queuedOffline, shouldAnswerInCloud } from "@/lib/phone-ask";

export const runtime = "nodejs";
/** A cloud answer takes up to 20 s (CLOUD_TIMEOUT_MS) on top of the database round trips. */
export const maxDuration = 60;

/** Questions still pending after this long get a `hint` saying why (computer offline, other account…). */
const HINT_AFTER_MS = 10_000;

type Hint = { reason: string; text: string };

/** What the phone sees: never the stored screen text or internal bookkeeping. */
const forPhone = (r: StoredRequest | MobileRequest): MobileRequest => ({
  id: r.id,
  mode: r.mode,
  text: r.text,
  status: r.status,
  answer: r.answer,
  createdAt: r.createdAt,
  answeredBy: r.answeredBy,
});

/**
 * Phone: the status (pending | taken | done | failed) and answer of one of its requests.
 *
 * Laptop shut? An ask still pending after 8 s while the computer looks offline (no snapshot in 12
 * minutes, or none at all) is answered here with cloud AI, once (atomic claim, so concurrent polls
 * don't answer twice), and marked `answeredBy: "cloud"`. Lazily, on the phone's own poll: no cron. If
 * the cloud call fails, the request goes back to the computer and the phone gets the usual hint.
 * To-dos and notes need the computer: they stay queued with a "saved" hint.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found." }, { status: 404 });
  let request: StoredRequest | MobileRequest | null = await getRequest(c.user.id, id);
  if (!request) return Response.json({ error: "Not found." }, { status: 404 });
  let hint: Hint | undefined;
  if (request.status === "pending") {
    const pc = await getDesktopState(c.user.id);
    const seenAt = pc?.updatedAt ?? null;
    const now = new Date();
    if (cloudAnswersEnabled() && shouldAnswerInCloud(request as StoredRequest, seenAt, now)) {
      const claimed = await claimForCloud(c.user.id, id);
      if (claimed) {
        const answer = await answerInCloud(c.user, claimed.text, claimed.context, pc?.state ?? null);
        const done = answer ? await finishInCloud(c.user.id, id, answer) : null;
        if (done) {
          await notifyAnswer(c.user.id, done, true, done.answer ?? "");
          request = done;
        } else {
          request = (await releaseFromCloud(c.user.id, id)) ?? (await getRequest(c.user.id, id)) ?? request;
        }
      } else {
        // another poll is answering it right now
        request = (await getRequest(c.user.id, id)) ?? request;
      }
    } else if (queuedOffline(request, seenAt, now)) {
      hint = { reason: "queued", text: QUEUED_TEXT };
    }
    if (!hint && request.status === "pending" && now.getTime() - new Date(request.createdAt).getTime() > HINT_AFTER_MS) {
      hint = waitingHint(c.user.email, seenAt, now);
    }
  }
  const body = hint ? { request: forPhone(request), hint } : { request: forPhone(request) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
