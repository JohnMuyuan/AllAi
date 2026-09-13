import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { deleteUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const job = await updateDb((db) => {
    const current = db.studioJobs.find((item) => item.id === id);
    if (!current) return null;
    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (title) current.title = title.slice(0, 60);
      else delete current.title;
    }
    return current;
  });
  if (!job) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = await readDb();
  const job = db.studioJobs.find((item) => item.id === id);
  if (!job) return NextResponse.json({ error: "这条创作不存在" }, { status: 404 });

  await updateDb((current) => {
    const index = current.studioJobs.findIndex((item) => item.id === id);
    if (index !== -1) current.studioJobs.splice(index, 1);
  });
  // 先移除引用再清文件。即使磁盘清理失败，也不会留下指向缺失文件的创作记录。
  await deleteUploads(job.outputs.map((output) => output.id)).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
