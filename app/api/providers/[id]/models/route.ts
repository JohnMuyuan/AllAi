import { NextResponse } from "next/server";
import { isOfficialProvider } from "@/lib/official-chat";
import { fetchRemoteModels } from "@/lib/fetch-models";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = await readDb();
  const provider = db.providers.find((item) => item.id === id);
  if (!provider) {
    return NextResponse.json({ error: "服务不存在" }, { status: 404 });
  }
  if (isOfficialProvider(provider)) {
    return NextResponse.json({ error: "请用桌面版从官方同步模型" }, { status: 400 });
  }
  if (!provider.apiKey) {
    return NextResponse.json({ error: "还没有填写 API Key" }, { status: 400 });
  }

  try {
    const models = await fetchRemoteModels({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      extraHeaders: provider.extraHeaders,
    });
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法连接该接口";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
