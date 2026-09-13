import { NextResponse } from "next/server";
import { listConversations, readConversation, writeConversation } from "@/lib/conversations";
import { toSummary } from "@/lib/public";
import type { ChatMessage, Conversation } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

function asMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  const messages: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as ChatMessage;
    if (
      row.role !== "user" &&
      row.role !== "assistant" &&
      row.role !== "system" &&
      row.role !== "notice"
    ) {
      continue;
    }
    if (typeof row.id !== "string" || typeof row.content !== "string") continue;
    messages.push(row);
  }
  return messages;
}

function asCompaction(input: unknown): Conversation["compaction"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const row = input as Record<string, unknown>;
  if (
    typeof row.summary !== "string" ||
    typeof row.folded !== "number" ||
    !Number.isFinite(row.folded) ||
    row.folded < 0 ||
    typeof row.at !== "number" ||
    typeof row.tokensBefore !== "number" ||
    typeof row.tokensAfter !== "number"
  ) {
    return undefined;
  }
  return {
    summary: row.summary,
    folded: Math.round(row.folded),
    at: row.at,
    tokensBefore: row.tokensBefore,
    tokensAfter: row.tokensAfter,
    modelId: typeof row.modelId === "string" ? row.modelId : undefined,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as { conversation?: Partial<Conversation> };
  const incoming = body.conversation;
  const id = incoming?.id?.trim();
  const modelKey = incoming?.modelKey?.trim() ?? "";
  const messages = asMessages(incoming?.messages);
  if (!incoming || !id || !modelKey || !messages) {
    return NextResponse.json({ error: "对话内容不完整" }, { status: 400 });
  }
  const record = incoming;
  const now = Date.now();
  const existing = await readConversation(id);

  const conversation: Conversation = {
    id,
    title: existing
      ? typeof record.title === "string" && record.title.trim()
        ? record.title.trim().slice(0, 60)
        : existing.title
      : (record.title?.trim() || "新对话").slice(0, 60),
    messages,
    modelKey,
    reasoningEffort:
      typeof record.reasoningEffort === "string"
        ? record.reasoningEffort
        : existing?.reasoningEffort,
    cliSessionId:
      typeof record.cliSessionId === "string" ? record.cliSessionId : existing?.cliSessionId,
    cliKind: typeof record.cliKind === "string" ? record.cliKind : existing?.cliKind,
    cliDelivered:
      typeof record.cliDelivered === "number" ? record.cliDelivered : existing?.cliDelivered,
    // 官方登录聊天由客户端整条保存。这里漏掉 compaction 会把刚做好的摘要抹掉，
    // 下一轮又从压缩前的长度开始算，并且可能重复花一次摘要请求。
    compaction: asCompaction(record.compaction) ?? existing?.compaction,
    createdAt: existing?.createdAt || record.createdAt || now,
    updatedAt: now,
  };

  await writeConversation(conversation);
  return NextResponse.json({ conversation: toSummary(conversation) });
}
