import type { AgentAuthMode, AgentEndpoint, AgentProfile } from "./types";

export function emptyOfficialEndpoint(): AgentEndpoint {
  return {
    id: crypto.randomUUID(),
    label: "官方登录",
    mode: "official",
    apiKey: "",
    baseUrl: "",
    model: "",
    models: [],
  };
}

function relabelDefaultEndpoint(item: AgentEndpoint): AgentEndpoint {
  if (item.mode === "official") return item;
  if (item.label !== "官方登录") return item;
  return {
    ...item,
    label: item.apiKey || item.baseUrl ? "第三方接口" : "默认接口",
    mode: "api",
  };
}

export function emptyApiEndpoint(label = "第三方接口"): AgentEndpoint {
  return {
    id: crypto.randomUUID(),
    label,
    mode: "api",
    apiKey: "",
    baseUrl: "",
    model: "",
    models: [],
  };
}

export function ensureEndpoints(agent: AgentProfile): AgentProfile {
  if (agent.endpoints?.length) {
    const endpoints = agent.endpoints.map(relabelDefaultEndpoint);
    const active =
      endpoints.find((item) => item.id === agent.activeEndpointId) ?? endpoints[0];
    return {
      ...agent,
      endpoints,
      activeEndpointId: active.id,
      authMode: active.mode,
      apiKey: active.apiKey,
      baseUrl: active.baseUrl,
      model: active.model || agent.model,
    };
  }
  const fallback = emptyApiEndpoint("默认接口");
  const endpoints = [fallback];
  if (agent.apiKey || agent.baseUrl) {
    fallback.apiKey = agent.apiKey || "";
    fallback.baseUrl = agent.baseUrl || "";
    fallback.model = agent.model || "";
  }
  const active = fallback;
  return {
    ...agent,
    endpoints,
    activeEndpointId: active.id,
    authMode: active.mode,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    model: active.model || agent.model,
  };
}

export function applyEndpoint(
  agent: AgentProfile,
  endpointId?: string,
): AgentProfile {
  const ready = ensureEndpoints(agent);
  const selected =
    ready.endpoints.find((item) => item.id === endpointId) ??
    ready.endpoints.find((item) => item.id === ready.activeEndpointId) ??
    ready.endpoints[0];
  return {
    ...ready,
    activeEndpointId: selected.id,
    authMode: selected.mode as AgentAuthMode,
    apiKey: selected.apiKey,
    baseUrl: selected.baseUrl,
    model: selected.model || ready.model,
  };
}

/**
 * 把全局提供商池并进一个 Agent 的接口列表。
 *
 * 为什么要有这个：三个 Agent（Claude Code / Codex / Grok）用的往往是同一个中转站，
 * 以前得在三个 Agent 的设置里各填一遍 key 和 baseUrl，改一次中转站要改三次。
 * 现在全局配一次，这里合并出来 —— 带 `global: true`，界面上只读。
 *
 * 合并只发生在「发出去」的路上（给界面、给运行器），绝不写回 agents[].endpoints，
 * 否则又变成三份各自的副本，改一处不同步。
 */
export function withGlobalEndpoints(
  agent: AgentProfile,
  globals: AgentEndpoint[] = [],
): AgentProfile {
  const ready = ensureEndpoints(agent);
  if (!globals.length) return ready;
  const shared = globals.map((item) => ({ ...item, global: true as const }));
  const own = ready.endpoints.filter((item) => !shared.some((row) => row.id === item.id));
  const endpoints = [...own, ...shared];
  const active =
    endpoints.find((item) => item.id === ready.activeEndpointId) ?? endpoints[0];
  return {
    ...ready,
    endpoints,
    activeEndpointId: active.id,
    authMode: active.mode,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    // 全局接口是几个 Agent 共用的，模型却可以各自不同，所以这个 Agent 自己记的优先。
    model: active.global ? ready.model || active.model : active.model || ready.model,
  };
}
