import { describe, expect, it } from "vitest";
import { autoWire, compileSkill, describeForAi, freeSpot, graphFromGenerated, graphFromSkill, NODE_W, NODE_H, orderedSteps, type SkillGraph } from "./skillGraph";

const g: SkillGraph = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { text: "proposal for this job, apply to this job" } },
    { id: "s2", type: "step", position: { x: 300, y: 0 }, data: { text: "Write a 300-word proposal" } },
    { id: "s1", type: "step", position: { x: 150, y: 0 }, data: { text: "Read the job post on screen" } },
    { id: "s3", type: "step", position: { x: 450, y: 0 }, data: { text: "End with one sharp question" } },
    { id: "p", type: "platform", position: { x: 300, y: 200 }, data: { ref: "upwork" } },
    { id: "m", type: "mcp", position: { x: 300, y: 300 }, data: { ref: "conn-notion" } },
    { id: "k", type: "knowledge", position: { x: 300, y: 400 }, data: { ref: "doc:portfolio" } },
    { id: "o", type: "output", position: { x: 600, y: 0 }, data: { mode: "write" } },
  ],
  edges: [
    { id: "1", source: "t", target: "s1" },
    { id: "2", source: "s1", target: "s2" },
    { id: "3", source: "s2", target: "s3" },
    { id: "4", source: "s3", target: "o" },
    { id: "5", source: "s2", target: "p" },
    { id: "6", source: "s2", target: "m" },
    { id: "7", source: "s2", target: "k" },
  ],
};

describe("skill canvas → skill", () => {
  it("runs steps in arrow order, not in the order they were added", () => {
    expect(orderedSteps(g).map((n) => n.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("compiles triggers, numbered steps, platforms, tools, docs and mode", () => {
    const c = compileSkill(g, { "conn-notion": "Notion MCP", "doc:portfolio": "Portfolio" });
    expect(c.triggers).toBe("proposal for this job, apply to this job");
    expect(c.instructions).toContain("1. Read the job post on screen\n2. Write a 300-word proposal\n3. End with one sharp question");
    expect(c.instructions).toContain("tools from: Notion MCP");
    expect(c.instructions).toContain("reference documents: Portfolio");
    expect(c.platforms).toEqual(["upwork"]);
    expect(c.connections).toEqual(["conn-notion", "doc:portfolio"]);
    expect(c.mode).toBe("write");
    expect(c.warnings).toEqual([]);
  });

  it("keeps unconnected steps instead of dropping them, and warns about missing parts", () => {
    const loose: SkillGraph = { nodes: [{ id: "x", type: "step", position: { x: 0, y: 0 }, data: { text: "Do the thing" } }], edges: [] };
    const c = compileSkill(loose);
    expect(c.instructions).toContain("Do the thing");
    expect(c.warnings.join(" ")).toMatch(/Trigger/);
    expect(c.warnings.join(" ")).toMatch(/Output/);
  });

  it("lays out older skills as a canvas and round-trips a saved one", () => {
    const fresh = graphFromSkill({ triggers: "reply on slack", instructions: "Reply briefly", platforms: ["slack"], mode: "do", connections: ["doc:faq"] });
    const c = compileSkill(fresh);
    expect(c.triggers).toBe("reply on slack");
    expect(c.mode).toBe("do");
    expect(c.platforms).toEqual(["slack"]);
    expect(c.connections).toEqual(["doc:faq"]);
    const saved = graphFromSkill({ triggers: "", instructions: "", platforms: [], mode: "write", graph: JSON.stringify(g) });
    expect(saved.nodes).toHaveLength(g.nodes.length);
  });
});

describe("adding nodes on the canvas", () => {
  it("never places a node on top of another", () => {
    const nodes = [{ position: { x: 0, y: 0 } }, { position: { x: 0, y: 200 } }];
    const p = freeSpot(nodes, { x: 10, y: 10 });
    const overlaps = nodes.some((n) => p.x < n.position.x + NODE_W && p.x + NODE_W > n.position.x && p.y < n.position.y + 150 && p.y + 150 > n.position.y);
    expect(overlaps).toBe(false);
  });

  it("wires new nodes in: attachments off the last step, a new step before the output", () => {
    const mcp = { id: "m2", type: "mcp" as const, position: { x: 0, y: 0 }, data: {} };
    expect(autoWire({ nodes: [...g.nodes, mcp], edges: g.edges }, mcp).add).toEqual([{ id: "e-s3-m2", source: "s3", target: "m2" }]);
    const step = { id: "s4", type: "step" as const, position: { x: 500, y: 0 }, data: { text: "Proofread it" } };
    const w = autoWire({ nodes: [...g.nodes, step], edges: g.edges }, step);
    expect(w.add.map((e) => [e.source, e.target])).toEqual([["s3", "s4"], ["s4", "o"]]);
    expect(w.remove).toEqual(["4"]); // s3 → output is replaced by s3 → s4 → output
    const edges = [...g.edges.filter((e) => !w.remove.includes(e.id)), ...w.add];
    expect(compileSkill({ nodes: [...g.nodes, step], edges }).instructions).toContain("4. Proofread it");
  });

  it("lays template attachments out without overlap", () => {
    const fresh = graphFromSkill({ triggers: "x", instructions: "y", platforms: ["upwork", "browser", "slack"], mode: "write" });
    const att = fresh.nodes.filter((n) => n.type === "platform");
    for (let i = 1; i < att.length; i++) expect(att[i].position.x - att[i - 1].position.x).toBeGreaterThanOrEqual(NODE_W);
  });

  it("a Schedule starts the skill like a trigger and compiles to its cron", () => {
    const sg: SkillGraph = {
      nodes: [
        { id: "c", type: "schedule", position: { x: 0, y: 0 }, data: { cron: " 0 9  * * 1-5 " } },
        { id: "s", type: "step", position: { x: 300, y: 0 }, data: { text: "Summarise my inbox" } },
        { id: "o", type: "output", position: { x: 600, y: 0 }, data: { mode: "write" } },
      ],
      edges: [
        { id: "1", source: "c", target: "s" },
        { id: "2", source: "s", target: "o" },
      ],
    };
    const c = compileSkill(sg);
    expect(c.schedule).toBe("0 9 * * 1-5");
    // a schedule alone is enough: no trigger warning
    expect(c.warnings).toEqual([]);
    expect(compileSkill({ ...sg, nodes: sg.nodes.map((n) => (n.id === "c" ? { ...n, data: { cron: "61 * * * *" } } : n)) }).warnings.join(" ")).toMatch(/Fix the Schedule: minute/);
    expect(compileSkill(g).schedule).toBe("");
    // a new schedule node feeds the first step
    const w = autoWire({ nodes: [...g.nodes, { id: "c2", type: "schedule", position: { x: 0, y: 0 }, data: {} }], edges: g.edges }, { id: "c2", type: "schedule", position: { x: 0, y: 0 }, data: {} });
    expect(w.add).toEqual([{ id: "e-c2-s1", source: "c2", target: "s1" }]);
    // older skills with a schedule get a Schedule node
    const fresh = graphFromSkill({ triggers: "digest", instructions: "x", platforms: [], mode: "write", schedule: "0 9 * * *" });
    expect(compileSkill(fresh).schedule).toBe("0 9 * * *");
  });

  it("lays out an AI-drafted skill: steps in order, attachments under the step that mentions them, no overlaps", () => {
    const gen = {
      name: "Daily inbox digest",
      triggers: ["inbox digest"],
      schedule: "0 9 * * 1-5",
      steps: ["Read my unread Gmail", "Summarise it in 5 bullets", "Post it to #daily in Slack"],
      platforms: ["gmail"],
      mcp: ["c2"],
      knowledge: [],
      mode: "do" as const,
      notes: [],
    };
    const lg = graphFromGenerated(gen, { c2: "Slack" });
    const c = compileSkill(lg, { c2: "Slack" });
    expect(c.triggers).toBe("inbox digest");
    expect(c.schedule).toBe("0 9 * * 1-5");
    expect(c.instructions).toMatch(/^1\. Read my unread Gmail\n2\. Summarise it in 5 bullets\n3\. Post it to #daily in Slack/);
    expect(c.platforms).toEqual(["gmail"]);
    expect(c.connections).toEqual(["c2"]);
    expect(c.mode).toBe("do");
    expect(c.warnings).toEqual([]);
    const steps = orderedSteps(lg);
    const host = (ref: string) => lg.edges.find((e) => e.target === lg.nodes.find((n) => n.data.ref === ref)!.id)!.source;
    expect(host("gmail")).toBe(steps[0].id);
    expect(host("c2")).toBe(steps[2].id);
    for (const a of lg.nodes)
      for (const b of lg.nodes)
        if (a !== b) expect(Math.abs(a.position.x - b.position.x) < NODE_W && Math.abs(a.position.y - b.position.y) < NODE_H - 40).toBe(false);
    // the last node revealed is the output
    expect(lg.nodes[lg.nodes.length - 1].type).toBe("output");
    // no trigger phrases and no schedule: still gets a trigger node to fill in
    expect(graphFromGenerated({ ...gen, triggers: [], schedule: null }).nodes.some((n) => n.type === "trigger")).toBe(true);
    expect(graphFromGenerated({ ...gen, triggers: [] }).nodes.some((n) => n.type === "trigger")).toBe(false);
  });

  it("describes the canvas for Refine with AI", () => {
    const d = describeForAi("Proposal", compileSkill(g, { "conn-notion": "Notion" }), { "conn-notion": "Notion" });
    expect(d).toContain("Name: Proposal");
    expect(d).toContain("Schedule (cron): none");
    expect(d).toContain("Notion [conn-notion]");
    expect(d).toContain("1. Read the job post on screen");
  });
});
