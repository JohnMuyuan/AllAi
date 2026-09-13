import { NextResponse } from "next/server";
import { isOfficialProvider } from "@/lib/official-chat";
import { toPublicProvider } from "@/lib/public";
import { updateDb } from "@/lib/store";
import { withModelKind } from "@/lib/models";
import type { ModelKind, ModelRef } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeModels(input: unknown): ModelRef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const models: ModelRef[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push(withModelKind({ id, label: id }));
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; label?: unknown; kind?: unknown; reasoningLevels?: unknown };
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind =
      record.kind === "chat" || record.kind === "image" || record.kind === "video"
        ? (record.kind as ModelKind)
        : undefined;
    const reasoningLevels = Array.isArray(record.reasoningLevels)
      ? record.reasoningLevels.map(String).filter(Boolean)
      : undefined;
    models.push(
      withModelKind({
        id,
        label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : id,
        kind,
        reasoningLevels,
      }),
    );
  }
  return models;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    name?: string;
    baseUrl?: string;
    apiKey?: string | null;
    extraHeaders?: Record<string, string>;
    models?: unknown;
  };

  try {
    const provider = await updateDb((db) => {
      const current = db.providers.find((item) => item.id === id);
      if (!current) throw new Error("NOT_FOUND");
      if (typeof body.name === "string" && body.name.trim()) current.name = body.name.trim();
      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
        const baseUrl = body.baseUrl.trim().replace(/\/+$/, "");
        if (!isOfficialProvider({ baseUrl }) && !/^https?:\/\//i.test(baseUrl)) {
          throw new Error("BAD_URL");
        }
        current.baseUrl = baseUrl;
      }
      // apiKey: null = 明确清空；缺省 = 不动；掩码串 = 界面回显，忽略。
      if (body.apiKey === null) current.apiKey = "";
      else if (
        typeof body.apiKey === "string" &&
        body.apiKey.trim() &&
        !body.apiKey.includes("•")
      ) {
        current.apiKey = body.apiKey.trim();
      }
      if (body.extraHeaders) current.extraHeaders = body.extraHeaders;
      const models = normalizeModels(body.models);
      if (models) {
        current.models = models;
        // 用户自己保存过一次，就由用户维护：启动扫描不再回填，哪怕清空了。
        current.modelsPinned = true;
      }
      // 地址或模型改过，之前记的「不支持联网」就不算数了，重新试一次。
      if (models || typeof body.baseUrl === "string") delete current.webSearchUnsupported;
      return current;
    });
    return NextResponse.json({ provider: toPublicProvider(provider) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "服务不存在" }, { status: 404 });
    }
    if (message === "BAD_URL") {
      return NextResponse.json({ error: "接口地址需要以 http:// 或 https:// 开头" }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const removed = await updateDb((db) => {
    const index = db.providers.findIndex((item) => item.id === id);
    if (index === -1) return false;
    db.providers.splice(index, 1);
    return true;
  });
  if (!removed) return NextResponse.json({ error: "服务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
