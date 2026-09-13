import type { Provider } from "./types";

export function joinUrl(base: string, segment: string) {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

export function providerHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    "Content-Type": "application/json",
    ...provider.extraHeaders,
  };
  if (provider.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] ??= "http://localhost:3000";
    headers["X-Title"] ??= "AllAi";
  }
  return headers;
}

export async function* iterateSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              yield JSON.parse(data) as Record<string, unknown>;
            } catch {
              // ignore malformed final keep-alive
            }
          }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // ignore malformed keep-alives
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/** 大部分 OpenAI 兼容网关会在最后一个 chunk 里带 usage（要先开 stream_options）。 */
export function usageFromChunk(chunk: Record<string, unknown>) {
  return chunk.usage && typeof chunk.usage === "object" ? chunk.usage : null;
}

export function deltaFromChunk(chunk: Record<string, unknown>) {
  const choices = chunk.choices as
    | {
        finish_reason?: string;
        delta?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: ToolCallDelta[];
        };
      }[]
    | undefined;
  const choice = choices?.[0];
  const delta = choice?.delta ?? {};
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning:
      (typeof delta.reasoning_content === "string" && delta.reasoning_content) ||
      (typeof delta.reasoning === "string" && delta.reasoning) ||
      "",
    toolCalls: Array.isArray(delta.tool_calls) ? delta.tool_calls : [],
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
  };
}
