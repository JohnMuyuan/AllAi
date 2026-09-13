import { NextResponse } from "next/server";
import { clearUsage, listUsage, recordUsage } from "@/lib/usage-store";
import { rollupEvents, rollupSummary } from "@/lib/usage-rollups";
import type { UsageArea } from "@/lib/usage";

export const dynamic = "force-dynamic";

const AREAS: UsageArea[] = ["chat", "agent", "studio"];

export async function GET() {
  /*
   * 两份账拼起来：
   * - `usage.json`：AllAi 自己这边发生的（聊天、创作），一次一条；
   * - `usage-rollups.json`：本机所有 CLI 的用量（主进程扫会话文件）+ 导入的历史，
   *   一天一条汇总。几万次请求不可能一条条塞进 usage.json，见 lib/usage-rollups.ts。
   */
  const [events, rollups, summary] = await Promise.all([listUsage(), rollupEvents(), rollupSummary()]);
  /*
   * 0.16.35 之前 AllAi 会给自己跑的每一轮 Agent 单独记一条。现在那部分由扫描器
   * 从 CLI 会话文件里算（更全，连你在终端里跑的也算），两份留着就会翻倍。
   * 老记录**不删**（只增不删是产品约定），读的时候跳过就行 ——
   * 那些轮次的会话文件还在，扫描器已经把它们算进去了。
   */
  const live = events.filter((item) => item.area !== "agent");
  return NextResponse.json({ events: [...rollups, ...live], summary });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const area = body?.area;
  if (typeof area !== "string" || !AREAS.includes(area as UsageArea)) {
    return NextResponse.json({ error: "area 必须是 chat / agent / studio" }, { status: 400 });
  }
  // at 可以由调用方给（补记历史），不给就按服务器现在时间。
  const at = Number(body?.at);
  const event = await recordUsage({
    area: area as UsageArea,
    at: Number.isFinite(at) && at > 0 ? at : undefined,
    conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
    source: typeof body?.source === "string" ? body.source : "",
    modelId: typeof body?.modelId === "string" ? body.modelId : "",
    input: Number(body?.input) || 0,
    output: Number(body?.output) || 0,
    cacheRead: Number(body?.cacheRead) || 0,
    cacheWrite: Number(body?.cacheWrite) || 0,
    reasoning: Number(body?.reasoning) || 0,
    contextTokens: Number(body?.contextTokens) || undefined,
    costUsd: Number(body?.costUsd) || 0,
    requests: Number(body?.requests) || 1,
    images: Number(body?.images) || 0,
    durationMs: Number(body?.durationMs) || 0,
  });
  return NextResponse.json({ event });
}

/** 只在用户主动点「清空」时调用 —— 统计数据不会自己过期。 */
export async function DELETE(request: Request) {
  const before = Number(new URL(request.url).searchParams.get("before")) || undefined;
  const removed = await clearUsage(before);
  return NextResponse.json({ removed });
}
