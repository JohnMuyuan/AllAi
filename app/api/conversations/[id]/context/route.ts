import { NextResponse } from "next/server";
import { buildChatContext } from "@/lib/chat-context";
import { contextLimit } from "@/lib/context-window";
import { patchConversation, readConversation } from "@/lib/conversations";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 换模型（或要开新 CLI 会话）时取上下文，交给新模型。
 *
 * 顺带就把压缩做了：能装下多少由目标模型的上限决定，装不下的压成摘要并存回对话，
 * 下次不用重压。摘要要调第三方接口，所以只能在服务端做。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { modelId?: string };
  const conversation = await readConversation(id);
  if (!conversation) return NextResponse.json({ error: "对话不存在" }, { status: 404 });

  const db = await readDb();
  const modelId = body.modelId || "";
  const built = await buildChatContext(conversation.messages, {
    modelId,
    overrides: db.prefs.contextLimits,
    percent: db.prefs.compactPercent,
    previous: conversation.compaction,
    signal: request.signal,
  });
  if (built.compaction) {
    const next = built.compaction;
    await patchConversation(id, (current) => {
      current.compaction = next;
    });
  }
  return NextResponse.json({ ...built, limit: contextLimit(modelId, db.prefs.contextLimits) });
}
