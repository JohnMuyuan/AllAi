import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { claudeAuthLogin, claudeAuthLogout, claudeAuthStatus } from "./claude-cli";
import type { AgentKind, AgentRecord } from "./db";
import { cliInvocation, resolveCommand } from "./detect";
import OFFICIAL_MODELS from "./official-models.json";
import { childEnv, planLaunch } from "./launch";

const execFileAsync = promisify(execFile);

export type CliAuthKind = "grok-build" | "claude-code" | "codex";

export type CliAuthStatus = {
  kind: CliAuthKind;
  installed: boolean;
  loggedIn: boolean;
  email: string;
  account: string;
};

const LABELS: Record<CliAuthKind, string> = {
  "grok-build": "Grok",
  "claude-code": "Claude Code",
  codex: "Codex",
};

export function isCliAuthKind(kind: AgentKind | string): kind is CliAuthKind {
  return kind === "grok-build" || kind === "claude-code" || kind === "codex";
}

function emptyStatus(kind: CliAuthKind, installed = false): CliAuthStatus {
  return { kind, installed, loggedIn: false, email: "", account: "" };
}

function dummyAgent(kind: CliAuthKind): AgentRecord {
  return {
    id: "cli-auth",
    name: LABELS[kind],
    kind,
    command: "",
    args: [],
    cwd: "",
    authMode: "official",
    apiKey: "",
    baseUrl: "",
    model: "",
    extraEnv: {},
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execCli(command: string, args: string[], timeout = 20000) {
  const inv = cliInvocation(command, args);
  try {
    const { stdout, stderr } = await execFileAsync(inv.file, inv.args, {
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      windowsVerbatimArguments: inv.verbatim,
    });
    return { ok: true as const, text: `${stdout}\n${stderr}` };
  } catch (error) {
    const extra = error as { stdout?: string; stderr?: string; message?: string };
    const text = `${extra.stdout || ""}\n${extra.stderr || ""}`;
    const detail = extra.message || "命令失败";
    return {
      ok: false as const,
      text,
      error: /不是内部或外部命令|not recognized as an internal/i.test(`${detail}\n${text}`)
        ? "无法启动命令行，请确认已安装 Codex/Grok"
        : detail,
    };
  }
}

function grokAuthFromFile(): { loggedIn: boolean; email: string } {
  const file = path.join(os.homedir(), ".grok", "auth.json");
  if (!fs.existsSync(file)) return { loggedIn: false, email: "" };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const value of Object.values(parsed)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const email = typeof row.email === "string" ? row.email : "";
      const hasRefresh = typeof row.refresh_token === "string" && row.refresh_token.length > 0;
      const hasUser = typeof row.user_id === "string" && row.user_id.length > 0;
      if (email || hasRefresh || hasUser) return { loggedIn: true, email };
    }
  } catch {
    // ignore malformed auth files
  }
  return { loggedIn: false, email: "" };
}

function parseCodexStatus(text: string): { loggedIn: boolean; account: string } {
  const lower = text.toLowerCase();
  if (/not logged in|logged out|no login|unauthenticated/.test(lower)) {
    return { loggedIn: false, account: "" };
  }
  if (/logged in/.test(lower)) {
    const using = text.match(/using\s+(.+)/i);
    return { loggedIn: true, account: (using?.[1] || "ChatGPT").trim() };
  }
  return { loggedIn: false, account: "" };
}

function codexAuthFromFile(): { loggedIn: boolean } {
  const file = path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(file)) return { loggedIn: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      auth_mode?: string;
      tokens?: unknown;
    };
    return { loggedIn: parsed.auth_mode === "chatgpt" && Boolean(parsed.tokens) };
  } catch {
    return { loggedIn: false };
  }
}

export async function cliAuthStatus(kind: CliAuthKind, command = ""): Promise<CliAuthStatus> {
  if (kind === "claude-code") {
    const status = await claudeAuthStatus();
    return {
      kind,
      installed: status.installed,
      loggedIn: status.loggedIn,
      email: status.email,
      account: status.subscriptionType,
    };
  }

  const resolved = await resolveCommand(kind, command);
  if (!resolved) return emptyStatus(kind);

  if (kind === "grok-build") {
    const auth = grokAuthFromFile();
    return {
      kind,
      installed: true,
      loggedIn: auth.loggedIn,
      email: auth.email,
      account: auth.loggedIn ? "xAI" : "",
    };
  }

  const result = await execCli(resolved, ["login", "status"], 15000);
  const parsed = parseCodexStatus(result.text);
  if (parsed.loggedIn) {
    return { kind, installed: true, loggedIn: true, email: "", account: parsed.account };
  }
  const fallback = codexAuthFromFile();
  return {
    kind,
    installed: true,
    loggedIn: fallback.loggedIn,
    email: "",
    account: fallback.loggedIn ? "ChatGPT" : "",
  };
}

export async function cliAuthLogin(
  kind: CliAuthKind,
  command = "",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (kind === "claude-code") return claudeAuthLogin();

  const before = await cliAuthStatus(kind, command);
  if (!before.installed) {
    return { ok: false, error: `没有找到 ${LABELS[kind]}。请先安装 ${kind === "codex" ? "codex" : "grok"} 命令行。` };
  }
  if (before.loggedIn) return { ok: true };

  const resolved = await resolveCommand(kind, command);
  if (!resolved) {
    return { ok: false, error: `没有找到 ${LABELS[kind]}。` };
  }

  const plan = planLaunch(dummyAgent(kind), "login", resolved);
  const proc = spawn(plan.file, plan.args, {
    cwd: os.homedir(),
    env: childEnv(plan.env),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: plan.verbatim,
  });

  let closed: number | null | undefined;
  proc.on("close", (code) => {
    closed = code;
  });
  proc.on("error", () => {
    closed = -1;
  });

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = await cliAuthStatus(kind, command);
    if (status.loggedIn) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      return { ok: true };
    }
    if (closed !== undefined) {
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        const again = await cliAuthStatus(kind, command);
        if (again.loggedIn) return { ok: true };
      }
      return { ok: false, error: "没有检测到登录成功，请再点一次登录" };
    }
    await sleep(1200);
  }

  try {
    proc.kill();
  } catch {
    // ignore
  }
  const last = await cliAuthStatus(kind, command);
  if (last.loggedIn) return { ok: true };
  return { ok: false, error: "登录等待超时，请再试一次" };
}

export async function cliAuthLogout(
  kind: CliAuthKind,
  command = "",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (kind === "claude-code") return claudeAuthLogout();

  const resolved = await resolveCommand(kind, command);
  if (!resolved) return { ok: false, error: `没有找到 ${LABELS[kind]}。` };

  const result = await execCli(resolved, ["logout"], 20000);
  const status = await cliAuthStatus(kind, command);
  if (!status.loggedIn) return { ok: true };
  return {
    ok: false,
    error: result.ok ? "退出登录后仍显示已登录" : result.error || "退出登录失败",
  };
}

export type CliModel = {
  id: string;
  label: string;
  reasoningLevels?: string[];
};

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseCodexModels(text: string): CliModel[] {
  const parsed = parseJsonObject(text) as {
    models?: Array<{
      slug?: string;
      id?: string;
      model?: string;
      display_name?: string;
      displayName?: string;
      visibility?: string;
      hidden?: boolean;
      supported_reasoning_levels?: Array<{ effort?: string } | string>;
    }>;
  } | null;
  if (!parsed?.models?.length) return [];

  const rows: CliModel[] = [];
  for (const item of parsed.models) {
    const id = (item.slug || item.id || item.model || "").trim();
    if (!id) continue;
    if (item.hidden === true) continue;
    const visibility = (item.visibility || "").toLowerCase();
    if (visibility === "hidden" || visibility === "unavailable") continue;
    const reasoningLevels = (item.supported_reasoning_levels ?? [])
      .map((row) => (typeof row === "string" ? row : row.effort || ""))
      .map((row) => row.trim())
      .filter(Boolean);
    rows.push({
      id,
      label: (item.display_name || item.displayName || id).trim(),
      reasoningLevels: reasoningLevels.length ? reasoningLevels : undefined,
      visibility,
    } as CliModel & { visibility?: string });
  }

  const listed = rows.filter((item) => {
    const visibility = (item as CliModel & { visibility?: string }).visibility;
    return !visibility || visibility === "list";
  });
  const usable = listed.length ? listed : rows;
  return usable.map(({ id, label, reasoningLevels }) => ({ id, label, reasoningLevels }));
}

function parseGrokModels(text: string): CliModel[] {
  const models: CliModel[] = [];
  const seen = new Set<string>();
  let preferred = "";
  for (const line of text.split(/\r?\n/)) {
    const def = line.match(/default model:\s*(\S+)/i);
    if (def) preferred = def[1].trim();
    const hit = line.match(/^\s*[-*]\s+([A-Za-z0-9._:-]+)/);
    if (!hit) continue;
    const id = hit[1].trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  if (preferred && seen.has(preferred)) {
    models.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  }
  return models;
}

const CLAUDE_FALLBACK: CliModel[] = OFFICIAL_MODELS.claude;

function claudeLabelFromId(id: string) {
  const hit = id.match(/^claude-(sonnet|opus|haiku|fable)-(\d+)(?:-(\d+))?(?:-\d{8})?$/i);
  if (!hit) return id;
  const name = hit[1][0].toUpperCase() + hit[1].slice(1);
  const ver = hit[3] ? `${hit[2]}.${hit[3]}` : hit[2];
  return `${name} ${ver}`;
}

function parseClaudeBinaryModels(command: string): CliModel[] {
  if (!command || !/\.exe$/i.test(command) || !fs.existsSync(command)) return [];
  try {
    const text = fs.readFileSync(command).toString("latin1");
    const re = /claude-(?:sonnet|opus|haiku|fable)-[0-9][A-Za-z0-9.-]*/g;
    const seen = new Set<string>();
    const models: CliModel[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const raw = match[0].replace(/-v\d+$/i, "");
      const id = raw.replace(/-\d{8}$/, "");
      if (seen.has(id)) continue;
      if (!/^claude-(sonnet|opus|haiku|fable)-\d+(?:-\d+)?$/i.test(id)) continue;
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 120).replace(/[^\x20-\x7E]/g, " ");
      if (!/\b(Sonnet|Opus|Haiku|Fable)\b/.test(after)) continue;
      seen.add(id);
      models.push({ id, label: claudeLabelFromId(id) });
    }
    models.sort((a, b) => claudeRank(b.id) - claudeRank(a.id));
    return models;
  } catch {
    return [];
  }
}

function claudeRank(id: string) {
  const hit = id.match(/claude-(sonnet|opus|haiku|fable)-(\d+)(?:-(\d+))?/i);
  if (!hit) return 0;
  const family = { fable: 4, opus: 3, sonnet: 2, haiku: 1 }[hit[1].toLowerCase()] || 0;
  return family * 1_000_000 + Number(hit[2]) * 1000 + Number(hit[3] || 0);
}

export async function cliListModels(
  kind: CliAuthKind,
  command = "",
): Promise<{ ok: true; models: CliModel[] } | { ok: false; error: string }> {
  if (kind === "claude-code") {
    const status = await claudeAuthStatus();
    if (!status.installed) return { ok: false, error: "没有找到 Claude Code。" };
    const resolved = await resolveCommand("claude-code", command);
    const models = parseClaudeBinaryModels(resolved || "");
    return { ok: true, models: models.length ? models : CLAUDE_FALLBACK };
  }

  const resolved = await resolveCommand(kind, command);
  if (!resolved) return { ok: false, error: `没有找到 ${LABELS[kind]}。` };

  if (kind === "grok-build") {
    const result = await execCli(resolved, ["models"], 20000);
    const models = parseGrokModels(result.text);
    if (models.length) return { ok: true, models };
    return { ok: false, error: result.ok ? "Grok 没有返回模型" : result.error || "无法读取 Grok 模型" };
  }

  const result = await execCli(resolved, ["debug", "models"], 60000);
  const models = parseCodexModels(result.text);
  if (models.length) return { ok: true, models };
  return {
    ok: false,
    error: result.ok ? "Codex 没有返回模型" : result.error || "无法读取 Codex 模型",
  };
}
