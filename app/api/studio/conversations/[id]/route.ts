import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { toStudioSummary } from "@/lib/studio";
import { deleteUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = await readDb();
  const conversation = db.studioConversations.find((item) => item.id === id);
  if (!conversation) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  const jobs = db.studioJobs
    .filter((item) => item.conversationId === id)
    .sort((a, b) => a.createdAt - b.createdAt);
  return NextResponse.json({
    conversation: toStudioSummary(conversation, jobs),
    jobs,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const conversation = await updateDb((db) => {
    const current = db.studioConversations.find((item) => item.id === id);
    if (!current) return null;
    if (typeof body?.title === "string") {
      const title = body.title.trim();
      current.title = (title || "新创作").slice(0, 60);
      current.updatedAt = Date.now();
    }
    return current;
  });
  if (!conversation) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  return NextResponse.json({ conversation });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = await readDb();
  const conversation = db.studioConversations.find((item) => item.id === id);
  if (!conversation) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  const jobs = db.studioJobs.filter((item) => item.conversationId === id);
  await updateDb((current) => {
    current.studioConversations = current.studioConversations.filter((item) => item.id !== id);
    current.studioJobs = current.studioJobs.filter((item) => item.conversationId !== id);
  });
  await deleteUploads(jobs.flatMap((job) => job.outputs.map((output) => output.id))).catch(
    () => undefined,
  );
  return NextResponse.json({ ok: true });
}
