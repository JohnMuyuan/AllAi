/**
 * Token 用量记录。手动清空之前不会自己删。
 * 存在 ~/.allai/usage.json，和 db.json 分开 —— 它只增不改，别拖累主库。
 */
export type UsageArea = "chat" | "agent" | "studio";

export type UsageEvent = {
  id: string;
  at: number;
  area: UsageArea;
  /** 属于哪条对话，用来算「这次对话用了多少」。老记录没有。 */
  conversationId?: string;
  /** 显示用的服务名（第三方服务名 / "Claude 账号" / "Grok 账号"）。 */
  source: string;
  modelId: string;
  /** 这一轮真正占用的窗口大小（各家口径已统一）。老记录没有。 */
  contextTokens?: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** CLI 报的真实花费，没有就是 0。 */
  costUsd: number;
  requests: number;
  /** 创作页出的图/视频数量。 */
  images: number;
  durationMs: number;
};

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  costUsd: number;
  requests: number;
  images: number;
  tokens: number;
};

export function emptyTotals(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costUsd: 0,
    requests: 0,
    images: 0,
    tokens: 0,
  };
}

export function addTotals(into: UsageTotals, event: UsageEvent) {
  into.input += event.input;
  into.output += event.output;
  into.cacheRead += event.cacheRead;
  into.cacheWrite += event.cacheWrite;
  into.reasoning += event.reasoning;
  into.costUsd += event.costUsd;
  into.requests += event.requests;
  into.images += event.images;
  // 缓存读的是输入的一部分，不重复计；总量按 input + output 算。
  into.tokens += event.input + event.output;
  return into;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 三家的字段名都不一样，统一到一处：
 * - Anthropic wire（Claude Code / Grok Build 的 result 事件）
 * - Codex 的 token_usage_record
 * - OpenAI 兼容 HTTP 的 usage
 */
export function normalizeUsage(raw: unknown): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const inDetails = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const outDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>;

  const cacheRead = num(u.cache_read_input_tokens) || num(u.cached_input_tokens) || num(inDetails.cached_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens) || num(u.cache_write_input_tokens);
  const reasoning = num(u.reasoning_output_tokens) || num(outDetails.reasoning_tokens);
  const input = num(u.input_tokens) || num(u.prompt_tokens);
  const output = num(u.output_tokens) || num(u.completion_tokens);

  if (!input && !output && !cacheRead && !cacheWrite && !reasoning) return null;
  return { input, output, cacheRead, cacheWrite, reasoning };
}

/**
 * 官方登录（Claude / Grok / ChatGPT 账号）在滚动窗口里已经用掉多少 token。
 *
 * 注意：这是 **AllAi 自己记的用量**，不是官方剩余额度。
 * 三家 CLI 都没有暴露配额接口（claude 没有 usage 子命令、
 * grok/codex 也没有），所以拿不到「还剩多少」。
 */
export function windowUsage(events: UsageEvent[], source: string, now: number) {
  const fiveHourFrom = now - 5 * 60 * 60 * 1000;
  const weekFrom = now - 7 * 24 * 60 * 60 * 1000;
  const out = { fiveHour: 0, week: 0, requests: 0, costUsd: 0 };
  for (const event of events) {
    if (event.source !== source) continue;
    const tokens = event.input + event.output;
    if (event.at >= weekFrom) {
      out.week += tokens;
      out.requests += event.requests;
      out.costUsd += event.costUsd;
    }
    if (event.at >= fiveHourFrom) out.fiveHour += tokens;
  }
  return out;
}

/** 这条对话累计用了多少 token。 */
export function conversationUsage(events: UsageEvent[], conversationId: string) {
  const out = { input: 0, output: 0, cacheRead: 0, prompt: 0, tokens: 0, requests: 0, costUsd: 0 };
  for (const event of events) {
    if (event.conversationId !== conversationId) continue;
    out.input += event.input;
    out.output += event.output;
    out.cacheRead += event.cacheRead;
    /*
     * 缓存命中率的分母是「这一轮送进模型的全部输入」。Anthropic 口径（Claude）的 input 不含缓存读写，
     * 要加回去；OpenAI / Grok 的 input 已经含了。Anthropic 会报缓存写入、缓存读常比 input 大，据此区分。
     */
    out.prompt +=
      event.cacheWrite > 0 || event.cacheRead > event.input
        ? event.input + event.cacheRead + event.cacheWrite
        : event.input;
    out.tokens += event.input + event.output;
    out.requests += event.requests;
    out.costUsd += event.costUsd;
  }
  return out;
}

/**
 * 这条对话此刻在模型窗口里占了多少 —— 取**最后一轮**上报的输入量。
 *
 * 为什么不按消息字符估：估算看不见 CLI 内部已经 compact 过、也看不见系统提示和
 * 工具输出占的量。实测一条 Codex 会话，CLI 报 101.6K，字符估算给出 456.7K，
 * 差 4.5 倍（0.12.1 的 BUG）。接口回报的 usage 才是真的。
 *
 * 输入量本身已经含缓存读的部分，所以 `input` 就是窗口占用，不要再加 `cacheRead`。
 */
export function liveContextTokens(events: UsageEvent[], conversationId: string): number {
  let latest = 0;
  let at = -1;
  for (const event of events) {
    if (event.conversationId !== conversationId) continue;
    if (event.at < at) continue;
    at = event.at;
    /*
     * 优先用记录时算好的 contextTokens。老记录没有这个字段，只能现推：
     * Anthropic 的 input 不含缓存读（input 会明显小于 cacheRead），
     * OpenAI / Grok 的已经含了。
     */
    latest =
      event.contextTokens ||
      (event.cacheRead > event.input
        ? event.input + event.cacheRead + event.cacheWrite
        : event.input) ||
      0;
  }
  return latest;
}
