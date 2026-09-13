import { NextResponse } from "next/server";
import { mergeModelLists } from "@/lib/agent-models";
import { fetchRemoteModels } from "@/lib/fetch-models";
import { publicEndpoint } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 给全局提供商拉模型列表。和 Agent 那套一样，只是写回的是全局池。 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { endpointId?: string };
  const db = await readDb();
  const endpoint = (db.agentEndpoints ?? []).find((item) => item.id === body.endpointId);
  if (!endpoint) return NextResponse.json({ error: "找不到这个接口" }, { status: 404 });
  if (!endpoint.apiKey) return NextResponse.json({ error: "还没有填写 API Key" }, { status: 400 });
  if (!endpoint.baseUrl.trim()) {
    return NextResponse.json({ error: "还没有填写接口地址" }, { status: 400 });
  }

  try {
    const models = await fetchRemoteModels({
      baseUrl: endpoint.baseUrl.trim(),
      apiKey: endpoint.apiKey,
    });
    const saved = await updateDb((current) => {
      const row = (current.agentEndpoints ?? []).find((item) => item.id === endpoint.id);
      if (row) {
        row.models = mergeModelLists(row.models ?? [], models);
        if (!row.model && row.models[0]) row.model = row.models[0].id;
      }
      return current.agentEndpoints ?? [];
    });
    return NextResponse.json({ models, endpoints: saved.map(publicEndpoint) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法连接该接口";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
