import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { clearTraceRecords, listTraceRecords, routingRate } from "@/lib/model-trace/store";
import { analyzeCollectedOutputs, runModelTraceProbe } from "@/lib/model-trace/probe";
import { generateChallenges } from "@/lib/model-trace/challenges";
import { patchConversation } from "@/lib/conversations";
import { traceFamily } from "@/lib/model-trace/match";
import { isOfficialProvider, officialSpecForProvider } from "@/lib/official-chat";
import bankJson from "@/data/model-trace/unified_bank.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const records = await listTraceRecords();
  const db = await readDb();
  /*
   * 指纹库有 670KB，不能整个塞给界面（那是一次性把整包 JSON 打进前端 bundle）。
   * 只回摘要：覆盖了哪些型号、什么时候构建的、建议打几次。
   */
  const bank = bankJson as {
    built_at?: string;
    recommended_queries?: number;
    models: { id: string; display_name: string; family?: string; family_name?: string }[];
  };
  return NextResponse.json({
    enabled: db.prefs.modelTraceEnabled !== false,
    records,
    rate: routingRate(records),
    bank: {
      builtAt: bank.built_at || "",
      recommendedQueries: bank.recommended_queries || 3,
      models: bank.models.map((item) => ({
        id: item.id,
        name: item.display_name,
        family: item.family || "",
        familyName: item.family_name || "",
      })),
    },
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "缺少开关" }, { status: 400 });
  }
  const enabled = body.enabled;
  const prefs = await updateDb((db) => {
    db.prefs.modelTraceEnabled = enabled;
    return db.prefs;
  });
  return NextResponse.json({ enabled: prefs.modelTraceEnabled !== false });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    providerId?: string;
    modelId?: string;
    queries?: number;
    conversationId?: string;
    messageId?: string;
    source?: "auto" | "manual";
    outputs?: { text?: string; expected_count?: number }[];
  } | null;
  if (!body?.providerId || !body?.modelId) {
    return NextResponse.json({ error: "缺少接口或型号" }, { status: 400 });
  }
  if (!traceFamily(body.modelId)) {
    return NextResponse.json({ error: "只支持 OpenAI 和 Claude 型号" }, { status: 400 });
  }
  const db = await readDb();
  if (body.source !== "manual" && db.prefs.modelTraceEnabled === false) {
    return NextResponse.json({ skipped: true });
  }
  const provider = db.providers.find((item) => item.id === body.providerId);
  if (!provider) {
    return NextResponse.json({ error: "找不到这个接口" }, { status: 400 });
  }
  const collected = (body.outputs || [])
    .filter((item) => typeof item.text === "string" && item.text.trim())
    .map((item) => ({ text: item.text as string, expected_count: item.expected_count }));
  try {
    if (!collected.length && isOfficialProvider(provider)) {
      const spec = officialSpecForProvider(provider);
      if (!spec || (spec.kind !== "claude" && spec.kind !== "chatgpt")) {
        return NextResponse.json({ error: "只支持 OpenAI 和 Claude 型号" }, { status: 400 });
      }
      const count = Math.min(3, Math.max(1, body.queries || 1));
      return NextResponse.json({
        needOfficial: true,
        kind: spec.kind,
        challenges: generateChallenges(count),
      });
    }
    const record = collected.length
      ? await analyzeCollectedOutputs({
          modelId: body.modelId,
          outputs: collected,
          conversationId: body.conversationId,
          messageId: body.messageId,
          source: body.source,
        })
      : await runModelTraceProbe({
          providerId: body.providerId,
          modelId: body.modelId,
          queries: body.queries,
          conversationId: body.conversationId,
          messageId: body.messageId,
          source: body.source,
        });
    if (record.messageId && record.conversationId) {
      await patchConversation(record.conversationId, (current) => {
        const message = current.messages.find((item) => item.id === record.messageId);
        if (message) message.routeTrace = record;
      }).catch(() => undefined);
    }
    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "探测失败" },
      { status: 500 },
    );
  }
}

/** 清空探测历史。只有用户在设置里主动点才会调。 */
export async function DELETE() {
  const removed = await clearTraceRecords();
  return NextResponse.json({ removed });
}
