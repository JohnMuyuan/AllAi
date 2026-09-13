import { NextResponse } from "next/server";
import { patchConversation, readConversation, removeConversation } from "@/lib/conversations";
import { toSummary } from "@/lib/public";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const conversation = await readConversation(id);
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    modelKey?: string;
    cliSessionId?: string;
    reasoningEffort?: string;
    notice?: { id?: string; fromModelKey?: string; modelKey?: string };
    message?: {
      id?: string;
      content?: string;
      step?: { kind?: "search" | "notice" | "error"; text?: string };
    };
  };
  const conversation = await patchConversation(id, (current) => {
    if (typeof body.title === "string") {
      current.title = (body.title.trim() || "新对话").slice(0, 60);
    }
    if (typeof body.modelKey === "string") current.modelKey = body.modelKey;
    if (typeof body.cliSessionId === "string") current.cliSessionId = body.cliSessionId;
    if (typeof body.reasoningEffort === "string") current.reasoningEffort = body.reasoningEffort;
    if (body.message?.id) {
      const message = current.messages.find((item) => item.id === body.message?.id);
      if (message) {
        if (typeof body.message.content === "string") message.content = body.message.content;
        const stepText = body.message.step?.text?.trim();
        if (stepText) {
          const requestedKind = body.message.step?.kind;
          const stepKind =
            requestedKind === "search" || requestedKind === "error" ? requestedKind : "notice";
          message.steps = [
            ...(message.steps ?? []),
            {
              kind: stepKind,
              text: stepText.slice(0, 500),
              at: Date.now(),
            },
          ];
        }
      }
    }
    const to = body.notice?.modelKey?.trim() || (typeof body.modelKey === "string" ? body.modelKey : "");
    const from = body.notice?.fromModelKey?.trim() || "";
    if (body.notice && to && from !== to) {
      const noticeId = body.notice.id?.trim() || crypto.randomUUID();
      if (!current.messages.some((item) => item.id === noticeId)) {
        current.messages.push({
          id: noticeId,
          role: "notice",
          content: "",
          fromModelKey: from || undefined,
          modelKey: to,
          createdAt: Date.now(),
        });
      }
    }
  });
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  return NextResponse.json({ conversation: toSummary(conversation) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!(await removeConversation(id))) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
