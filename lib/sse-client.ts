import type { ChatSseEvent } from "./types";

export async function readSse(
  response: Response,
  onEvent: (event: ChatSseEvent) => void,
) {
  if (!response.body) throw new Error("响应没有内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      onEvent(JSON.parse(payload) as ChatSseEvent);
    } catch {
      // ignore malformed keep-alives
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    }
  } finally {
    reader.releaseLock();
  }
}
