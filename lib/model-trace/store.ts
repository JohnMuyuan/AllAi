import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "../paths";

export type TraceRecord = {
  id: string;
  at: number;
  expected: string;
  predicted: string;
  predictedName: string;
  family: string;
  probability: number;
  mismatch: boolean;
  conversationId?: string;
  messageId?: string;
  source: "auto" | "manual";
};

type TraceFile = {
  records: TraceRecord[];
};

function filePath() {
  return path.join(dataDir(), "model-trace.json");
}

async function readFile(): Promise<TraceFile> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath(), "utf8")) as TraceFile;
    return { records: Array.isArray(raw.records) ? raw.records : [] };
  } catch {
    return { records: [] };
  }
}

async function writeFile(data: TraceFile) {
  await fs.mkdir(path.dirname(filePath()), { recursive: true });
  const tmp = `${filePath()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath()).catch(async () => {
    await fs.copyFile(tmp, filePath());
    await fs.unlink(tmp).catch(() => undefined);
  });
}

export async function listTraceRecords() {
  const data = await readFile();
  return data.records.slice(-200).reverse();
}

export async function addTraceRecord(record: TraceRecord) {
  const data = await readFile();
  data.records = [...data.records, record].slice(-200);
  await writeFile(data);
  return record;
}

export function routingRate(records: TraceRecord[]) {
  const recent = records.slice(0, 50);
  if (!recent.length) return 0;
  return recent.filter((item) => item.mismatch).length / recent.length;
}
