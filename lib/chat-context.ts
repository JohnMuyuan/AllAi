import { compactIfNeeded, compactionTurns, type CompactProgress, type CompactTurn } from "./compact";
import {
  DEFAULT_COMPACT_PERCENT,
  contextLimit,
  contextStatus,
  estimateMessagesTokens,
  estimateTokens,
} from "./context-window";
import type { ChatMessage, Compaction } from "./types";

/**
 * 换模型时要交给新模型的上下文。
 *
 * 为什么需要这个：官方登录那三条路（Claude / Grok / ChatGPT 账号）的记忆
 * 存在各家 CLI 自己的会话文件里，靠 `--resume` 续。一换模型就是换 CLI，
 * 那个会话根本不存在，新模型从零开始 —— 它还不知道自己失忆了，于是开始编。
 *
 * 所以：**AllAi 自己的对话记录才是唯一事实来源**，换模型时重新喂一遍。
 * resume 降级成纯粹的省 token 优化。
 *
 * 「交接」和「到量压缩」是同一件事，所以都走 lib/compact.ts：
 * 能装下的原样带过去，装不下的早期内容压成摘要。以前这里写死「最近 6 条 /
 * 12K 字符」，对 1M 窗口的模型是白白丢上下文，对 128K 的又可能不够 ——
 * 现在按目标模型的实际上限来。
 */

export type ChatContext = {
  /** 更早那些轮次的摘要。没有更早的内容时是空串。 */
  summary: string;
  /** 能原样带过去的部分，按时间正序。 */
  recent: CompactTurn[];
  /** 被摘要掉的消息条数，用来在界面上说明。 */
  summarized: number;
  /** 这次新压出来的结果，调用方要存下来，下次不用重压。 */
  compaction?: Compaction;
  /** 组装完之后的占用情况，给进度条用。 */
  status: ReturnType<typeof contextStatus>;
};

/** 只有真正的对话内容能进上下文：notice 是界面标记，system 由各 CLI 自己管。 */
function conversational(messages: ChatMessage[]): CompactTurn[] {
  return messages
    .filter((item) => (item.role === "user" || item.role === "assistant") && item.content.trim())
    .map((item) => ({
      role: item.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: item.content,
    }));
}

export async function buildChatContext(
  messages: ChatMessage[],
  opts: {
    /** 要交给哪个模型 —— 上限按它算。空字符串会落到保守的兜底值。 */
    modelId?: string;
    overrides?: Record<string, number>;
    percent?: number;
    /** 这条对话上已有的压缩结果，接着往下压。 */
    previous?: Compaction;
    signal?: AbortSignal;
    /** 换模型开新会话时更早压，按新窗口 KEEP_RATIO。 */
    handoff?: boolean;
    onProgress?: (event: CompactProgress) => void;
  } = {},
): Promise<ChatContext> {
  const all = conversational(messages);
  const limit = contextLimit(opts.modelId || "", opts.overrides);
  const percent = opts.percent || DEFAULT_COMPACT_PERCENT;
  if (!all.length) {
    return { summary: "", recent: [], summarized: 0, status: contextStatus(0, limit.tokens, percent) };
  }

  const result = await compactIfNeeded({
    turns: all,
    modelId: opts.modelId || "",
    limitTokens: limit.tokens,
    percent,
    previous: opts.previous,
    signal: opts.signal,
    handoff: opts.handoff,
    onProgress: opts.onProgress,
  });

  if (result.compacted) {
    const recent = all.slice(result.compaction.folded);
    return {
      summary: result.compaction.summary,
      recent,
      summarized: result.compaction.folded,
      compaction: result.compaction,
      status: contextStatus(
        estimateTokens(result.compaction.summary) + estimateMessagesTokens(recent),
        limit.tokens,
        percent,
      ),
    };
  }

  // 没到量：能原样带的就全带过去，交接得越完整越好。
  const previous = opts.previous;
  const recent = previous ? all.slice(previous.folded) : all;
  return {
    summary: previous?.summary ?? "",
    recent,
    summarized: previous?.folded ?? 0,
    status: result.status,
  };
}

/** Grok / Codex 没有多轮输入，只能把上下文写进提示词。 */
export function contextToPrompt(context: ChatContext, prompt: string): string {
  if (!context.summary && !context.recent.length) return prompt;
  const parts: string[] = [
    "【以下是你和用户此前的对话，供你了解来龙去脉。这不是用户此刻的提问，不要复述、不要重新回答它们。】",
  ];
  if (context.summary) parts.push(`早前对话的要点：\n${context.summary}`);
  if (context.recent.length) {
    parts.push(
      `最近几轮原文：\n${context.recent
        .map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${item.content}`)
        .join("\n\n")}`,
    );
  }
  parts.push(`【以上是历史。用户此刻的问题】\n${prompt}`);
  return parts.join("\n\n");
}

/** 交接时摘要要怎么摆。和 compact 那边共用一句话，口径统一。 */
export function contextHandoffTurns(context: ChatContext): CompactTurn[] {
  if (!context.summary) return context.recent;
  return [
    ...compactionTurns({
      summary: context.summary,
      folded: context.summarized,
      at: Date.now(),
      tokensBefore: 0,
      tokensAfter: 0,
    }),
    ...context.recent,
  ];
}
