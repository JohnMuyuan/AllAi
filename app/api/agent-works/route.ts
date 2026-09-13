import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import type { AgentWorkOverride, Compaction } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 用户对 Agent 工作的改名 / 隐藏。会话本体在各家 CLI 自己的目录里，
 * 我们只在这里存一层覆盖。
 */
export async function GET() {
  const db = await readDb();
  return NextResponse.json({ works: db.agentWorks ?? {} });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    title?: string | null;
    hidden?: boolean;
    modelSwitch?: { id?: string; fromModelKey?: string; modelKey?: string };
    /** 用户给这条工作选的模型，重启后要还原成它。 */
    modelKey?: string | null;
    /** 这条 CLI 会话实际在用的型号。 */
    sessionModel?: string | null;
    /** 上下文压缩结果。会话文件是各家 CLI 的，改不了，只能叠在这层覆盖里。 */
    compaction?: Compaction | null;
    /** 「接续到新对话」两头互相记住对方。null 表示清掉。 */
    continuedFrom?: string | null;
    continuedTo?: string | null;
  } | null;
  const id = body?.id?.trim();
  if (!id) return NextResponse.json({ error: "缺少工作 id" }, { status: 400 });

  const works = await updateDb((db) => {
    const map = (db.agentWorks ??= {});
    const current: AgentWorkOverride = { ...map[id] };
    if (body?.title === null) delete current.title;
    else if (typeof body?.title === "string" && body.title.trim()) {
      current.title = body.title.trim().slice(0, 80);
    }
    if (typeof body?.hidden === "boolean") current.hidden = body.hidden;
    if (!current.hidden) delete current.hidden;
    const to = body?.modelSwitch?.modelKey?.trim() || "";
    const from = body?.modelSwitch?.fromModelKey?.trim() || "";
    if (to && from !== to) {
      current.modelSwitches = [
        ...(current.modelSwitches ?? []),
        {
          id: body?.modelSwitch?.id?.trim() || crypto.randomUUID(),
          createdAt: Date.now(),
          fromModelKey: from,
          modelKey: to,
        },
      ];
    }
    if (body?.modelKey === null) delete current.modelKey;
    else if (typeof body?.modelKey === "string" && body.modelKey.includes("::")) {
      current.modelKey = body.modelKey.trim().slice(0, 200);
    }
    if (body?.sessionModel === null) delete current.sessionModel;
    else if (typeof body?.sessionModel === "string" && body.sessionModel.trim() && !body.sessionModel.startsWith("__")) {
      current.sessionModel = body.sessionModel.trim().slice(0, 120);
    }
    if (body?.compaction === null) delete current.compaction;
    else if (body?.compaction?.summary) current.compaction = body.compaction;
    for (const field of ["continuedFrom", "continuedTo"] as const) {
      const value = body?.[field];
      if (value === null) delete current[field];
      else if (typeof value === "string" && value.trim()) current[field] = value.trim().slice(0, 200);
    }
    if (Object.keys(current).length) map[id] = current;
    else delete map[id];
    return map;
  });

  return NextResponse.json({ works });
}
