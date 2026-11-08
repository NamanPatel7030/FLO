// The skill editor as a canvas: drop nodes, connect them, and see the skill they generate.
// Triggers start it, Steps run in arrow order, Platforms / MCP servers / Knowledge docs attach to
// steps, and the Output says how it ends (write into the field, or do it on screen).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { AlertTriangle, ArrowUp, BookText, Boxes, ChevronDown, Clock, Flag, Globe, ListOrdered, Loader2, MousePointerClick, PenLine, Plug, RotateCcw, Sparkles, Trash2, WandSparkles, X, Zap } from "lucide-react";
import { api } from "../lib/api";
import { cronError, cronFromForm, describeCron, formatRun, formFromCron, nextRun, PRESETS, WEEKDAYS, type ScheduleForm } from "../lib/cron";
import type { Connection, ContextDoc, Skill } from "../lib/types";
import {
  autoWire,
  compileSkill,
  describeForAi,
  freeSpot,
  graphFromGenerated,
  graphFromSkill,
  nodeId,
  NODE_W,
  orderedSteps,
  type SkillEdge,
  type SkillGraph,
  type SkillNode,
  type SkillNodeData,
  type SkillNodeKind,
} from "../lib/skillGraph";
import { PLATFORMS } from "./platforms";
import { SlackIcon, useSlackConnected } from "./SlackCard";
import { Button } from "./ui";

type FlowNode = Node<SkillNodeData, SkillNodeKind>;

const KIND: Record<SkillNodeKind, { label: string; hint: string; color: string; icon: React.ReactNode }> = {
  trigger: { label: "Trigger", hint: "Words that start it", color: "#f5b94a", icon: <Zap size={13} /> },
  schedule: { label: "Schedule", hint: "Runs by itself", color: "#ff8a5c", icon: <Clock size={13} /> },
  step: { label: "Step", hint: "One thing to do", color: "#3dbbff", icon: <ListOrdered size={13} /> },
  platform: { label: "Platform", hint: "Where it works", color: "#34d399", icon: <Globe size={13} /> },
  mcp: { label: "MCP server", hint: "Tools Flo can call", color: "#a78bfa", icon: <Plug size={13} /> },
  knowledge: { label: "Knowledge", hint: "A document to use", color: "#f472b6", icon: <BookText size={13} /> },
  output: { label: "Output", hint: "How it ends", color: "#2dd4bf", icon: <Flag size={13} /> },
};

/** Lists the pickers inside nodes choose from. */
const Picks = createContext<{ platforms: Connection[]; mcps: Connection[]; docs: ContextDoc[] }>({ platforms: [], mcps: [], docs: [] });

const inputCls = "nodrag w-full rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]";

function Shell({ id, kind, selected, children, target = true, source = true }: { id: string; kind: SkillNodeKind; selected?: boolean; children: React.ReactNode; target?: boolean; source?: boolean }) {
  const k = KIND[kind];
  const { deleteElements } = useReactFlow();
  return (
    <div
      className={clsx("group/node relative w-[240px] rounded-2xl border bg-[#0d1722] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] transition", selected ? "border-white/40" : "border-white/10")}
      style={{ boxShadow: selected ? `0 0 0 1px ${k.color}, 0 12px 34px -12px ${k.color}66` : undefined }}
      data-testid={`node-${kind}`}
    >
      <div className="flex cursor-grab items-center gap-1.5 rounded-t-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-wider active:cursor-grabbing" style={{ color: k.color, background: `${k.color}14` }}>
        {k.icon} <span className="flex-1">{k.label}</span>
        {/* delete: appears on hover (or when selected) */}
        <button
          aria-label={`Delete ${k.label}`}
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            deleteElements({ nodes: [{ id }] });
          }}
          className={clsx(
            "nodrag -mr-1 flex h-5 w-5 items-center justify-center rounded-md text-white/50 transition hover:bg-red-500/20 hover:text-red-300",
            selected ? "opacity-100" : "opacity-0 group-hover/node:opacity-100 focus:opacity-100",
          )}
        >
          <X size={12} />
        </button>
      </div>
      <div className="px-3 pb-3 pt-2">{children}</div>
      {target && <Handle type="target" position={Position.Left} style={{ background: k.color, width: 10, height: 10, border: "2px solid #0d1722" }} />}
      {source && <Handle type="source" position={Position.Right} style={{ background: k.color, width: 10, height: 10, border: "2px solid #0d1722" }} />}
    </div>
  );
}

function useData(id: string) {
  const { updateNodeData } = useReactFlow();
  return (patch: Partial<SkillNodeData>) => updateNodeData(id, patch);
}

function TriggerNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  return (
    <Shell id={id} kind="trigger" selected={selected} target={false}>
      <input aria-label="Trigger phrases" className={inputCls} placeholder="proposal for this job, apply…" value={data.text ?? ""} onChange={(e) => set({ text: e.target.value })} />
      <div className="mt-1.5 text-[10.5px] text-white/40">Comma-separated. The skill's name works too.</div>
    </Shell>
  );
}

const DEFAULT_CRON = "0 9 * * 1-5";

function ScheduleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  const cron = data.cron ?? "";
  const [form, setForm] = useState<ScheduleForm>(() => formFromCron(cron || DEFAULT_CRON));
  const [advanced, setAdvanced] = useState(() => formFromCron(cron || DEFAULT_CRON).preset === "custom");
  // the cron changed from outside (Build with AI): show it on the matching preset
  useEffect(() => {
    if (form.preset !== "custom" && cron && cronFromForm(form) !== cron) {
      const f = formFromCron(cron);
      setForm(f);
      if (f.preset === "custom") setAdvanced(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]);
  const update = (patch: Partial<ScheduleForm>) => {
    const f = { ...form, ...patch };
    setForm(f);
    if (f.preset === "custom") setAdvanced(true);
    else set({ cron: cronFromForm(f) });
  };
  const err = cron.trim() ? cronError(cron) : "Pick when it should run.";
  const next = err ? null : nextRun(cron);
  const sel = inputCls + " nowheel appearance-none bg-no-repeat pr-7";
  const chevron = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23ffffff80' stroke-width='3'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right 9px center" };
  return (
    <Shell id={id} kind="schedule" selected={selected} target={false}>
      <div className="space-y-1.5">
        <select aria-label="Repeat" className={sel} style={chevron} value={form.preset} onChange={(e) => update({ preset: e.target.value as ScheduleForm["preset"] })}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {form.preset === "weekly" && (
          <select aria-label="Day" className={sel} style={chevron} value={form.day} onChange={(e) => update({ day: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        )}
        {(form.preset === "weekdays" || form.preset === "daily" || form.preset === "weekly") && (
          <label className="flex items-center gap-2 text-[11.5px] text-white/50">
            at
            <input aria-label="Time" type="time" className={inputCls + " [color-scheme:dark] tabular-nums"} value={form.time} onChange={(e) => e.target.value && update({ time: e.target.value })} />
          </label>
        )}
        {form.preset === "minutes" && (
          <label className="flex items-center gap-2 text-[11.5px] text-white/50">
            every
            <input
              aria-label="Minutes"
              type="number"
              min={1}
              max={59}
              className={inputCls + " w-16 text-center tabular-nums"}
              value={form.every}
              onChange={(e) => update({ every: Math.min(59, Math.max(1, Number(e.target.value) || 1)) })}
            />
            minutes
          </label>
        )}
      </div>
      <button
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
        className="nodrag mt-2 flex items-center gap-1 text-[10.5px] font-medium text-white/45 transition hover:text-white/80"
      >
        <ChevronDown size={11} className={clsx("transition", advanced ? "rotate-0" : "-rotate-90")} /> Advanced: cron expression
      </button>
      {advanced && (
        <input
          aria-label="Cron expression"
          spellCheck={false}
          className={inputCls + " mt-1.5 font-mono text-[12px] tracking-wide"}
          placeholder="min hour day month weekday"
          value={cron}
          onChange={(e) => {
            set({ cron: e.target.value });
            setForm(formFromCron(e.target.value));
          }}
        />
      )}
      <div
        data-testid="schedule-preview"
        className={clsx("mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug", err ? "bg-red-500/10 text-red-200/90 ring-1 ring-red-400/25" : "bg-[#ff8a5c]/10 text-white/80 ring-1 ring-[#ff8a5c]/25")}
      >
        {err ? (
          err
        ) : (
          <>
            Runs {describeCron(cron)}
            {next && <span className="text-white/50"> · next: {formatRun(next, new Date(), false)}</span>}
          </>
        )}
      </div>
    </Shell>
  );
}

function StepNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  return (
    <Shell id={id} kind="step" selected={selected}>
      <textarea
        aria-label="Step"
        rows={3}
        className={inputCls + " nowheel resize-none leading-snug"}
        placeholder="Read the job post on screen…"
        value={data.text ?? ""}
        onChange={(e) => set({ text: e.target.value })}
      />
    </Shell>
  );
}

function PlatformNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  const { platforms } = useContext(Picks);
  return (
    <Shell id={id} kind="platform" selected={selected} source={false}>
      <select aria-label="Platform" className={inputCls} value={data.ref ?? ""} onChange={(e) => set({ ref: e.target.value })}>
        <option value="">Choose…</option>
        {PLATFORMS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {platforms.length > 0 && (
          <optgroup label="Your platforms">
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {data.ref === "slack" && <SlackShortcut />}
    </Shell>
  );
}

/** Slack picked but not connected → one click to the Connect Slack card. */
function SlackShortcut() {
  const connected = useSlackConnected();
  if (connected !== false) return null;
  return (
    <a href="#/settings/integrations" className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-brand-300 hover:text-brand-200" data-testid="connect-slack-shortcut">
      <SlackIcon size={12} /> Connect Slack →
    </a>
  );
}

function McpNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  const { mcps } = useContext(Picks);
  const chosen = mcps.find((m) => m.id === data.ref);
  return (
    <Shell id={id} kind="mcp" selected={selected} source={false}>
      {mcps.length === 0 ? (
        <div className="text-[11.5px] leading-snug text-white/55">No MCP servers yet. Add one in the Connections tab, then pick it here.</div>
      ) : (
        <>
          <select aria-label="MCP server" className={inputCls} value={data.ref ?? ""} onChange={(e) => set({ ref: e.target.value })}>
            <option value="">Choose a server…</option>
            {mcps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {chosen && <div className="mt-1.5 truncate text-[10.5px] text-white/40">{chosen.transport === "http" ? chosen.url : [chosen.command, ...chosen.args].join(" ")}</div>}
        </>
      )}
    </Shell>
  );
}

function KnowledgeNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  const { docs } = useContext(Picks);
  return (
    <Shell id={id} kind="knowledge" selected={selected} source={false}>
      {docs.length === 0 ? (
        <div className="text-[11.5px] leading-snug text-white/55">No documents yet. Add them in the Knowledge tab.</div>
      ) : (
        <select aria-label="Knowledge document" className={inputCls} value={data.ref ?? ""} onChange={(e) => set({ ref: e.target.value })}>
          <option value="">Choose a document…</option>
          {docs.map((d) => (
            <option key={d.id} value={`doc:${d.id}`}>
              {d.title}
            </option>
          ))}
        </select>
      )}
    </Shell>
  );
}

function OutputNode({ id, data, selected }: NodeProps<FlowNode>) {
  const set = useData(id);
  const mode = data.mode ?? "write";
  return (
    <Shell id={id} kind="output" selected={selected} source={false}>
      <div className="nodrag grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Output">
        {(
          [
            { id: "write", label: "Write it", icon: <PenLine size={12} /> },
            { id: "do", label: "Do it", icon: <MousePointerClick size={12} /> },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => set({ mode: m.id })}
            className={clsx("flex h-8 items-center justify-center gap-1 rounded-lg text-[12px] font-medium transition", mode === m.id ? "bg-[#2dd4bf]/20 text-white shadow-[0_0_0_1px_#2dd4bf]" : "bg-white/[0.05] text-white/55 hover:text-white")}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] leading-snug text-white/40">{mode === "do" ? "Operates your Mac. Asks before sending or buying." : "Types the result where your cursor is."}</div>
    </Shell>
  );
}

/** A connection you can detach: hover it (or select it) and click the × at its middle. */
function RemovableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const show = hover || selected;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: show ? 2.4 : 1.6, stroke: show ? "#9be0ff" : "#66ceff" }} />
      {/* invisible wide path = easy to hover */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={22} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: "pointer" }} />
      <EdgeLabelRenderer>
        <button
          aria-label="Detach"
          title="Detach"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => deleteElements({ edges: [{ id }] })}
          className="nodrag nopan absolute flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#0d1722] text-white/80 shadow-lg transition hover:border-red-400/60 hover:bg-red-500/20 hover:text-red-200"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", opacity: show ? 1 : 0 }}
          data-testid="edge-detach"
        >
          <X size={12} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { removable: RemovableEdge };

const nodeTypes = { trigger: TriggerNode, schedule: ScheduleNode, step: StepNode, platform: PlatformNode, mcp: McpNode, knowledge: KnowledgeNode, output: OutputNode };

const edgeDefaults = { type: "removable", animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: "#66ceff", width: 16, height: 16 }, style: { stroke: "#66ceff", strokeWidth: 1.6 } };

function toFlow(g: SkillGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeDefaults })),
  };
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): SkillGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as SkillNodeKind, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data }) as SkillNode),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target }) as SkillEdge),
  };
}

const AI_EXAMPLES = [
  "Every weekday at 9, read my unread Gmail, summarise it and post it to Slack #daily",
  "When I say “proposal”, read the Upwork job on screen and write a proposal from my portfolio",
  "Every Monday at 8:30, list my open to-dos by project and save it as a note",
];
const AI_STAGES = ["Reading your description…", "Choosing the steps…", "Wiring platforms and tools…", "Laying out the canvas…"];

/** Shimmering placeholder nodes while the AI drafts the skill. */
function GhostNodes() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStage((s) => Math.min(s + 1, AI_STAGES.length - 1)), 1100);
    return () => window.clearInterval(t);
  }, []);
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center bg-[#070d14]/80 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="ai-ghosts">
      <div className="flex items-center">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center">
            {i > 0 && <div className="h-px w-9 bg-gradient-to-r from-white/5 via-[var(--accent)]/50 to-white/5" />}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.14, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-[184px] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1722] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)]"
            >
              <div className="flo-ghost h-8" style={{ animationDelay: `${i * 0.15}s` }} />
              <div className="space-y-2 p-3">
                <div className="flo-ghost h-2.5 w-4/5 rounded-full" style={{ animationDelay: `${i * 0.15}s` }} />
                <div className="flo-ghost h-2.5 w-3/5 rounded-full" style={{ animationDelay: `${i * 0.15}s` }} />
                <div className="flo-ghost h-7 rounded-lg" style={{ animationDelay: `${i * 0.15}s` }} />
              </div>
            </motion.div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-2 rounded-full border border-white/10 bg-[#0d1722]/90 px-3.5 py-1.5 text-[12px] text-white/75">
        <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
        <AnimatePresence mode="wait">
          <motion.span key={stage} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {AI_STAGES[stage]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** "Describe it in words": the Build / Refine with AI box floating over the canvas. */
function AiComposer({ refine, busy, error, onSubmit, onClose }: { refine: boolean; busy: boolean; error: string; onSubmit: (text: string, mode: "build" | "refine") => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const go = (mode: "build" | "refine") => text.trim() && !busy && onSubmit(text.trim(), mode);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="flo-ai-card pointer-events-auto w-full max-w-[600px] rounded-2xl p-4 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.95),0_0_40px_-12px_rgb(var(--accent-rgb)/0.5)]"
        data-testid="ai-composer"
        role="dialog"
        aria-label={refine ? "Refine with AI" : "Build with AI"}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[#a78bfa] text-white shadow-[0_6px_18px_-6px_rgb(var(--accent-rgb)/0.8)]">
            <WandSparkles size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-white">{refine ? "Refine with AI" : "Build with AI"}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-white/50">
              {refine ? "Say what to change. Flo redraws the canvas; nothing is saved until you do." : "Describe the skill in plain words. Flo drafts the canvas; edit anything before you create it."}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close AI" className="-mr-1 -mt-1 rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        </div>
        <textarea
          ref={ref}
          aria-label="Describe the skill"
          rows={3}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              go(refine ? "refine" : "build");
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder={refine ? "Also post it to #standup on Fridays, and skip newsletters…" : "What should it do, where, and when? Flo picks the steps, platforms and tools…"}
          className="mt-3 w-full resize-none rounded-xl bg-white/[0.05] px-3 py-2.5 text-[13px] leading-relaxed text-white outline-none ring-1 ring-white/10 transition placeholder:text-white/30 focus:ring-[var(--accent)] disabled:opacity-60"
        />
        {!refine && !text && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AI_EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setText(ex)} className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white">
                {ex}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-2.5 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] leading-snug text-red-200 ring-1 ring-red-400/25" data-testid="ai-error">
            <AlertTriangle size={13} className="mt-[1px] shrink-0" /> {error}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[11px] text-white/35">Type or dictate · ⌘↵ to {refine ? "refine" : "build"}</span>
          {refine && (
            <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} disabled={busy || !text.trim()} onClick={() => go("build")}>
              Start over
            </Button>
          )}
          <Button variant="primary" size="sm" icon={busy ? <Loader2 size={13} className="animate-spin" /> : refine ? <Sparkles size={13} /> : <ArrowUp size={13} />} disabled={busy || !text.trim()} onClick={() => go(refine ? "refine" : "build")}>
            {busy ? (refine ? "Refining…" : "Building…") : refine ? "Refine" : "Build"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Canvas({ initial, onSave, onDelete, onClose }: { initial: Skill; onSave: (s: Skill) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void }) {
  const start = useMemo(() => toFlow(graphFromSkill(initial)), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [err, setErr] = useState("");
  const [picks, setPicks] = useState<{ platforms: Connection[]; mcps: Connection[]; docs: ContextDoc[] }>({ platforms: [], mcps: [], docs: [] });
  // Build with AI: open right away for a brand-new blank skill
  const [aiOpen, setAiOpen] = useState(!initial.id && !initial.instructions.trim());
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const timers = useRef<number[]>([]);
  const { screenToFlowPosition, fitView } = useReactFlow();

  useEffect(() => {
    Promise.all([api.listConnections().catch(() => [] as Connection[]), api.listContextDocs()]).then(([conns, docs]) =>
      setPicks({ platforms: conns.filter((c) => c.kind === "platform"), mcps: conns.filter((c) => c.kind === "mcp"), docs }),
    );
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of [...picks.platforms, ...picks.mcps]) m[c.id] = c.name;
    for (const d of picks.docs) m[`doc:${d.id}`] = d.title;
    return m;
  }, [picks]);
  const graph = fromFlow(nodes, edges);
  const compiled = compileSkill(graph, names);
  const hasSteps = orderedSteps(graph).some((s) => (s.data.text ?? "").trim());
  const next = compiled.schedule ? nextRun(compiled.schedule) : null;

  const onConnect = useCallback((c: FlowConnection) => setEdges((es) => addEdge({ ...c, id: `e-${c.source}-${c.target}-${Date.now().toString(36)}`, ...edgeDefaults }, es)), [setEdges]);

  const add = (kind: SkillNodeKind, at?: { x: number; y: number }) => {
    const g = fromFlow(nodes, edges);
    const steps = orderedSteps(g);
    const last = steps[steps.length - 1];
    // a sensible place near where it belongs (or where it was dropped), never on top of another node
    const near =
      at ??
      (kind === "step" && last
        ? { x: last.position.x + NODE_W + 80, y: last.position.y }
        : kind === "trigger" || kind === "schedule"
          ? { x: (steps[0]?.position.x ?? 0) - NODE_W - 80, y: (steps[0]?.position.y ?? 0) + (kind === "schedule" ? 200 : 0) }
          : last
            ? { x: last.position.x, y: last.position.y + 220 }
            : screenToFlowPosition({ x: window.innerWidth / 2 - NODE_W / 2, y: window.innerHeight / 2 - 60 }));
    const node: SkillNode = { id: nodeId(kind), type: kind, position: freeSpot(g.nodes, near), data: kind === "output" ? { mode: "write" } : kind === "schedule" ? { cron: DEFAULT_CRON } : {} };
    const wiring = autoWire({ nodes: [...g.nodes, node], edges: g.edges }, node);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges((es) => [...es.filter((x) => !wiring.remove.includes(x.id)), ...wiring.add.map((x) => ({ ...x, ...edgeDefaults }))]);
  };

  /** Replace the canvas with `g`, revealing its nodes one by one (edges appear as both ends do). */
  const reveal = (g: SkillGraph) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const flow = toFlow(g);
    setNodes(flow.nodes.map((n) => ({ ...n, className: "flo-node-pending" })));
    setEdges([]);
    const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    // frame the finished layout first (the hidden nodes are measured by then), then show them
    later(60, () => fitView({ padding: 0.22, maxZoom: 1, duration: 350 }));
    const shown = new Set<string>();
    flow.nodes.forEach((n, i) =>
      later(380 + i * 150, () => {
        shown.add(n.id);
        setNodes((ns) => ns.map((x) => (x.id === n.id ? { ...x, className: "flo-node-in" } : x)));
        const ready = flow.edges.filter((e) => e.source === n.id || e.target === n.id).filter((e) => shown.has(e.source) && shown.has(e.target));
        if (ready.length) setEdges((es) => [...es, ...ready.filter((e) => !es.some((x) => x.id === e.id))]);
      }),
    );
  };

  const runAi = async (text: string, mode: "build" | "refine") => {
    setAiBusy(true);
    setAiErr("");
    try {
      const gen = await api.generateSkillGraph(text, mode === "refine" ? describeForAi(name, compiled, names) : undefined);
      reveal(graphFromGenerated(gen, names));
      if (mode === "build" || !name.trim()) setName(gen.name);
      setAiNotes(gen.notes ?? []);
      setErr("");
      setAiOpen(false);
    } catch (e) {
      setAiErr(String(e).replace(/^Error:\s*/, "") || "Something went wrong. Try again.");
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setErr("Give the skill a name.");
    if (!compiled.instructions.trim() || compiled.warnings.some((w) => w.includes("Step"))) return setErr("Add at least one Step that says what to do.");
    const badSchedule = compiled.warnings.find((w) => w.startsWith("Fix the Schedule"));
    if (badSchedule) return setErr(badSchedule);
    try {
      await onSave({
        ...initial,
        name: name.trim(),
        enabled,
        triggers: compiled.triggers,
        instructions: compiled.instructions,
        platforms: compiled.platforms,
        mode: compiled.mode,
        connections: compiled.connections,
        schedule: compiled.schedule || null,
        graph: JSON.stringify(graph),
      });
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <Picks.Provider value={picks}>
      <div className="flex h-full flex-col">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-brand-200">
            <Boxes size={15} />
          </span>
          <input aria-label="Skill name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this skill" className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold text-white outline-none placeholder:text-white/30" />
          <label className="flex items-center gap-2 text-[12.5px] text-white/60">
            <button
              role="switch"
              aria-checked={enabled}
              aria-label="Enabled"
              onClick={() => setEnabled(!enabled)}
              className={clsx("relative h-6 w-10 rounded-full transition", enabled ? "bg-[var(--accent)]" : "bg-white/15")}
            >
              <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", enabled ? "left-[18px]" : "left-0.5")} />
            </button>
            Enabled
          </label>
          {onDelete && (
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {initial.id ? "Save" : "Create skill"}
          </Button>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* palette */}
          <div className="w-[190px] shrink-0 space-y-1.5 overflow-y-auto border-r border-white/10 p-3" aria-label="Add nodes">
            <button
              onClick={() => setAiOpen(true)}
              aria-label={hasSteps ? "Refine with AI" : "Build with AI"}
              className={clsx(
                "flo-ai-card mb-3 flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition",
                aiOpen ? "shadow-[0_0_30px_-4px_rgb(var(--accent-rgb)/0.8)]" : "shadow-[0_0_22px_-8px_rgb(var(--accent-rgb)/0.7)] hover:shadow-[0_0_30px_-4px_rgb(var(--accent-rgb)/0.8)]",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[#a78bfa] text-white shadow-[0_4px_14px_-4px_rgb(var(--accent-rgb)/0.9)]">
                {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-white">{hasSteps ? "Refine with AI" : "Build with AI"}</span>
                <span className="block truncate text-[10.5px] text-white/50">{hasSteps ? "Describe a change" : "Describe it in words"}</span>
              </span>
            </button>
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Add</div>
            {(Object.keys(KIND) as SkillNodeKind[]).map((k) => (
              <button
                key={k}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/flo-node", k)}
                onClick={() => add(k)}
                aria-label={`Add ${KIND[k].label}`}
                className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left transition hover:bg-white/[0.07]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ color: KIND[k].color, background: `${KIND[k].color}1f` }}>
                  {KIND[k].icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-white">{KIND[k].label}</span>
                  <span className="block truncate text-[10.5px] text-white/40">{KIND[k].hint}</span>
                </span>
              </button>
            ))}
            <div className="px-1 pt-2 text-[10.5px] leading-snug text-white/35">Click or drag onto the canvas. Drag a node by its title. Drag from a dot to another node to connect. Hover a node or a connection and click × to delete or detach.</div>
          </div>

          {/* canvas */}
          <div
            className="relative min-w-0 flex-1"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const k = e.dataTransfer.getData("application/flo-node") as SkillNodeKind;
              if (k in KIND) add(k, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
            data-testid="skill-canvas"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.3}
              maxZoom={1.6}
              deleteKeyCode={["Backspace", "Delete"]}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(147,221,255,0.16)" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => KIND[(n.type as SkillNodeKind) ?? "step"]?.color ?? "#3dbbff"} maskColor="rgba(5,9,14,0.75)" style={{ background: "#0a121b" }} />
            </ReactFlow>
            <AnimatePresence>{aiBusy && <GhostNodes key="ghosts" />}</AnimatePresence>
            <AnimatePresence>
              {aiOpen && <AiComposer key="composer" refine={hasSteps} busy={aiBusy} error={aiErr} onSubmit={runAi} onClose={() => (setAiOpen(false), setAiErr(""))} />}
            </AnimatePresence>
          </div>

          {/* generated skill */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-l border-white/10 p-4" data-testid="generated-skill">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              <Sparkles size={12} /> Generated skill
            </div>
            <div className="mt-3 space-y-3 text-[12.5px]">
              <div>
                <div className="text-[11px] text-white/40">Say</div>
                <div className="mt-0.5 text-white/85">{compiled.triggers || <span className="text-white/30">{compiled.schedule ? "nothing: it runs on its schedule" : "no trigger yet"}</span>}</div>
              </div>
              {compiled.schedule && (
                <div data-testid="compiled-schedule" className="rounded-xl bg-[#ff8a5c]/[0.08] p-2.5 ring-1 ring-[#ff8a5c]/20">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#ffb08f]">
                    <Clock size={12} /> Runs on a schedule
                  </div>
                  <div className="mt-1 text-white/85">{cap(describeCron(compiled.schedule))}</div>
                  {next && <div className="mt-0.5 text-[11px] text-white/45">Next run {formatRun(next)}</div>}
                  {compiled.mode === "write" && <div className="mt-1.5 text-[11px] leading-snug text-white/40">On its schedule there's no field to type into, so the result is saved as a note and sent as a notification.</div>}
                </div>
              )}
              <div>
                <div className="text-[11px] text-white/40">Flo will</div>
                <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-white/[0.04] p-2.5 font-sans text-[12px] leading-relaxed text-white/80">{compiled.instructions}</pre>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/70">{compiled.mode === "do" ? "Does it on screen" : "Writes it for you"}</span>
                {compiled.platforms.map((p) => (
                  <span key={p} className="rounded-full bg-[#34d399]/15 px-2 py-0.5 text-[11px] text-[#7ee8bd]">
                    {PLATFORMS.find((x) => x.id === p)?.label ?? p}
                  </span>
                ))}
                {compiled.connections.map((c) => (
                  <span key={c} className="rounded-full bg-[#a78bfa]/15 px-2 py-0.5 text-[11px] text-[#cbbcff]">
                    {names[c] ?? c}
                  </span>
                ))}
              </div>
              {compiled.warnings.length > 0 && (
                <div className="space-y-1">
                  {compiled.warnings.map((w) => (
                    <div key={w} className="flex items-start gap-1.5 text-[11.5px] text-amber-200/80">
                      <AlertTriangle size={12} className="mt-[2px] shrink-0" /> {w}
                    </div>
                  ))}
                </div>
              )}
              {aiNotes.length > 0 && (
                <div className="space-y-1 rounded-xl bg-[var(--accent)]/[0.07] p-2.5 ring-1 ring-[var(--accent)]/20" data-testid="ai-notes">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-brand-200">
                    <WandSparkles size={12} /> From the AI
                  </div>
                  {aiNotes.map((n) => (
                    <div key={n} className="text-[11.5px] leading-snug text-white/65">
                      {n}
                    </div>
                  ))}
                </div>
              )}
              {err && <div className="text-[12px] text-red-300">{err}</div>}
            </div>
          </div>
        </div>
      </div>
    </Picks.Provider>
  );
}

/** Full-screen canvas editor for one skill. */
export function SkillCanvasEditor(props: { initial: Skill; onSave: (s: Skill) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 p-4" role="dialog" aria-modal="true" aria-label="Skill canvas" data-testid="skill-editor">
      <motion.div className="absolute inset-0 bg-black/75 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={props.onClose} />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative h-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)]"
        style={{ background: "linear-gradient(180deg, #0c1620 0%, #070d14 100%)" }}
      >
        <ReactFlowProvider>
          <Canvas {...props} />
        </ReactFlowProvider>
      </motion.div>
    </div>
  );
}
