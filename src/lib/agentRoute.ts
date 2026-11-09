// Flo Agent routing, mirrored from src-tauri/src/floagent.rs `plan` (the backend decides; this
// copy powers the browser preview and keeps the two in step through tests).
import type { AgentConfig, RoutePlan } from "./floAgent";

const SCREEN_VERBS = ["open", "go to", "goto", "visit", "click", "tap", "type", "scroll", "navigate", "launch", "play", "search", "log in", "sign in", "fill", "press", "watch", "find", "like", "follow", "connect with", "message", "post", "reply", "comment", "send", "apply"];
const SCREEN_PLACES = [
  "linkedin", "youtube", "gmail", "twitter", "x.com", "instagram", "facebook", "reddit", "github", "chrome", "safari", "firefox", "arc", "whatsapp", "telegram", "upwork", "notion", "figma", "spotify", "amazon", "google", "maps", "calendar", "finder", "browser", "website", "page", "tab", "app", "screen", "slack",
];

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").split(/\s+/).filter(Boolean).join(" ")} `;
const has = (hay: string, phrase: string) => hay.includes(` ${phrase.trim()} `);

export function isScreenTask(goal: string): boolean {
  const q = norm(goal);
  const verb = SCREEN_VERBS.some((v) => has(q, v));
  const place = SCREEN_PLACES.some((p) => has(q, p)) || goal.includes("://") || q.includes(".com ");
  const compound = has(q, "and") || has(q, "then") || goal.includes(",");
  const simpleOpen = (q.startsWith(" open ") || q.startsWith(" launch ")) && !compound;
  return verb && place && !simpleOpen;
}

export function matchSkill(goal: string, skills: { name: string; triggers: string }[]): number | null {
  const q = norm(goal);
  let best: [number, number] | null = null;
  skills.forEach((k, i) => {
    for (const phrase of [k.name, ...k.triggers.split(",")]) {
      const p = norm(phrase);
      const core = p.trim();
      if ([...core].length < 3 || !q.includes(p)) continue;
      if (!best || core.length > best[1]) best = [i, core.length];
    }
  });
  return best ? (best as [number, number])[0] : null;
}

export function namedServers(goal: string, servers: string[]): string[] {
  const q = norm(goal);
  return servers.filter((n) => {
    const p = norm(n);
    return [...p.trim()].length >= 3 && q.includes(p);
  });
}

export function planRoute(goal: string, skills: { name: string; triggers: string }[], servers: string[], cfg: Pick<AgentConfig, "engine" | "allowScreen" | "allowTools" | "allowSkills">): RoutePlan {
  if (cfg.allowSkills) {
    const i = matchSkill(goal, skills);
    if (i !== null) return { route: "skill", target: skills[i].name, reason: `Uses your ${skills[i].name} skill` };
  }
  const named = cfg.allowTools ? namedServers(goal, servers) : [];
  if (named.length) {
    const names = named.join(", ");
    return cfg.engine === "hermes" ? { route: "hermes", target: names, reason: `Hermes with ${names}` } : { route: "tools", target: names, reason: `Uses ${names}` };
  }
  if (cfg.allowScreen && isScreenTask(goal)) return { route: "screen", target: null, reason: "Works on your screen" };
  if (cfg.engine === "hermes") return { route: "hermes", target: null, reason: "Answered by Hermes" };
  return { route: "answer", target: null, reason: "Flo answers or acts directly" };
}
