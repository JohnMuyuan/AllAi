import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import type { StudioCharacter } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDb();
  return NextResponse.json({ characters: db.characters });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<StudioCharacter>;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "请填写人物名称" }, { status: 400 });
  const character = await updateDb((db) => {
    const created: StudioCharacter = {
      id: crypto.randomUUID(),
      name,
      description: (body.description || "").trim(),
      imageIds: Array.isArray(body.imageIds) ? body.imageIds.map(String) : [],
      createdAt: Date.now(),
    };
    db.characters.unshift(created);
    return created;
  });
  return NextResponse.json({ character });
}
