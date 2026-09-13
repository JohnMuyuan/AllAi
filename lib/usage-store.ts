import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./paths";
import type { UsageArea, UsageEvent } from "./usage";

/** usage.json 的读写。只有服务端用得到 —— 界面那边引 lib/usage.ts 的纯部分。 */

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function usageFile() {
  return path.join(dataDir(), "usage.json");
}

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readRaw(): Promise<UsageEvent[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(usageFile(), "utf8")) as { events?: UsageEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // 不能把损坏/暂时读不了误判成“没有统计”。否则下一条记录会覆盖全部历史。
    throw error;
  }
}

async function writeRaw(events: UsageEvent[]) {
  await fs.mkdir(dataDir(), { recursive: true });
  const target = usageFile();
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ events }, null, 2), "utf8");
  try {
    await fs.rename(tmp, target);
  } catch {
    await fs.copyFile(tmp, target);
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export function listUsage(): Promise<UsageEvent[]> {
  return enqueue(readRaw);
}

export function recordUsage(input: Partial<UsageEvent> & { area: UsageArea }): Promise<UsageEvent> {
  return enqueue(async () => {
    const event: UsageEvent = {
      id: crypto.randomUUID(),
      at: input.at || Date.now(),
      area: input.area,
      conversationId: input.conversationId,
      source: (input.source || "").slice(0, 80),
      modelId: (input.modelId || "").slice(0, 120),
      input: num(input.input),
      output: num(input.output),
      cacheRead: num(input.cacheRead),
      cacheWrite: num(input.cacheWrite),
      reasoning: num(input.reasoning),
      contextTokens: num(input.contextTokens) || undefined,
      costUsd: typeof input.costUsd === "number" && input.costUsd > 0 ? input.costUsd : 0,
      requests:
        typeof input.requests === "number" && Number.isFinite(input.requests) && input.requests > 0
          ? Math.round(input.requests)
          : 1,
      images: num(input.images),
      durationMs: num(input.durationMs),
    };
    const events = await readRaw();
    events.push(event);
    await writeRaw(events);
    return event;
  });
}

export function clearUsage(before?: number): Promise<number> {
  return enqueue(async () => {
    const events = await readRaw();
    const kept = before ? events.filter((item) => item.at >= before) : [];
    await writeRaw(kept);
    return events.length - kept.length;
  });
}
