import { getDesktop } from "./desktop";
import type { AgentKind, ModelRef, PublicAgent } from "./types";
import type { CliAuthKind } from "@/types/desktop";

function isCliAuthKind(kind: AgentKind): kind is CliAuthKind {
  return kind === "grok-build" || kind === "claude-code" || kind === "codex";
}

const STALE_CODEX = new Set(["gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5", "o3", "o3-mini"]);
const STALE_CLAUDE = new Set(["sonnet", "opus", "haiku", "fable"]);

export function officialModelsNeedRefresh(kind: AgentKind, models?: ModelRef[]) {
  const list = models ?? [];
  if (!list.length) return true;
  if (kind === "codex") return list.every((item) => STALE_CODEX.has(item.id));
  if (kind === "claude-code") return list.every((item) => STALE_CLAUDE.has(item.id));
  return false;
}

export async function syncAgentEndpointModels(agent: PublicAgent, endpointId: string) {
  const endpoint =
    agent.endpoints.find((item) => item.id === endpointId) ??
    agent.endpoints.find((item) => item.id === agent.activeEndpointId) ??
    agent.endpoints[0];
  if (!endpoint) throw new Error("还没有接口");

  if (endpoint.mode === "official") {
    if (!isCliAuthKind(agent.kind)) throw new Error("这个 Agent 没有官方模型列表");
    const desktop = getDesktop();
    if (!desktop?.cliListModels) throw new Error("请用桌面版 AllAi 打开");
    const result = await desktop.cliListModels(agent.kind, agent.command);
    if (!result.ok) throw new Error(result.error);
    if (!result.models.length) throw new Error("官方没有返回模型");
    const response = await fetch(`/api/agents/${agent.id}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointId: endpoint.id, models: result.models, replace: true }),
    });
    const data = (await response.json()) as { error?: string; models?: ModelRef[] };
    if (!response.ok) throw new Error(data.error || "保存模型失败");
    return data.models ?? result.models;
  }

  const response = await fetch(`/api/agents/${agent.id}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpointId: endpoint.id }),
  });
  const data = (await response.json()) as { error?: string; models?: ModelRef[] };
  if (!response.ok) throw new Error(data.error || "同步失败");
  return data.models ?? [];
}
