// The skill editor as a canvas: drop nodes, connect them, and see the skill they generate.
// Triggers start it, Steps run in arrow order, Platforms / MCP servers / Knowledge docs attach to
// steps, and the Output says how it ends (write into the field, or do it on screen).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
import { motion } from "motion/react";
import clsx from "clsx";
import { AlertTriangle, BookText, Boxes, Flag, Globe, ListOrdered, MousePointerClick, PenLine, Plug, Sparkles, Trash2, X, Zap } from "lucide-react";
import { api } from "../lib/api";
import type { Connection, ContextDoc, Skill } from "../lib/types";
import { autoWire, compileSkill, freeSpot, graphFromSkill, nodeId, NODE_W, orderedSteps, type SkillEdge, type SkillGraph, type SkillNode, type SkillNodeData, type SkillNodeKind } from "../lib/skillGraph";
import { PLATFORMS } from "./platforms";
import { Button } from "./ui";

type FlowNode = Node<SkillNodeData, SkillNodeKind>;

const KIND: Record<SkillNodeKind, { label: string; hint: string; color: string; icon: React.ReactNode }> = {
  trigger: { label: "Trigger", hint: "Words that start it", color: "#f5b94a", icon: <Zap size={13} /> },
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
    </Shell>
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

const nodeTypes = { trigger: TriggerNode, step: StepNode, platform: PlatformNode, mcp: McpNode, knowledge: KnowledgeNode, output: OutputNode };

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

function Canvas({ initial, onSave, onDelete, onClose }: { initial: Skill; onSave: (s: Skill) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void }) {
  const start = useMemo(() => toFlow(graphFromSkill(initial)), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [err, setErr] = useState("");
  const [picks, setPicks] = useState<{ platforms: Connection[]; mcps: Connection[]; docs: ContextDoc[] }>({ platforms: [], mcps: [], docs: [] });
  const { screenToFlowPosition } = useReactFlow();

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

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of [...picks.platforms, ...picks.mcps]) m[c.id] = c.name;
    for (const d of picks.docs) m[`doc:${d.id}`] = d.title;
    return m;
  }, [picks]);
  const graph = fromFlow(nodes, edges);
  const compiled = compileSkill(graph, names);

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
        : kind === "trigger"
          ? { x: (steps[0]?.position.x ?? 0) - NODE_W - 80, y: steps[0]?.position.y ?? 0 }
          : last
            ? { x: last.position.x, y: last.position.y + 220 }
            : screenToFlowPosition({ x: window.innerWidth / 2 - NODE_W / 2, y: window.innerHeight / 2 - 60 }));
    const node: SkillNode = { id: nodeId(kind), type: kind, position: freeSpot(g.nodes, near), data: kind === "output" ? { mode: "write" } : {} };
    const wiring = autoWire({ nodes: [...g.nodes, node], edges: g.edges }, node);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges((es) => [...es.filter((x) => !wiring.remove.includes(x.id)), ...wiring.add.map((x) => ({ ...x, ...edgeDefaults }))]);
  };

  const save = async () => {
    if (!name.trim()) return setErr("Give the skill a name.");
    if (!compiled.instructions.trim() || compiled.warnings.some((w) => w.includes("Step"))) return setErr("Add at least one Step that says what to do.");
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
          <div className="w-[190px] shrink-0 space-y-1.5 border-r border-white/10 p-3" aria-label="Add nodes">
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
          </div>

          {/* generated skill */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-l border-white/10 p-4" data-testid="generated-skill">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              <Sparkles size={12} /> Generated skill
            </div>
            <div className="mt-3 space-y-3 text-[12.5px]">
              <div>
                <div className="text-[11px] text-white/40">Say</div>
                <div className="mt-0.5 text-white/85">{compiled.triggers || <span className="text-white/30">no trigger yet</span>}</div>
              </div>
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
