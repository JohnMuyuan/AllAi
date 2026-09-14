import bankJson from "../../data/model-trace/unified_bank.json";
import { isOfficialProvider } from "../official-chat";
import { readDb } from "../store";
import { joinUrl, providerHeaders } from "../upstream";
import type { Provider } from "../types";
import { generateChallenges } from "./challenges";
import { analyzeOutputs, type FingerprintBank } from "./fingerprint";
import { isRouteMismatch, traceFamily } from "./match";
import { addTraceRecord, type TraceRecord } from "./store";

const BANK = bankJson as FingerprintBank;

async function completeOnce(provider: Provider, modelId: string, prompt: string, format: "openai" | "anthropic") {
  const headers = providerHeaders(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    if (format === "anthropic") {
      const url = provider.baseUrl.includes("/messages")
        ? provider.baseUrl
        : joinUrl(provider.baseUrl.replace(/\/+$/, ""), "messages");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as { content?: { type?: string; text?: string }[]; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
      return (data.content || []).filter((block) => block.type === "text").map((block) => block.text || "").join("");
    }
    const url = /chat\/completions$/.test(provider.baseUrl)
      ? provider.baseUrl
      : joinUrl(provider.baseUrl, "chat/completions");
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | { text?: string }[] } }[];
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => part.text || "").join("");
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function complete(provider: Provider, modelId: string, prompt: string) {
  const family = traceFamily(modelId);
  const order: ("openai" | "anthropic")[] =
    family === "claude" ? ["anthropic", "openai"] : ["openai", "anthropic"];
  let last = "";
  for (const format of order) {
    try {
      return await completeOnce(provider, modelId, prompt, format);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(last || "探测请求失败");
}

export async function runModelTraceProbe(opts: {
  providerId: string;
  modelId: string;
  queries?: number;
  conversationId?: string;
  messageId?: string;
  source?: "auto" | "manual";
}): Promise<TraceRecord> {
  const family = traceFamily(opts.modelId);
  if (!family) throw new Error("只支持 OpenAI 和 Claude 型号");
  const db = await readDb();
  const provider = db.providers.find((item) => item.id === opts.providerId);
  if (!provider) throw new Error("找不到这个接口");
  if (isOfficialProvider(provider) || !provider.apiKey) {
    throw new Error("官方登录的 CLI 账号不走 HTTP，没法做指纹探测");
  }
  const count = Math.min(3, Math.max(1, opts.queries || 1));
  const challenges = generateChallenges(count);
  const outputs = [];
  for (const challenge of challenges) {
    const text = await complete(provider, opts.modelId, challenge.prompt);
    outputs.push({ text, expected_count: challenge.expectedCount });
  }
  const result = analyzeOutputs(outputs, BANK);
  const mismatch = isRouteMismatch(
    opts.modelId,
    result.prediction,
    result.familyPrediction,
    result.probability,
  );
  return addTraceRecord({
    id: crypto.randomUUID(),
    at: Date.now(),
    expected: opts.modelId,
    predicted: result.prediction,
    predictedName: result.predictionName,
    family: result.familyPrediction,
    probability: result.probability,
    mismatch,
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    source: opts.source || "manual",
  });
}
