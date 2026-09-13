import { NextResponse } from "next/server";
import { buildChatContext } from "@/lib/chat-context";
import { contextLimit } from "@/lib/context-window";
import { readDb } from "@/lib/store";
import type { ChatMessage, Compaction } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 通用的上下文组装：给一串消息，返回「摘要 + 最近几轮」。
 * 聊天、Agent、创作三个专区共用 —— 换模型不丢上下文这件事在哪都一样。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    messages?: { role?: string; content?: string }[];
    /** 要交给哪个模型 —— 上限按它算。 */
    modelId?: string;
    /** 这条工作/创作上已有的压缩结果，接着往下压。 */
    previous?: Compaction;
    handoff?: boolean;
    stream?: boolean;
  } | null;
  const rows = Array.isArray(body?.messages) ? body.messages : [];
  const messages = rows
    .filter(
      (item) =>
        (item?.role === "user" || item?.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim(),
    )
    .map((item, index) => ({
      id: String(index),
      role: item.role as "user" | "assistant",
      content: (item.content || "").slice(0, 20_000),
      createdAt: index,
    })) as ChatMessage[];

  const db = await readDb();
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  if (!messages.length) {
    return NextResponse.json({
      summary: "",
      recent: [],
      summarized: 0,
      limit: contextLimit(modelId, db.prefs.contextLimits),
    });
  }
  const limit = contextLimit(modelId, db.prefs.contextLimits);
  const stream = body?.stream === true;
  if (!stream) {
    const built = await buildChatContext(messages, {
      modelId,
      overrides: db.prefs.contextLimits,
      percent: db.prefs.compactPercent,
      previous: body?.previous,
      signal: request.signal,
      handoff: body?.handoff === true,
    });
    return NextResponse.json({ ...built, limit });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const built = await buildChatContext(messages, {
          modelId,
          overrides: db.prefs.contextLimits,
          percent: db.prefs.compactPercent,
          previous: body?.previous,
          signal: request.signal,
          handoff: body?.handoff === true,
          onProgress: (event) => send({ type: "progress", ...event }),
        });
        send({ type: "done", ...built, limit });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "压缩失败",
        });
      }
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
