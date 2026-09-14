import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { askFromInput, describeTool, type AskPayload } from "./agent-tools";
import { parseExternalAgentText } from "./external-agent";
import { diffFromHunks, diffsForTool, diffsFromCodexChanges, elideOldDiffs, type FileDiff } from "./diff";
import { cliInvocation, resolveCommand } from "./detect";

const execFileAsync = promisify(execFile);

export type AgentKind = "grok-build" | "claude-code" | "codex" | "custom";

export type AgentWork = {
  id: string;
  kind: AgentKind;
  agentName: string;
  title: string;
  cwd: string;
  cliSessionId: string;
  model?: string;
  running: boolean;
  /** 这条会话的 CLI 进程还开着（哪怕闲着没在跑）。目前 Claude Code / Grok 能判断，见 live.ts。 */
  online?: boolean;
  pid?: number;
  createdAt: number;
  updatedAt: number;
  preview: string;
  source: "history" | "live" | "new";
  messagesFile?: string;
  /** Codex 同一会话会拆成多个 rollout 文件，打开时要按时间拼起来。 */
  messagesFiles?: string[];
};

export type AgentTraceItem =
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; detail?: string; diff?: FileDiff[]; ask?: AskPayload };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  tools?: { name: string; detail?: string }[];
  trace?: AgentTraceItem[];
  createdAt: number;
};

const NAMES: Record<AgentKind, string> = {
  "grok-build": "Grok Build",
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  custom: "自定义",
};

function exists(file: string) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const HEAD_BYTES = 96 * 1024;

/**
 * 每次进 Agent 页都要把每个 session 文件的头部读一遍，会话一多就卡。
 * 文件的 mtime + size 没变，解析结果就不会变，直接复用。
 */
type HeadMeta = {
  title: string;
  cwd: string;
  preview: string;
  model?: string;
  sessionId?: string;
  hidden?: boolean;
};
type HeadEntry = { mtimeMs: number; size: number; meta: HeadMeta };
const headCache = new Map<string, HeadEntry>();
const CACHE_VERSION = 3;

// 缓存落盘，重启后第一次进 Agent 页就不用再全量扫一遍。
const cacheFile = () =>
  path.join(process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai"), "history-cache.json");

let cacheLoaded = false;
let cacheDirty = false;

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as {
      version?: number;
      entries?: Record<string, HeadEntry>;
    } & Record<string, HeadEntry>;
    const entries =
      parsed.version === CACHE_VERSION && parsed.entries
        ? parsed.entries
        : undefined;
    if (!entries) return;
    for (const [file, entry] of Object.entries(entries)) {
      if (entry && typeof entry.mtimeMs === "number" && entry.meta) headCache.set(file, entry);
    }
  } catch {
    // 没有缓存或者坏了，全量扫一次重建就是
  }
}

function saveCache() {
  if (!cacheDirty) return;
  cacheDirty = false;
  try {
    const dir = path.dirname(cacheFile());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      cacheFile(),
      JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(headCache) }),
      "utf8",
    );
  } catch {
    // 缓存写不了不影响功能
  }
}

function readHead(file: string, stat: fs.Stats, parse: (lines: string[]) => HeadMeta): HeadMeta {
  loadCache();
  const hit = headCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.meta;
  let meta: HeadMeta = { title: "", cwd: "", preview: "" };
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, Math.max(1, stat.size)));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    meta = parse(buf.subarray(0, n).toString("utf8").split(/\n/));
  } catch {
    // 读不动就留空，外层有默认值
  }
  headCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
  cacheDirty = true;
  return meta;
}

/** 只读文件末尾：Claude 的 session 能到几十 MB，整份读进来没必要。 */
function readTail(file: string, maxBytes: number): string[] {
  const stat = fs.statSync(file);
  if (stat.size <= maxBytes) return fs.readFileSync(file, "utf8").split(/\n/);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    const lines = buf.subarray(0, n).toString("utf8").split(/\n/);
    // 第一行多半被截断了，扔掉。
    lines.shift();
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function decodeGrokCwd(folder: string) {
  try {
    return decodeURIComponent(folder);
  } catch {
    return folder;
  }
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  if (value && typeof value === "object" && "text" in (value as object)) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function scanGrok(): AgentWork[] {
  const root = path.join(os.homedir(), ".grok", "sessions");
  if (!exists(root)) return [];
  const works: AgentWork[] = [];
  for (const encoded of fs.readdirSync(root)) {
    const dir = path.join(root, encoded);
    if (!fs.statSync(dir).isDirectory()) continue;
    const cwd = decodeGrokCwd(encoded);
    if (isChatCwd(cwd)) continue;
    let sessions: string[] = [];
    try {
      sessions = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const id of sessions) {
      const summaryFile = path.join(dir, id, "summary.json");
      if (!exists(summaryFile)) continue;
      try {
        const summary = readJson(summaryFile) as {
          info?: { id?: string; cwd?: string };
          generated_title?: string;
          session_summary?: string;
          last_recap?: string;
          current_model_id?: string;
          created_at?: string;
          updated_at?: string;
          last_active_at?: string;
        };
        const cliSessionId = summary.info?.id || id;
        if (isChatCwd(summary.info?.cwd || cwd)) continue;
        const createdAt = Date.parse(summary.created_at || "") || Date.now();
        const updatedAt =
          Date.parse(summary.last_active_at || summary.updated_at || "") || createdAt;
        works.push({
          id: `grok-build:${cliSessionId}`,
          kind: "grok-build",
          agentName: NAMES["grok-build"],
          title: (summary.generated_title || summary.session_summary || "Grok 工作").slice(0, 80),
          cwd: summary.info?.cwd || cwd,
          cliSessionId,
          model: summary.current_model_id,
          running: looksRunning(updatedAt),
          createdAt,
          updatedAt,
          preview: (summary.last_recap || summary.session_summary || "").slice(0, 80),
          source: "history",
          messagesFile: path.join(dir, id, "updates.jsonl"),
        });
      } catch {
        // skip broken summary
      }
    }
  }
  return works;
}

// AllAi 自己的官方登录聊天（Claude 账号 / Grok 账号）也是跑 CLI，
// session 会落进各家自己的历史目录。那些是聊天，不是本地工作，别混进 Agent 列表。
const CHAT_CWDS = ["claude-chat", "grok-chat", "chatgpt-chat", "model-trace"].map((name) =>
  path.join(os.homedir(), ".allai", name),
);

function normalizeCwd(cwd: string) {
  const trimmed = cwd.trim();
  const stripped = trimmed.startsWith("\\\\?\\") ? trimmed.slice(4) : trimmed;
  try {
    return path.resolve(stripped);
  } catch {
    return stripped;
  }
}

function isChatCwd(cwd: string) {
  if (!cwd) return false;
  const normalized = normalizeCwd(cwd).toLowerCase();
  return CHAT_CWDS.some((item) => normalized === item.toLowerCase());
}

/** Codex 的审批子会话 / 子 Agent，不是用户自己的对话。 */
function isCodexHiddenThread(payload: Record<string, unknown>) {
  const source = payload.thread_source;
  if (source === "guardian_review" || source === "subagent") return true;
  const origin = payload.source;
  if (origin && typeof origin === "object" && !Array.isArray(origin) && "subagent" in origin) {
    return true;
  }
  if (typeof origin === "string" && /guardian|subagent/i.test(origin)) return true;
  return false;
}

function skipCodexUser(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("<")) return true;
  if (/whose request action you are assessing/i.test(trimmed)) return true;
  if (/^You are a helpful chat assistant/.test(trimmed)) return true;
  return false;
}

type CodexCatalogRow = {
  id: string;
  title: string;
  cwd: string;
  rolloutPath: string;
  hidden: boolean;
  recencyMs: number;
};

function readCodexIndexTitles() {
  const map = new Map<string, string>();
  const file = path.join(os.homedir(), ".codex", "session_index.jsonl");
  if (!exists(file)) return map;
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { id?: string; thread_name?: string };
      const name = row.thread_name?.trim() || "";
      if (row.id && name && name.length <= 40 && !name.includes("\n")) map.set(row.id, name);
    }
  } catch {
    // 索引坏了就用文件头里的首句
  }
  return map;
}

function readCodexSqlite(): CodexCatalogRow[] {
  try {
    // pty-host 用的是打包进去的 node.exe（现在是 Node 24），带 node:sqlite。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require("node:sqlite") as {
      DatabaseSync: new (
        file: string,
        opts?: { readOnly?: boolean },
      ) => {
        prepare: (sql: string) => { all: () => Record<string, unknown>[] };
        close: () => void;
      };
    };
    const file = path.join(os.homedir(), ".codex", "state_5.sqlite");
    if (!exists(file)) return [];
    const db = new sqlite.DatabaseSync(file, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT id, title, cwd, rollout_path, thread_source, recency_at_ms FROM threads WHERE archived IS NULL OR archived = 0",
        )
        .all();
      return rows.map((row) => {
        const source = typeof row.thread_source === "string" ? row.thread_source : "";
        return {
          id: String(row.id || ""),
          title: String(row.title || "").trim(),
          cwd: String(row.cwd || ""),
          rolloutPath: String(row.rollout_path || ""),
          hidden: source === "guardian_review" || source === "subagent",
          recencyMs: Number(row.recency_at_ms) || 0,
        };
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function pickCodexTitle(id: string, fallback: string, index: Map<string, string>, sqliteTitle?: string) {
  const named = index.get(id)?.trim();
  if (named) return named;
  const sql = (sqliteTitle || "").trim().split(/\n/)[0] || "";
  if (sql && sql.length <= 40) return sql;
  return fallback || "Codex 工作";
}

/**
 * 会话文件刚被写过 = 这条会话还在动。
 *
 * 不许靠扫进程名判断（会把 CC Switch 那种也算成运行中，见产品约定）。
 * 实测：正在跑的会话文件 3 秒前刚写过，第二新的是 13 小时前，区分度很足。
 */
export function looksRunning(mtimeMs: number, now = Date.now()) {
  return now - mtimeMs < RUNNING_MS;
}

export const RUNNING_MS = 180_000;

function isCodexRunning(mtimeMs: number, recencyMs: number) {
  const now = Date.now();
  if (looksRunning(mtimeMs, now)) return true;
  // CLI 长时间思考时 jsonl 可能几分钟不写；sqlite 的 recency 更接近「还在动」。
  // 不要在扫描路径上同步跑 tasklist：全进程列表在这台机器上要 400ms+，
  // Agent 页每 4 秒扫一次会把主进程卡住，打字就一顿一顿。
  if (recencyMs && now - recencyMs < 15 * 60_000) return true;
  return false;
}

export function listCodexRollouts(sessionId: string, hintFile: string): string[] {
  if (!sessionId && !hintFile) return [];
  const files = new Set<string>();
  if (hintFile && exists(hintFile)) files.add(path.resolve(hintFile));
  const dir = hintFile ? path.dirname(hintFile) : "";
  if (dir && exists(dir)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      if (sessionId && !name.includes(sessionId)) continue;
      const full = path.join(dir, name);
      if (exists(full)) files.add(path.resolve(full));
    }
  }
  return [...files].sort((a, b) => {
    try {
      return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
    } catch {
      return a.localeCompare(b);
    }
  });
}

/** Claude 把 cwd 压成目录名（分隔符换成 -），照同样规则比一次。 */
function isAllAiChatProject(project: string) {
  const name = project.toLowerCase();
  return CHAT_CWDS.some((item) => name === item.replace(/[\\/:.]/g, "-").toLowerCase());
}

function scanClaude(): AgentWork[] {
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!exists(root)) return [];
  const works: AgentWork[] = [];
  for (const project of fs.readdirSync(root)) {
    if (isAllAiChatProject(project)) continue;
    const dir = path.join(root, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      const cliSessionId = name.replace(/\.jsonl$/, "");
      const stat = fs.statSync(file);
      const meta = readHead(file, stat, (lines) => {
        let title = "";
        let cwd = "";
        let preview = "";
        let model = "";
        for (const line of lines) {
          if (!line.startsWith("{")) continue;
          try {
            const row = JSON.parse(line) as {
              type?: string;
              cwd?: string;
              message?: { content?: unknown; model?: string };
            };
            if (row.cwd && !cwd) cwd = row.cwd;
            if (row.type === "assistant" && typeof row.message?.model === "string" && row.message.model) {
              model = row.message.model;
            }
            if (row.type === "user" && !preview) {
              const text = textOf(row.message?.content).trim();
              if (text && !skipClaudeUserText(text)) {
                preview = text.slice(0, 80);
                title = text.replace(/\s+/g, " ").slice(0, 40);
              }
            }
          } catch {
            // skip
          }
        }
        return { title, cwd, preview, model };
      });
      const title = meta.title || "Claude 工作";
      const cwd = meta.cwd;
      const preview = meta.preview;
      if (isChatCwd(cwd)) continue;
      works.push({
        id: `claude-code:${cliSessionId}`,
        kind: "claude-code",
        agentName: NAMES["claude-code"],
        title,
        cwd,
        cliSessionId,
        model: meta.model,
        // Claude 以前一直写死 false，所以正在跑的会话在 AllAi 里也显示成历史。
        running: looksRunning(stat.mtimeMs),
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        updatedAt: stat.mtimeMs,
        preview,
        source: "history",
        messagesFile: file,
      });
    }
  }
  return works;
}

function scanCodex(): AgentWork[] {
  const root = path.join(os.homedir(), ".codex", "sessions");
  if (!exists(root)) return [];
  const works: AgentWork[] = [];
  const stack = [root];
  const index = readCodexIndexTitles();
  const catalog = readCodexSqlite();
  const catalogById = new Map(catalog.map((row) => [row.id, row]));
  const catalogByFile = new Map(
    catalog.filter((row) => row.rolloutPath).map((row) => [normalizeCwd(row.rolloutPath), row]),
  );
  const seen = new Set<string>();
  const groups = new Map<
    string,
    { full: string; stat: fs.Stats; meta: HeadMeta }[]
  >();
  while (stack.length) {
    const dir = stack.pop() as string;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!name.endsWith(".jsonl")) continue;
      const meta = readHead(full, stat, (lines) => {
        let cliSessionId = name.replace(/\.jsonl$/, "");
        let cwd = "";
        let title = "";
        let preview = "";
        let model = "";
        let hidden = false;
        for (const line of lines) {
          if (!line.startsWith("{")) continue;
          try {
            const row = JSON.parse(line) as {
              type?: string;
              payload?: Record<string, unknown>;
            };
            const payload = row.payload;
            if (!payload) continue;
            if (row.type === "session_meta") {
              cliSessionId =
                (typeof payload.id === "string" && payload.id) ||
                (typeof payload.session_id === "string" && payload.session_id) ||
                cliSessionId;
              cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
              if (isCodexHiddenThread(payload)) hidden = true;
            }
            if (hidden) continue;
            const item = asRecord(payload.item);
            const userText =
              item?.type === "UserMessage"
                ? textOf(item.content).trim()
                : payload.type === "message" && payload.role === "user"
                  ? textOf(payload.content).trim()
                  : "";
            if (userText && !preview && !skipCodexUser(userText)) {
              preview = userText.slice(0, 80);
              title = userText.replace(/\s+/g, " ").slice(0, 40);
            }
            if (row.type === "event_msg") {
              const settings = asRecord(payload.thread_settings);
              if (typeof settings?.model === "string") model = settings.model;
            }
          } catch {
            // skip
          }
        }
        return { title, cwd, preview, model, sessionId: cliSessionId, hidden };
      });
      const cliSessionId = meta.sessionId || name.replace(/\.jsonl$/, "");
      const row = catalogById.get(cliSessionId) || catalogByFile.get(normalizeCwd(full));
      if (meta.hidden || row?.hidden || isChatCwd(meta.cwd || row?.cwd || "")) continue;
      const list = groups.get(cliSessionId) ?? [];
      list.push({ full, stat, meta });
      groups.set(cliSessionId, list);
    }
  }
  for (const [cliSessionId, files] of groups) {
    files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    const latest = files[files.length - 1];
    const earliest = files[0];
    const row = catalogById.get(cliSessionId) || catalogByFile.get(normalizeCwd(latest.full));
    const titled = files.find((item) => item.meta.title)?.meta.title || latest.meta.title;
    const previewed =
      [...files].reverse().find((item) => item.meta.preview)?.meta.preview || latest.meta.preview;
    const cwd = normalizeCwd(
      latest.meta.cwd || files.find((item) => item.meta.cwd)?.meta.cwd || row?.cwd || "",
    );
    const mtime = Math.max(...files.map((item) => item.stat.mtimeMs));
    seen.add(cliSessionId);
    works.push({
      id: `codex:${cliSessionId}`,
      kind: "codex",
      agentName: NAMES.codex,
      title: pickCodexTitle(cliSessionId, titled, index, row?.title),
      cwd,
      cliSessionId,
      model: files.find((item) => item.meta.model)?.meta.model,
      running:
        files.some((item) => looksRunning(item.stat.mtimeMs)) ||
        isCodexRunning(mtime, row?.recencyMs || 0),
      createdAt: earliest.stat.birthtimeMs || earliest.stat.mtimeMs,
      updatedAt: Math.max(mtime, row?.recencyMs || 0),
      preview: previewed || (row?.title || "").slice(0, 80),
      source: "history",
      messagesFile: latest.full,
      messagesFiles: files.map((item) => item.full),
    });
  }
  for (const row of catalog) {
    if (seen.has(row.id) || row.hidden || isChatCwd(row.cwd)) continue;
    const file = row.rolloutPath ? normalizeCwd(row.rolloutPath) : "";
    if (!file || !exists(file)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    works.push({
      id: `codex:${row.id}`,
      kind: "codex",
      agentName: NAMES.codex,
      title: pickCodexTitle(row.id, "", index, row.title),
      cwd: normalizeCwd(row.cwd),
      cliSessionId: row.id,
      running: isCodexRunning(stat.mtimeMs, row.recencyMs),
      createdAt: stat.birthtimeMs || row.recencyMs,
      updatedAt: Math.max(stat.mtimeMs, row.recencyMs),
      preview: (row.title || "").slice(0, 80),
      source: "history",
      messagesFile: file,
    });
  }
  return works;
}

export function scanHistory(limit = 120): AgentWork[] {
  loadCache();
  const all = [...scanGrok(), ...scanClaude(), ...scanCodex()];
  const unique = new Map<string, AgentWork>();
  for (const item of all) {
    const prev = unique.get(item.id);
    if (!prev || item.updatedAt >= prev.updatedAt) unique.set(item.id, item);
  }
  const deduped = [...unique.values()];
  deduped.sort((a, b) => b.updatedAt - a.updatedAt);
  // 会话文件删掉了就别留在缓存里。
  if (headCache.size > 400) {
    const live = new Set(deduped.map((item) => item.messagesFile).filter(Boolean) as string[]);
    for (const key of headCache.keys()) {
      if (!live.has(key)) {
        headCache.delete(key);
        cacheDirty = true;
      }
    }
  }
  saveCache();
  return deduped.slice(0, limit);
}

function pushText(
  messages: AgentMessage[],
  role: "user" | "assistant",
  text: string,
  createdAt: number,
  join: "chunk" | "block" = "chunk",
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const last = messages.at(-1);
  if (last && last.role === role) {
    if (join === "block") {
      if (last.content.trim().endsWith(trimmed)) return;
      last.content = last.content ? `${last.content}\n\n${trimmed}` : trimmed;
    } else {
      last.content += text;
    }
    return;
  }
  messages.push({
    id: crypto.randomUUID(),
    role,
    content: join === "block" ? trimmed : text,
    createdAt,
  });
}

function ensureAssistant(messages: AgentMessage[], createdAt: number): AgentMessage {
  const last = messages.at(-1);
  if (last?.role === "assistant") return last;
  const created: AgentMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    createdAt,
    trace: [],
  };
  messages.push(created);
  return created;
}

function appendThinking(message: AgentMessage, text: string, separate = false) {
  if (!text) return;
  const trace = message.trace ?? (message.trace = []);
  if (separate) {
    message.thinking = [message.thinking, text].filter(Boolean).join("\n\n");
    trace.push({ type: "thinking", text });
    return;
  }
  message.thinking = (message.thinking || "") + text;
  const last = trace.at(-1);
  if (last?.type === "thinking") last.text += text;
  else trace.push({ type: "thinking", text });
}

function appendTool(message: AgentMessage, name: string, detail?: string, diff?: FileDiff[]) {
  message.tools = [...(message.tools || []), { name, detail }];
  const trace = message.trace ?? (message.trace = []);
  trace.push(diff?.length ? { type: "tool", name, detail, diff } : { type: "tool", name, detail });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function claudeUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec) continue;
    if (rec.type && rec.type !== "text") continue;
    if (typeof rec.text === "string") text += rec.text;
  }
  return text;
}

function skipClaudeUserText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("此前对话")) return true;
  if (/^<(command-message|command-name|local-command|tick)/.test(trimmed)) return true;
  return false;
}

function claudeBlocks(
  content: unknown,
  tools?: Map<string, Extract<AgentTraceItem, { type: "tool" }>>,
): { text: string; trace: AgentTraceItem[] } {
  const trace: AgentTraceItem[] = [];
  if (!Array.isArray(content)) return { text: textOf(content), trace };
  let text = "";
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec) continue;
    if (rec.type === "thinking" || rec.type === "redacted_thinking") {
      const thinking =
        typeof rec.thinking === "string" ? rec.thinking : textOf(rec.content ?? rec);
      if (thinking) trace.push({ type: "thinking", text: thinking });
    } else if (rec.type === "tool_use") {
      const toolName = typeof rec.name === "string" ? rec.name : "工具";
      const info = describeTool(toolName, rec.input);
      const diff = diffsForTool(toolName, rec.input, true);
      const item: Extract<AgentTraceItem, { type: "tool" }> = diff?.length
        ? { type: "tool", name: info.label, detail: info.detail || undefined, diff }
        : { type: "tool", name: info.label, detail: info.detail || undefined };
      const ask = askFromInput(toolName, rec.input);
      if (ask) item.ask = ask;
      trace.push(item);
      // 工具结果在后面的 user 行里，带着行号准确的补丁，到时候按 id 换掉这里比出来的差异。
      if (diff?.length && tools && typeof rec.id === "string") tools.set(rec.id, item);
    } else if (rec.type === "text") {
      text += typeof rec.text === "string" ? rec.text : "";
    }
  }
  return { text, trace };
}

/**
 * Claude 的工具结果（user 行）里有 structuredPatch：带原文件 / 新文件行号的补丁。
 * 用它换掉我们按 old_string / new_string 自己比出来的差异，这样能显示每行在文件里的第几行。
 */
function applyClaudeToolResult(
  content: unknown,
  result: unknown,
  tools: Map<string, Extract<AgentTraceItem, { type: "tool" }>>,
) {
  const res = asRecord(result);
  if (!res || !Array.isArray(content)) return;
  const hunks = Array.isArray(res.structuredPatch) ? res.structuredPatch : [];
  const filePath = typeof res.filePath === "string" ? res.filePath : "";
  for (const block of content) {
    const rec = asRecord(block);
    if (rec?.type !== "tool_result" || typeof rec.tool_use_id !== "string") continue;
    const item = tools.get(rec.tool_use_id);
    if (!item) continue;
    tools.delete(rec.tool_use_id);
    if (hunks.length && filePath) {
      item.diff = [diffFromHunks(filePath, res.type === "create" ? "add" : "update", hunks)];
    }
  }
}

/** 打开一条会话读全文。Grok 的 updates.jsonl 能到几十 MB，只读末尾会把开头丢掉。 */
const SESSION_READ_MAX = 64 * 1024 * 1024;

function readSessionLines(file: string): string[] {
  const stat = fs.statSync(file);
  if (stat.size <= SESSION_READ_MAX) return fs.readFileSync(file, "utf8").split(/\n/);
  return readTail(file, SESSION_READ_MAX);
}

/** Codex 的 reasoning 摘要：正文是加密的，只有 summary 里有人类可读的一句。 */
function codexReasoningText(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["summary", "summary_text", "raw_content", "content"]) {
    const value = payload[key];
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) {
      for (const row of value) {
        if (typeof row === "string") parts.push(row);
        else {
          const rec = asRecord(row);
          if (rec && typeof rec.text === "string") parts.push(rec.text);
        }
      }
    }
  }
  if (typeof payload.text === "string") parts.push(payload.text);
  return parts.filter(Boolean).join("\n").trim();
}

/**
 * Codex 把每件事包成 item_completed.item，类型是 PascalCase。
 * 返回 true 表示这条已经处理过了。
 */
function pushCodexItem(
  messages: AgentMessage[],
  item: Record<string, unknown>,
  at: number,
): boolean {
  const type = typeof item.type === "string" ? item.type : "";
  if (type === "Reasoning") {
    const text = codexReasoningText(item);
    if (text) appendThinking(ensureAssistant(messages, at), text, true);
    return true;
  }
  if (type === "CommandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map(String).join(" ")
      : String(item.command || "");
    const info = describeTool("exec", { command });
    appendTool(ensureAssistant(messages, at), info.label, info.detail || undefined);
    return true;
  }
  if (type === "FileChange") {
    const diff = diffsFromCodexChanges(item.changes);
    const files = diff.map((entry) => entry.path);
    const info = describeTool("edit", { file_path: files[0] || "" });
    const extra = files.length > 1 ? ` 等 ${files.length} 个文件` : "";
    appendTool(ensureAssistant(messages, at), info.label, (info.detail + extra).trim() || undefined, diff);
    return true;
  }
  if (type === "ImageView") {
    const info = describeTool("read", { path: String(item.path || "") });
    appendTool(ensureAssistant(messages, at), "看图", info.detail || undefined);
    return true;
  }
  if (type === "McpToolCall") {
    const info = describeTool(String(item.tool || "工具"), item.arguments);
    appendTool(ensureAssistant(messages, at), info.label, info.detail || undefined);
    return true;
  }
  if (type === "Extension") {
    const kind = String(item.kind || "");
    const info = describeTool(kind || "工具", { query: item.query });
    appendTool(ensureAssistant(messages, at), info.label, info.detail || undefined);
    return true;
  }
  if (type === "ContextCompaction") {
    appendTool(ensureAssistant(messages, at), "压缩上下文");
    return true;
  }
  if (type === "AgentMessage" || type === "UserMessage") {
    const text = textOf(item.content).trim();
    if (!text) return true;
    if (type === "UserMessage" && skipCodexUser(text)) return true;
    if (type === "AgentMessage") {
      const asst = ensureAssistant(messages, at);
      // 从别的 Agent 导入的会话：工具调用和输出写成了带标记的文字，拆出来，别当成回复正文。
      const imported = parseExternalAgentText(text);
      for (const tool of imported.tools) {
        const info = describeTool(tool.name, tool.fields);
        appendTool(asst, info.label, info.detail || undefined);
      }
      if (!imported.text) return true;
      appendThinking(asst, imported.text, true);
      pushText(messages, "assistant", imported.text, at, "block");
      return true;
    }
    pushText(messages, "user", text, at, "block");
    return true;
  }
  return false;
}

function parseCodexFile(file: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const raw = readSessionLines(file);
  const rows: {
    payload: Record<string, unknown>;
    item: Record<string, unknown> | null;
    at: number;
  }[] = [];
  let hasItems = false;
  for (const line of raw) {
    if (!line.startsWith("{")) continue;
    try {
      const row = JSON.parse(line) as {
        timestamp?: string;
        payload?: Record<string, unknown>;
      };
      const payload = row.payload;
      if (!payload) continue;
      const item = asRecord(payload.item);
      if (item && typeof item.type === "string") hasItems = true;
      rows.push({
        payload,
        item,
        at: Date.parse(row.timestamp || "") || Date.now(),
      });
    } catch {
      // skip
    }
  }
  for (const row of rows) {
    if (row.item) {
      const handled = pushCodexItem(messages, row.item, row.at);
      if (handled) continue;
    }
    // 同一轮既有 item_completed 又有 response_item.message，旧路径会把用户/助手各写一遍。
    if (hasItems) continue;
    const payload = row.payload;
    if (payload.type === "reasoning" || payload.type === "agent_reasoning") {
      const thinking = codexReasoningText(payload).trim();
      if (thinking) appendThinking(ensureAssistant(messages, row.at), thinking);
      continue;
    }
    if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call" ||
      payload.type === "command_execution"
    ) {
      const toolName = typeof payload.name === "string" ? payload.name : "工具";
      const toolInput = payload.arguments ?? payload.input ?? payload.command;
      const info = describeTool(toolName, toolInput);
      appendTool(
        ensureAssistant(messages, row.at),
        info.label,
        info.detail || undefined,
        diffsForTool(toolName, toolInput),
      );
      continue;
    }
    if (payload.type !== "message") continue;
    if (payload.role !== "user" && payload.role !== "assistant") continue;
    const text = textOf(payload.content).trim();
    if (!text) continue;
    if (payload.role === "user" && skipCodexUser(text)) continue;
    let body = text;
    if (payload.role === "assistant") {
      // 老格式（没有 item_completed）里导入的会话同样带标记，一样拆。
      const imported = parseExternalAgentText(text);
      if (imported.tools.length) {
        const asst = ensureAssistant(messages, row.at);
        for (const tool of imported.tools) {
          const info = describeTool(tool.name, tool.fields);
          appendTool(asst, info.label, info.detail || undefined);
        }
      }
      body = imported.text;
      if (!body) continue;
    }
    messages.push({
      id: (typeof payload.id === "string" && payload.id) || crypto.randomUUID(),
      role: payload.role,
      content: body,
      createdAt: row.at,
    });
  }
  return messages;
}

function mergeCodexMessages(target: AgentMessage[], part: AgentMessage[]) {
  if (!part.length) return;
  const lastUser = [...target].reverse().find((item) => item.role === "user")?.content.trim();
  let index = 0;
  if (lastUser && part[0].role === "user" && part[0].content.trim() === lastUser) index = 1;
  for (; index < part.length; index++) {
    const item = part[index];
    target.push({
      id: crypto.randomUUID(),
      role: item.role,
      content: item.content,
      thinking: item.thinking,
      tools: item.tools,
      trace: item.trace,
      createdAt: item.createdAt,
    });
  }
}

export function loadMessages(work: AgentWork, cap = 0): AgentMessage[] {
  const file = work.messagesFile;
  if (!file || !exists(file)) return [];
  const messages: AgentMessage[] = [];
  if (work.kind === "grok-build") {
    const raw = readSessionLines(file);
    for (const line of raw) {
      if (!line.startsWith("{")) continue;
      try {
        const row = JSON.parse(line) as {
          timestamp?: number;
          params?: {
            update?: {
              sessionUpdate?: string;
              content?: { text?: string };
              tool_name?: string;
              title?: string;
              rawInput?: unknown;
              _meta?: unknown;
            };
          };
        };
        const update = row.params?.update;
        const at = typeof row.timestamp === "number" ? row.timestamp * 1000 : Date.now();
        const text = update?.content?.text || "";
        if (update?.sessionUpdate === "user_message_chunk") pushText(messages, "user", text, at);
        if (update?.sessionUpdate === "agent_message_chunk") {
          pushText(messages, "assistant", text, at);
        }
        if (update?.sessionUpdate === "agent_thought_chunk" && text) {
          appendThinking(ensureAssistant(messages, at), text);
        }
        // 真正的工具调用是 sessionUpdate === "tool_call"。
        // 以前读的是 update.tool_name，那个字段长在 hook_execution 上（每次工具前后
        // 都有一堆钩子），于是「思考过程」里全是重复的工具名而且没有细节。
        if (update?.sessionUpdate === "tool_call") {
          const meta = (update._meta as Record<string, unknown> | undefined)?.["x.ai/tool"] as
            | { name?: string; label?: string }
            | undefined;
          const toolName = meta?.name || update.title || "工具";
          const info = describeTool(toolName, update.rawInput);
          appendTool(
            ensureAssistant(messages, at),
            info.label,
            info.detail || undefined,
            diffsForTool(toolName, update.rawInput, true),
          );
        }
      } catch {
        // skip
      }
    }
  } else if (work.kind === "claude-code") {
    const raw = readSessionLines(file);
    const claudeTools = new Map<string, Extract<AgentTraceItem, { type: "tool" }>>();
    for (const line of raw) {
      if (!line.startsWith("{")) continue;
      try {
        const row = JSON.parse(line) as {
          type?: string;
          isSidechain?: boolean;
          timestamp?: string;
          uuid?: string;
          message?: { role?: string; content?: unknown };
          toolUseResult?: unknown;
        };
        if (row.isSidechain) continue;
        if (row.type !== "user" && row.type !== "assistant") continue;
        const role = row.type === "user" ? "user" : "assistant";
        const at = Date.parse(row.timestamp || "") || Date.now();
        if (role === "assistant") {
          const parsed = claudeBlocks(row.message?.content, claudeTools);
          if (!parsed.text.trim() && !parsed.trace.length) continue;
          messages.push({
            id: row.uuid || crypto.randomUUID(),
            role,
            content: parsed.text,
            thinking: parsed.trace
              .filter((item): item is Extract<AgentTraceItem, { type: "thinking" }> => item.type === "thinking")
              .map((item) => item.text)
              .join("\n"),
            tools: parsed.trace
              .filter((item): item is Extract<AgentTraceItem, { type: "tool" }> => item.type === "tool")
              .map((item) => ({ name: item.name, detail: item.detail })),
            trace: parsed.trace,
            createdAt: at,
          });
          continue;
        }
        applyClaudeToolResult(row.message?.content, row.toolUseResult, claudeTools);
        const text = claudeUserText(row.message?.content);
        if (skipClaudeUserText(text)) continue;
        messages.push({
          id: row.uuid || crypto.randomUUID(),
          role,
          content: text,
          createdAt: at,
        });
      } catch {
        // skip
      }
    }
  } else if (work.kind === "codex") {
    const files = work.messagesFiles?.length
      ? work.messagesFiles
      : listCodexRollouts(work.cliSessionId, file);
    for (const partFile of files) {
      mergeCodexMessages(messages, parseCodexFile(partFile));
    }
  }
  const kept = cap > 0 && messages.length > cap ? messages.slice(messages.length - cap) : messages;
  return elideOldDiffs(kept);
}

/**
 * 真删掉这条会话在 CLI 那边的记录。
 * Grok 是 `~/.grok/sessions/<enc-cwd>/<id>/` 一整个目录，
 * Claude / Codex 是单个 .jsonl。删不掉就报错，让界面退回到「只隐藏」。
 */
/**
 * 真删掉这条会话在 CLI 那边的记录。
 *
 * 光删文件不够：codex 还有 `session_index.jsonl` 和 sqlite 索引，
 * grok 的会话目录里有十几个文件外加 active_sessions.json。
 * 两家都提供了自己的删除命令，用它们才干净；命令不可用时再退回删文件。
 */
export async function deleteWork(
  work: AgentWork,
): Promise<{ ok: true; how: string } | { ok: false; error: string }> {
  const forget = (file?: string) => {
    if (!file) return;
    headCache.delete(file);
    cacheDirty = true;
    saveCache();
  };

  // 先让 CLI 自己删，它知道还有哪些索引要一起清。
  const viaCli = await deleteViaCli(work);
  if (viaCli) {
    forget(work.messagesFile);
    if (work.kind === "grok-build") pruneEmptyDir(path.dirname(path.dirname(work.messagesFile || "")));
    return { ok: true, how: "命令行" };
  }

  try {
    if (work.kind === "grok-build") {
      const file = work.messagesFile;
      // messagesFile 是 <...>/<session>/updates.jsonl，要删的是它上一层目录。
      const dir = file ? path.dirname(file) : "";
      if (!dir || !exists(dir)) return { ok: false, error: "找不到这条会话的文件" };
      if (path.basename(dir) !== work.cliSessionId) {
        return { ok: false, error: "会话目录对不上，没有删除" };
      }
      if (!insideDir(path.join(os.homedir(), ".grok", "sessions"), dir)) {
        return { ok: false, error: "会话目录不在 Grok 历史目录中，没有删除" };
      }
      fs.rmSync(dir, { recursive: true, force: true });
      forget(file);
      dropGrokActive(work.cliSessionId);
      pruneEmptyDir(path.dirname(dir));
      return { ok: true, how: "文件" };
    }
    const file = work.messagesFile;
    if (!file || !exists(file)) return { ok: false, error: "找不到这条会话的文件" };
    if (!file.endsWith(".jsonl")) return { ok: false, error: "这个文件不像会话记录，没有删除" };
    const expectedRoot =
      work.kind === "claude-code"
        ? path.join(os.homedir(), ".claude", "projects")
        : work.kind === "codex"
          ? path.join(os.homedir(), ".codex", "sessions")
          : "";
    if (!expectedRoot || !insideDir(expectedRoot, file)) {
      return { ok: false, error: "会话文件不在对应的历史目录中，没有删除" };
    }
    fs.rmSync(file, { force: true });
    forget(file);
    if (work.kind === "codex") dropCodexIndex(work.cliSessionId);
    pruneEmptyDir(path.dirname(file));
    return { ok: true, how: "文件" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "删除失败" };
  }
}

function insideDir(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** 让 CLI 自己删。成功返回 true。 */
async function deleteViaCli(work: AgentWork): Promise<boolean> {
  const id = work.cliSessionId;
  if (!id || id.startsWith("live-")) return false;
  const args =
    work.kind === "codex"
      ? ["delete", id]
      : work.kind === "grok-build"
        ? ["sessions", "delete", id]
        : null;
  if (!args) return false; // claude 没有删会话的子命令
  const command = await resolveCommand(work.kind, "");
  if (!command) return false;
  try {
    const inv = cliInvocation(command, args);
    await execFileAsync(inv.file, inv.args, {
      timeout: 25000,
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
    });
    // 命令说成功了也得核实：文件真没了才算数。
    return !work.messagesFile || !exists(work.messagesFile);
  } catch {
    return false;
  }
}

/** 会话删完后父目录空了就一起收掉，别留一堆空壳。 */
function pruneEmptyDir(dir: string) {
  try {
    if (!dir || !exists(dir)) return;
    if (fs.readdirSync(dir).length) return;
    fs.rmdirSync(dir);
  } catch {
    // 删不掉就算了，空目录不影响功能
  }
}

/** grok 的运行中会话清单里也别留着。 */
function dropGrokActive(sessionId: string) {
  const file = path.join(os.homedir(), ".grok", "active_sessions.json");
  try {
    if (!exists(file)) return;
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as { session_id?: string }[];
    if (!Array.isArray(rows)) return;
    const kept = rows.filter((row) => row?.session_id !== sessionId);
    if (kept.length !== rows.length) fs.writeFileSync(file, JSON.stringify(kept), "utf8");
  } catch {
    // 清单格式不对就别动它
  }
}

/** codex 的 session_index.jsonl 里去掉这一条，否则列表里还看得到。 */
function dropCodexIndex(sessionId: string) {
  const file = path.join(os.homedir(), ".codex", "session_index.jsonl");
  try {
    if (!exists(file)) return;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const kept = lines.filter((line) => !line.includes(sessionId));
    if (kept.length !== lines.length) fs.writeFileSync(file, kept.join("\n"), "utf8");
  } catch {
    // 索引动不了就算了，文件本身已经删掉
  }
}

/**
 * 从会话文件里读出 **CLI 自己报的上下文占用**。
 *
 * 为什么必须读它而不是自己按字符估：估算看不见三件事 ——
 *   1. CLI 内部已经 compact 过（Codex 到 ~200K 会自己压，压完窗口里只剩一小截，
 *      但会话文件里所有原文都还在）；
 *   2. 工具输出、系统提示、skills 这些没进消息列表但真的占窗口的东西；
 *   3. 各家分词器的差异。
 * 实测一条 Codex 会话：CLI 报 101.6K，我们按字符估出 456.7K，差 4.5 倍 —— 而这个
 * 数字还在驱动自动压缩，会把一条只用了 39% 的健康会话误判成该压了（0.12.1 的 BUG）。
 *
 * 三家都在会话文件里写了，字段名各不相同：
 * - Codex：`event_msg/token_count` → `info.last_token_usage.input_tokens`
 *   （已含 cached）和 `info.model_context_window`（**权威窗口大小**，实测 258400，
 *   不是文档上的 272000）
 * - Claude：每条 assistant 消息的 `message.usage`，
 *   窗口占用 = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 * - Grok：`turn_completed` 的 `usage.inputTokens`（**camelCase**）
 *
 * 取最后一条，因为它反映的就是"此刻窗口里有多少"。
 */

/**
 * Grok 的窗口占用要从 `~/.grok/logs/unified.jsonl` 里读，**不能用会话文件里的
 * `turn_completed.usage.inputTokens`**。
 *
 * 那个字段是**一轮里所有模型调用的输入量之和**（它旁边就写着 `modelCalls`）。
 * 实测一轮 9 次调用：每次的 prompt 从 24,268 一路涨到 47,762，而 `inputTokens`
 * 是这 9 次的总和 313,756 —— 拿它当窗口占用会虚高 6 倍多，界面上就成了
 * `1.40M/500.0K · 279%`，而 Grok 自己说只用了 9%（0.12.2 的 BUG）。
 *
 * 真正的窗口占用是**最后一次推理的 prompt_tokens**，Grok 把每次推理都记在
 * unified 日志的 `shell.turn.inference_done` 里，带 `sid` 可以对上会话。
 */
export function readGrokContext(sessionId: string): number {
  if (!sessionId) return 0;
  const file = path.join(os.homedir(), ".grok", "logs", "unified.jsonl");
  if (!exists(file)) return 0;
  try {
    // 日志是所有会话共用的，只看尾部就够 —— 我们要的是最后一次。
    const lines = readTail(file, 4 * 1024 * 1024);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith("{") || !line.includes("inference_done")) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (row.msg !== "shell.turn.inference_done" || row.sid !== sessionId) continue;
      const ctx = row.ctx as Record<string, unknown> | undefined;
      const prompt = Number(ctx?.prompt_tokens);
      return Number.isFinite(prompt) && prompt > 0 ? prompt : 0;
    }
  } catch {
    return 0;
  }
  return 0;
}

export function readContextUsage(
  work: Pick<AgentWork, "kind" | "cliSessionId"> & { messagesFile?: string },
): { tokens: number; window?: number } | null {
  const file = work.messagesFile;
  if (!file || !exists(file)) return null;
  // Grok 的窗口占用不在会话文件里，见 readGrokContext 的说明。
  if (work.kind === "grok-build") {
    const grok = readGrokContext(work.cliSessionId);
    return grok ? { tokens: grok } : null;
  }
  let tokens = 0;
  let window = 0;
  try {
    for (const line of readSessionLines(file)) {
      if (!line.startsWith("{")) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Codex
      const payload = row.payload as Record<string, unknown> | undefined;
      if (payload?.type === "token_count") {
        const info = payload.info as Record<string, unknown> | undefined;
        const last = info?.last_token_usage as Record<string, unknown> | undefined;
        const input = Number(last?.input_tokens);
        if (Number.isFinite(input) && input > 0) tokens = input;
        const win = Number(info?.model_context_window);
        if (Number.isFinite(win) && win > 0) window = win;
        continue;
      }


      // Claude
      const message = row.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, unknown> | undefined;
      if (usage) {
        const sum =
          (Number(usage.input_tokens) || 0) +
          (Number(usage.cache_read_input_tokens) || 0) +
          (Number(usage.cache_creation_input_tokens) || 0);
        if (sum > 0) tokens = sum;
      }
    }
  } catch {
    return null;
  }
  if (!tokens) return null;
  return window ? { tokens, window } : { tokens };
}
