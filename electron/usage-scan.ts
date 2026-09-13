import fs from "fs";
import os from "os";
import path from "path";

/**
 * 统计**这台电脑上所有** Agent 的 token 消耗 —— 不管那一轮是 AllAi 发的、
 * 你在终端里自己跑的、还是别的壳子（CC Switch、IDE 插件）跑的。
 *
 * 做法和 CC Switch 一样：**增量读各家 CLI 自己的会话文件**。
 * 那些文件里每次 API 请求都留了一条 usage，这是本机唯一一份「全都算上」的账。
 * （CC Switch 还挂了个本地代理记请求，但它 35020 次请求里有 34689 次来自会话文件扫描，
 *   代理只是补充。我们不做代理：那要改用户的 Base URL，风险和维护量都不值当。）
 *
 * 三家的格式（都是对着本机真实文件核过的）：
 *
 * | CLI | 文件 | 那一条 | 去重键 |
 * |-----|------|--------|--------|
 * | Claude Code | `~/.claude/projects/<项目>/<会话>.jsonl` | `type:"assistant"` 的 `message.usage` | `requestId` |
 * | Codex | `~/.codex/sessions/<日期>/rollout-….jsonl` | `type:"token_usage_record"` 的 `payload.usage` | `payload.response_id` |
 * | Grok Build | `~/.grok/sessions/<目录>/<会话>/updates.jsonl` | `turn_completed` 的 `update.usage` | `prompt_id` |
 *
 * ⚠️ Grok 那条 `usage` 是**一轮里所有模型调用的总和**。算「上下文占用」时不能用它
 * （会虚高好几倍，见 readGrokContext 的说明）；但算**用量**要的正是这个总和。
 *
 * 420MB 的会话文件不可能每次全读，所以按**字节偏移**增量读。
 * 而且每个文件的账单独记（`files[路径].days`），全局合计 = 所有文件相加：
 * 这样一个文件被重写/截断时，把它自己那份清掉重读就行，不会重复计数。
 */

export type UsageBucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  costUsd: number;
  requests: number;
};

/**
 * 一天一个来源一个型号一格：`days[日期][来源][型号]`。
 * 分三层，而不是把来源和型号拼成一个键 —— 来源名里本来就有空格（"Claude Code"），
 * 拼起来再切会切错（第一版就把 "Claude Code" 切成了 "Claude"）。
 */
type DayBuckets = Record<string, Record<string, Record<string, UsageBucket>>>;

type FileState = {
  size: number;
  mtimeMs: number;
  /** 已经读到哪个字节。下次从这里接着读。 */
  offset: number;
  /** 这个文件自己贡献的账。文件被重写时整份丢掉重算。 */
  days: DayBuckets;
  /** Codex 的型号写在前面的 thread_settings_applied 里，跨批次要记住。 */
  model?: string;
  /**
   * 上一条 Claude 用量行的 requestId。
   *
   * Claude Code 把**一次 API 响应的多个内容块拆成多行**写，每行都带同一份 usage —— 
   * 按行累加就把同一次请求算了好几遍（实测这台机器 11003 行里有 5009 行是这种，虚高 1.8 倍）。
   * 实测这些重复行**永远相邻**、usage 完全相同，所以记住上一条的 id 就够去重了。
   * 跨批次也要记住：一组重复行可能正好被增量读的边界切开。
   */
  lastId?: string;
  /** 哪家 CLI 的会话。额度监控按它把用量对到官方账号上。 */
  kind?: Kind;
  /**
   * 这个会话是不是走官方登录账号（而不是 API Key / 中转站）。额度监控只算这种。
   * Codex 看文件开头 session_meta 的 model_provider（每个会话自己记了，准）；
   * Claude Code / Grok 的会话文件里没记，只能看它们的全局配置，见 configOfficial。
   * undefined = 还没判断出来（比如 Codex 还没读到 session_meta）。
   */
  official?: boolean;
  /** 按小时的账：`hours[整点时间戳][型号]`。只留 HOURS_KEEP_MS，额度监控用。 */
  hours?: Record<string, Record<string, UsageBucket>>;
  /** 账本结构版本，见 STATE_VERSION。 */
  v?: number;
};

/**
 * 0.17.0 起每个文件多记了 hours / official / kind。老账没有这些，遇到就重读一次 ——
 * 只重读最近 HOURS_KEEP_MS 里动过的文件（更早的用不上按小时的账，日账也是对的）。
 */
const STATE_VERSION = 2;
/** 按小时的账只留这么久：额度监控最多看一周，多留点余量。 */
const HOURS_KEEP_MS = 40 * 86_400_000;
const HOUR_MS = 3_600_000;

export type UsageRollups = {
  version: 1;
  files: Record<string, FileState>;
  /** 外部导入的历史（目前只有 cc-switch），结构同 DayBuckets。 */
  imports: Record<string, { at: number; days: DayBuckets }>;
};


function dataDir() {
  return process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
}

function rollupFile() {
  return path.join(dataDir(), "usage-rollups.json");
}

export function emptyRollups(): UsageRollups {
  return { version: 1, files: {}, imports: {} };
}

export function readRollups(): UsageRollups {
  try {
    const parsed = JSON.parse(fs.readFileSync(rollupFile(), "utf8")) as UsageRollups;
    if (parsed?.version !== 1) return emptyRollups();
    return { version: 1, files: parsed.files ?? {}, imports: parsed.imports ?? {} };
  } catch {
    return emptyRollups();
  }
}

export function writeRollups(value: UsageRollups) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = rollupFile();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, target);
}

function bucket(days: DayBuckets, day: string, source: string, model: string): UsageBucket {
  const bySource = (days[day] ??= {});
  const byModel = (bySource[source] ??= {});
  return (byModel[model] ??= {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costUsd: 0,
    requests: 0,
  });
}

function emptyBucket(): UsageBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, requests: 0 };
}

function addUsage(into: UsageBucket, usage: UsageBucket) {
  into.input += usage.input;
  into.output += usage.output;
  into.cacheRead += usage.cacheRead;
  into.cacheWrite += usage.cacheWrite;
  into.reasoning += usage.reasoning;
  into.costUsd += usage.costUsd;
  into.requests += usage.requests;
}

/**
 * 终端里的 CLI 走官方账号还是中转站，看它自己的全局配置：
 * - Claude Code：`~/.claude/settings.json` 的 env 里配了中转地址或 Key 就不是官方；
 * - Grok：`~/.grok/config.toml` 里有生效的 base_url 就不是官方。
 * 局限：AllAi 里用「API 接口」跑的 Claude Code / Grok 是临时注入环境变量的，
 * 会话文件看不出来，会跟着全局配置走。Codex 不看这个 —— 它每个会话自己记了 model_provider。
 */
function configOfficial(): Record<Kind, boolean | undefined> {
  const home = os.homedir();
  let claude = true;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8")) as {
      env?: Record<string, unknown>;
    };
    const env = settings.env ?? {};
    claude = !["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"].some(
      (key) => typeof env[key] === "string" && String(env[key]).trim(),
    );
  } catch {
    // 没有 settings.json 就是默认的官方登录
  }
  let grok = true;
  try {
    const toml = fs.readFileSync(path.join(home, ".grok", "config.toml"), "utf8");
    grok = !/^\s*base_url\s*=\s*["'][^"']+["']/m.test(toml);
  } catch {
    // 没有 config.toml 同上
  }
  return { "claude-code": claude, codex: undefined, "grok-build": grok };
}

function dayOf(ms: number) {
  const d = new Date(ms);
  // 本地日期：统计页是按用户当地的「今天」分组的。
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/* ---------------- 找文件 ---------------- */

/**
 * AllAi 自己的「官方登录聊天」也是拿 CLI 跑的，会话落在 `~/.allai/*-chat` 那几个空目录下。
 * 那些轮次 AllAi 已经按「聊天」记过账了，这里必须跳过，否则算两遍。
 */
function isAllAiChatPath(text: string) {
  return /[\\/-]allai[\\/-](claude|grok|chatgpt)-chat/i.test(text);
}

function walkJsonl(dir: string, out: string[] = [], depth = 0) {
  if (depth > 6) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(full, out, depth + 1);
    else if (entry.name.endsWith(".jsonl") && !isAllAiChatPath(full)) out.push(full);
  }
  return out;
}

type Kind = "claude-code" | "codex" | "grok-build";

const SOURCES: Record<Kind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  "grok-build": "Grok Build",
};

function roots(): { kind: Kind; dir: string }[] {
  const home = os.homedir();
  return [
    { kind: "claude-code", dir: path.join(home, ".claude", "projects") },
    { kind: "codex", dir: path.join(home, ".codex", "sessions") },
    { kind: "grok-build", dir: path.join(home, ".grok", "sessions") },
  ];
}

/* ---------------- 解析一行 ---------------- */

type Row = { at: number; model: string; usage: UsageBucket; id?: string };

function claudeRow(obj: Record<string, unknown>): Row | null {
  if (obj.type !== "assistant") return null;
  const message = obj.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;
  const at = Date.parse(String(obj.timestamp || "")) || 0;
  if (!at) return null;
  const details = usage.output_tokens_details as Record<string, unknown> | undefined;
  return {
    at,
    id: String(obj.requestId || message?.id || ""),
    model: String(message?.model || "") || "未知模型",
    usage: {
      /*
       * **口径统一**：`input` 一律表示「这一轮送进去的全部输入」，缓存读和缓存写是其中的明细。
       * Anthropic 把三者分开报（实测 input=2 / cache_read=33849 / cache_creation=14249），
       * 只取 input 的话缓存那几十万 token 会凭空消失 —— 统计页的合计（输入+输出）就成了笑话。
       * Codex 和 Grok 的 input 本来就含缓存读，不用动。
       */
      input: num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      reasoning: num(details?.thinking_tokens),
      costUsd: 0,
      requests: 1,
    },
  };
}

function codexRow(obj: Record<string, unknown>): Row | null {
  if (obj.type !== "token_usage_record") return null;
  const payload = obj.payload as Record<string, unknown> | undefined;
  const usage = payload?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;
  const at = Date.parse(String(obj.timestamp || "")) || 0;
  if (!at) return null;
  // Codex 的 input_tokens **已经含**缓存读，别再加一次（和 chat-parse 里同一个口径）。
  return {
    at,
    model: "",
    usage: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cached_input_tokens),
      cacheWrite: num(usage.cache_write_input_tokens),
      reasoning: num(usage.reasoning_output_tokens),
      costUsd: 0,
      requests: 1,
    },
  };
}

function grokRows(obj: Record<string, unknown>): Row[] {
  const params = obj.params as Record<string, unknown> | undefined;
  const update = params?.update as Record<string, unknown> | undefined;
  if (!update || update.sessionUpdate !== "turn_completed") return [];
  const usage = update.usage as Record<string, unknown> | undefined;
  if (!usage) return [];
  const at = num(obj.timestamp) * 1000 || 0;
  if (!at) return [];
  const perModel = usage.modelUsage as Record<string, Record<string, unknown>> | undefined;
  // 有按型号拆分就用它，没有就整轮记成一条。
  const entries: [string, Record<string, unknown>][] = perModel
    ? Object.entries(perModel)
    : [["未知模型", usage]];
  return entries.map(([model, row]) => ({
    at,
    model: model || "未知模型",
    usage: {
      input: num(row.inputTokens),
      output: num(row.outputTokens),
      cacheRead: num(row.cachedReadTokens),
      cacheWrite: num(row.cacheCreationTokens),
      reasoning: num(row.reasoningTokens),
      // Grok 自己报了花费，单位是「tick」：实测 128479200 tick ≈ $0.128，即 1e-9 美元。
      costUsd: num(row.costUsdTicks) / 1e9,
      requests: num(row.modelCalls) || 1,
    },
  }));
}

/* ---------------- 扫一个文件 ---------------- */

/** 一次最多读多少字节，免得单个超大文件把内存吃满。剩下的下一轮接着读。 */
const MAX_CHUNK = 32 * 1024 * 1024;

function scanFile(file: string, kind: Kind, state: FileState, official: Record<Kind, boolean | undefined>) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (state.v !== STATE_VERSION) {
    state.v = STATE_VERSION;
    if (!state.offset || stat.mtimeMs >= Date.now() - HOURS_KEEP_MS) {
      state.offset = 0;
      state.days = {};
      state.hours = {};
      state.model = undefined;
      state.lastId = undefined;
      state.official = undefined;
    }
  }
  state.kind = kind;
  if (state.official === undefined && kind !== "codex") state.official = official[kind];
  // 变小了 = 被重写/截断过，之前记的账对不上了：整份清掉重读。
  if (stat.size < state.offset) {
    state.offset = 0;
    state.days = {};
    state.hours = {};
    state.model = undefined;
    state.lastId = undefined;
    if (kind === "codex") state.official = undefined;
  }
  if (stat.size === state.offset) {
    state.size = stat.size;
    state.mtimeMs = stat.mtimeMs;
    return false;
  }
  const end = Math.min(stat.size, state.offset + MAX_CHUNK);
  let text = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const length = end - state.offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buffer, 0, length, state.offset);
      text = buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  // 最后一行可能只读了一半：留到下次，偏移只推进到最后一个完整换行。
  const lastBreak = text.lastIndexOf("\n");
  if (lastBreak < 0) return false;
  const consumed = Buffer.byteLength(text.slice(0, lastBreak + 1), "utf8");
  const source = SOURCES[kind];
  let touched = false;
  for (const line of text.slice(0, lastBreak).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (kind === "codex") {
      // 型号写在这一轮开头的设置里，后面的 usage 行自己不带。
      const payload = obj.payload as Record<string, unknown> | undefined;
      // 会话开头那条自己写了走哪家：openai = 官方 ChatGPT 账号，custom 之类 = 中转站。
      if (obj.type === "session_meta" && typeof payload?.model_provider === "string") {
        state.official = payload.model_provider === "openai";
      }
      if (payload?.type === "thread_settings_applied") {
        const settings = payload.thread_settings as Record<string, unknown> | undefined;
        const model = String(settings?.model || "");
        if (model) state.model = model;
      }
    }
    const one = kind === "claude-code" ? claudeRow(obj) : kind === "codex" ? codexRow(obj) : null;
    const rows = kind === "grok-build" ? grokRows(obj) : one ? [one] : [];
    for (const row of rows) {
      const model = row.model || state.model || "未知模型";
      // Claude Code 内部占位的那种，不是真的 API 请求，别算进去。
      if (model === "<synthetic>") continue;
      // 同一次响应被拆成多行、每行都带同一份 usage：只认第一行（见 FileState.lastId）。
      if (kind === "claude-code") {
        if (row.id && row.id === state.lastId) continue;
        state.lastId = row.id;
      }
      addUsage(bucket(state.days, dayOf(row.at), source, model), row.usage);
      if (row.at >= Date.now() - HOURS_KEEP_MS) {
        const byModel = ((state.hours ??= {})[String(Math.floor(row.at / HOUR_MS) * HOUR_MS)] ??= {});
        addUsage((byModel[model] ??= emptyBucket()), row.usage);
      }
      touched = true;
    }
  }
  state.offset += consumed;
  state.size = stat.size;
  state.mtimeMs = stat.mtimeMs;
  return touched;
}

/* ---------------- 对外 ---------------- */

let scanning = false;

/**
 * 扫一遍本机所有 CLI 会话文件，把新增的部分记进账里。
 * 同一时间只跑一个（启动、定时、每轮结束都会叫它）。
 */
export function scanLocalUsage(): { files: number; changed: number; skipped: boolean } {
  if (scanning) return { files: 0, changed: 0, skipped: true };
  scanning = true;
  try {
    const rollups = readRollups();
    const alive = new Set<string>();
    const official = configOfficial();
    let changed = 0;
    let files = 0;
    for (const { kind, dir } of roots()) {
      for (const file of walkJsonl(dir)) {
        alive.add(file);
        files += 1;
        const state = (rollups.files[file] ??= { size: 0, mtimeMs: 0, offset: 0, days: {} });
        // 大小和改动时间都没变就跳过（新文件的 size/mtime 记的是 0，不会误判成没变）。
        const stat = safeStat(file);
        if (stat && state.v === STATE_VERSION && stat.size === state.size && stat.mtimeMs === state.mtimeMs) continue;
        if (scanFile(file, kind, state, official)) changed += 1;
      }
    }
    // CLI 自己清掉的老会话：账留着（那些 token 确实花过），只是不会再更新。
    for (const key of Object.keys(rollups.files)) {
      if (!alive.has(key) && !Object.keys(rollups.files[key].days).length) delete rollups.files[key];
    }
    const cutoff = Date.now() - HOURS_KEEP_MS;
    for (const state of Object.values(rollups.files)) {
      for (const key of Object.keys(state.hours ?? {})) if (Number(key) < cutoff) delete state.hours![key];
    }
    writeRollups(rollups);
    return { files, changed, skipped: false };
  } finally {
    scanning = false;
  }
}

function safeStat(file: string) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/** 把某一份导入的历史整份替换掉（重复导入不会翻倍）。 */
export function putImport(name: string, days: DayBuckets) {
  const rollups = readRollups();
  rollups.imports[name] = { at: Date.now(), days };
  writeRollups(rollups);
}

export function dropImport(name: string) {
  const rollups = readRollups();
  delete rollups.imports[name];
  writeRollups(rollups);
}

export type { DayBuckets };
