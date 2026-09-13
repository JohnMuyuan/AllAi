import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readUpload } from "@/lib/uploads";
import type { ChatAttachment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 把附件复制进 Agent 的工作目录。
 *
 * 上传的文件本来在 ~/.allai/uploads/ 下，但 Agent 是带沙箱跑的
 * （codex 是 workspace-write，只认工作目录），读不到外面的路径。
 * 复制到 <cwd>/.allai-files/ 之后它们才真的能打开。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    cwd?: string;
    attachments?: ChatAttachment[];
  } | null;

  const cwd = body?.cwd?.trim();
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
  if (!cwd) return NextResponse.json({ error: "缺少工作目录" }, { status: 400 });
  if (!attachments.length) return NextResponse.json({ files: [] });

  try {
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) throw new Error("不是目录");
  } catch {
    return NextResponse.json({ error: "工作目录不存在" }, { status: 400 });
  }

  const dir = path.join(cwd, ".allai-files");
  await fs.mkdir(dir, { recursive: true });

  const files: { name: string; path: string; kind: string }[] = [];
  for (const attachment of attachments) {
    const upload = await readUpload(attachment.id).catch(() => null);
    if (!upload) continue;
    // 文件名只取 basename，别让上传名里的 ../ 跑出这个目录。
    const safe = path.basename(attachment.name || `${attachment.id}${upload.ext}`);
    const target = path.join(dir, `${attachment.id.slice(0, 8)}-${safe}`);
    if (path.relative(dir, target).startsWith("..")) continue;
    await fs.writeFile(target, upload.data);
    files.push({ name: safe, path: target, kind: attachment.kind });
  }

  return NextResponse.json({ files });
}
