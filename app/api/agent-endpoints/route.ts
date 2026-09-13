import { NextResponse } from "next/server";
import { publicEndpoint } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";
import type { AgentEndpoint, ModelRef } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 全局提供商池。
 *
 * 三个 Agent 用的基本都是同一个中转站，以前要在每个 Agent 里各填一遍；
 * 这里配一次，所有 Agent 自动都有（合并见 lib/agent-endpoints.ts 的
 * withGlobalEndpoints）。
 */

export async function GET() {
  const db = await readDb();
  return NextResponse.json({
    endpoints: (db.agentEndpoints ?? []).map(publicEndpoint),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    endpoints?: Partial<AgentEndpoint>[];
  };
  if (!Array.isArray(body.endpoints)) {
    return NextResponse.json({ error: "缺少 endpoints" }, { status: 400 });
  }
  const saved = await updateDb((db) => {
    const prev = db.agentEndpoints ?? [];
    db.agentEndpoints = body.endpoints!.map((item) => {
      const old = prev.find((row) => row.id === item.id);
      const key = typeof item.apiKey === "string" ? item.apiKey.trim() : "";
      return {
        id: item.id || crypto.randomUUID(),
        label: (item.label || "全局接口").trim(),
        // 全局池只放第三方接口：官方登录是按机器、按 CLI 来的，共享没有意义。
        mode: "api" as const,
        // 界面拿到的是打码后的 key，别把 •••• 存回去。
        apiKey: key && !key.includes("•") ? key : old?.apiKey || "",
        baseUrl: (item.baseUrl || "").trim(),
        model: (item.model || "").trim(),
        models: (Array.isArray(item.models) ? item.models : old?.models || []) as ModelRef[],
      };
    });
    return db.agentEndpoints;
  });
  return NextResponse.json({ endpoints: saved.map(publicEndpoint) });
}
