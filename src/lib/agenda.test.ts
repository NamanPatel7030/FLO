import { describe, expect, it } from "vitest";
import { agendaStatus, gmailComposeUrl, guests, isStructuredNotes, notesOnCount, rowForTime, splitTimestamps } from "./agenda";

const T = Date.parse("2026-11-26T10:00:00Z");
const at = (m: number) => new Date(T + m * 60_000).toISOString();

describe("agenda", () => {
  it("orders status: recording, now, soon, later, done", () => {
    expect(agendaStatus({ start: at(-5), end: at(25), recording: true }, T)).toBe("recording");
    expect(agendaStatus({ start: at(-5), end: at(25), recording: false }, T)).toBe("now");
    expect(agendaStatus({ start: at(10), end: at(40), recording: false }, T)).toBe("soon");
    expect(agendaStatus({ start: at(60), end: at(90), recording: false }, T)).toBe("later");
    expect(agendaStatus({ start: at(-60), end: at(-30), recording: false }, T)).toBe("done");
  });

  it("lists guests without the user or decliners", () => {
    const a = (name: string, self = false, response = "accepted") => ({ name, email: `${name}@x.com`, self, response });
    expect(guests({ attendees: [a("Jake", true), a("Priya"), a("Dan", false, "declined"), a("Rahul", false, "tentative")] })).toEqual(["Priya", "Rahul"]);
  });

  it("counts meetings still ahead with notes on", () => {
    expect(notesOnCount([{ takeNotes: true, end: at(30) }, { takeNotes: false, end: at(30) }, { takeNotes: true, end: at(-1) }], T)).toBe(1);
  });

  it("finds [mm:ss] and [h:mm:ss] timestamps", () => {
    expect(splitTimestamps("**Priya**: ship it [02:14] then [1:02:03].")).toEqual([
      { t: "text", v: "**Priya**: ship it " },
      { t: "ts", v: "02:14", sec: 134 },
      { t: "text", v: " then " },
      { t: "ts", v: "1:02:03", sec: 3723 },
      { t: "text", v: "." },
    ]);
    expect(splitTimestamps("no times")).toEqual([{ t: "text", v: "no times" }]);
    expect(splitTimestamps("[link](x) [99]")).toEqual([{ t: "text", v: "[link](x) [99]" }]);
  });

  it("maps a timestamp to its transcript row", () => {
    const times = [2, 134, 220, 485];
    expect(rowForTime(times, 134)).toBe(1);
    expect(rowForTime(times, 300)).toBe(2);
    expect(rowForTime(times, 0)).toBe(0);
    expect(rowForTime(times, 9999)).toBe(3);
  });

  it("tells structured notes from plain bullets", () => {
    expect(isStructuredNotes("## Overview\nHi")).toBe(true);
    expect(isStructuredNotes("- a\n- b")).toBe(false);
  });

  it("builds a Gmail compose link (draft, user sends)", () => {
    const u = new URL(gmailComposeUrl(["a@x.com", "b@x.com"], "Follow-up: Sync", "Hi all,\n- one"));
    expect(u.host).toBe("mail.google.com");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("to")).toBe("a@x.com,b@x.com");
    expect(u.searchParams.get("body")).toBe("Hi all,\n- one");
  });
});
