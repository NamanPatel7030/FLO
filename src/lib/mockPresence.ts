// Browser mock for presence + paired phones (push.rs commands). Hooked into mock.ts's default case.
// Tests steer it through window.__floPresenceMock: claim() pairs a phone with the current code,
// pushes lists what "reached the server".
import type { PairCode, PhoneDevice, PresenceInfo, PushResult } from "./types";
import { UNHANDLED } from "./mockCode";

interface Ctx {
  settings: { presence?: "active" | "away"; autoAway?: boolean; autoAwayMinutes?: number };
  emit: (event: string, payload: unknown) => void;
  signedIn: () => boolean;
}

const state = {
  devices: [{ id: "d_pixel", name: "Pixel 8", platform: "android", lastSeen: new Date(Date.now() - 12 * 60_000).toISOString() }] as PhoneDevice[],
  code: null as (PairCode & { digits: string }) | null,
  pushes: [] as { kind: string; title: string; body: string }[],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function info(ctx: Ctx): PresenceInfo {
  return { status: ctx.settings.presence === "away" ? "away" : "active", signedIn: ctx.signedIn(), auto: false };
}

function hooks(ctx: Ctx) {
  if (typeof window === "undefined") return;
  (window as any).__floPresenceMock = {
    state,
    /** a phone scans the QR / types the code */
    claim: (name = "Galaxy S25") => {
      if (!state.code || Date.parse(state.code.expiresAt) < Date.now()) return false;
      state.code = null;
      state.devices.unshift({ id: `d_${Math.random().toString(36).slice(2, 8)}`, name, platform: "android", lastSeen: new Date().toISOString() });
      return true;
    },
    /** the phone flipped presence (or auto-away fired) */
    remote: (status: "active" | "away") => {
      ctx.settings.presence = status;
      ctx.emit("flo://presence", info(ctx));
    },
  };
}

export async function presenceMock(cmd: string, args: Record<string, any>, ctx: Ctx): Promise<unknown> {
  hooks(ctx);
  switch (cmd) {
    case "get_presence":
      return info(ctx);
    case "set_presence": {
      if (args.status !== "active" && args.status !== "away") throw 'status must be "active" or "away"';
      const was = ctx.settings.presence;
      ctx.settings.presence = args.status;
      const p = info(ctx);
      ctx.emit("flo://presence", p);
      if (was !== "away" && args.status === "away" && p.signedIn) state.pushes.push({ kind: "todos_digest", title: "3 to-dos for today", body: "Ship the deck · Call Rahul · Review PR" });
      return p;
    }
    case "pair_phone_start": {
      await sleep(250);
      if (!ctx.signedIn()) throw "Sign in to your Flo account to use your phone.";
      const digits = String(Math.floor(100000 + Math.random() * 900000));
      state.code = {
        digits,
        code: `${digits.slice(0, 3)} ${digits.slice(3)}`,
        payload: `flo-pair://flo.app/${digits}?scheme=https`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
      const { digits: _d, ...out } = state.code;
      return out;
    }
    case "list_phones":
      await sleep(120);
      if (!ctx.signedIn()) throw "Sign in to your Flo account to use your phone.";
      return state.devices.map((d) => ({ ...d }));
    case "remove_phone":
      state.devices = state.devices.filter((d) => d.id !== args.id);
      return null;
    case "send_test_push": {
      await sleep(300);
      if (ctx.settings.presence !== "away") throw "You're Active, so nothing goes to your phone. Switch to Away to test.";
      state.pushes.push({ kind: "reminder", title: "Test from Flo", body: "Notifications reach this phone while you're away from your Mac." });
      const r: PushResult = state.devices.length ? { stored: true, pushed: state.devices.length } : { stored: true, pushed: 0, reason: "no paired devices" };
      return r;
    }
    default:
      return UNHANDLED;
  }
}
