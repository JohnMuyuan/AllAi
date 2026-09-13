import type { AgentAsk, AgentTraceItem, FileDiff } from "./types";

export function asTrace(message: {
  trace?: AgentTraceItem[];
  thinking?: string;
  tools?: { name: string; detail?: string }[];
}): AgentTraceItem[] {
  if (message.trace?.length) return message.trace;
  const out: AgentTraceItem[] = [];
  if (message.thinking) out.push({ type: "thinking", text: message.thinking });
  for (const tool of message.tools || []) {
    out.push({ type: "tool", name: tool.name, detail: tool.detail });
  }
  return out;
}

export function appendThinkingTrace(
  trace: AgentTraceItem[] | undefined,
  text: string,
): AgentTraceItem[] {
  const next = [...(trace || [])];
  const last = next.at(-1);
  if (last?.type === "thinking") {
    next[next.length - 1] = { type: "thinking", text: last.text + text };
  } else {
    next.push({ type: "thinking", text });
  }
  return next;
}

export function appendToolTrace(
  trace: AgentTraceItem[] | undefined,
  name: string,
  detail?: string,
  diff?: FileDiff[],
  ask?: AgentAsk,
): AgentTraceItem[] {
  const item: AgentTraceItem = {
    type: "tool",
    name,
    detail,
    ...(diff?.length ? { diff } : {}),
    ...(ask ? { ask } : {}),
  };
  return [...(trace || []), item];
}

/** 压缩上下文这一步要边跑边改详情，不能每跳一下就多一行。 */
export function upsertToolTrace(
  trace: AgentTraceItem[] | undefined,
  name: string,
  detail?: string,
): AgentTraceItem[] {
  const next = [...(trace || [])];
  const index = next.findLastIndex((item) => item.type === "tool" && item.name === name);
  const item: AgentTraceItem = { type: "tool", name, detail };
  if (index >= 0) {
    next[index] = item;
    return next;
  }
  next.push(item);
  return next;
}
