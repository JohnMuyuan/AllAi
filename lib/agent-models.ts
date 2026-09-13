import OFFICIAL_MODELS from "../electron/official-models.json";
import { withModelKind } from "./models";
import { makeModelKey } from "./public";
import type { AgentKind, ModelRef, PublicAgent, PublicEndpoint, PublicProvider } from "./types";

/** 拉不到官方目录时的兜底列表，和聊天那边共用 electron/official-models.json。 */
export function officialAgentModels(kind: AgentKind): ModelRef[] {
  const rows =
    kind === "grok-build"
      ? OFFICIAL_MODELS.grok
      : kind === "claude-code"
        ? OFFICIAL_MODELS.claude
        : kind === "codex"
          ? OFFICIAL_MODELS.codex
          : [];
  return rows.map((item) => withModelKind({ id: item.id, label: item.label }));
}

export function fallbackAgentBaseUrl(kind: AgentKind) {
  if (kind === "grok-build") return "https://api.x.ai/v1";
  if (kind === "claude-code") return "https://api.anthropic.com/v1";
  if (kind === "codex") return "https://api.openai.com/v1";
  return "";
}

export function endpointLooksLikeApi(endpoint: PublicEndpoint) {
  return endpoint.mode === "api";
}

export function agentHasApiEndpoint(agent: PublicAgent) {
  return agent.endpoints.some(endpointLooksLikeApi);
}

export function modelsForEndpoint(kind: AgentKind, endpoint: PublicEndpoint): ModelRef[] {
  if (endpoint.mode === "official") {
    const stored = (endpoint.models ?? []).map(withModelKind);
    return stored.length ? stored : officialAgentModels(kind);
  }
  if (endpoint.mode === "api") return (endpoint.models ?? []).map(withModelKind);
  return [];
}

function pickerLabel(endpoint: PublicEndpoint) {
  if (endpoint.mode === "official") return endpoint.label || "官方登录";
  if (endpoint.label && endpoint.label !== "官方登录") return endpoint.label;
  try {
    const host = endpoint.baseUrl ? new URL(endpoint.baseUrl).host : "";
    if (host) return host;
  } catch {
    // ignore
  }
  return "第三方接口";
}

export function preferredAgentEndpointId(agent: PublicAgent | null) {
  if (!agent) return "";
  if (agent.activeEndpointId && agent.endpoints.some((item) => item.id === agent.activeEndpointId)) {
    return agent.activeEndpointId;
  }
  return agent.endpoints[0]?.id || "";
}

export function agentModelProviders(agent: PublicAgent): PublicProvider[] {
  const source = agent.endpoints.filter((endpoint) => {
    if (endpoint.mode === "official") return true;
    return endpointLooksLikeApi(endpoint) && (endpoint.hasKey || (endpoint.models?.length ?? 0) > 0);
  });
  return source.map((endpoint) => ({
    id: endpoint.id,
    name: pickerLabel(endpoint),
    baseUrl: endpoint.baseUrl,
    models: modelsForEndpoint(agent.kind, endpoint),
    createdAt: 0,
    hasKey: endpoint.hasKey,
    apiKeyMasked: endpoint.apiKeyMasked,
  }));
}

export function findAgentModel(agent: PublicAgent, modelKey: string) {
  const endpointId = modelKey.includes("::") ? modelKey.slice(0, modelKey.indexOf("::")) : "";
  const modelId = modelKey.includes("::") ? modelKey.slice(modelKey.indexOf("::") + 2) : modelKey;
  const endpoint = agent.endpoints.find((item) => item.id === endpointId);
  if (!endpoint) return undefined;
  return modelsForEndpoint(agent.kind, endpoint).find((item) => item.id === modelId);
}

export function modelKeyFromWork(
  work: { modelKey?: string; endpointId?: string; model?: string } | null,
  agent: PublicAgent | null,
) {
  if (!agent) return "";
  const groups = agentModelProviders(agent);
  if (work?.modelKey?.includes("::")) return work.modelKey;
  const endpointId = work?.endpointId || preferredAgentEndpointId(agent);
  const endpoint = agent.endpoints.find((item) => item.id === endpointId);
  const models = endpoint ? modelsForEndpoint(agent.kind, endpoint) : [];
  const modelId = work?.model || endpoint?.model || models[0]?.id || "";
  if (endpointId && modelId) return makeModelKey(endpointId, modelId);
  const first = groups.find((item) => item.models[0]);
  return first ? makeModelKey(first.id, first.models[0].id) : "";
}

export function mergeModelLists(current: ModelRef[], incoming: ModelRef[]) {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const model of incoming) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }
  return merged;
}
