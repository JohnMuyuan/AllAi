import fs from "fs";
import os from "os";
import path from "path";

export type AgentKind = "grok-build" | "claude-code" | "codex" | "custom";
export type AgentAuthMode = "official" | "api";

export type AgentEndpoint = {
  id: string;
  label: string;
  mode: AgentAuthMode;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type AgentRecord = {
  id: string;
  name: string;
  kind: AgentKind;
  command: string;
  args: string[];
  cwd: string;
  authMode: AgentAuthMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  extraEnv: Record<string, string>;
  endpoints?: AgentEndpoint[];
  activeEndpointId?: string;
};

export function applyEndpoint(agent: AgentRecord, endpointId?: string): AgentRecord {
  const list = agent.endpoints ?? [];
  if (!list.length) return agent;
  const selected =
    list.find((item) => item.id === endpointId) ??
    list.find((item) => item.id === agent.activeEndpointId) ??
    list[0];
  return {
    ...agent,
    authMode: selected.mode === "api" ? "api" : "official",
    apiKey: selected.apiKey,
    baseUrl: selected.baseUrl,
    model: selected.model || agent.model,
    activeEndpointId: selected.id,
  };
}

function dbFile() {
  const dir = process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
  return path.join(dir, "db.json");
}

export type ProviderRecord = {
  id: string;
  apiKey: string;
  baseUrl: string;
};

function readDb(): {
  agents?: AgentRecord[];
  providers?: ProviderRecord[];
  agentEndpoints?: AgentEndpoint[];
} | null {
  try {
    return JSON.parse(fs.readFileSync(dbFile(), "utf8")) as {
      agents?: AgentRecord[];
      providers?: ProviderRecord[];
      agentEndpoints?: AgentEndpoint[];
    };
  } catch {
    return null;
  }
}

export function readAgent(id: string, endpointId?: string): AgentRecord | null {
  const parsed = readDb();
  const found = parsed?.agents?.find((item) => item.id === id) ?? null;
  if (!found) return null;
  // 全局池里的接口对每个 Agent 都算它自己的接口，跑之前先并进来，
  // 不然选中的是全局接口时这里查不到 key 和地址。
  const shared = parsed?.agentEndpoints ?? [];
  const own = found.endpoints ?? [];
  const merged = shared.length
    ? { ...found, endpoints: [...own, ...shared.filter((row) => !own.some((e) => e.id === row.id))] }
    : found;
  return applyEndpoint(merged, endpointId);
}

export function readProvider(id: string): ProviderRecord | null {
  const parsed = readDb();
  const found = parsed?.providers?.find((item) => item.id === id);
  if (!found) return null;
  return {
    id: found.id,
    apiKey: found.apiKey || "",
    baseUrl: found.baseUrl || "",
  };
}

export function applyProvider(
  agent: AgentRecord,
  provider: ProviderRecord,
  model?: string,
): AgentRecord {
  return {
    ...agent,
    authMode: "api",
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: (model || agent.model).trim(),
  };
}
