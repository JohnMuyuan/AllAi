import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./paths";
import { toSummary } from "./public";
import { readDb, updateDb } from "./store";
import { deleteUploads, pruneUploads } from "./uploads";
import type { Conversation, ConversationSummary } from "./types";

/**
 * 对话不再塞在 db.json 里。以前发一条消息就要把所有对话的所有消息
 * 反序列化再序列化一遍，对话越多越慢。现在一条对话一个文件，
 * 侧栏列表读 index.json，一次只碰要动的那条。
 */

function conversationsDir() {
  return path.join(dataDir(), "conversations");
}

function indexFile() {
  return path.join(conversationsDir(), "index.json");
}

function fileFor(id: string) {
  return path.join(conversationsDir(), `${encodeURIComponent(id)}.json`);
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

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.rename(tmp, file);
  } catch {
    await fs.copyFile(tmp, file);
    await fs.unlink(tmp).catch(() => undefined);
  }
}

function validSummary(item: unknown): item is ConversationSummary {
  if (!item || typeof item !== "object") return false;
  const row = item as Partial<ConversationSummary>;
  return (
    typeof row.id === "string" &&
    Boolean(row.id) &&
    typeof row.title === "string" &&
    typeof row.modelKey === "string" &&
    typeof row.updatedAt === "number" &&
    typeof row.createdAt === "number" &&
    typeof row.preview === "string"
  );
}

async function readIndex(): Promise<ConversationSummary[] | null> {
  try {
    const raw = await fs.readFile(indexFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(validSummary)) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // JSON 写到一半或内容损坏时交给 rebuildIndex，从对话文件恢复。
    return null;
  }
}

/** index.json 丢了或对不上时，靠目录本身重建。 */
async function rebuildIndex(): Promise<ConversationSummary[]> {
  const summaries: ConversationSummary[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(conversationsDir());
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name === "index.json") continue;
    try {
      const raw = await fs.readFile(path.join(conversationsDir(), name), "utf8");
      summaries.push(toSummary(JSON.parse(raw) as Conversation));
    } catch {
      // 坏文件跳过
    }
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeJson(indexFile(), summaries);
  return summaries;
}

async function putIndex(summary: ConversationSummary) {
  const list = (await readIndex()) ?? (await rebuildIndex());
  const next = [summary, ...list.filter((item) => item.id !== summary.id)];
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeJson(indexFile(), next);
}

async function dropIndex(id: string) {
  const list = (await readIndex()) ?? (await rebuildIndex());
  await writeJson(
    indexFile(),
    list.filter((item) => item.id !== id),
  );
}

let migrated = false;

/** 老版本的 db.json 里还躺着对话，搬一次就好。 */
async function migrate() {
  if (migrated) return;
  migrated = true;
  const db = await readDb();
  if (!db.conversations?.length) return;
  for (const conversation of db.conversations) {
    if (!conversation?.id) continue;
    const target = fileFor(conversation.id);
    try {
      await fs.access(target);
      continue; // 已经搬过
    } catch {
      await writeJson(target, conversation);
    }
  }
  await rebuildIndex();
  await updateDb((current) => {
    current.conversations = [];
  });
}

async function loadFile(id: string): Promise<Conversation | null> {
  try {
    const raw = await fs.readFile(fileFor(id), "utf8");
    const parsed = JSON.parse(raw) as Conversation;
    return parsed?.id ? { ...parsed, messages: parsed.messages ?? [] } : null;
  } catch {
    return null;
  }
}

/**
 * 对话文件先落盘、索引后落盘。若应用恰好在两步之间退出，就会留下孤儿文件。
 * 列侧栏时只比较文件名，不读全文；发现数量或 id 对不上才重建索引。
 */
async function reconciledIndex(): Promise<ConversationSummary[]> {
  const indexed = await readIndex();
  if (indexed === null) return rebuildIndex();
  let names: string[];
  try {
    names = (await fs.readdir(conversationsDir())).filter(
      (name) => name.endsWith(".json") && name !== "index.json",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const indexedNames = new Set(indexed.map((item) => path.basename(fileFor(item.id))));
  if (names.length !== indexed.length || names.some((name) => !indexedNames.has(name))) {
    return rebuildIndex();
  }
  return indexed;
}

export function listConversations(): Promise<ConversationSummary[]> {
  const list = enqueue(async () => {
    await migrate();
    const rows = await reconciledIndex();
    return [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  });
  // 排在这次列表之后，不拖慢启动那一下。
  void list.then(sweepOrphanUploads, () => undefined);
  return list;
}

export function readConversation(id: string): Promise<Conversation | null> {
  return enqueue(async () => {
    await migrate();
    return loadFile(id);
  });
}

export function writeConversation(conversation: Conversation): Promise<Conversation> {
  return enqueue(async () => {
    await migrate();
    await writeJson(fileFor(conversation.id), conversation);
    await putIndex(toSummary(conversation));
    return conversation;
  });
}

/** 读-改-写一条对话，全程排队，不会和别的写撞上。 */
export function patchConversation(
  id: string,
  fn: (conversation: Conversation) => void | Promise<void>,
): Promise<Conversation | null> {
  return enqueue(async () => {
    await migrate();
    const current = await loadFile(id);
    if (!current) return null;
    await fn(current);
    current.updatedAt = Date.now();
    await writeJson(fileFor(id), current);
    await putIndex(toSummary(current));
    return current;
  });
}

/**
 * 一条对话引用了哪些附件。
 *
 * 两处都要收：消息上的 `attachments`，以及正文里 `/api/uploads/<id>` 这种
 * markdown 链接（聊天里 AI 生成的图就是这么插进去的，它不在 attachments 里）。
 */
const UPLOAD_LINK = /\/api\/uploads\/([0-9a-fA-F-]{16,64})/g;

function uploadIdsOf(conversation: Conversation): Set<string> {
  const ids = new Set<string>();
  for (const message of conversation.messages ?? []) {
    for (const item of message.attachments ?? []) if (item?.id) ids.add(item.id);
    for (const match of (message.content || "").matchAll(UPLOAD_LINK)) ids.add(match[1]);
    for (const step of message.steps ?? []) {
      for (const match of (step.text || "").matchAll(UPLOAD_LINK)) ids.add(match[1]);
    }
  }
  return ids;
}

/**
 * 现在还有谁在用附件。
 *
 * `complete` 为假表示**没扫全**（有对话文件读不出来）—— 这种情况下绝不能拿它去删东西，
 * 漏掉的那条对话里的图会被当成没人要的。
 */
async function collectUploadRefs(skipConversationId?: string) {
  const ids = new Set<string>();
  let complete = true;
  let names: string[] = [];
  try {
    names = (await fs.readdir(conversationsDir())).filter(
      (name) => name.endsWith(".json") && name !== "index.json",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
  }
  for (const name of names) {
    let parsed: Conversation | null = null;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(conversationsDir(), name), "utf8")) as Conversation;
    } catch {
      complete = false;
      continue;
    }
    if (!parsed?.id || parsed.id === skipConversationId) continue;
    for (const id of uploadIdsOf(parsed)) ids.add(id);
  }
  try {
    const db = await readDb();
    for (const job of db.studioJobs ?? []) {
      for (const output of job.outputs ?? []) if (output?.id) ids.add(output.id);
    }
    for (const character of db.characters ?? []) {
      for (const id of character.imageIds ?? []) ids.add(id);
    }
  } catch {
    complete = false;
  }
  return { ids, complete };
}

/**
 * 开机清一次没人引用的附件。只做一次，而且很保守：
 * 扫描不完整就整轮不做，24 小时内动过的文件不碰（可能是刚传上来还没写进消息的）。
 */
let swept = false;

function sweepOrphanUploads() {
  if (swept) return;
  swept = true;
  void enqueue(async () => {
    try {
      const refs = await collectUploadRefs();
      if (!refs.complete) return;
      await pruneUploads(refs.ids);
    } catch {
      // 清理失败不影响用
    }
  });
}

export function removeConversation(id: string): Promise<boolean> {
  return enqueue(async () => {
    await migrate();
    const current = await loadFile(id);
    if (!current) return false;
    const mine = uploadIdsOf(current);
    try {
      await fs.unlink(fileFor(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await dropIndex(id);
    /*
     * 把这条对话独占的附件一起删掉 —— 删创作一直是这么做的，聊天这边一直漏着。
     * 别删还被别处引用的：一张图可以被「用作参考」带进创作，也可能同时挂在别的对话上。
     * 扫不全（有对话文件读不出来）就一个都不删。
     */
    if (mine.size) {
      try {
        const refs = await collectUploadRefs(id);
        if (refs.complete) {
          await deleteUploads([...mine].filter((item) => !refs.ids.has(item)));
        }
      } catch {
        // 清不掉就留着，总比删错强
      }
    }
    return true;
  });
}
