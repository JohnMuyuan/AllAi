import { NextResponse } from "next/server";
import { importSkill, scanSkills } from "@/lib/skills";
import { readDb, updateDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDb();
  const skills = await scanSkills(db.skills);
  await updateDb((current) => {
    current.skills = skills;
  });
  return NextResponse.json({ skills });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { path?: string };
  const from = body.path?.trim();
  if (!from) return NextResponse.json({ error: "请选择 Skills 文件夹" }, { status: 400 });
  try {
    const imported = await importSkill(from);
    const skills = await updateDb(async (db) => {
      db.skills = db.skills.filter((item) => item.path !== imported.path);
      db.skills.push(imported);
      return scanSkills(db.skills);
    });
    return NextResponse.json({ skills, skill: imported });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入失败" },
      { status: 400 },
    );
  }
}
