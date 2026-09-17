import { NextResponse } from "next/server";
import { OFFICIAL_CHATS, officialSpecForProvider } from "@/lib/official-chat";
import { toPublicProvider } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";
import { withModelKind } from "@/lib/models";
import type { ModelKind, ModelRef, ProviderAuth } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeModels(input: unknown): ModelRef[] {
  if (!Array.isArray(input)) return [];
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

export async function GET() {
  const db = await readDb();
  return NextResponse.json({ providers: db.providers.map(toPublicProvider) });
}


/** 调整服务顺序。界面上的 ↑↓ 只发 id 列表过来，没列到的保持原有相对次序排在后面。 */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((item): item is string => typeof item === "string") : null;
  if (!ids) return NextResponse.json({ error: "缺少顺序" }, { status: 400 });
  const providers = await updateDb((db) => {
    const byId = new Map(db.providers.map((item) => [item.id, item]));
    const ordered = ids.map((id) => byId.get(id)).filter((item): item is (typeof db.providers)[number] => Boolean(item));
    const rest = db.providers.filter((item) => !ids.includes(item.id));
    db.providers = [...ordered, ...rest];
    return db.providers;
  });
  return NextResponse.json({ providers: providers.map(toPublicProvider) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    extraHeaders?: Record<string, string>;
    models?: unknown;
    auth?: ProviderAuth;
  };
  const name = body.name?.trim();
  // 官方登录的服务（Claude 账号 / Grok 账号）没有 Key 和地址，id 固定，只能有一个。
  const official = OFFICIAL_CHATS.find((item) => item.auth === body.auth) ?? null;
  const auth: ProviderAuth = official ? official.auth : "api";
  if (official) {
    if (!name) {
      return NextResponse.json({ error: "需要填写名称" }, { status: 400 });
    }
    const models = normalizeModels(body.models);
    const provider = await updateDb((db) => {
      const existing = db.providers.find(
        (item) => officialSpecForProvider(item)?.kind === official.kind,
      );
      if (existing) return existing;
      const created = {
        id: official.providerId,
        name,
        baseUrl: official.providerId,
        apiKey: "",
        auth,
        models: models.length ? models : official.models.map((model) => withModelKind(model)),
        modelsPinned: true,
        createdAt: Date.now(),
      };
      db.providers.push(created);
      return created;
    });
    return NextResponse.json({ provider: toPublicProvider(provider) });
  }
  const baseUrl = body.baseUrl?.trim().replace(/\/+$/, "");
  const apiKey = body.apiKey?.trim();
  if (!name || !baseUrl || !apiKey) {
    return NextResponse.json({ error: "名称、接口地址和 API Key 都需要填写" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return NextResponse.json({ error: "接口地址需要以 http:// 或 https:// 开头" }, { status: 400 });
  }

  const provider = await updateDb((db) => {
    const created = {
      id: crypto.randomUUID(),
      name,
      baseUrl,
      apiKey,
      auth,
      extraHeaders: body.extraHeaders,
      models: normalizeModels(body.models),
      modelsPinned: true,
      createdAt: Date.now(),
    };
    db.providers.push(created);
    return created;
  });

  return NextResponse.json({ provider: toPublicProvider(provider) });
}
