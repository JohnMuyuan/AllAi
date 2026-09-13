import { NextResponse } from "next/server";
import { patchConversation, readConversation } from "@/lib/conversations";
import { summarizeWithAnyProvider } from "@/lib/title";

export const dynamic = "force-dynamic";

/**
 * 给官方登录聊天（Claude 账号 / Grok 账号）的对话起标题。
 * 那条路不走 /api/chat，拿不到 HTTP 服务，所以借任意一个有 Key 的服务总结一下。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const conversation = await readConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const user = conversation.messages.find((item) => item.role === "user");
  const assistant = conversation.messages.find(
    (item) => item.role === "assistant" && item.content,
  );
  if (!user || !assistant) {
    return NextResponse.json({ title: "" });
  }

  const title = await summarizeWithAnyProvider(user.content, assistant.content, request.signal);
  if (!title) return NextResponse.json({ title: "" });
  await patchConversation(id, (current) => {
    current.title = title;
  });
  return NextResponse.json({ title });
}
