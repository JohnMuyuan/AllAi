import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { listTraceRecords, routingRate } from "@/lib/model-trace/store";
import { runModelTraceProbe } from "@/lib/model-trace/probe";
import { patchConversation } from "@/lib/conversations";
import { traceFamily } from "@/lib/model-trace/match";

export const dynamic = "force-dynamic";

export async function GET() {
  const records = await listTraceRecords();
  const db = await readDb();
  return NextResponse.json({
    enabled: db.prefs.modelTraceEnabled !== false,
    records,
    rate: routingRate(records),
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
  try {
    const record = await runModelTraceProbe({
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
