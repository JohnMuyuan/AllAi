import { cliInvocation } from "./detect";
import type { AgentRecord } from "./db";

export type LaunchPlan = {
  file: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
  verbatim?: boolean;
};

/**
 * 父进程 / Windows 用户环境里可能残留的鉴权变量。
 * 每次 spawn 先清掉，再按这一轮选中的接口写回去 ——
 * 不然官方登录和全局 Key 会叠在一起，Claude Code 就会报
 * 「claude.ai connectors are disabled because ANTHROPIC_API_KEY…」。
 */
export const AUTH_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ENABLE_CLAUDEAI_MCP_SERVERS",
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

export function isAnthropicApi(base: string) {
  const raw = base.trim();
  if (!raw) return false;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

export function isClaudeAuthNoise(text: string) {
  return (
    /claude\.ai connectors are disabled/i.test(text) ||
    /Unset it to load your organization's connectors/i.test(text) ||
    /Both claude\.ai and ANTHROPIC_API_KEY/i.test(text) ||
    /takes precedence over your claude\.ai login/i.test(text)
  );
}

export function apiEnv(agent: AgentRecord, modelOverride?: string): Record<string, string> {
  const env: Record<string, string> = { ...agent.extraEnv };
  if (agent.authMode !== "api") return env;

  const key = agent.apiKey.trim();
  const base = agent.baseUrl.trim().replace(/\/+$/, "");
  const model = (modelOverride || agent.model).trim();

  if (agent.kind === "grok-build") {
    if (key) env.XAI_API_KEY = key;
    if (base) {
      env.OPENAI_BASE_URL = base;
      env.XAI_BASE_URL = base;
    }
  } else if (agent.kind === "claude-code") {
    // 官方 Key 走 X-Api-Key（ANTHROPIC_API_KEY）；第三方网关走 Bearer（ANTHROPIC_AUTH_TOKEN）。
    // 两个一起设的话 Claude Code 仍会认为「API Key 鉴权」和本机 claude.ai 登录冲突。
    if (key) {
      if (base && !isAnthropicApi(base)) {
        env.ANTHROPIC_AUTH_TOKEN = key;
        delete env.ANTHROPIC_API_KEY;
      } else {
        env.ANTHROPIC_API_KEY = key;
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
    }
    // Claude Code 会自己拼 /v1/messages，Base URL 末尾不要带 /v1（CC Switch 同款）。
    if (base) env.ANTHROPIC_BASE_URL = base.replace(/\/v1$/i, "");
    env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
    if (model) {
      env.ANTHROPIC_MODEL = model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    }
  } else if (agent.kind === "codex") {
    if (key) env.OPENAI_API_KEY = key;
    if (base) env.OPENAI_BASE_URL = base;
  } else {
    if (key) env.ALLAI_API_KEY = key;
    if (base) env.ALLAI_BASE_URL = base;
  }
  return env;
}

function cliArgs(agent: AgentRecord, action: "run" | "login"): { args: string[]; stdin?: string } {
  const extra = [...(agent.args ?? [])];
  if (action === "login") {
    if (agent.kind === "grok-build") return { args: ["login", "--oauth", ...extra] };
    if (agent.kind === "claude-code") return { args: ["auth", "login", ...extra] };
    if (agent.kind === "codex") {
      if (agent.authMode === "api" && agent.apiKey) {
        return { args: ["login", "--with-api-key", ...extra], stdin: `${agent.apiKey}\n` };
      }
      return { args: ["login", ...extra] };
    }
    return { args: extra };
  }

  if (agent.kind === "codex" && agent.authMode === "api") {
    extra.unshift("-c", 'preferred_auth_method="apikey"');
  }
  if (agent.model.trim()) {
    if (agent.kind === "codex") extra.unshift("-c", `model="${agent.model.trim()}"`);
    else extra.unshift("--model", agent.model.trim());
  }
  return { args: extra };
}

export function planLaunch(
  agent: AgentRecord,
  action: "run" | "login",
  resolvedCommand: string,
): LaunchPlan {
  const { args, stdin } = cliArgs(agent, action);
  const spawned = cliInvocation(resolvedCommand, args);
  return {
    file: spawned.file,
    args: spawned.args,
    env: apiEnv(agent),
    stdin,
    verbatim: spawned.verbatim,
  };
}

export function childEnv(extra: Record<string, string>, oauthOnly = false): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  for (const key of AUTH_ENV) delete env[key];
  const incoming = { ...extra };
  if (oauthOnly) {
    for (const key of AUTH_ENV) delete incoming[key];
  }
  Object.assign(env, incoming);
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "AllAi";
  return env;
}
