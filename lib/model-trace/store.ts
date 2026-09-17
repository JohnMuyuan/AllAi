import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "../paths";

export type TraceCandidate = { model: string; name: string; probability: number };

export type TraceRecord = {
  id: string;
  at: number;
  expected: string;
  predicted: string;
  predictedName: string;
  family: string;
  probability: number;
  mismatch: boolean;
  /** 指纹库里概率最高的几个型号。老记录没有。 */
  candidates?: TraceCandidate[];
  /** 这次用了几条有效回答（数字够长的才算）。 */
  usedOutputs?: number;
  /** 这次一共发了几道挑战。 */
  queries?: number;
  /** 判定成「这一家」的把握。 */
  familyProbability?: number;
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


/** 清空探测历史（界面上的「清空重测」）。 */
export async function clearTraceRecords() {
  const data = await readFile();
  const removed = data.records.length;
  await writeFile({ records: [] });
  return removed;
}

export function routingRate(records: TraceRecord[]) {
  const recent = records.slice(0, 50);
  if (!recent.length) return 0;
  return recent.filter((item) => item.mismatch).length / recent.length;
}
