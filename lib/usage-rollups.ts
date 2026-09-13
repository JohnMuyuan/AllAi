import { promises as fs } from "fs";
import path from "path";
import { estimateCost } from "./model-pricing";
import { dataDir } from "./paths";
import type { UsageEvent } from "./usage";

/**
 * 把 `~/.allai/usage-rollups.json` 读成统计页认识的 `UsageEvent`。**服务端专用**。
 *
 * 那个文件由主进程写（`electron/usage-scan.ts` 扫本机 CLI 会话文件、
 * `electron/cc-switch.ts` 导 CC Switch 的历史），一天一条汇总。
 *
 * 为什么是汇总而不是一条条事件：本机会话文件里有几万次请求，全摊成事件塞进
 * `usage.json` 会把那个「整份读、整份写」的文件撑到几十兆，每记一条都要重写一遍。
 * CC Switch 也是这么做的（它 35020 次请求只留 200 行日汇总）。
 *
 * 这边把一天一个来源一个型号折成**一条** UsageEvent（`requests` 就是那天的次数），
 * 统计页、热力图、折线图全都不用改。
 */

type Bucket = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  costUsd: number;
  requests: number;
};

type DayBuckets = Record<string, Record<string, Record<string, Bucket>>>;

type Rollups = {
  version?: number;
  files?: Record<string, { days?: DayBuckets }>;
  imports?: Record<string, { at?: number; days?: DayBuckets }>;
};

function rollupFile() {
  return path.join(dataDir(), "usage-rollups.json");
}

async function read(): Promise<Rollups> {
  try {
    return JSON.parse(await fs.readFile(rollupFile(), "utf8")) as Rollups;
  } catch {
    return {};
  }
}

/** `2026-09-11` → 当天中午的时间戳。落在哪一天不受时区影响。 */
function dayToAt(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

function merge(into: DayBuckets, from: DayBuckets | undefined) {
  if (!from) return;
  for (const [day, bySource] of Object.entries(from)) {
    const target = (into[day] ??= {});
    for (const [source, byModel] of Object.entries(bySource)) {
      const models = (target[source] ??= {});
      for (const [model, bucket] of Object.entries(byModel)) {
        const hit = (models[model] ??= {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          costUsd: 0,
          requests: 0,
        });
        hit.input += bucket.input || 0;
        hit.output += bucket.output || 0;
        hit.cacheRead += bucket.cacheRead || 0;
        hit.cacheWrite += bucket.cacheWrite || 0;
        hit.reasoning += bucket.reasoning || 0;
        hit.costUsd += bucket.costUsd || 0;
        hit.requests += bucket.requests || 0;
      }
    }
  }
}

export type RollupSummary = {
  scanned: { days: number; requests: number; from: string; to: string };
  imports: { name: string; at: number; days: number; requests: number; from: string; to: string }[];
};

/**
 * 汇总数据变成事件。
 *
 * 同一天同一个来源，**本机扫出来的优先**：CC Switch 那份是它扫同一批会话文件得来的，
 * 两边都有就会重复计。实测这两段时间几乎不重叠（CC Switch 到 2026-08-12，
 * 本机会话文件从 2026-08-16 才开始 —— CLI 自己把更早的清掉了），但规则得写死在这儿。
 */
export async function rollupEvents(): Promise<UsageEvent[]> {
  const rollups = await read();
  const scanned: DayBuckets = {};
  for (const file of Object.values(rollups.files ?? {})) merge(scanned, file.days);

  const imported: DayBuckets = {};
  for (const entry of Object.values(rollups.imports ?? {})) merge(imported, entry.days);

  const out: UsageEvent[] = [];
  const push = (day: string, source: string, model: string, bucket: Bucket, from: string) => {
    const at = dayToAt(day);
    if (!at || !bucket.requests) return;
    out.push({
      id: `rollup:${from}:${day}:${source}:${model}`,
      at,
      area: "agent",
      source,
      modelId: model,
      input: bucket.input,
      output: bucket.output,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      reasoning: bucket.reasoning,
      // 自己报过花费的就用它；没有的按型号估（Claude / Codex 的会话文件里没有钱）。
      costUsd: bucket.costUsd || estimateCost(model, bucket),
      requests: bucket.requests,
      images: 0,
      durationMs: 0,
    });
  };

  for (const [day, bySource] of Object.entries(scanned)) {
    for (const [source, byModel] of Object.entries(bySource)) {
      for (const [model, bucket] of Object.entries(byModel)) push(day, source, model, bucket, "local");
    }
  }
  for (const [day, bySource] of Object.entries(imported)) {
    for (const [source, byModel] of Object.entries(bySource)) {
      // 这一天这个来源本机已经扫到了，就不要再叠导入的那份。
      if (scanned[day]?.[source]) continue;
      for (const [model, bucket] of Object.entries(byModel)) push(day, source, model, bucket, "import");
    }
  }
  return out;
}

/** 给设置页显示「扫到了多少 / 导入了多少」。 */
export async function rollupSummary(): Promise<RollupSummary> {
  const rollups = await read();
  const scanned: DayBuckets = {};
  for (const file of Object.values(rollups.files ?? {})) merge(scanned, file.days);
  const count = (days: DayBuckets) => {
    let requests = 0;
    for (const bySource of Object.values(days))
      for (const byModel of Object.values(bySource))
        for (const bucket of Object.values(byModel)) requests += bucket.requests || 0;
    const keys = Object.keys(days).sort();
    return { days: keys.length, requests, from: keys[0] || "", to: keys.at(-1) || "" };
  };
  return {
    scanned: count(scanned),
    imports: Object.entries(rollups.imports ?? {}).map(([name, entry]) => {
      const days: DayBuckets = {};
      merge(days, entry.days);
      return { name, at: entry.at || 0, ...count(days) };
    }),
  };
}
