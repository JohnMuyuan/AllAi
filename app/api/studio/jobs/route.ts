import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import type { StudioJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDb();
  return NextResponse.json({ jobs: db.studioJobs.slice(0, 80) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    id?: string;
    mode?: string;
    modelKey?: string;
    fromModelKey?: string;
    conversationId?: string;
  } | null;
  if (body?.kind !== "model-switch") {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }
  const modelKey = body.modelKey?.trim() || "";
  const fromModelKey = body.fromModelKey?.trim() || "";
  const conversationId = body.conversationId?.trim() || "";
  if (!modelKey || fromModelKey === modelKey) {
    return NextResponse.json({ error: "模型没有变化" }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "没有当前创作" }, { status: 400 });
  }
  const job: StudioJob = {
    id: body.id?.trim() || crypto.randomUUID(),
    conversationId,
    kind: "model-switch",
    mode: body.mode === "video" ? "video" : "image",
    prompt: "",
    aspectRatio: "auto",
    characterIds: [],
    modelKey,
    fromModelKey,
    status: "done",
    outputs: [],
    createdAt: Date.now(),
  };
  const saved = await updateDb((db) => {
    const conversation = db.studioConversations.find((item) => item.id === conversationId);
    if (!conversation) return null;
    if (!db.studioJobs.some((item) => item.id === job.id)) db.studioJobs.unshift(job);
    conversation.updatedAt = Date.now();
    return job;
  });
  if (!saved) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  return NextResponse.json({ job: saved });
}
