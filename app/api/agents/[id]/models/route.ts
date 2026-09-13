import { NextResponse } from "next/server";
import { withGlobalEndpoints } from "@/lib/agent-endpoints";
import { fallbackAgentBaseUrl, mergeModelLists } from "@/lib/agent-models";
import { fetchRemoteModels } from "@/lib/fetch-models";
import { withModelKind } from "@/lib/models";
import { toPublicAgent } from "@/lib/public";
import type { Database } from "@/lib/types";
import { readDb, updateDb } from "@/lib/store";
import type { ModelRef } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeModels(raw: unknown): ModelRef[] {
  if (!Array.isArray(raw)) return [];
  const models: ModelRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      const id = item.trim();
      if (seen.has(id)) continue;
      seen.add(id);
      models.push(withModelKind({ id, label: id }));
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as ModelRef;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const reasoningLevels = Array.isArray(row.reasoningLevels)
      ? row.reasoningLevels.map(String).map((value) => value.trim()).filter(Boolean)
      : undefined;
    models.push(
      withModelKind({
        id,
        label: (typeof row.label === "string" && row.label.trim()) || id,
        reasoningLevels: reasoningLevels?.length ? reasoningLevels : undefined,
      }),
    );
  }
  return models;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    endpointId?: string;
    models?: unknown;
    replace?: boolean;
  };
  const db = await readDb();
  const stored = db.agents.find((item) => item.id === id);
  if (!stored) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
  // 用合并过全局池的列表来找接口，否则全局接口在这儿查不到。
  const agent = withGlobalEndpoints(stored, db.agentEndpoints);

  const endpoint =
    agent.endpoints.find((item) => item.id === body.endpointId) ??
    agent.endpoints.find((item) => item.id === agent.activeEndpointId) ??
    agent.endpoints[0];
  if (!endpoint) return NextResponse.json({ error: "还没有接口" }, { status: 400 });

  /** 全局接口的模型表要写回全局池，不能写进某一个 Agent。 */
  function locate(current: Database) {
    const target = current.agents.find((item) => item.id === id);
    if (!target) return null;
    const row = endpoint.global
      ? (current.agentEndpoints ?? []).find((item) => item.id === endpoint.id)
      : (target.endpoints.find((item) => item.id === endpoint.id) ?? target.endpoints[0]);
    if (!row) return null;
    return { target, row };
  }

  if (Array.isArray(body.models)) {
    const models = normalizeModels(body.models);
    const updated = await updateDb((current) => {
      const found = locate(current);
      if (!found) return null;
      const { target, row } = found;
      row.models = body.replace || endpoint.mode === "official" ? models : mergeModelLists(row.models ?? [], models);
      if (!row.models.some((item) => item.id === row.model)) {
        row.model = row.models[0]?.id || "";
      }
      if (target.activeEndpointId === row.id) target.model = row.model;
      return target;
    });
    return NextResponse.json({
      models,
      agent: toPublicAgent(
        withGlobalEndpoints(updated ?? stored, (await readDb()).agentEndpoints),
      ),
    });
  }

  if (endpoint.mode === "official") {
    return NextResponse.json({ error: "请用桌面版从官方同步模型" }, { status: 400 });
  }

  const baseUrl = endpoint.baseUrl.trim() || fallbackAgentBaseUrl(agent.kind);
  if (!endpoint.apiKey) {
    return NextResponse.json({ error: "这个接口还没有填写 API Key" }, { status: 400 });
  }
  if (!baseUrl) {
    return NextResponse.json({ error: "这个接口还没有填写地址" }, { status: 400 });
  }

  try {
    const models = await fetchRemoteModels({
      baseUrl,
      apiKey: endpoint.apiKey,
    });
    const updated = await updateDb((current) => {
      const found = locate(current);
      if (!found) return null;
      const { row, target } = found;
      row.models = mergeModelLists(row.models ?? [], models);
      if (!row.model && row.models[0]) row.model = row.models[0].id;
      return target;
    });
    return NextResponse.json({
      models,
      agent: toPublicAgent(
        withGlobalEndpoints(updated ?? stored, (await readDb()).agentEndpoints),
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法连接该接口";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
