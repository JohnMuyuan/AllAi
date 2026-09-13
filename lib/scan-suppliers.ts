import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { isOfficialProvider, OFFICIAL_CHATS } from "./official-chat";
import { fetchRemoteModels } from "./fetch-models";
import { withModelKind } from "./models";
import type { AgentProfile, Database, ModelRef, Provider } from "./types";

export type ScannedSupplier = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "";
    return `${parsed.origin}${pathname}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function asChatBase(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (/\/v1(beta)?$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function looksLikeApiKey(key: string) {
  const value = key.trim();
  if (value.length < 8) return false;
  if (value.startsWith("eyJ")) return false;
  return true;
}

function skipOfficialHost(url: string) {
  if (OFFICIAL_CHATS.some((item) => item.providerId === url)) return true;
  try {
    const host = new URL(url).host.toLowerCase();
    return (
      host === "api.anthropic.com" ||
      host === "api.openai.com" ||
      host === "auth.x.ai"
    );
  } catch {
    return false;
  }
}

function nameFromUrl(url: string, fallback: string) {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes("x.ai")) return "Grok / xAI";
    if (host.includes("openai.com")) return "OpenAI";
    if (host.includes("anthropic.com")) return "Anthropic";
    return host || fallback;
  } catch {
    return fallback;
  }
}

function unquote(value: string) {
  const trimmed = value.trim();
  const matched = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
  if (matched) return matched[1].replace(/\\"/g, '"');
  const single = trimmed.match(/^'((?:\\.|[^'\\])*)'/);
  if (single) return single[1];
  return trimmed;
}

function parseTomlTables(text: string) {
  const tables: { section: string; values: Record<string, string> }[] = [];
  let section = "";
  let values: Record<string, string> = {};
  const flush = () => {
    tables.push({ section, values });
    values = {};
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      flush();
      section = header[1];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    values[kv[1]] = unquote(kv[2]);
  }
  flush();
  return tables;
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

function addCandidate(
  list: ScannedSupplier[],
  item: { name: string; baseUrl: string; apiKey: string; models?: string[] },
) {
  if (!item.baseUrl || !looksLikeApiKey(item.apiKey) || skipOfficialHost(item.baseUrl)) return;
  const baseUrl = asChatBase(item.baseUrl);
  const key = `${normalizeUrl(baseUrl)}::${item.apiKey}`;
  const existing = list.find((row) => `${normalizeUrl(row.baseUrl)}::${row.apiKey}` === key);
  const models = (item.models ?? []).map((id) => id.trim()).filter(Boolean);
  if (existing) {
    for (const model of models) {
      if (!existing.models.includes(model)) existing.models.push(model);
    }
    return;
  }
  list.push({
    name: item.name || nameFromUrl(baseUrl, "扫描到的接口"),
    baseUrl,
    apiKey: item.apiKey.trim(),
    models: [...new Set(models)],
  });
}

function fromAgents(agents: AgentProfile[]) {
  const list: ScannedSupplier[] = [];
  for (const agent of agents) {
    for (const endpoint of agent.endpoints ?? []) {
      if (endpoint.mode !== "api" && !endpoint.apiKey && !endpoint.baseUrl) continue;
      addCandidate(list, {
        name:
          endpoint.label && !["官方登录", "默认接口", "第三方接口"].includes(endpoint.label)
            ? endpoint.label
            : nameFromUrl(endpoint.baseUrl, agent.name),
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        models: [
          ...(endpoint.models ?? []).map((model) => model.id),
          ...(endpoint.model ? [endpoint.model] : []),
        ],
      });
    }
  }
  return list;
}

async function fromGrokCli() {
  const list: ScannedSupplier[] = [];
  const text = await readText(path.join(os.homedir(), ".grok", "config.toml"));
  if (!text) return list;
  for (const table of parseTomlTables(text)) {
    const baseUrl = table.values.base_url || table.values.baseUrl || "";
    const apiKey = table.values.api_key || table.values.apiKey || "";
    const model = table.values.model || "";
    const name = table.values.name || nameFromUrl(baseUrl, "Grok CLI");
    addCandidate(list, { name, baseUrl, apiKey, models: model ? [model] : [] });
  }
  return list;
}

async function fromClaudeCli() {
  const list: ScannedSupplier[] = [];
  for (const file of ["settings.json", "settings.local.json"]) {
    const raw = await readText(path.join(os.homedir(), ".claude", file));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { env?: Record<string, string> };
      const env = parsed.env ?? {};
      addCandidate(list, {
        name: nameFromUrl(env.ANTHROPIC_BASE_URL || "", "Claude CLI"),
        baseUrl: env.ANTHROPIC_BASE_URL || "",
        apiKey: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "",
      });
    } catch {
      // ignore
    }
  }
  return list;
}

async function fromCodexCli() {
  const list: ScannedSupplier[] = [];
  const text = await readText(path.join(os.homedir(), ".codex", "config.toml"));
  if (!text) return list;
  for (const table of parseTomlTables(text)) {
    if (!table.section.startsWith("model_providers.")) continue;
    addCandidate(list, {
      name: table.values.name || table.section.replace(/^model_providers\./, "") || "Codex CLI",
      baseUrl: table.values.base_url || table.values.baseUrl || "",
      apiKey: table.values.api_key || table.values.apiKey || "",
    });
  }
  return list;
}

export async function collectSuppliers(agents: AgentProfile[]) {
  const merged: ScannedSupplier[] = [];
  for (const item of [
    ...fromAgents(agents),
    ...(await fromGrokCli()),
    ...(await fromClaudeCli()),
    ...(await fromCodexCli()),
  ]) {
    addCandidate(merged, item);
  }
  return merged;
}

export function applySuppliers(db: Database, suppliers: ScannedSupplier[]) {
  let added = 0;
  let updated = 0;
  for (const item of suppliers) {
    const current = db.providers.find(
      (provider) =>
        !isOfficialProvider(provider) &&
        normalizeUrl(provider.baseUrl) === normalizeUrl(item.baseUrl),
    );
    const incomingModels = item.models.map((id) => withModelKind({ id, label: id }));
    if (current) {
      if (!current.apiKey && item.apiKey) {
        current.apiKey = item.apiKey;
        updated += 1;
      }
      continue;
    }
    db.providers.push({
      id: crypto.randomUUID(),
      name: item.name,
      baseUrl: item.baseUrl,
      apiKey: item.apiKey,
      models: incomingModels,
      createdAt: Date.now(),
    } satisfies Provider);
    added += 1;
  }
  return { added, updated };
}

/**
 * 只给「从没被用户碰过」的空服务补模型。返回 providerId -> models，
 * 由调用方在拿到结果后再写库 —— 网络请求不能占着 store 的串行锁。
 */
export async function fetchMissingModels(db: Database) {
  const filled = new Map<string, ModelRef[]>();
  const targets = db.providers.filter(
    (item) => item.apiKey && item.baseUrl && item.models.length === 0 && !item.modelsPinned,
  );
  for (const provider of targets.slice(0, 6)) {
    try {
      const models = await Promise.race([
        fetchRemoteModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 8000);
        }),
      ]);
      if (models.length) filled.set(provider.id, models);
    } catch {
      // keep empty list
    }
  }
  return filled;
}
