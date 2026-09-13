import { askFromInput, describeTool, type AskPayload } from "./agent-tools";
import { parseExternalAgentText } from "./external-agent";
import { diffsForTool, diffsFromCodexChanges, type FileDiff } from "./diff";
import { isClaudeAuthNoise } from "./launch";

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; detail?: string; diff?: FileDiff[]; ask?: AskPayload }
  /** 这一轮回复用的型号（Claude 的 assistant 消息里有）。用量记录缺型号时靠它兜底。 */
  | { type: "model"; modelId: string }
  | { type: "session"; cliSessionId: string }
  | { type: "error"; message: string }
  /** 想续的会话 CLI 那边已经没了，这一轮是从零开始的（上下文断了）。 */
  | { type: "reset"; reason: string }
  | {
      type: "usage";
      modelId?: string;
      /** 这一轮真正占用的窗口大小。各家口径不同，已在 usageEvent 里统一。 */
      contextTokens?: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning: number;
      costUsd?: number;
      durationMs?: number;
    }
  | { type: "done" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickSessionId(obj: Record<string, unknown>): string | undefined {
  const keys = ["session_id", "sessionId", "thread_id", "threadId"];
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  const payload = asRecord(obj.payload);
  if (payload) {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value) return value;
    }
    if (typeof payload.id === "string" && obj.type === "session_meta") return payload.id;
  }
  return undefined;
}

function toNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * 三家 CLI 的 usage 字段名都不同，这里统一：
 * - Claude Code / Grok Build：`result` 事件的 Anthropic wire 格式
 * - Codex：`token_usage_record` / `token_count`
 */
function usageEvent(obj: Record<string, unknown>): ChatEvent | null {
  const payload = asRecord(obj.payload);
  const info = asRecord(obj.info) || asRecord(payload?.info);
  const update = asRecord(asRecord(obj.params)?.update) || asRecord(obj.update);
  const raw =
    asRecord(obj.usage) ||
    asRecord(payload?.usage) ||
    // Grok 的 turn_completed，usage 藏在 params.update 下面。
    asRecord(update?.usage) ||
    /*
     * Codex 的 token_usage_record 走上面的 payload.usage（本来就是本轮的量）。
     * 这两条是兜底：万一拿到的是 token_count 事件，也要取 last_token_usage（本轮），
     * 绝不能取 total_token_usage —— 那是整条会话的累计值，逐轮相加会翻好几倍。
     */
    asRecord(info?.last_token_usage) ||
    asRecord(info?.total_token_usage) ||
    null;
  if (!raw) return null;

  // Grok 用 camelCase（inputTokens / cachedReadTokens），另外两家是 snake_case。
  const input = toNum(raw.input_tokens) || toNum(raw.prompt_tokens) || toNum(raw.inputTokens);
  const output = toNum(raw.output_tokens) || toNum(raw.completion_tokens) || toNum(raw.outputTokens);
  const cacheRead =
    toNum(raw.cache_read_input_tokens) ||
    toNum(raw.cached_input_tokens) ||
    toNum(raw.cachedReadTokens);
  const cacheWrite =
    toNum(raw.cache_creation_input_tokens) ||
    toNum(raw.cache_write_input_tokens) ||
    toNum(raw.cacheCreationTokens);
  const reasoning = toNum(raw.reasoning_output_tokens) || toNum(raw.reasoningTokens);
  if (!input && !output && !cacheRead && !cacheWrite && !reasoning) return null;

  const message = asRecord(obj.message);
  // Grok / Claude 的 result 事件顶层没有 model，型号是 modelUsage 的键名。
  const modelUsage = asRecord(obj.modelUsage);
  const fromUsageMap = modelUsage ? Object.keys(modelUsage)[0] : "";
  /*
   * 窗口占用（这一轮真正塞进模型的量）。各家口径不同，必须在这儿分清楚：
   * - Anthropic wire（Claude Code）：`input_tokens` **不含**缓存读，
   *   实测 input=2 / cache_read=362818 —— 只取 input 会显示成 2 tokens。
   * - OpenAI wire（Codex）和 Grok：`input_tokens` / `inputTokens` **已含**缓存读，
   *   再加一次就翻倍。
   * 靠字段名区分：只有 Anthropic 用 `cache_read_input_tokens` 这个名字。
   */
  const anthropicWire = raw.cache_read_input_tokens !== undefined;
  const contextTokens = anthropicWire ? input + cacheRead + cacheWrite : input;
  /*
   * 记账用的 `input` 也按同一个口径：一律表示「送进去的全部输入」，缓存是其中的明细。
   * 不统一的话统计页里 Anthropic 那几行的输入只有个位数，而 Codex / Grok 那几行含缓存，
   * 同一张表里两种意思，合计（输入+输出）根本没法看（0.16.36 起）。
   */
  const totalInput = anthropicWire ? input + cacheRead + cacheWrite : input;

  return {
    type: "usage",
    contextTokens: contextTokens || undefined,
    modelId:
      (typeof obj.model === "string" && obj.model) ||
      (typeof message?.model === "string" && message.model) ||
      fromUsageMap ||
      undefined,
    input: totalInput,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    costUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
    durationMs: toNum(obj.duration_ms) || undefined,
  };
}

export function eventsFromJson(obj: Record<string, unknown>): ChatEvent[] {
  const out: ChatEvent[] = [];
  const sessionId = pickSessionId(obj);
  if (sessionId) out.push({ type: "session", cliSessionId: sessionId });
  if (obj.type === "system") {
    const blob = [obj.message, obj.content, obj.error]
      .filter((item): item is string => typeof item === "string")
      .join("\n");
    if (blob && isClaudeAuthNoise(blob)) return out;
  }

  if (obj.type === "stream_event" && asRecord(obj.event)) {
    return [...out, ...eventsFromJson(obj.event as Record<string, unknown>)];
  }

  const delta = asRecord(obj.delta);
  if (delta && typeof delta.text === "string" && delta.text) {
    if (delta.type === "thinking_delta") out.push({ type: "thinking", text: delta.text });
    else out.push({ type: "delta", text: delta.text });
  }

  const contentBlock = asRecord(obj.content_block);
  if (obj.type === "content_block_start" && contentBlock?.type === "tool_use") {
    const info = describeTool(
      typeof contentBlock.name === "string" ? contentBlock.name : "工具",
      contentBlock.input,
    );
    out.push({ type: "tool", name: info.label, detail: info.detail || undefined });
  }

  if (obj.type === "assistant") {
    const message = asRecord(obj.message);
    if (typeof message?.model === "string" && message.model && message.model !== "<synthetic>") {
      out.push({ type: "model", modelId: message.model });
    }
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const item = asRecord(block);
        if (item?.type === "tool_use" && typeof item.name === "string") {
          const info = describeTool(item.name, item.input);
          out.push({
            type: "tool",
            name: info.label,
            detail: info.detail || undefined,
            diff: diffsForTool(item.name, item.input),
            ask: askFromInput(item.name, item.input),
          });
        }
      }
    }
  }

  if (obj.type === "result" && obj.is_error) {
    const message = String(obj.result || "Agent 出错");
    if (!isClaudeAuthNoise(message)) out.push({ type: "error", message });
  }

  // result（Claude/Grok）和 token_usage_record（Codex）都在这一轮结束时报总量。
  const usageUpdate =
    asRecord(asRecord(obj.params)?.update)?.sessionUpdate || asRecord(obj.update)?.sessionUpdate;
  if (
    obj.type === "result" ||
    obj.type === "token_usage_record" ||
    obj.type === "token_count" ||
    obj.type === "turn.completed" ||
    // Grok Agent 的一轮结束事件。以前这里没认它，Grok Agent 的用量一条都没记上。
    usageUpdate === "turn_completed"
  ) {
    const usage = usageEvent(obj);
    if (usage) out.push(usage);
  }

  const update = asRecord(obj.update) || asRecord(asRecord(obj.params)?.update);
  const sessionUpdate = (update?.sessionUpdate || obj.sessionUpdate) as string | undefined;
  const content = asRecord(update?.content) || asRecord(obj.content);
  const chunkText = typeof content?.text === "string" ? content.text : "";
  if (sessionUpdate === "agent_message_chunk" && chunkText) out.push({ type: "delta", text: chunkText });
  if (sessionUpdate === "user_message_chunk" && chunkText) out.push({ type: "delta", text: chunkText });
  if (sessionUpdate === "agent_thought_chunk" && chunkText) {
    out.push({ type: "thinking", text: chunkText });
  }
  // 真工具是 tool_call；tool_name 那个字段长在 hook_execution 上，不是工具本身。
  if (sessionUpdate === "tool_call") {
    const meta = asRecord(update?._meta)?.["x.ai/tool"];
    const metaName = asRecord(meta)?.name;
    const toolName =
      (typeof metaName === "string" && metaName) ||
      (typeof update?.title === "string" ? update.title : "工具");
    const info = describeTool(toolName, update?.rawInput);
    out.push({
      type: "tool",
      name: info.label,
      detail: info.detail || undefined,
      diff: diffsForTool(toolName, update?.rawInput),
    });
  }

  const item = asRecord(obj.item);
  if (
    (obj.type === "item.completed" ||
      obj.type === "item.updated" ||
      obj.type === "item.started") &&
    item
  ) {
    if (item.type === "agent_message" && typeof item.text === "string") {
      // 导入的会话里带标记的工具调用 / 输出（见 external-agent.ts）：调用变成工具行，输出不当正文。
      const imported = parseExternalAgentText(item.text);
      for (const tool of imported.tools) {
        const info = describeTool(tool.name, tool.fields);
        out.push({ type: "tool", name: info.label, detail: info.detail || undefined });
      }
      if (imported.text) out.push({ type: "replace", text: imported.text });
    }
    if (item.type === "reasoning" && typeof item.text === "string" && item.text) {
      out.push({ type: "thinking", text: item.text });
    }
    if (item.type === "command_execution" || item.type === "CommandExecution") {
      const command = Array.isArray(item.command)
        ? item.command.map(String).join(" ")
        : String(item.command || "");
      const info = describeTool("exec", { command });
      out.push({ type: "tool", name: info.label, detail: info.detail || undefined });
    }
    if (item.type === "file_change" || item.type === "FileChange") {
      // `codex exec --json` 的流里只有文件名没有内容；具体改动等这一轮结束后从会话文件读回来。
      const diff = diffsFromCodexChanges(item.changes);
      const first = diff[0]?.path || "";
      const info = describeTool("edit", {
        file_path: first || String(item.path || item.file || ""),
      });
      out.push({
        type: "tool",
        name: info.label,
        detail: info.detail || undefined,
        diff: diff.some((entry) => entry.lines.length) ? diff : undefined,
      });
    }
    if (
      item.type === "mcp_tool_call" ||
      item.type === "McpToolCall" ||
      item.type === "web_search" ||
      item.type === "Extension"
    ) {
      const info = describeTool(
        String(item.tool || item.kind || item.name || item.type),
        item.arguments ?? { query: item.query },
      );
      out.push({ type: "tool", name: info.label, detail: info.detail || undefined });
    }
  }

  if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
    out.push({ type: "session", cliSessionId: obj.thread_id });
  }

  const payload = asRecord(obj.payload);
  if (payload?.type === "message" && payload.role === "assistant") {
    const text = Array.isArray(payload.content)
      ? payload.content
          .map((block) => {
            const rec = asRecord(block);
            return typeof rec?.text === "string" ? rec.text : "";
          })
          .join("")
      : typeof payload.content === "string"
        ? payload.content
        : "";
    if (text) out.push({ type: "replace", text });
  }

  return out;
}
