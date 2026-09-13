import { NextResponse } from "next/server";
import { searchLocal } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") || "";
  if (q.trim().length > 80) {
    return NextResponse.json({ error: "搜索词太长" }, { status: 400 });
  }
  const results = await searchLocal(q);
  return NextResponse.json({ results });
}
