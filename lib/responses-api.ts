import type { Provider } from "./types";
import { joinUrl, providerHeaders } from "./upstream";

/**
 * xAI / OpenAI 的 Responses API（`/v1/responses`）。
 *
 * 为什么要单独走这条：Grok 的联网搜索**只在这个端点上**。
 * `chat/completions` 那边 xAI 已经把 Live Search 下线了 ——
 * 传 `search_parameters` 会返回 410「Live search is deprecated,
 * please switch to the Agent Tools API」，传 `tools:[{type:"web_search"}]`
 * 会 422（那个端点只认 `function` 和废弃的 `live_search`）。
 *
 * 事件名和字段是对着真实响应抓的，不是照文档猜的。
 */

export type ResponsesEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "search"; stage: "start" | "done" }
  | { type: "usage"; usage: Record<string, unknown> };

type Part = { type: string; text?: string; image_url?: { url?: string } | string };

/** 把 chat/completions 的消息体翻成 Responses API 的 input。 */
export function toResponsesInput(
  messages: { role: string; content: unknown }[],
): { role: string; content: unknown }[] {
  return messages.map((message) => {
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    if (!Array.isArray(message.content)) return { role: message.role, content: "" };
    const parts = (message.content as Part[]).map((part) => {
      if (part.type === "image_url") {
        const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        return { type: "input_image", image_url: url };
      }
      // Responses API 里用户侧的文本是 input_text（助手侧是 output_text，
      // 但历史消息统一按 input_text 传就行）。
      return { type: "input_text", text: part.text ?? "" };
    });
    return { role: message.role, content: parts };
  });
}

export async function* streamResponses(opts: {
  provider: Provider;
  model: string;
  input: { role: string; content: unknown }[];
  webSearch: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<ResponsesEvent> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    input: opts.input,
  };
  if (opts.webSearch) body.tools = [{ type: "web_search" }];

  const response = await fetch(joinUrl(opts.provider.baseUrl, "responses"), {
    method: "POST",
    headers: providerHeaders(opts.provider),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new ResponsesError(response.status, text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (opts.signal?.aborted) break;
      const { done, value } = await reader.read();
      let lines: string[];
      if (done) {
        buffer += decoder.decode();
        // 有些兼容网关关闭连接前不会补最后一个换行，最后一帧仍然要处理。
        lines = buffer.trim() ? [buffer] : [];
      } else {
        buffer += decoder.decode(value, { stream: true });
        lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
      }
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = typeof row.type === "string" ? row.type : "";
        const delta = typeof row.delta === "string" ? row.delta : "";
        if (type === "response.output_text.delta" && delta) {
          yield { type: "delta", text: delta };
        } else if (type === "response.reasoning_summary_text.delta" && delta) {
          yield { type: "reasoning", text: delta };
        } else if (type === "response.web_search_call.in_progress") {
          yield { type: "search", stage: "start" };
        } else if (type === "response.web_search_call.completed") {
          yield { type: "search", stage: "done" };
        } else if (type === "response.completed") {
          const usage = (row.response as { usage?: Record<string, unknown> } | undefined)?.usage;
          if (usage) yield { type: "usage", usage };
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export class ResponsesError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Responses API ${status}`);
    this.status = status;
    this.body = body;
  }
}
