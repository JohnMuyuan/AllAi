import { promises as fs } from "fs";
import path from "path";
import { ensureEndpoints } from "./agent-endpoints";
import { defaultAgents } from "./agents";
import { withModelKind } from "./models";
import { dataDir } from "./paths";
import { applySuppliers, collectSuppliers } from "./scan-suppliers";
import { migrateStudioConversations } from "./studio";
import { emptyPrefs, type Database } from "./types";

function dbFile() {
  return path.join(dataDir(), "db.json");
}

function emptyDb(): Database {
  return {
    providers: [],
    conversations: [],
    agents: defaultAgents(),
    agentEndpoints: [],
    prefs: emptyPrefs(),
    skills: [],
    characters: [],
    studioConversations: [],
    studioJobs: [],
    agentWorks: {},
    seeded: {},
  };
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

async function readRaw(): Promise<Database> {
  try {
    const raw = await fs.readFile(dbFile(), "utf8");
    const parsed = JSON.parse(raw) as Database;
    return {
      providers: (parsed.providers ?? []).map((provider) => ({
        ...provider,
        models: (provider.models ?? []).map(withModelKind),
      })),
      conversations: parsed.conversations ?? [],
      agents: (parsed.agents ?? []).map(ensureEndpoints),
      agentEndpoints: parsed.agentEndpoints ?? [],
      prefs: {
        ...emptyPrefs(),
        ...(parsed.prefs ?? {}),
        agentPermissionMode: {
          ...emptyPrefs().agentPermissionMode,
          ...(parsed.prefs?.agentPermissionMode ?? {}),
        },
      },
      skills: parsed.skills ?? [],
      characters: parsed.characters ?? [],
      studioConversations: parsed.studioConversations ?? [],
      studioJobs: parsed.studioJobs ?? [],
      agentWorks: parsed.agentWorks ?? {},
      seeded: parsed.seeded ?? {},
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyDb();
    throw error;
  }
}

async function writeRaw(db: Database) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const target = dbFile();
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  try {
    await fs.rename(tmp, target);
  } catch {
    await fs.copyFile(tmp, target);
    await fs.unlink(tmp).catch(() => undefined);
  }
}

// 本机 CLI 配置一个进程内扫一次就够了。每次 readDb/updateDb 都扫，
// 等于每条聊天消息都要读一遍 ~/.grok、~/.claude、~/.codex 的配置文件。
let suppliersScanned = false;

async function seed(db: Database) {
  let changed = false;
  if (!db.agents.length) {
    db.agents = defaultAgents();
    changed = true;
  }
  const relabeled = db.agents.map(ensureEndpoints);
  if (JSON.stringify(relabeled) !== JSON.stringify(db.agents)) {
    db.agents = relabeled;
    changed = true;
  }
  // 启动时扫本机 CLI 配置，把中转站和 Key 导进来 —— 对用户是省事，
  // 但跑回归时会让隔离数据目录悄悄多出一份真 Key。测试脚本设
  // ALLAI_NO_SUPPLIER_SCAN=1 关掉它。
  if (!suppliersScanned && process.env.ALLAI_NO_SUPPLIER_SCAN !== "1") {
    suppliersScanned = true;
    try {
      const scanned = await collectSuppliers(db.agents);
      const result = applySuppliers(db, scanned);
      if (result.added || result.updated) changed = true;
    } catch {
      // scanning local CLI configs is best-effort
    }
  }
  // 0.9.3 之前联网走的是 chat/completions，被拒的模型都记成了「不支持」。
  // 现在改走 Responses API，那批记录不算数了，清一次重新试。
  if (migrateStudioConversations(db)) changed = true;
  if (!db.seeded?.webSearchReset) {
    for (const provider of db.providers) delete provider.webSearchUnsupported;
    db.seeded = { ...db.seeded, webSearchReset: true };
    changed = true;
  }
  if (!db.seeded?.xai && process.env.XAI_API_KEY) {
    db.providers.unshift({
      id: crypto.randomUUID(),
      name: "SpaceXAI",
      baseUrl: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
      models: [
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
      ],
      createdAt: Date.now(),
    });
    db.seeded = { ...db.seeded, xai: true };
    changed = true;
  }
  if (changed) await writeRaw(db);
}

export function readDb(): Promise<Database> {
  return enqueue(async () => {
    const db = await readRaw();
    await seed(db);
    return db;
  });
}

export function updateDb<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  return enqueue(async () => {
    const db = await readRaw();
    await seed(db);
    const result = await fn(db);
    await writeRaw(db);
    return result;
  });
}
