import fs from "fs";
import os from "os";
import path from "path";
import type { AgentWork } from "./history";

// Windows 上 pid 会被回收，光看「这个号还活着」可能是别的进程。
// Grok 自己写的 opened_at 给了个时间边界：太老的记录一律不认。
const LIVE_MAX_AGE = 24 * 60 * 60 * 1000;

function pidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = 进程在，只是不归我们管。
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function grokActive(): AgentWork[] {
  const file = path.join(os.homedir(), ".grok", "active_sessions.json");
  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as {
      session_id?: string;
      pid?: number;
      cwd?: string;
      opened_at?: string;
    }[];
    const works: AgentWork[] = [];
    for (const row of rows) {
      if (!row.session_id || !row.pid || !pidAlive(row.pid)) continue;
      const opened = Date.parse(row.opened_at || "") || Date.now();
      if (Date.now() - opened > LIVE_MAX_AGE) continue;
      works.push({
        id: `grok-build:${row.session_id}`,
        kind: "grok-build",
        agentName: "Grok Build",
        title: "Grok 运行中",
        cwd: row.cwd || "",
        cliSessionId: row.session_id,
        running: true,
        pid: row.pid,
        createdAt: opened,
        updatedAt: Date.now(),
        preview: row.cwd || "正在运行",
        source: "live",
        messagesFile: row.cwd
          ? path.join(
              os.homedir(),
              ".grok",
              "sessions",
              encodeURIComponent(row.cwd),
              row.session_id,
              "updates.jsonl",
            )
          : undefined,
      });
    }
    return works;
  } catch {
    return [];
  }
}

/**
 * Claude Code 每开一个会话进程，就在 `~/.claude/sessions/<pid>.json` 登记一条：
 * `{ pid, sessionId, cwd, status: "busy" | "idle", ... }`，进程正常退出时删掉。
 *
 * 以前只看会话文件最近有没有写（3 分钟内），放在后台闲着的会话就被当成已经关了。
 * 进程还在 = 在线；status 是 busy = 正在跑。进程号可能被系统回收，所以还要求这条登记
 * 近 7 天内更新过，太老的一律不认。
 */
const CLAUDE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

type ClaudeLive = { sessionId: string; pid: number; cwd: string; busy: boolean; updatedAt: number };

/**
 * 登记表读得到吗。读得到，「这条会话没登记」才等于「它没在跑」；
 * 读不到（目录不在、权限不够）只能退回按文件时间猜。
 */
let claudeRegistryOk = false;

export function claudeRegistryReadable() {
  return claudeRegistryOk;
}

function claudeActive(): ClaudeLive[] {
  const dir = path.join(os.homedir(), ".claude", "sessions");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
    claudeRegistryOk = true;
  } catch {
    claudeRegistryOk = false;
    return [];
  }
  const out: ClaudeLive[] = [];
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      const row = JSON.parse(fs.readFileSync(file, "utf8")) as {
        pid?: number;
        sessionId?: string;
        cwd?: string;
        status?: string;
        updatedAt?: number;
        startedAt?: number;
      };
      const pid = Number(row.pid || name.split(".")[0]);
      if (!row.sessionId || !pidAlive(pid)) continue;
      const updatedAt = Number(row.updatedAt || row.startedAt) || fs.statSync(file).mtimeMs;
      if (Date.now() - updatedAt > CLAUDE_MAX_AGE) continue;
      out.push({ sessionId: row.sessionId, pid, cwd: row.cwd || "", busy: row.status === "busy", updatedAt });
    } catch {
      // 正在被改写的文件读到一半，下次再看
    }
  }
  return out;
}

/** 某条 Claude 会话现在的进程状态。没有登记（进程不在）就是 null。 */
export function claudeLiveState(sessionId: string): { busy: boolean; pid: number } | null {
  const hit = claudeActive().find((item) => item.sessionId === sessionId);
  return hit ? { busy: hit.busy, pid: hit.pid } : null;
}

export async function scanLive(): Promise<AgentWork[]> {
  const claude = claudeActive().map<AgentWork>((item) => ({
    id: `claude-code:${item.sessionId}`,
    kind: "claude-code",
    agentName: "Claude Code",
    title: "Claude 运行中",
    cwd: item.cwd,
    cliSessionId: item.sessionId,
    running: item.busy,
    online: true,
    pid: item.pid,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    preview: item.cwd,
    source: "live",
  }));
  return [...grokActive().map((item) => ({ ...item, online: true })), ...claude];
}

export function mergeWorks(history: AgentWork[], live: AgentWork[]): AgentWork[] {
  const map = new Map<string, AgentWork>();
  const liveClaude = new Set(live.filter((item) => item.kind === "claude-code").map((item) => item.id));
  for (const item of history) {
    /*
     * Claude Code 自己登记了进程（~/.claude/sessions/<pid>.json），所以对它我们有**准信**，
     * 不该再用「会话文件 3 分钟内写过」去猜 —— 那个猜法在你直接关掉终端窗口之后
     * 还会继续说「运行中」整整三分钟（进程早没了，只是文件刚写过）。
     * 没登记 = 没在跑。只有登记表整个读不出来时才退回猜。
     * Grok / Codex 没有这种登记，仍然按时间猜。
     */
    const stale =
      item.kind === "claude-code" && item.running && claudeRegistryReadable() && !liveClaude.has(item.id);
    map.set(item.id, stale ? { ...item, running: false } : item);
  }
  for (const item of live) {
    const current = map.get(item.id);
    if (current) {
      // Claude 闲着时进程还在：在线但不算「运行中」。busy 是它自己报的，以它为准，
      // 别再 OR 上历史那个按文件时间的猜测（那会让刚跑完的会话多显示三分钟）。
      const running = item.kind === "claude-code" ? item.running : true;
      map.set(item.id, { ...current, running, online: true, pid: item.pid, source: "live" });
    } else if (item.kind !== "claude-code") {
      // Claude 还没写出会话文件的新会话先不列出来，有了内容历史扫描自然会带上。
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
