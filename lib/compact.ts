import {
  KEEP_RATIO,
  clipToTokens,
  contextLimit,
  contextStatus,
  estimateMessagesTokens,
  estimateTokens,
  handoffShouldCompact,
  type CompactTurn,
} from "./context-window";
import { isChatModel, withModelKind } from "./models";
import { isOfficialProvider } from "./official-chat";
import { readDb } from "./store";
import type { Compaction, Provider } from "./types";
import { joinUrl, providerHeaders } from "./upstream";

/**
 * 上下文压缩（compact）—— **服务端专用**。
 *
 * 这个文件会读 db、会发请求，链条上挂着 `fs`。界面千万别引它，
 * 引一下整个浏览器包就炸（Module not found: Can't resolve 'fs'）。
 * 界面要用的纯函数（compactNotice / applyCompaction 等）在 lib/context-window.ts。
 *
 * 各家 CLI 到自家上限的 83%–85% 会自己压一次。AllAi 的问题是：我们自己的对话记录
 * 才是事实来源（见 lib/chat-context.ts 的说明），换模型、换 CLI、走 HTTP 的时候
 * 都是我们把整段历史重新喂过去的 —— 那 CLI 内部压没压就不算数了，得我们自己压。
 *
 * 做法和各家一样：早期内容压成一段摘要，最近几轮保留原文。压完存下来，
 * 下一轮直接复用，不会每轮都重新摘要一遍。
 */

export type { Compaction };
export {
  applyCompaction,
  clipToTokens,
  compactNotice,
  compactionTurns,
  type CompactTurn,
} from "./context-window";


const SUMMARY_SYSTEM =
  "把下面的对话压缩成给另一个 AI 看的交接记录，它要接着这段对话继续干活。" +
  "必须保留：用户的目标和要求、已经定下的结论和约定、提到的具体名字/数字/文件路径/命令、" +
  "做到哪一步了、还没解决的问题。丢掉寒暄和重复的复述。" +
  "用中文，分条写，不超过 600 字。只输出记录本身，不要开场白。";

export type CompactProgress = {
  phase: "整理" | "摘要";
  chars?: number;
  text?: string;
};

async function readSummaryStream(response: Response, onDelta?: (text: string) => void) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const row = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      const piece = row.choices?.[0]?.delta?.content || "";
      if (piece) {
        out += piece;
        onDelta?.(piece);
      }
    } catch {
      // keep-alive
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) consume(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
  } finally {
    reader.releaseLock();
  }
  return out.trim();
}

async function callSummarizer(
  provider: Provider,
  modelId: string,
  transcript: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string> {
  const streaming = Boolean(onDelta);
  const response = await fetch(joinUrl(provider.baseUrl, "chat/completions"), {
    method: "POST",
    headers: providerHeaders(provider),
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      stream: streaming,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: transcript },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 200));
  }
  if (streaming) return readSummaryStream(response, onDelta);
  const text = await response.text();
  const parsed = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  return (parsed.choices?.[0]?.message?.content || "").trim();
}

/**
 * 借任意一个有 Key 的第三方服务做摘要。
 *
 * 为什么不用当前这个模型自己压：官方登录那三条路根本没有 HTTP 接口，
 * 要压得再起一个 CLI 进程，慢且容易失败。而且摘要这活儿不挑模型。
 *
 * 摘要本身也可能很长，所以先按目标模型的上限截一刀再送进去 ——
 * 拿一段 800K 的记录去喂一个 128K 的小模型，只会白等一个 400。
 */
export async function summarizeTranscript(
  transcript: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<string> {
  const db = await readDb();
  const timeout = AbortSignal.timeout(30_000);
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (const provider of db.providers) {
    if (!provider.apiKey || isOfficialProvider(provider)) continue;
    const model = provider.models.find((item) => isChatModel(withModelKind(item)));
    if (!model) continue;
    const limit = contextLimit(model.id, db.prefs.contextLimits);
    // 留一半给系统提示和输出。
    const room = Math.max(4_000, Math.floor(limit.tokens * 0.5));
    const clipped = clipToTokens(transcript, room);
    try {
      const summary = await callSummarizer(provider, model.id, clipped, bounded, onDelta);
      if (summary) return summary;
    } catch (error) {
      if (signal?.aborted) throw error;
      // 换下一个服务
    }
  }
  return "";
}

function transcriptOf(turns: CompactTurn[]) {
  return turns
    .map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`)
    .join("\n\n");
}

export type CompactResult =
  | { compacted: false; status: ReturnType<typeof contextStatus> }
  | { compacted: true; compaction: Compaction; status: ReturnType<typeof contextStatus> };

/**
 * 到量就压。没到量原样返回，调用方拿 `status` 去画进度条。
 *
 * @param turns 完整历史（正序）。**不包含**用户这一刻刚发的那句。
 * @param alreadyFolded 之前已经压掉的条数，这次只在它之后的内容里挑。
 */
export async function compactIfNeeded(opts: {
  turns: CompactTurn[];
  modelId: string;
  limitTokens: number;
  percent: number;
  /** 上一次的压缩结果，接着往下压。 */
  previous?: Compaction;
  /** 额外要算进去的长度，例如这一轮的提问和附件。 */
  extraTokens?: number;
  /** 当前发送被取消时，摘要请求也应立即停。 */
  signal?: AbortSignal;
  /** 换模型 / 开新会话：按新窗口的 KEEP_RATIO 压，别等 80%。 */
  handoff?: boolean;
  onProgress?: (event: CompactProgress) => void;
}): Promise<CompactResult> {
  const { turns, modelId, limitTokens, percent, previous } = opts;
  const previousSummaryTokens = previous ? estimateTokens(previous.summary) : 0;
  const live = previous ? turns.slice(previous.folded) : turns;
  const used =
    previousSummaryTokens + estimateMessagesTokens(live) + (opts.extraTokens ?? 0);
  const status = contextStatus(used, limitTokens, percent);
  if (!status.shouldCompact && !(opts.handoff && handoffShouldCompact(used, limitTokens))) {
    return { compacted: false, status };
  }

  // 保留的原文最多占上限的 KEEP_RATIO，剩下的留给摘要和这一轮。
  const keepBudget = Math.floor(limitTokens * KEEP_RATIO);
  let keepFrom = live.length;
  let keepTokens = 0;
  while (keepFrom > 0) {
    const next = keepTokens + estimateTokens(live[keepFrom - 1].content) + 4;
    if (next > keepBudget && live.length - keepFrom >= 2) break;
    keepTokens = next;
    keepFrom -= 1;
  }
  // 至少要折掉一条，否则等于没压，下一轮又会走到这儿。
  if (keepFrom >= live.length) keepFrom = Math.max(0, live.length - 2);
  if (keepFrom <= 0) return { compacted: false, status };

  const older = live.slice(0, keepFrom);
  const parts = previous?.summary
    ? [`【更早的交接记录】\n${previous.summary}`, transcriptOf(older)]
    : [transcriptOf(older)];
  opts.onProgress?.({ phase: "整理" });
  let summary: string;
  let chars = 0;
  try {
    summary = await summarizeTranscript(parts.join("\n\n"), opts.signal, (piece) => {
      chars += piece.length;
      opts.onProgress?.({ phase: "摘要", chars, text: piece });
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    summary = "";
  }
  if (!summary) {
    // 一个能做摘要的服务都没有：宁可把原文截短带过去，也不能什么都不给 ——
    // 什么都不给的后果是模型开始编，那比丢细节严重得多。
    summary = clipToTokens(parts.join("\n\n"), Math.floor(limitTokens * 0.15));
  }

  const folded = (previous?.folded ?? 0) + older.length;
  const tokensAfter = estimateTokens(summary) + keepTokens + (opts.extraTokens ?? 0);
  return {
    compacted: true,
    compaction: {
      summary,
      folded,
      at: Date.now(),
      tokensBefore: used,
      tokensAfter,
      modelId,
    },
    status,
  };
}
