import { promises as fs } from "fs";
import path from "path";
import { mediaKindFromMime } from "./models";
import { uploadsDir } from "./paths";
import type { ChatAttachment } from "./types";

type Meta = Record<string, { name: string; mime: string; ext: string }>;

function metaFile() {
  return path.join(uploadsDir(), "meta.json");
}

function fileFor(id: string, ext: string) {
  // 这是用户数据目录，不是项目源码。让 Turbopack 不要因为动态路径把整个仓库
  // 都追踪进服务端产物里。
  return path.join(/* turbopackIgnore: true */ uploadsDir(), `${id}${ext}`);
}

let metaChain: Promise<unknown> = Promise.resolve();

/**
 * meta.json 是所有附件共用的一份索引。输入框会 Promise.all 并行上传，
 * 所以这里必须把“读 → 改 → 写”排成一条队列，否则后写的请求会覆盖先写的索引。
 */
function enqueueMeta<T>(fn: () => Promise<T>): Promise<T> {
  const next = metaChain.then(fn, fn);
  metaChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readMeta(): Promise<Meta> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaFile(), "utf8")) as Meta;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("附件索引格式损坏");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    // 索引坏了时不能装作空对象继续写，否则下一次上传会把所有旧附件从索引抹掉。
    throw error;
  }
}

async function writeMeta(meta: Meta) {
  await fs.mkdir(uploadsDir(), { recursive: true });
  const target = metaFile();
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
  try {
    await fs.rename(tmp, target);
  } catch {
    await fs.copyFile(tmp, target);
    await fs.unlink(tmp).catch(() => undefined);
  }
}

function extFrom(name: string, mime: string) {
  const fromName = path.extname(name);
  if (fromName) return fromName;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime.startsWith("video/")) return ".mp4";
  if (mime.startsWith("audio/")) return ".webm";
  return ".bin";
}

export async function saveUpload(opts: {
  name: string;
  mime: string;
  data: Buffer;
}): Promise<ChatAttachment> {
  const id = crypto.randomUUID();
  const ext = extFrom(opts.name, opts.mime);
  await fs.mkdir(uploadsDir(), { recursive: true });
  const localPath = fileFor(id, ext);
  await fs.writeFile(localPath, opts.data);
  try {
    await enqueueMeta(async () => {
      const meta = await readMeta();
      meta[id] = { name: opts.name, mime: opts.mime, ext };
      await writeMeta(meta);
    });
  } catch (error) {
    // 索引没写成，这个裸文件以后也找不到，立即收掉避免垃圾越积越多。
    await fs.unlink(localPath).catch(() => undefined);
    throw error;
  }
  return {
    id,
    name: opts.name,
    mime: opts.mime,
    kind: mediaKindFromMime(opts.mime),
    localPath,
  };
}

export async function readUpload(id: string) {
  const item = await enqueueMeta(async () => (await readMeta())[id]);
  if (!item) return null;
  const file = fileFor(id, item.ext);
  let data: Buffer;
  try {
    data = await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { ...item, id, data, file };
}

export function publicUploadUrl(id: string) {
  return `/api/uploads/${id}`;
}

export async function uploadPath(id: string) {
  const item = await enqueueMeta(async () => (await readMeta())[id]);
  if (!item) return null;
  return fileFor(id, item.ext);
}

/**
 * 清掉没人再引用的附件。
 *
 * 这是补一个一直存在的洞：删创作会顺手删掉它生成的图（见 app/api/studio/...），
 * **删聊天对话却什么都不删** —— 你发过的每一张图、AI 在聊天里生成的每一张图，
 * 都永远留在 ~/.allai/uploads 里，而且没有任何入口能清掉它。
 * 实测用户机器上 67 个附件 4.88MB **全部**没有任何对话或创作引用（0.16.32）。
 *
 * @param keep 还被引用着的 id。**调用方必须保证这份集合是完整的** ——
 *             漏一个就会删掉还在显示的图，所以扫描出错时宁可整轮不做。
 * @param minAgeMs 太新的不碰：刚上传还没来得及写进消息的附件不能误删。
 */
export function pruneUploads(keep: Set<string>, minAgeMs = 24 * 60 * 60 * 1000) {
  return enqueueMeta(async () => {
    const meta = await readMeta();
    const now = Date.now();
    const removed: string[] = [];
    let bytes = 0;
    for (const [id, item] of Object.entries(meta)) {
      if (keep.has(id)) continue;
      const file = fileFor(id, item.ext);
      let size = 0;
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs < minAgeMs) continue;
        size = stat.size;
      } catch (error) {
        // 文件早没了，只剩一条索引 —— 那就只清索引。
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
      await fs.unlink(file).catch(() => undefined);
      delete meta[id];
      removed.push(id);
      bytes += size;
    }
    if (removed.length) await writeMeta(meta);
    return { removed: removed.length, bytes };
  });
}

/** 删除附件本体和索引；批量删只重写一次 meta.json。 */
export function deleteUploads(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return Promise.resolve(0);
  return enqueueMeta(async () => {
    const meta = await readMeta();
    let removed = 0;
    for (const id of unique) {
      const item = meta[id];
      if (!item) continue;
      await fs.unlink(fileFor(id, item.ext)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      delete meta[id];
      removed += 1;
    }
    if (removed) await writeMeta(meta);
    return removed;
  });
}
