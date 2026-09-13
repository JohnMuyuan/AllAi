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
      signal: AbortSignal.timeout(6000),
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
    `https://www.google.com/s2/favicons?sz=128&domain=${hostname}`,
  ];
}

/**
 * 抓一个候选。成功给 data URI，失败给一句**能直接给用户看**的人话
 * （不带 host —— 由调用方按「是用户自己的站还是第三方服务」决定怎么讲）。
 */
async function grab(url: string, timeoutMs: number): Promise<{ icon: string } | { error: string }> {
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
    if (!buffer.length) return { error: "抓到的是空文件" };
    const icon = `data:${type};base64,${buffer.toString("base64")}`;
    if (icon.length > MAX_DATA_URI) {
      return { error: `图片太大（${Math.round(buffer.length / 1024)}KB），换一张小图或直接填图片网址` };
    }
    return { icon };
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

  /*
   * 分两轮，别混在一起：
   *   1. 用户自己的站（页面声明的图标 + 标准路径）—— 失败要**说清楚是哪一步**，
   *      因为这是用户能改的（换成图片网址、或直接上传一张）。
   *   2. 第三方图标服务 —— 它挂了是**我们的**问题，不该拿它的 host 去烦用户。
   * 两轮的错分开记，最后优先报第一轮里「图不行」那类（最有指导性）。
   */
  const declared = target.direct ? [] : await fetchDeclaredIcons(source);
  const own = target.direct
    ? [target.direct]
    : [...declared, ...sameOriginCandidates(new URL(target.base))];

  let ownError = "";
  for (const url of own) {
    const result = await grab(url, 6000);
    if ("icon" in result) return NextResponse.json({ icon: result.icon, from: url });
    // 「不是图片 / 太大」比「连不上」有用，优先留下。
    if (!ownError || /不是图片|太大|空文件/.test(result.error)) ownError = result.error;
  }

  for (const url of fallbackCandidates(target.host)) {
    const result = await grab(url, 4000);
    if ("icon" in result) return NextResponse.json({ icon: result.icon, from: url });
  }

  return NextResponse.json(
    { error: `${target.host} 上没找到图标（${ownError || "没有可用的图标文件"}）。可以直接填图片网址，或从本地选一张。` },
    { status: 502 },
  );
}
