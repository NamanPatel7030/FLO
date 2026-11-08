// Browser mock for auto-continue after a Claude usage limit (autocontinue.rs commands). Hooked into
// mock.ts's default case. Starts empty; tests / screenshots steer it through
// window.__floAutoContinueMock: limit() simulates Claude hitting its limit in a session.
import type { AutoContinue } from "./autoContinue";
import { UNHANDLED } from "./mockCode";

interface Ctx {
  settings: { claudeAutoContinue?: boolean; claudeContinuePrompt?: string };
  emit: (event: string, payload: unknown) => void;
}

const EVENT = "flo://autocontinue";
const entries: Omit<AutoContinue, "auto">[] = [];
const logs = new Map<string, string[]>();
const calls: { cmd: string; args: Record<string, unknown> }[] = [];

function views(ctx: Ctx): AutoContinue[] {
  return entries
    .map((e) => ({ ...e, auto: e.enabled ?? !!ctx.settings.claudeAutoContinue }))
    .sort((a, b) => b.limitedAt.localeCompare(a.limitedAt));
}

function publish(ctx: Ctx) {
  ctx.emit(EVENT, views(ctx));
}

function find(id: unknown) {
  const e = entries.find((x) => x.sessionId === id);
  if (!e) throw "Flo isn't tracking that session.";
  return e;
}

function hooks(ctx: Ctx) {
  if (typeof window === "undefined" || (window as any).__floAutoContinueMock) return;
  (window as any).__floAutoContinueMock = {
    calls,
    entries,
    /** Claude hit its limit in a session: resets in `inMinutes` (null = no reset given → back-off) */
    limit: (o: { sessionId?: string; project?: string; inMinutes?: number | null; enabled?: boolean | null; status?: AutoContinue["status"]; detail?: string } = {}) => {
      const now = Date.now();
      const id = o.sessionId ?? "s1";
      const project = o.project ?? "Flo";
      const resets = o.inMinutes === null ? null : new Date(now + (o.inMinutes ?? 72) * 60_000).toISOString();
      const next = resets ? new Date(Date.parse(resets) + 60_000).toISOString() : new Date(now + 15 * 60_000).toISOString();
      const i = entries.findIndex((x) => x.sessionId === id);
      const e = {
        sessionId: id,
        project,
        cwd: `/Users/parth/${project}`,
        limitedAt: new Date(now - 3 * 60_000).toISOString(),
        resetsAt: resets,
        nextCheckAt: next,
        reason: resets ? `You've hit your session limit · resets ${new Date(resets).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "").toLowerCase()}` : "API Error: 429 rate_limit_error",
        status: o.status ?? "waiting",
        enabled: o.enabled ?? null,
        cycles: 0,
        cycleDay: new Date().toISOString().slice(0, 10),
        detail: o.detail ?? null,
        tzNote: null,
        updatedAt: new Date(now).toISOString(),
      };
      if (i >= 0) entries[i] = e;
      else entries.unshift(e);
      publish(ctx);
      return e;
    },
    /** the user typed in the session (UserPromptSubmit) */
    typed: (sessionId = "s1") => {
      const e = entries.find((x) => x.sessionId === sessionId);
      if (e && e.status === "waiting") Object.assign(e, { status: "cancelled", detail: "You continued the session yourself.", updatedAt: new Date().toISOString() });
      publish(ctx);
    },
    clear: () => {
      entries.splice(0, entries.length);
      publish(ctx);
    },
  };
}

export async function autoContinueMock(cmd: string, args: Record<string, any>, ctx: Ctx): Promise<unknown> {
  hooks(ctx);
  switch (cmd) {
    case "list_auto_continue":
      return views(ctx);
    case "set_auto_continue": {
      calls.push({ cmd, args });
      const e = find(args.sessionId);
      e.enabled = args.enabled ?? null;
      publish(ctx);
      return views(ctx);
    }
    case "auto_continue_now": {
      calls.push({ cmd, args });
      const e = find(args.sessionId);
      if (e.status === "resuming") throw "It's already resuming.";
      Object.assign(e, { status: "resuming", detail: null, cycles: e.cycles + 1, updatedAt: new Date().toISOString() });
      const prompt = ctx.settings.claudeContinuePrompt || "Continue where you left off.";
      logs.set(e.sessionId, [
        ...(logs.get(e.sessionId) ?? []),
        `── resuming: claude --resume ${e.sessionId} --print "${prompt}"`,
        "Claude Code started",
        "→ Read src/island/Tray.tsx",
        "Picking up the notch tray work where I stopped.",
      ]);
      publish(ctx);
      ctx.emit("flo://claude", { id: `ac_${Date.now()}`, kind: "resumed", sessionId: e.sessionId, project: e.project, cwd: e.cwd, message: "Continuing where it left off.", at: new Date().toISOString(), seen: false });
      return null;
    }
    case "cancel_auto_continue": {
      calls.push({ cmd, args });
      const e = find(args.sessionId);
      Object.assign(e, { status: "cancelled", detail: e.status === "resuming" ? "Stopped from Flo." : "Cancelled.", updatedAt: new Date().toISOString() });
      publish(ctx);
      return null;
    }
    case "dismiss_auto_continue": {
      calls.push({ cmd, args });
      const i = entries.findIndex((x) => x.sessionId === args.sessionId);
      if (i >= 0 && entries[i].status !== "resuming") entries.splice(i, 1);
      publish(ctx);
      return null;
    }
    case "auto_continue_log":
      return logs.get(String(args.sessionId)) ?? [];
    default:
      return UNHANDLED;
  }
}
