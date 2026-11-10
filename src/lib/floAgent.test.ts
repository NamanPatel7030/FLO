import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG, slackReadiness, type HermesStatus } from "./floAgent";

const base: HermesStatus = {
  installed: true,
  outdated: false,
  testedVersion: "0.22.5",
  running: true,
  healthy: true,
  port: 8642,
  home: "/h",
  slackRunning: true,
  slackBotToken: true,
  slackAppToken: true,
  installCommand: "",
  docsUrl: "",
  playing: true,
  phase: "live",
  restarts: 0,
  appleSilicon: true,
  installing: false,
  slackAppUrl: "",
};
const cfg = { ...DEFAULT_AGENT_CONFIG, slackAllowedUsers: "U0AR547TTRS" };
const why = (st: Partial<HermesStatus>, c = cfg, bot: any = null) => slackReadiness({ ...base, ...st }, c, bot).blocker;

describe("slackReadiness: why '@Flo' got no answer", () => {
  it("is answering when everything is set up and live", () => {
    const r = slackReadiness(base, cfg, { ok: true, bot: "flo", team: "Northwind" });
    expect(r.blocker).toBeNull();
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.botReady).toBe(true);
  });

  it("the user's case: tokens and allow-list saved, Hermes not installed", () => {
    const r = slackReadiness({ ...base, installed: false, running: false, healthy: false, slackRunning: false, playing: false, phase: "not_installed" }, cfg, null);
    expect(r.blocker).toMatch(/Hermes isn't installed/);
    expect(r.checks.find((c) => c.id === "installed")?.ok).toBe(false);
    expect(r.botReady).toBe(true);
  });

  it("names each blocker in order", () => {
    expect(why({ installing: true })).toMatch(/installing/);
    expect(why({ installed: false, appleSilicon: false })).toMatch(/Apple Silicon/);
    expect(why({ slackBotToken: false })).toMatch(/bot token is missing/);
    expect(why({}, cfg, { ok: false, error: "Slack says this bot token isn't valid." })).toMatch(/isn't valid/);
    expect(why({ slackAppToken: false })).toMatch(/app token is missing/);
    expect(why({}, { ...cfg, slackAllowedUsers: "" })).toMatch(/ignores every message/);
    expect(why({ playing: false, running: false, phase: "paused" })).toMatch(/paused/);
    expect(why({ running: false, phase: "error", error: "Hermes keeps stopping" })).toBe("Hermes keeps stopping");
    expect(why({ slackError: "Slack rejected a token." })).toBe("Slack rejected a token.");
    expect(why({ healthy: false, phase: "starting" })).toMatch(/starting/);
    expect(why({ slackRunning: false })).toMatch(/without Slack/);
  });
});
