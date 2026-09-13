import { NextResponse } from "next/server";
import { toStudioSummary } from "@/lib/studio";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDb();
  const conversations = [...db.studioConversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((item) =>
      toStudioSummary(
        item,
        db.studioJobs.filter((job) => job.conversationId === item.id),
      ),
    );
  return NextResponse.json({ conversations });
}
