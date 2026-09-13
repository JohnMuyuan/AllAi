import { NextResponse } from "next/server";
import { deleteManagedSkill, importSkill, scanSkills } from "@/lib/skills";
import { updateDb } from "@/lib/store";
import type { AgentKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: AgentKind[] = ["grok-build", "claude-code", "codex", "custom"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    disabledFor?: string[];
    refresh?: boolean;
  };
  try {
    const skills = await updateDb(async (db) => {
      const current = db.skills.find((item) => item.id === id);
      if (!current) throw new Error("NOT_FOUND");
      if (body.refresh && current.sourcePath) {
        const imported = await importSkill(current.sourcePath);
        Object.assign(current, imported, { id: current.id, disabledFor: current.disabledFor });
      }
      if (Array.isArray(body.disabledFor)) {
        current.disabledFor = body.disabledFor.filter((item): item is AgentKind =>
          KINDS.includes(item as AgentKind),
        );
      }
      return scanSkills(db.skills);
    });
    return NextResponse.json({ skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "Skill 不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const skills = await updateDb(async (db) => {
      const current = db.skills.find((item) => item.id === id);
      if (!current) throw new Error("NOT_FOUND");
      if (!current.managed) throw new Error("只能删除导入到 AllAi 的 Skills");
      await deleteManagedSkill(current.path);
      db.skills = db.skills.filter((item) => item.id !== id);
      return scanSkills(db.skills);
    });
    return NextResponse.json({ skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    const status = message === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
