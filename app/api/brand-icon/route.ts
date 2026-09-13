import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 按最终 data URI 的字符数卡，要和 prefs 那边的上限一致，
// 不然会出现「抓成功了但存不进去」。
// 512KB 是给多分辨率 .ico 留的余量（deepseek 的就有 205KB）。
const MAX_DATA_URI = 512 * 1024;
const OK_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AllAi/1.0";

/** 读页面最多看这么多字符，够找到 <head> 里的图标声明了。 */
const MAX_HTML = 400_000;

/**
 * 从 HTML 的 <link> 里读图标声明。
 *
 * 这一步对国内站点特别重要：硅基流动、智谱、火山方舟这些基本**不用**
 * `/favicon.ico`，而是 `<link rel="icon" href="/assets/xxx.svg">`、
 * 或者把 apple-touch-icon 放在 CDN 上。只试标准路径的话，要么 404，
 * 要么抓到一张 16×16 的糊图。
 *
 * rel 里只要含 "icon" 就算（icon / shortcut icon / apple-touch-icon /
 * apple-touch-icon-precomposed / mask-icon 全都收）。
 */
function declaredIcons(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] || "").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    // data URI 直接可用，别的按页面地址拼绝对路径。
    if (/^data:image\//i.test(href)) {
      found.push(href);
      continue;
    }
    try {
      found.push(new URL(href, pageUrl).toString());
    } catch {
      // 拼不出绝对地址就跳过
    }
  }
  // apple-touch-icon 通常分辨率最高，往前放；顺序在同等条件下优先用它。
  return found.sort((a, b) => Number(!/apple-touch/i.test(a)) - Number(!/apple-touch/i.test(b)));
}

/** 抓一次页面，把它声明的图标地址挖出来。失败就当没有。 */
async function fetchDeclaredIcons(source: string): Promise<string[]> {
  const raw = source.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return [];
  }
  // 一看就是图片地址，不用去读页面。
  if (/\.(png|jpe?g|webp|gif|svg|ico)(\?|$)/i.test(url.pathname)) return [];
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    });
    if (!response.ok) return [];
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("html")) return [];
    const html = (await response.text()).slice(0, MAX_HTML);
    // response.url 是跟完重定向之后的地址，拿它当基准拼相对路径才准。
    return declaredIcons(html, response.url || url.toString());
  } catch {
    return [];
  }
}

/**
 * 抓一个图标存成 data URI。
 *
 * 给的是网址就直接抓；给的是域名（或任意 http 地址）就先去它页面上找
 * `<link rel="icon">`，找不到再试标准路径的 favicon。
 * 存成 data URI 而不是记住外链：图标要能离线显示，也不想每次渲染都去打别人的服务器。
 */
/**
 * 把用户填的东西解析成一个基准地址。
 *
 * - 填 `example.com` / `https://example.com/usage` → 拿它当站点，去页面上找图标
 * - 填 `https://example.com/logo.png` → 这就是图片本身，直接抓，别去读页面
 * - 填的不是网址 → null（别拿它去打 DNS 白等）
 */
function parseTarget(input: string): { base: string; host: string; direct: string | null } | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  // 得像个域名，否则别去打 DNS 白等。
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
  const isImage = /\.(png|jpe?g|webp|gif|svg|ico)(\?|$)/i.test(url.pathname);
  return { base: url.toString(), host: url.hostname, direct: isImage ? url.toString() : null };
}

/**
 * 同源候选：站点的标准图标路径。
 *
 * 注意这**只是兜底** —— 国内站点多数不走 /favicon.ico，靠的是上面的
 * `declaredIcons()` 读 `<link rel="icon">`。两条路都要留着。
 */
function sameOriginCandidates(url: URL): string[] {
  return [
    `${url.origin}/favicon.ico`,
    `${url.origin}/favicon.svg`,
    `${url.origin}/favicon.png`,
    `${url.origin}/apple-touch-icon.png`,
    `${url.origin}/apple-touch-icon-precomposed.png`,
  ];
}

/**
 * 第三方图标服务的兜底。**放最后，且要短超时。**
 *
 * 以前这里第一个是 Google 的 `s2/favicons`，在墙内**必然**超时（实测 10s），
 * 白等一轮还把错误信息写成了「www.google.com 连不上」—— 用户填的是
 * `qianfan.baidubce.com`，看到这句完全不知道发生了什么。
 * 换成国内能通的 cccyun，Google 降到最后、只给 4 秒。
 */
function fallbackCandidates(hostname: string): string[] {
  return [
    `https://favicon.cccyun.cc/${hostname}`,
    `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`,
  ];
}

/** 这一波里挑最大的一张。1×1 / 空 SVG 那种「秒抓到的寂寞」直接丢掉。 */
async function bestIcon(
  urls: string[],
  timeoutMs: number,
): Promise<{ icon: string; from: string } | null> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return null;
  const hits = await Promise.all(
    unique.map(async (url) => {
      const result = await grab(url, timeoutMs);
      if ("icon" in result) return { icon: result.icon, from: url, width: result.width };
      return null;
    }),
  );
  const ok = hits.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!ok.length) return null;
  ok.sort((a, b) => b.width - a.width);
  return { icon: ok[0].icon, from: ok[0].from };
}

/** api.x.ai /v1 这种地址，图标在站点根上，不在接口路径上。 */
function siteOrigins(base: string): string[] {
  const url = new URL(base);
  const host = url.hostname;
  const origins = [url.origin];
  if (host.startsWith("api.") && host.split(".").length > 2) {
    origins.push(`https://${host.slice(4)}`);
  }
  if (!host.startsWith("www.") && host.split(".").length >= 2) {
    origins.push(`https://www.${host}`);
  }
  return [...new Set(origins)];
}

const MIN_BYTES = 120;
const MIN_EDGE = 16;

/** 读出宽高。读不出来又太小的当废图。 */
function imageSize(buffer: Buffer, type: string): { width: number; height: number } | null {
  if (buffer.length < MIN_BYTES) return null;
  const mime = type.toLowerCase();
  if (mime.includes("svg")) {
    const text = buffer.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) return null;
    if (!/<path|<rect|<circle|<ellipse|<polygon|<image|<use|<g[\s>]/i.test(text)) return null;
    const box = /viewBox=["']?[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(text);
    const w = Number(/width=["']?([\d.]+)/i.exec(text)?.[1] || box?.[1] || 64);
    const h = Number(/height=["']?([\d.]+)/i.exec(text)?.[1] || box?.[2] || 64);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { width: w, height: h };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    if (buffer.length < 10) return null;
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) {
    const count = buffer[4];
    if (!count || buffer.length < 6 + count * 16) return null;
    let edge = 0;
    for (let i = 0; i < count; i++) {
      const w = buffer[6 + i * 16] || 256;
      const h = buffer[7 + i * 16] || 256;
      edge = Math.max(edge, Math.min(w, h));
    }
    return { width: edge, height: edge };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) break;
      const marker = buffer[i + 1];
      const len = buffer.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
        return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const kind = buffer.toString("ascii", 12, 16);
    if (kind === "VP8X" && buffer.length >= 30) {
      const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
      const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);
      return { width, height };
    }
    if (kind === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
  }
  if (buffer.length >= 800) return { width: 32, height: 32 };
  return null;
}

/**
 * 抓一个候选。成功给 data URI，失败给一句**能直接给用户看**的人话
 * （不带 host —— 由调用方按「是用户自己的站还是第三方服务」决定怎么讲）。
 */
async function grab(
  url: string,
  timeoutMs: number,
): Promise<{ icon: string; width: number } | { error: string }> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA },
    });
    if (!response.ok) return { error: `返回 ${response.status}` };
    const type = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!OK_TYPES.test(type)) return { error: `不是图片（${type || "未知类型"}）` };
    const buffer = Buffer.from(await response.arrayBuffer());
    const size = imageSize(buffer, type);
    if (!size || Math.min(size.width, size.height) < MIN_EDGE) {
      return { error: "图太小或空的" };
    }
    const icon = `data:${type};base64,${buffer.toString("base64")}`;
    if (icon.length > MAX_DATA_URI) {
      return { error: `图片太大（${Math.round(buffer.length / 1024)}KB），换一张小图或直接填图片网址` };
    }
    return { icon, width: Math.min(size.width, size.height) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { error: /abort|timeout/i.test(message) ? "连接超时" : "连不上" };
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { source?: string } | null;
  const source = body?.source?.trim();
  if (!source) return NextResponse.json({ error: "请填写图标地址或网站域名" }, { status: 400 });

  if (/^data:image\//i.test(source)) {
    if (source.length > MAX_DATA_URI) {
      return NextResponse.json({ error: "图标太大了，换一张小图" }, { status: 400 });
    }
    return NextResponse.json({ icon: source });
  }

  const target = parseTarget(source);
  if (!target) return NextResponse.json({ error: "看不懂这个地址" }, { status: 400 });

  if (target.direct) {
    const result = await grab(target.direct, 4000);
    if ("icon" in result) return NextResponse.json({ icon: result.icon, from: target.direct });
    return NextResponse.json(
      { error: `${target.host} 上没找到图标（${result.error}）。可以直接填图片网址，或从本地选一张。` },
      { status: 502 },
    );
  }

  /*
   * 并行：站点根上的 favicon 往往一秒内就有结果。
   * 以前一条条 6 秒超时排着试，接口地址（/v1）还当网页去抓，所以会感觉特别慢。
   * HTML 声明和第三方兜底同时开，谁先到用谁。
   */
  const origins = siteOrigins(target.base);
  const quick = origins.flatMap((origin) => sameOriginCandidates(new URL(origin)));
  const pagePromise = Promise.all(origins.map((origin) => fetchDeclaredIcons(origin)));

  const fast = await bestIcon(quick, 2500);
  if (fast) return NextResponse.json({ icon: fast.icon, from: fast.from });

  const declared = (await pagePromise).flat();
  const fromPage = await bestIcon(declared, 2500);
  if (fromPage) return NextResponse.json({ icon: fromPage.icon, from: fromPage.from });

  const fallback = origins.flatMap((origin) => fallbackCandidates(new URL(origin).hostname));
  const last = await bestIcon(fallback, 2000);
  if (last) return NextResponse.json({ icon: last.icon, from: last.from });

  return NextResponse.json(
    { error: `${target.host} 上没找到图标。可以直接填图片网址，或从本地选一张。` },
    { status: 502 },
  );
}
