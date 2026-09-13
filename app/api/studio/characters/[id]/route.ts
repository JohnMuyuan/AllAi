import { NextResponse } from "next/server";
import { updateDb } from "@/lib/store";
import { deleteUploads } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    imageIds?: string[];
  };
  const result = await updateDb((db) => {
    const current = db.characters.find((item) => item.id === id);
    if (!current) return null;
    const previousImages = [...current.imageIds];
    if (typeof body.name === "string" && body.name.trim()) current.name = body.name.trim();
    if (typeof body.description === "string") current.description = body.description.trim();
    if (Array.isArray(body.imageIds)) current.imageIds = body.imageIds.map(String);
    const stillUsed = new Set(db.characters.flatMap((item) => item.imageIds));
    return {
      character: current,
      unusedImages: previousImages.filter((imageId) => !stillUsed.has(imageId)),
    };
  });
  if (!result) return NextResponse.json({ error: "人物不存在" }, { status: 404 });
  await deleteUploads(result.unusedImages).catch(() => undefined);
  return NextResponse.json({ character: result.character });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await updateDb((db) => {
    const index = db.characters.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const [removed] = db.characters.splice(index, 1);
    const stillUsed = new Set(db.characters.flatMap((item) => item.imageIds));
    return removed.imageIds.filter((imageId) => !stillUsed.has(imageId));
  });
  if (!result) return NextResponse.json({ error: "人物不存在" }, { status: 404 });
  await deleteUploads(result).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
