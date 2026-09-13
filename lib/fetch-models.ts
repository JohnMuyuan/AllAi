import { withModelKind } from "./models";
import type { ModelRef } from "./types";
import { joinUrl } from "./upstream";

function modelListUrls(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const urls = [joinUrl(base, "models")];
  if (!/\/v1(beta)?$/i.test(base)) urls.push(joinUrl(`${base}/v1`, "models"));
  return [...new Set(urls)];
}

function headerSets(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Record<string, string>[] {
  const sets: Record<string, string>[] = [
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  ];
  if (/anthropic\.com/i.test(baseUrl)) {
    sets.push({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      ...extraHeaders,
    });
  }
  return sets;
}

function parseModelList(text: string): ModelRef[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
        : null;
  if (!rows) throw new Error("接口返回的模型列表格式无法识别");
  const seen = new Set<string>();
  const models: ModelRef[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      const id = row.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push(withModelKind({ id, label: id }));
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as { id?: unknown; display_name?: unknown; name?: unknown };
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      (typeof record.display_name === "string" && record.display_name.trim()) ||
      (typeof record.name === "string" && record.name.trim()) ||
      id;
    models.push(withModelKind({ id, label }));
  }
  return models;
}

export async function fetchRemoteModels(opts: {
  baseUrl: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
}): Promise<ModelRef[]> {
  const baseUrl = opts.baseUrl.trim();
  if (!baseUrl) throw new Error("还没有填写接口地址");
  if (!opts.apiKey.trim()) throw new Error("还没有填写 API Key");

  let lastError = "无法获取模型列表";
  const deadline = AbortSignal.timeout(15_000);
  for (const url of modelListUrls(baseUrl)) {
    for (const headers of headerSets(baseUrl, opts.apiKey, opts.extraHeaders)) {
      try {
        const response = await fetch(url, { headers, cache: "no-store", signal: deadline });
        const text = await response.text();
        if (!response.ok) {
          lastError = `同步失败（${response.status}）：${text.slice(0, 280)}`;
          continue;
        }
        const models = parseModelList(text);
        if (models.length) return models;
        lastError = "接口没有返回可用模型";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "无法连接该接口";
      }
    }
  }
  throw new Error(lastError);
}
