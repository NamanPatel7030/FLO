// Flo Agent: the main face of Flo. One command box (type or talk) for anything Flo can do, plus
// everything it works with in one place: Apps (MCP servers, Slack, coding agents), Skills (the
// canvas), Engine (Flo built in, or Hermes Agent), Slack (one page for everything Slack) and Customize.
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { Cpu, LayoutGrid, Plug, SlidersHorizontal, Zap } from "lucide-react";
import { agentApi, DEFAULT_AGENT_CONFIG, type AgentConfig } from "../../lib/floAgent";
import { useStore } from "../store";
import { Card, CardTitle } from "../ui";
import { Integrations } from "../Integrations";
import { SlackIcon } from "../SlackCard";
import { ConnectionsPanel, SkillsList } from "./Skills";
import { Overview } from "../floagent/Overview";
import { EnginePanel } from "../floagent/Engine";
import { SlackPage } from "../floagent/Slack";
import { Customize } from "../floagent/Customize";
import { EASE } from "../floagent/parts";

export type AgentTab = "overview" | "apps" | "skills" | "engine" | "slack" | "customize";

const TABS: { id: AgentTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutGrid size={13} /> },
  { id: "apps", label: "Apps", icon: <Plug size={13} /> },
  { id: "skills", label: "Skills", icon: <Zap size={13} /> },
  { id: "engine", label: "Engine", icon: <Cpu size={13} /> },
  { id: "slack", label: "Slack", icon: <SlackIcon size={13} /> },
  { id: "customize", label: "Customize", icon: <SlidersHorizontal size={13} /> },
];


/** The agent's config, shared by every tab (one load, one save path). */
export function useAgentConfig() {
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const reload = useCallback(() => {
    agentApi
      .config()
      .then((c) => setCfg({ ...DEFAULT_AGENT_CONFIG, ...c }))
      .catch(() => setCfg((x) => x ?? { ...DEFAULT_AGENT_CONFIG }));
  }, []);
  useEffect(reload, [reload]);
  const save = useCallback(async (next: AgentConfig) => {
    const saved = await agentApi.saveConfig(next);
    setCfg({ ...DEFAULT_AGENT_CONFIG, ...saved });
    return saved;
  }, []);
  return { cfg, save, reload };
}

export default function FloAgentPage() {
  const { pageArg, go } = useStore();
  const tab: AgentTab = TABS.some((t) => t.id === pageArg) ? (pageArg as AgentTab) : "overview";
  const agent = useAgentConfig();
  return (
    <div data-testid="flo-agent">
      <div className="mb-6 inline-flex rounded-xl glass p-1" role="tablist" aria-label="Flo Agent sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go("agent", t.id === "overview" ? undefined : t.id)}
            className={clsx("relative h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors", tab === t.id ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
          >
            {tab === t.id && <motion.span layoutId="agent-tab" className="absolute inset-0 rounded-lg glass-strong" transition={{ duration: 0.22, ease: EASE }} />}
            <span className="relative flex items-center gap-1.5">
              {t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <Overview cfg={agent.cfg} />
      ) : tab === "apps" ? (
        <AppsTab />
      ) : tab === "skills" ? (
        <SkillsList />
      ) : tab === "engine" ? (
        <EnginePanel cfg={agent.cfg} save={agent.save} />
      ) : tab === "slack" ? (
        <SlackPage cfg={agent.cfg} save={agent.save} reload={agent.reload} />
      ) : (
        <Customize cfg={agent.cfg} save={agent.save} />
      )}
    </div>
  );
}

/** Every connection in one place: MCP servers and platforms, then agents and coding tools (Slack has its own tab). */
function AppsTab() {
  return (
    <div className="flex flex-col gap-8" data-testid="agent-apps">
      <ConnectionsPanel />
      <div>
        <Card className="mb-4 px-5 py-4">
          <CardTitle icon={<Plug size={15} />}>Agents and coding tools</CardTitle>
          <p className="-mt-1.5 text-[12.5px] text-muted">Flo Agent can hand work to these, and they report back to Flo in the notch.</p>
        </Card>
        <Integrations />
      </div>
    </div>
  );
}
