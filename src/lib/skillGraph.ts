// A skill drawn as a canvas: nodes you connect, compiled into the skill Flo runs.
//   trigger  — phrases that invoke it ("proposal for this job")
//   schedule — a cron schedule it also runs on by itself ("0 9 * * 1-5")
//   step     — one instruction; steps run in the order the arrows connect them
//   platform — where it works (Upwork, Slack…, or a custom platform you added)
//   mcp      — an MCP server whose tools Flo may call
//   knowledge— a document from Knowledge to use as reference
//   output   — what happens at the end: write into the field, or do it on screen
import { cronError } from "./cron";
import type { GeneratedSkill, Skill } from "./types";

export type SkillNodeKind = "trigger" | "schedule" | "step" | "platform" | "mcp" | "knowledge" | "output";

export interface SkillNodeData extends Record<string, unknown> {
  /** trigger: phrases · step: instruction · platform/mcp/knowledge: display label */
  text?: string;
  /** platform id ("upwork"…) or connection id or "doc:<id>" */
  ref?: string;
  /** output */
  mode?: "write" | "do";
  /** schedule: 5-field cron */
  cron?: string;
}

export interface SkillNode {
  id: string;
  type: SkillNodeKind;
  position: { x: number; y: number };
  data: SkillNodeData;
}

export interface SkillEdge {
  id: string;
  source: string;
  target: string;
}

export interface SkillGraph {
  nodes: SkillNode[];
  edges: SkillEdge[];
}

export interface CompiledSkill {
  triggers: string;
  instructions: string;
  platforms: string[];
  connections: string[];
  mode: "write" | "do";
  /** cron it runs on by itself ("" = only when asked) */
  schedule: string;
  /** human-readable problems ("No steps yet") */
  warnings: string[];
}

/** Built-in platform ids (custom ones are connection ids). */
export const BUILTIN_PLATFORMS = ["upwork", "slack", "gmail", "linkedin", "whatsapp", "browser", "any"];

/**
 * Steps in run order: follow arrows from triggers through steps (breadth-first, by position for
 * ties); steps nobody points to come after, top to bottom, so nothing the user wrote is lost.
 */
export function orderedSteps(g: SkillGraph): SkillNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of g.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const starts = g.nodes.filter((n) => n.type === "trigger" || n.type === "schedule").sort((a, b) => a.position.y - b.position.y);
  const seen = new Set<string>();
  const order: SkillNode[] = [];
  const queue = [...starts.map((s) => s.id)];
  while (queue.length) {
    const id = queue.shift()!;
    const next = (out.get(id) ?? []).map((t) => byId.get(t)!).filter(Boolean).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    for (const n of next) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (n.type === "step") order.push(n);
      queue.push(n.id);
    }
  }
  const loose = g.nodes.filter((n) => n.type === "step" && !seen.has(n.id)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return [...order, ...loose];
}

/** Turn the canvas into the skill Flo runs. `names` maps connection / doc ids to labels. */
export function compileSkill(g: SkillGraph, names: Record<string, string> = {}): CompiledSkill {
  const warnings: string[] = [];
  const triggers = g.nodes
    .filter((n) => n.type === "trigger")
    .flatMap((n) => (n.data.text ?? "").split(","))
    .map((t) => t.trim())
    .filter(Boolean);
  const steps = orderedSteps(g)
    .map((n) => (n.data.text ?? "").trim())
    .filter(Boolean);
  const refs = (kind: SkillNodeKind) => [...new Set(g.nodes.filter((n) => n.type === kind && n.data.ref).map((n) => n.data.ref!))];
  const platformRefs = refs("platform");
  const platforms = platformRefs.filter((r) => BUILTIN_PLATFORMS.includes(r));
  const customPlatforms = platformRefs.filter((r) => !BUILTIN_PLATFORMS.includes(r));
  const mcp = refs("mcp");
  const docs = refs("knowledge");
  const output = g.nodes.find((n) => n.type === "output");
  const mode = output?.data.mode === "do" ? "do" : "write";
  const scheduleNode = g.nodes.find((n) => n.type === "schedule");
  const cron = (scheduleNode?.data.cron ?? "").trim();
  const cronErr = scheduleNode ? (cron ? cronError(cron) : "Pick when it should run.") : null;
  const schedule = scheduleNode && !cronErr ? cron.split(/\s+/).join(" ") : "";

  const lines: string[] = [];
  if (steps.length === 1) lines.push(steps[0]);
  else steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  const label = (id: string) => names[id] ?? id;
  if (customPlatforms.length) lines.push(`Works on: ${customPlatforms.map(label).join(", ")}.`);
  if (mcp.length) lines.push(`You can use the tools from: ${mcp.map(label).join(", ")}.`);
  if (docs.length) lines.push(`Use my reference documents: ${docs.map(label).join(", ")}.`);
  lines.push(mode === "do" ? "Finish by doing it on screen. Ask before sending, posting, paying or deleting." : "Finish by typing the result into the field I'm in.");

  if (!triggers.length && !scheduleNode) warnings.push("Add a Trigger with the words that start this skill, or a Schedule.");
  if (cronErr) warnings.push(`Fix the Schedule: ${cronErr}`);
  if (!steps.length) warnings.push("Add at least one Step that says what to do.");
  if (!output) warnings.push("Add an Output: write it, or do it on screen.");

  return {
    triggers: triggers.join(", "),
    instructions: lines.join("\n"),
    platforms,
    connections: [...customPlatforms, ...mcp, ...docs],
    mode,
    schedule,
    warnings,
  };
}

/** Canvas node footprint (px) used for layout and free-spot search. */
export const NODE_W = 240;
export const NODE_H = 150;
const GAP_X = 80;

/** First spot near `want` where a node doesn't overlap any other (spiral search on a grid). */
export function freeSpot(nodes: Pick<SkillNode, "position">[], want: { x: number; y: number }): { x: number; y: number } {
  const hits = (x: number, y: number) =>
    nodes.some((n) => x < n.position.x + NODE_W + 20 && x + NODE_W + 20 > n.position.x && y < n.position.y + NODE_H + 16 && y + NODE_H + 16 > n.position.y);
  if (!hits(want.x, want.y)) return want;
  for (let r = 1; r < 40; r++) {
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const x = want.x + dx * r * 60;
      const y = want.y + dy * r * 60;
      if (!hits(x, y)) return { x, y };
    }
  }
  return { x: want.x, y: want.y + 40 * nodes.length };
}

/**
 * Wire a newly added node into the graph the way people usually mean it: attachments hang off the
 * last step, a new step goes after the last step (before the output), a trigger feeds the first
 * step, an output follows the last step. Returns the edges to add / remove.
 */
export function autoWire(g: SkillGraph, added: SkillNode): { add: SkillEdge[]; remove: string[] } {
  const steps = orderedSteps(g).filter((n) => n.id !== added.id);
  const last = steps[steps.length - 1];
  const first = steps[0];
  const output = g.nodes.find((n) => n.type === "output" && n.id !== added.id);
  const e = (source: string, target: string): SkillEdge => ({ id: `e-${source}-${target}`, source, target });
  switch (added.type) {
    case "platform":
    case "mcp":
    case "knowledge":
      return { add: last ? [e(last.id, added.id)] : [], remove: [] };
    case "step": {
      if (!last) {
        const starts = g.nodes.filter((n) => n.type === "trigger" || n.type === "schedule");
        return { add: [...starts.map((t) => e(t.id, added.id)), ...(output ? [e(added.id, output.id)] : [])], remove: [] };
      }
      const toOut = output ? g.edges.filter((x) => x.source === last.id && x.target === output.id).map((x) => x.id) : [];
      return { add: [e(last.id, added.id), ...(output ? [e(added.id, output.id)] : [])], remove: toOut };
    }
    case "trigger":
    case "schedule":
      return { add: first ? [e(added.id, first.id)] : [], remove: [] };
    case "output":
      return { add: last ? [e(last.id, added.id)] : [], remove: [] };
  }
}

let seq = 0;
export const nodeId = (kind: SkillNodeKind) => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A canvas for a skill: its saved graph, or one laid out from its fields (older skills, templates). */
export function graphFromSkill(k: Pick<Skill, "triggers" | "instructions" | "platforms" | "mode"> & { graph?: string; connections?: string[]; schedule?: string | null }): SkillGraph {
  if (k.graph) {
    try {
      const g = JSON.parse(k.graph) as SkillGraph;
      if (Array.isArray(g.nodes) && Array.isArray(g.edges)) return g;
    } catch {
      /* fall through to a fresh layout */
    }
  }
  const trigger: SkillNode = { id: "trigger", type: "trigger", position: { x: 0, y: 40 }, data: { text: k.triggers } };
  const step: SkillNode = { id: "step-1", type: "step", position: { x: NODE_W + GAP_X, y: 0 }, data: { text: k.instructions } };
  const output: SkillNode = { id: "output", type: "output", position: { x: 2 * (NODE_W + GAP_X), y: 40 }, data: { mode: k.mode === "do" ? "do" : "write" } };
  const nodes: SkillNode[] = [trigger, step, output];
  const edges: SkillEdge[] = [
    { id: "e-trigger-step", source: "trigger", target: "step-1" },
    { id: "e-step-output", source: "step-1", target: "output" },
  ];
  [...k.platforms, ...(k.connections ?? [])].forEach((ref, i) => {
    const type: SkillNodeKind = ref.startsWith("doc:") ? "knowledge" : BUILTIN_PLATFORMS.includes(ref) ? "platform" : "mcp";
    const id = `${type}-${i}`;
    // attachments in a row under the step, never overlapping (node width + gap)
    nodes.push({ id, type, position: { x: NODE_W + GAP_X + (i % 3) * (NODE_W + 40), y: 230 + Math.floor(i / 3) * 140 }, data: { ref } });
    edges.push({ id: `e-step-${id}`, source: "step-1", target: id });
  });
  if (k.schedule) {
    nodes.push({ id: "schedule", type: "schedule", position: { x: 0, y: 260 }, data: { cron: k.schedule } });
    edges.push({ id: "e-schedule-step", source: "schedule", target: "step-1" });
  }
  return { nodes, edges };
}

/**
 * Lay out a skill drafted by "Build with AI": trigger and schedule on the left, steps left to right,
 * the output after the last step, and each platform / server / document under the step that
 * mentions it (else the last step). Node order = the order they're revealed in.
 */
export function graphFromGenerated(gen: GeneratedSkill, names: Record<string, string> = {}): SkillGraph {
  const col = (i: number) => i * (NODE_W + GAP_X);
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];
  const e = (source: string, target: string) => edges.push({ id: `e-${source}-${target}`, source, target });
  const hasTrigger = gen.triggers.length > 0 || !gen.schedule;
  if (hasTrigger) nodes.push({ id: nodeId("trigger"), type: "trigger", position: { x: 0, y: gen.schedule ? -90 : 20 }, data: { text: gen.triggers.join(", ") } });
  if (gen.schedule) nodes.push({ id: nodeId("schedule"), type: "schedule", position: { x: 0, y: hasTrigger ? 120 : 20 }, data: { cron: gen.schedule } });
  const starts = nodes.map((n) => n.id);
  const steps: SkillNode[] = gen.steps.map((text, i) => ({ id: nodeId("step"), type: "step", position: { x: col(i + 1), y: 0 }, data: { text } }));
  steps.forEach((s, i) => {
    nodes.push(s);
    if (i === 0) starts.forEach((t) => e(t, s.id));
    else e(steps[i - 1].id, s.id);
  });
  const last = steps[steps.length - 1];
  const output: SkillNode = { id: nodeId("output"), type: "output", position: { x: col(steps.length + 1), y: 20 }, data: { mode: gen.mode === "do" ? "do" : "write" } };
  // attachments: under the step that mentions them, stacked when several share a step
  const label = (ref: string) => (names[ref] ?? PLATFORM_LABELS[ref] ?? ref).toLowerCase();
  const perStep = new Map<string, number>();
  const attach = (ref: string, type: SkillNodeKind) => {
    const words = label(ref).split(/\s+/).filter((w) => w.length > 2);
    const host = steps.find((s) => words.some((w) => (s.data.text ?? "").toLowerCase().includes(w))) ?? last;
    if (!host) return;
    const k = perStep.get(host.id) ?? 0;
    perStep.set(host.id, k + 1);
    const node: SkillNode = { id: nodeId(type), type, position: freeSpot(nodes, { x: host.position.x, y: 230 + k * 150 }), data: { ref } };
    nodes.push(node);
    e(host.id, node.id);
  };
  gen.platforms.forEach((r) => attach(r, "platform"));
  gen.mcp.forEach((r) => attach(r, "mcp"));
  gen.knowledge.forEach((r) => attach(r, "knowledge"));
  nodes.push(output);
  if (last) e(last.id, output.id);
  return { nodes, edges };
}

const PLATFORM_LABELS: Record<string, string> = { upwork: "Upwork", slack: "Slack", gmail: "Gmail", linkedin: "LinkedIn", whatsapp: "WhatsApp", browser: "website browser", any: "app" };

/** The skill as text for "Refine with AI" (what the canvas compiles to). */
export function describeForAi(name: string, c: CompiledSkill, names: Record<string, string> = {}): string {
  const label = (id: string) => names[id] ?? PLATFORM_LABELS[id] ?? id;
  return [
    `Name: ${name || "(unnamed)"}`,
    `Triggers: ${c.triggers || "(none)"}`,
    `Schedule (cron): ${c.schedule || "none"}`,
    `Steps and notes:\n${c.instructions}`,
    `Platforms: ${c.platforms.map(label).join(", ") || "(none)"}`,
    `Connections (MCP servers, custom platforms, documents): ${c.connections.map((x) => `${label(x)} [${x}]`).join(", ") || "(none)"}`,
    `Output: ${c.mode}`,
  ].join("\n");
}
