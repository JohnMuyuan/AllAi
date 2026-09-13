import { NextResponse } from "next/server";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

// 只有这些才直接在页面里渲染。其余一律当附件下载，
// 否则传个 .html 进来就等于在应用自己的源上执行脚本。
const INLINE = /^(image\/|video\/|audio\/)|^application\/pdf$|^text\/plain$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const file = await readUpload(id);
  if (!file) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  const inline = INLINE.test(file.mime);
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.name)}"`,
    },
  });
}
