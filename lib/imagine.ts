import { joinUrl, providerHeaders } from "./upstream";
import type { Provider } from "./types";

function abortedError() {
  const error = new Error("已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortedError();
}

export function readApiError(text: string, fallback: string) {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      detail?: string;
    };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (parsed.error && typeof parsed.error === "object") {
      const message = [parsed.error.message, parsed.error.code].filter(Boolean).join(" · ");
      if (message) return message;
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
  } catch {
    // 不是 JSON 就原文截一段
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 280);
}

async function delay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function generateImages(opts: {
  provider: Provider;
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  references?: { mime: string; data: Buffer }[];
  signal?: AbortSignal;
}) {
  throwIfAborted(opts.signal);
  const usingEdit = Boolean(opts.references?.length);
  const endpoint = usingEdit ? "images/edits" : "images/generations";
  const body: Record<string, unknown> = {
    model: opts.modelId,
    prompt: opts.prompt,
    n: 1,
    response_format: "b64_json",
  };
  if (opts.aspectRatio && opts.aspectRatio !== "auto") body.aspect_ratio = opts.aspectRatio;
  if (usingEdit) {
    // 字段名是 `image_url`，值是 data URI 字符串。
    // 以前写的是 `url`，网关直接 400「images[].image_url is required」——
    // 也就是说参考图功能一直没生效过。
    body.images = opts.references!.map((item) => ({
      image_url: `data:${item.mime};base64,${item.data.toString("base64")}`,
    }));
  }

  const response = await fetch(joinUrl(opts.provider.baseUrl, endpoint), {
    method: "POST",
    headers: providerHeaders(opts.provider),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const text = await response.text();
  throwIfAborted(opts.signal);
  if (!response.ok) {
    throw new Error(readApiError(text, `生图接口 ${response.status}`));
  }
  let parsed: { data?: { b64_json?: string; url?: string }[] };
  try {
    parsed = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
  } catch {
    throw new Error(readApiError(text, "生图接口返回无法解析"));
  }
  const rows = parsed.data ?? [];
  if (!rows.length) throw new Error("生图接口没有返回图片");
  return rows;
}


/**
 * 成片地址藏在哪个字段，各家不一样。实测 ai.yp.mk 的 grok-imagine-video
 * 完成时是 `{status:"done", video:{url:"/v1/videos/<id>/content"}}` ——
 * 只找 `url` / `data[0].url` 会永远拿不到，然后一路轮询到超时。
 */
function pickMediaUrl(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const r = row as Record<string, unknown>;
  const direct = [r.url, r.video_url, r.download_url, r.output_url];
  for (const value of direct) if (typeof value === "string" && value) return value;
  for (const key of ["video", "output", "result", "asset"]) {
    const nested = r[key];
    if (typeof nested === "string" && nested) return nested;
    if (nested && typeof nested === "object") {
      const url = (nested as Record<string, unknown>).url;
      if (typeof url === "string" && url) return url;
    }
  }
  for (const key of ["data", "videos", "outputs"]) {
    const list = r[key];
    if (Array.isArray(list) && list.length) {
      const first = list[0];
      if (typeof first === "string" && first) return first;
      if (first && typeof first === "object") {
        const url = (first as Record<string, unknown>).url;
        if (typeof url === "string" && url) return url;
      }
    }
  }
  return "";
}

/** 接口给的常常是 `/v1/videos/xxx/content` 这种相对路径，要贴回服务的域名。 */
function absoluteUrl(baseUrl: string, url: string): string {
  if (!url || /^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  try {
    return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return url;
  }
}

export async function generateVideo(opts: {
  provider: Provider;
  modelId: string;
  prompt: string;
  aspectRatio?: string;
  image?: { mime: string; data: Buffer };
  signal?: AbortSignal;
}) {
  throwIfAborted(opts.signal);
  const body: Record<string, unknown> = {
    model: opts.modelId,
    prompt: opts.prompt,
  };
  if (opts.aspectRatio && opts.aspectRatio !== "auto") body.aspect_ratio = opts.aspectRatio;
  if (opts.image) {
    body.image = { url: `data:${opts.image.mime};base64,${opts.image.data.toString("base64")}` };
  }
  const started = await fetch(joinUrl(opts.provider.baseUrl, "videos/generations"), {
    method: "POST",
    headers: providerHeaders(opts.provider),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const startText = await started.text();
  throwIfAborted(opts.signal);
  if (!started.ok) {
    throw new Error(readApiError(startText, `视频接口 ${started.status}`));
  }
  let created: {
    id?: string;
    request_id?: string;
    status?: string;
    data?: { url?: string; b64_json?: string }[];
    url?: string;
    error?: { message?: string } | string;
  };
  try {
    created = JSON.parse(startText) as typeof created;
  } catch {
    throw new Error(readApiError(startText, "视频接口返回无法解析"));
  }
  const readyNow = pickMediaUrl(created);
  if (readyNow) {
    return {
      url: absoluteUrl(opts.provider.baseUrl, readyNow),
      b64: created.data?.[0]?.b64_json,
    };
  }
  const jobId = created.id || created.request_id;
  if (!jobId) throw new Error(readApiError(startText, "视频任务没有返回编号"));
  const deadline = Date.now() + 240_000;
  let lastStatus = created.status || "";
  let lastError = "";
  while (Date.now() < deadline) {
    throwIfAborted(opts.signal);
    await delay(2500, opts.signal);
    const poll = await fetch(joinUrl(opts.provider.baseUrl, `videos/${jobId}`), {
      headers: providerHeaders(opts.provider),
      signal: opts.signal,
    });
    const pollText = await poll.text();
    throwIfAborted(opts.signal);
    if (!poll.ok) {
      lastError = readApiError(pollText, `查询视频任务 ${poll.status}`);
      if (poll.status >= 400 && poll.status < 500) throw new Error(lastError);
      continue;
    }
    let row: {
      status?: string;
      url?: string;
      video?: { url?: string };
      data?: { url?: string }[];
      error?: { message?: string } | string;
    };
    try {
      row = JSON.parse(pollText) as typeof row;
    } catch {
      lastError = readApiError(pollText, "查询视频任务返回无法解析");
      continue;
    }
    lastStatus = row.status || lastStatus;
    if (row.status === "failed" || row.error) {
      throw new Error(
        readApiError(
          JSON.stringify(row),
          typeof row.error === "string" ? row.error : "视频生成失败",
        ),
      );
    }
    const url = pickMediaUrl(row);
    if (url) return { url: absoluteUrl(opts.provider.baseUrl, url), b64: undefined };
  }
  const extra = [lastStatus && `最后状态 ${lastStatus}`, lastError].filter(Boolean).join("；");
  throw new Error(
    extra
      ? `视频生成超过 4 分钟仍未完成（${extra}）`
      : "视频生成超过 4 分钟仍未完成，接口没有返回成片",
  );
}

export async function downloadBinary(
  url: string,
  signal?: AbortSignal,
  provider?: Provider,
) {
  // 成片如果就放在服务自己域名下（例如 /v1/videos/<id>/content），
  // 不带 Authorization 会 401。跨域的 CDN 链接则绝不能带上 Key。
  let headers: Record<string, string> | undefined;
  if (provider) {
    try {
      if (new URL(url).origin === new URL(provider.baseUrl).origin) {
        headers = { Authorization: `Bearer ${provider.apiKey}`, ...provider.extraHeaders };
      }
    } catch {
      // 地址不合法就当外链处理
    }
  }
  const response = await fetch(url, { signal, headers });
  if (!response.ok) throw new Error(`下载生成结果失败（${response.status}）`);
  return Buffer.from(await response.arrayBuffer());
}
