"use client";

import { getDesktop } from "../desktop";

export type TraceRecordView = {
  mismatch: boolean;
  expected: string;
  predictedName: string;
  predicted: string;
  family: string;
  probability: number;
};

type Challenge = { prompt: string; expectedCount: number };

type TraceResponse = {
  skipped?: boolean;
  needOfficial?: boolean;
  kind?: "claude" | "chatgpt";
  challenges?: Challenge[];
  record?: TraceRecordView;
  error?: string;
};

async function postTrace(body: Record<string, unknown>) {
  const response = await fetch("/api/model-trace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as TraceResponse;
  if (!response.ok) throw new Error(data.error || "探测失败");
  return data;
}

/** 聊天和设置页共用：HTTP 接口直接打；官方 Claude / ChatGPT 先走本机 CLI 再交回分析。 */
export async function runTraceFromUi(opts: {
  providerId: string;
  modelId: string;
  queries?: number;
  conversationId?: string;
  messageId?: string;
  source: "auto" | "manual";
}): Promise<TraceResponse> {
  const first = await postTrace(opts);
  if (first.skipped || first.record || !first.needOfficial) return first;
  const desktop = getDesktop();
  if (!desktop?.officialProbe) throw new Error("请用桌面版 AllAi 打开");
  const kind = first.kind;
  if (kind !== "claude" && kind !== "chatgpt") throw new Error("只支持 OpenAI 和 Claude 型号");
  const outputs = [];
  for (const challenge of first.challenges || []) {
    let result: { ok: true; text: string } | { ok: false; error: string };
    try {
      result = await desktop.officialProbe({
        kind,
        model: opts.modelId,
        prompt: challenge.prompt,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "探测失败");
    }
    if (!result.ok) throw new Error(result.error || "探测失败");
    outputs.push({ text: result.text, expected_count: challenge.expectedCount });
  }
  return postTrace({ ...opts, outputs });
}
