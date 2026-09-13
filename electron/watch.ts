import fs from "fs";
import path from "path";
import {
  listCodexRollouts,
  loadMessages,
  looksRunning,
  readContextUsage,
  type AgentMessage,
  type AgentWork,
} from "./history";
import { claudeLiveState } from "./live";

/**
 * 盯住正在看的那条 Agent 工作的会话文件，有新内容就推给界面。
 *
 * 为什么不轮询进程：交接文档里说死了不许扫 claude.exe 之类的进程名
 * （会把 CC Switch 之类的东西误报成运行中）。会话文件被写过才是真凭据 ——
 * 实测正在跑的会话文件 3 秒前刚写过，第二新的是 13 小时前，区分度很足。
 */

export type WatchPayload = {
  workId: string;
  messages: AgentMessage[];
  running: boolean;
  /** CLI 进程还开着（Claude Code 能判断），见 live.ts。 */
  online?: boolean;
  context?: { tokens: number; window?: number };
};

type Watcher = {
  close: () => void;
};

let current: { workId: string; watcher: Watcher } | null = null;

export function unwatchMessages() {
  try {
    current?.watcher.close();
  } catch {
    // 已经关了
  }
  current = null;
}

/**
 * 盯一条工作的会话文件。可以同时盯多条（每台手机自己一条）。
 * 文件一变就重新解析并回调；写入很密集，所以做了防抖。
 */
export function startWorkWatch(
  work: AgentWork,
  onChange: (payload: WatchPayload) => void,
): { close: () => void } | { error: string } {
  const file = work.messagesFile;
  if (!file || !fs.existsSync(file)) return { error: "这条工作还没有会话文件" };

  let timer: NodeJS.Timeout | null = null;
  const lastSizes = new Map<string, number>();
  const fileWatchers = new Map<string, fs.FSWatcher>();
  let dirWatcher: fs.FSWatcher | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, 400);
  };

  const filesToWatch = () => {
    if (work.kind === "codex") return listCodexRollouts(work.cliSessionId, file);
    return work.messagesFiles?.length ? work.messagesFiles : [file];
  };

  const ensureFileWatch = (target: string) => {
    if (fileWatchers.has(target) || !fs.existsSync(target)) return;
    try {
      fileWatchers.set(
        target,
        fs.watch(target, { persistent: false }, () => schedule()),
      );
    } catch {
      // 单个文件盯不住就靠目录
    }
  };

  const push = () => {
    timer = null;
    try {
      const files = filesToWatch();
      let changed = files.length !== lastSizes.size;
      let newest = 0;
      for (const target of files) {
        ensureFileWatch(target);
        const stat = fs.statSync(target);
        newest = Math.max(newest, stat.mtimeMs);
        if (lastSizes.get(target) !== stat.size) {
          changed = true;
          lastSizes.set(target, stat.size);
        }
      }
      if (!changed && lastSizes.size) return;
      const currentWork =
        work.kind === "codex" ? { ...work, messagesFile: files.at(-1) || file, messagesFiles: files } : work;
      // Claude Code 自己登记了进程和忙闲（~/.claude/sessions/<pid>.json），有就以它为准。
      const live = work.kind === "claude-code" ? claudeLiveState(work.cliSessionId) : null;
      onChange({
        workId: work.id,
        messages: loadMessages(currentWork),
        running: live ? live.busy : looksRunning(newest),
        online: live ? true : undefined,
        context: readContextUsage(currentWork) ?? undefined,
      });
    } catch {
      // 文件被删了就当没变化
    }
  };

  try {
    const dir = path.dirname(file);
    if (fs.existsSync(dir)) {
      dirWatcher = fs.watch(dir, { persistent: false }, () => schedule());
    }
    for (const target of filesToWatch()) ensureFileWatch(target);
    push();
    return {
      close: () => {
        if (timer) clearTimeout(timer);
        dirWatcher?.close();
        for (const watcher of fileWatchers.values()) watcher.close();
        fileWatchers.clear();
      },
    };
  } catch (error) {
    /*
     * 建到一半失败了（filesToWatch 对 codex 要读目录、可能抛），已经建起来的
     * 目录 watcher、文件 watcher 和防抖定时器必须在这里收掉。
     * 返回 {error} 之后调用方拿不到 close()，这些东西就永久泄漏了 ——
     * 每失败一次漏一份，正是这个项目踩过的那类坑（约定 66）。
     */
    if (timer) clearTimeout(timer);
    try {
      dirWatcher?.close();
    } catch {
      // 已经关了
    }
    for (const watcher of fileWatchers.values()) {
      try {
        watcher.close();
      } catch {
        // 已经关了
      }
    }
    fileWatchers.clear();
    return { error: error instanceof Error ? error.message : "盯不住这个文件" };
  }
}

/**
 * 界面自己看的那条。同一时间只盯一条。
 */
export function watchMessages(
  work: AgentWork,
  onChange: (payload: WatchPayload) => void,
): { ok: true } | { ok: false; error: string } {
  unwatchMessages();
  const started = startWorkWatch(work, onChange);
  if ("error" in started) return { ok: false, error: started.error };
  current = { workId: work.id, watcher: started };
  return { ok: true };
}
