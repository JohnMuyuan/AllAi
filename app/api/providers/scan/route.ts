import { NextResponse } from "next/server";
import { toPublicProvider } from "@/lib/public";
import { applySuppliers, collectSuppliers, fetchMissingModels } from "@/lib/scan-suppliers";
import { readDb, updateDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  const counts = await updateDb(async (db) => {
    const scanned = await collectSuppliers(db.agents);
    return applySuppliers(db, scanned);
  });

  // 拉远端模型目录要走网络，放在锁外面，否则启动时整个 API 都排在它后面。
  const filled = await fetchMissingModels(await readDb());

  const providers = await updateDb((db) => {
    for (const [id, models] of filled) {
      const provider = db.providers.find((item) => item.id === id);
      // 期间用户可能已经自己填过或删过，认用户的。
      if (!provider || provider.modelsPinned || provider.models.length) continue;
      provider.models = models;
    }
    return db.providers.map(toPublicProvider);
  });

  return NextResponse.json({ ...counts, providers });
}
