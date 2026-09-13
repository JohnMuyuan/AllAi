import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    mime?: string;
    data?: string;
  };
  const name = body.name?.trim();
  const mime = body.mime?.trim() || "application/octet-stream";
  const data = body.data?.trim();
  if (!name || !data) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length) {
    return NextResponse.json({ error: "文件是空的" }, { status: 400 });
  }
  if (buffer.length > 40 * 1024 * 1024) {
    return NextResponse.json({ error: "文件不能超过 40MB" }, { status: 400 });
  }
  const file = await saveUpload({ name, mime, data: buffer });
  return NextResponse.json({ file });
}
