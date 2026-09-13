/**
 * 每个模型能装多少上下文，以及什么时候该压缩。
 *
 * 三家 CLI 各有各的上限和 compact 点（2026-09 查证）：
 * - Claude Opus 5 / Sonnet 5：1M；Haiku 4.5、Claude 4 及更早：200K。
 *   Claude Code 到 ~83.5% 自动 compact（`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 只能往下调）。
 * - Grok 4.6：500K；grok-build-0.1（原 grok-code-fast-1）：256K。默认 85% 触发。
 * - Codex / GPT-5.5：标称 400K，但其中 128K 留给输出，实际能填的输入约 272K，
 *   CLI 还留 5% 余量。它的 `model_auto_compact_token_limit` 默认约 200K。
 *
 * 这里只关心**输入侧**能装多少，所以 Codex 记的是 272K 而不是 400K —— 按 400K
 * 算会压得太晚，压的时候内容已经超过压缩接口本身能吃下的量了（openai/codex #19409）。
 *
 * 这个文件必须是纯函数、不碰 fs / fetch，界面和服务端都要引它。
 */

/** 兜底上限。认不出的模型按这个算，宁可早压一点也别撑爆。 */
export const FALLBACK_CONTEXT = 128_000;

/** 默认在用掉多少之后开始压缩。三家官方在 83%–85% 之间，我们留多一点余量。 */
export const DEFAULT_COMPACT_PERCENT = 80;

/** 压缩后保留的原文最多占上限的多少 —— 剩下的留给摘要和这一轮的新内容。 */
export const KEEP_RATIO = 0.35;

/**
 * 模型 id → 上下文上限。从上往下第一条匹配的生效，所以具体的要排在笼统的前面
 * （`claude-haiku` 必须在 `claude` 前面）。
 */
const TABLE: { test: RegExp; tokens: number; note: string }[] = [
  // Anthropic
  { test: /claude.*haiku/i, tokens: 200_000, note: "Claude Haiku" },
  { test: /claude.*(opus|sonnet|fable).*-?5/i, tokens: 1_000_000, note: "Claude 5 系" },
  { test: /claude.*(opus|sonnet).*4[.-]?8/i, tokens: 1_000_000, note: "Claude 4.8" },
  { test: /claude/i, tokens: 200_000, note: "Claude 4 及更早" },

  // xAI
  { test: /grok.*4[.-]6/i, tokens: 500_000, note: "Grok 4.6" },
  { test: /grok.*(build|code)/i, tokens: 256_000, note: "grok-build" },
  { test: /grok/i, tokens: 256_000, note: "Grok" },

  // OpenAI
  { test: /gpt-4\.1/i, tokens: 1_000_000, note: "GPT-4.1" },
  { test: /gpt-4o|gpt-4-turbo/i, tokens: 128_000, note: "GPT-4o" },
  { test: /(gpt-5|codex|o[34])/i, tokens: 272_000, note: "GPT-5 / Codex（可输入部分）" },

  // 其它常见的
  { test: /gemini.*(1\.5|2\.|3)/i, tokens: 1_000_000, note: "Gemini" },
  { test: /gemini/i, tokens: 128_000, note: "Gemini" },
  { test: /deepseek/i, tokens: 128_000, note: "DeepSeek" },
  { test: /qwen|glm|kimi|moonshot/i, tokens: 128_000, note: "国产长文模型" },
  { test: /llama|mistral|mixtral/i, tokens: 128_000, note: "开源模型" },
];

export type ContextLimit = {
  tokens: number;
  /** 这个数是怎么来的，给界面显示用。 */
  source: "override" | "table" | "fallback";
  note: string;
};

/**
 * 查一个模型能装多少。
 *
 * `overrides` 是用户在设置里手填的，按模型 id 精确匹配，优先级最高 ——
 * 中转站上同一个名字可能被限成更小的窗口，只有用户自己知道。
 */
export function contextLimit(
  modelId: string,
  overrides?: Record<string, number>,
): ContextLimit {
  const id = (modelId || "").trim();
  const manual = id && overrides ? overrides[id] : undefined;
  if (typeof manual === "number" && manual > 0) {
    return { tokens: Math.round(manual), source: "override", note: "你手动设定的" };
  }
  for (const row of TABLE) {
    if (row.test.test(id)) return { tokens: row.tokens, source: "table", note: row.note };
  }
  return { tokens: FALLBACK_CONTEXT, source: "fallback", note: "认不出型号，按保守值算" };
}

/**
 * 粗略折算 token。
 *
 * 没有引 tokenizer：三家分词器各不相同，为了一个进度条把 wasm 塞进包里不值当。
 * 中文 1 字 ≈ 0.6 token、其它 4 字符 ≈ 1 token，实测和真实用量差在 15% 以内，
 * 够用来决定「该压了没」。真实用量还是以接口回报的 usage 为准。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) if (ch.charCodeAt(0) > 0x2e80) cjk += 1;
  return Math.round(cjk * 0.6 + (text.length - cjk) / 4);
}

export function estimateMessagesTokens(
  messages: { content?: string; reasoning?: string; thinking?: string }[],
): number {
  let total = 0;
  for (const item of messages) {
    total += estimateTokens(item.content || "");
    total += estimateTokens(item.reasoning || item.thinking || "");
    // 每条消息本身有角色标记等固定开销，各家都在 3–5 token。
    total += 4;
  }
  return total;
}

export type ContextStatus = {
  used: number;
  limit: number;
  /** 0–1。可能超过 1（已经溢出了）。 */
  ratio: number;
  /** 到这个数就该压缩了。 */
  compactAt: number;
  shouldCompact: boolean;
  /** 给界面上色：ok < 阈值一半的余量，warn 接近了，over 该压了。 */
  level: "ok" | "warn" | "over";
};

/**
 * 换模型 / 开新 CLI 会话时，历史必须装进**新模型**的窗口。
 * 常规压缩等 80% 才动；交接要更早压 —— 新会话还要装系统提示和工具表，
 * 而且 Grok 自己压会另开一条会话，出现在侧栏里。
 */
export function handoffShouldCompact(used: number, limit: number) {
  return used > Math.floor(Math.max(1, limit) * KEEP_RATIO);
}

export function contextStatus(
  used: number,
  limit: number,
  percent = DEFAULT_COMPACT_PERCENT,
): ContextStatus {
  const safe = Math.max(1, limit);
  const pct = Math.min(99, Math.max(10, percent)) / 100;
  const compactAt = Math.round(safe * pct);
  const ratio = used / safe;
  return {
    used,
    limit: safe,
    ratio,
    compactAt,
    shouldCompact: used >= compactAt,
    level: used >= compactAt ? "over" : ratio >= pct * 0.75 ? "warn" : "ok",
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}


/* ---------- 压缩相关的纯函数 ----------
 * 放在这里而不是 lib/compact.ts：那个文件要读 db、要发请求，链条上挂着 `fs`，
 * 被客户端组件引一下整个浏览器包就炸（Module not found: Can't resolve 'fs'）。
 * 界面要用的只有这几个纯函数。
 */

/** 存在对话/工作/创作上的压缩结果。`folded` 是被折进摘要的消息条数（前缀）。 */
export type Compaction = {
  summary: string;
  folded: number;
  at: number;
  /** 压缩发生时的估算长度，用来在界面上说明省了多少。 */
  tokensBefore: number;
  tokensAfter: number;
  /** 触发压缩时用的是哪个模型，方便回头查。 */
  modelId?: string;
};

export type CompactTurn = { role: "user" | "assistant"; content: string };

/** 按估算 token 从**开头**截断 —— 越近的内容越重要，砍就砍最早的。 */
export function clipToTokens(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  // 估算是线性的，按比例回切一次再微调，比逐字符试快得多。
  let slice = text;
  for (let i = 0; i < 6 && estimateTokens(slice) > budget; i++) {
    const ratio = budget / Math.max(1, estimateTokens(slice));
    slice = slice.slice(Math.floor(slice.length * (1 - ratio * 0.95)));
  }
  // 从前面切掉内容时，切口落在代理对中间，剩下的第一个码元会是“低代理”。
  if (slice.length && slice.charCodeAt(0) >= 0xdc00 && slice.charCodeAt(0) <= 0xdfff) {
    slice = slice.slice(1);
  }
  return `（更早的内容已省略）\n${slice}`;
}

/** 压缩后的摘要要怎么摆进消息列表。放 user 角色是因为三家 CLI 都只吃 user/assistant。 */
export function compactionTurns(compaction: Compaction): CompactTurn[] {
  return [
    {
      role: "user",
      content: `【此前对话的交接记录（由 AllAi 压缩，原文已折叠）】\n${compaction.summary}`,
    },
    { role: "assistant", content: "好的，我已经了解此前的进展，继续。" },
  ];
}

/** 把压缩结果套到完整历史上，得到真正要发出去的那份。 */
export function applyCompaction<T extends { content?: string }>(
  messages: T[],
  compaction: Compaction | undefined,
): { head: CompactTurn[]; rest: T[] } {
  if (!compaction || compaction.folded <= 0) return { head: [], rest: messages };
  return { head: compactionTurns(compaction), rest: messages.slice(compaction.folded) };
}

/**
 * 压缩发生后给用户看的那句话。三个专区都用这一句，口径统一。
 *
 * 拆成「模板 + 变量」两份，是为了能翻：服务端（不知道界面语言）直接调
 * `compactNotice()`，界面上调 `t(COMPACT_NOTICE, compactNoticeVars(...))`。
 * 别把数字拼进模板里 —— 拼进去就成了新 key，词典永远对不上。
 */
export const COMPACT_NOTICE =
  "上下文已到 {pct}%（约 {before}/{limit}），已把更早的内容压成摘要，省下约 {saved} token。最近几轮保留原文。";

export function compactNoticeVars(compaction: Compaction, limitTokens: number) {
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  return {
    pct: Math.round((compaction.tokensBefore / Math.max(1, limitTokens)) * 100),
    before: fmt(compaction.tokensBefore),
    limit: fmt(limitTokens),
    saved: fmt(Math.max(0, compaction.tokensBefore - compaction.tokensAfter)),
  };
}

export function compactNotice(compaction: Compaction, limitTokens: number): string {
  const vars = compactNoticeVars(compaction, limitTokens);
  return COMPACT_NOTICE.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key as keyof typeof vars]) : whole,
  );
}
