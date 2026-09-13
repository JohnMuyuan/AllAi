import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { summarizeWithAnyProvider } from "@/lib/title";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = await readDb();
  const conversation = db.studioConversations.find((item) => item.id === id);
  if (!conversation) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  const job = [...db.studioJobs]
    .filter((item) => item.conversationId === id && item.kind !== "model-switch")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!job) return NextResponse.json({ title: conversation.title });
  const title = await summarizeWithAnyProvider(
    job.prompt,
    job.mode === "video" ? "已生成视频" : "已生成图片",
    request.signal,
  );
  if (!title) return NextResponse.json({ title: conversation.title });
  await updateDb((current) => {
    const row = current.studioConversations.find((item) => item.id === id);
    if (row) row.title = title;
  });
  return NextResponse.json({ title });
}
