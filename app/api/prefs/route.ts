import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/store";
import { emptyPrefs, type AppPrefs } from "@/lib/types";

export const dynamic = "force-dynamic";

const PREF_KEYS = Object.keys(emptyPrefs()) as (keyof AppPrefs)[];

/** 只认识的字段进得来，别让脏 key 写进 db.json。 */
function cleanPrefs(input: unknown): Partial<AppPrefs> {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const patch: Partial<AppPrefs> = {};
  const defaults = emptyPrefs();
  for (const key of PREF_KEYS) {
    const value = row[key];
    if (typeof defaults[key] === "boolean") {
      if (typeof value === "boolean") (patch as Record<string, unknown>)[key] = value;
      continue;
    }
    if (typeof defaults[key] === "number") {
      const num = Number(value);
      if (Number.isFinite(num)) (patch as Record<string, unknown>)[key] = Math.round(num);
      continue;
    }
    /*
     * contextLimits 是 modelId -> token 数。**不能**走下面那个分支：
     * 那里会把 key 转小写，而模型 id 是大小写敏感的（Qwen/Qwen3 这种），
     * 转完就再也匹配不上了。
     */
    if (key === "contextLimits") {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const num = Number(v);
        if (k.trim() && k.length <= 200 && Number.isFinite(num) && num > 0) {
          clean[k.trim()] = Math.round(num);
        }
      }
      (patch as Record<string, unknown>)[key] = clean;
      continue;
    }
    // 统计行显示哪几项：只收短字符串的数组。要放在下面对象分支前面，那边会把数组拒掉。
    if (key === "statsFields") {
      if (!Array.isArray(value)) continue;
      (patch as Record<string, unknown>)[key] = value
        .filter((item): item is string => typeof item === "string" && item.length <= 40)
        .slice(0, 20);
      continue;
    }
    // brandIcons 这类对象：只收 string -> string，值最长 256KB（data URI）。
    if (defaults[key] && typeof defaults[key] === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string" && v.length <= 524288 && k.length <= 120) clean[k.toLowerCase()] = v;
      }
      (patch as Record<string, unknown>)[key] = clean;
      continue;
    }
    if (typeof value === "string") (patch as Record<string, unknown>)[key] = value.trim();
  }
  return patch;
}

export async function GET() {
  const db = await readDb();
  return NextResponse.json({ prefs: db.prefs });
}

export async function PATCH(request: Request) {
  const patch = cleanPrefs(await request.json().catch(() => null));
  const prefs = await updateDb((db) => {
    db.prefs = { ...db.prefs, ...patch };
    return db.prefs;
  });
  return NextResponse.json({ prefs });
}
