import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 按最终 data URI 的字符数卡，要和 prefs 那边的上限一致，
// 不然会出现「抓成功了但存不进去」。
// 512KB 是给多分辨率 .ico 留的余量（deepseek 的就有 205KB）。
const MAX_DATA_URI = 512 * 1024;
const OK_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

/**
 * 抓一个图标存成 data URI。
 *
 * 给的是网址就直接抓；给的是域名（或任意 http 地址）就试它的 favicon。
 * 存成 data URI 而不是记住外链：图标要能离线显示，也不想每次渲染都去打别人的服务器。
 */
function candidates(input: string): string[] {
  const raw = input.trim();
  if (!raw) return [];
  if (/^data:image\//i.test(raw)) return [raw];

  let url: URL | null = null;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return [];
  }
  // 得像个域名，否则别去打 DNS 白等 8 秒。
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return [];
  // 看起来就是图片地址，直接用。
  if (/\.(png|jpe?g|webp|gif|svg|ico)(\?|$)/i.test(url.pathname)) return [url.toString()];
  return [
    `${url.origin}/favicon.ico`,
    `${url.origin}/favicon.png`,
    `${url.origin}/apple-touch-icon.png`,
    // 兜底用 Google 的 favicon 服务，它对没有 /favicon.ico 的站点也能出图。
    `https://www.google.com/s2/favicons?sz=128&domain=${url.hostname}`,
  ];
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

  const urls = candidates(source);
  if (!urls.length) return NextResponse.json({ error: "看不懂这个地址" }, { status: 400 });

  // 记两种错：网络类的和「这张图不行」类的。
  // 后者更有用（能告诉用户怎么改），最后优先报它，别被兜底候选的超时盖掉。
  let networkError = "抓不到图标";
  let contentError = "";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "AllAi/1.0" },
      });
      if (!response.ok) {
        networkError = `${new URL(url).host} 返回 ${response.status}`;
        continue;
      }
      const type = (response.headers.get("content-type") || "").split(";")[0].trim();
      if (!OK_TYPES.test(type)) {
        contentError = `${new URL(url).host} 返回的不是图片（${type || "未知类型"}）`;
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        contentError = "抓到的图片是空的";
        continue;
      }
      const icon = `data:${type};base64,${buffer.toString("base64")}`;
      if (icon.length > MAX_DATA_URI) {
        contentError = `图标太大（${Math.round(buffer.length / 1024)}KB），换一张小图或直接填图片网址`;
        continue;
      }
      return NextResponse.json({ icon, from: url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      networkError = /abort|timeout/i.test(message)
        ? `${new URL(url).host} 连不上（超时）`
        : message || networkError;
    }
  }

  return NextResponse.json({ error: contentError || networkError }, { status: 502 });
}
