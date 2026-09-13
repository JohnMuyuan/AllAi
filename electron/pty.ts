import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { BrowserWindow, app } from "electron";
import { adminHostScript } from "./admin";
import { logLine, logPath } from "./log";

export type DesktopSession = {
  id: string;
  agentId: string;
  agentName: string;
  cwd: string;
  action: "run" | "login";
  status: "running" | "exited";
  exitCode: number | null;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

let host: ChildProcess | null = null;
const pending = new Map<string, Pending>();

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

function resolveNode(): string {
  const candidates = [
    process.env.ALLAI_NODE,
    app.isPackaged ? path.join(process.resourcesPath, "node.exe") : "",
    process.env.npm_node_execpath,
    "node",
  ].filter(Boolean) as string[];
  return candidates.find((item) => item === "node" || fs.existsSync(item)) || "node";
}

function resolveHostScript() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "pty-host", "pty-host.js");
  }
  return path.join(__dirname, "pty-host.js");
}

function onHostMessage(message: {
  id?: string;
  type?: string;
  result?: unknown;
  sessionId?: string;
  data?: string;
  exitCode?: number;
  sessions?: DesktopSession[];
  workId?: string;
  messages?: unknown;
  running?: boolean;
}) {
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)?.resolve(message.result);
    pending.delete(message.id);
    return;
  }
  if (message.type === "data" && message.sessionId && typeof message.data === "string") {
    broadcast("pty:data", message.sessionId, message.data);
  }
  if (message.type === "exit" && message.sessionId) {
    broadcast("pty:exit", message.sessionId, message.exitCode ?? 0);
  }
  if (message.type === "sessions" && message.sessions) {
    broadcast("pty:sessions", message.sessions);
  }
  if (message.type === "work-messages") {
    broadcast("agent:work-messages", message);
  }
  if (message.type === "chat-event" && message.sessionId) {
    broadcast("agent:event", message.sessionId, (message as { event?: unknown }).event);
  }
}

/**
 * 拿到活着的终端宿主。
 *
 * **判活要看 `connected`，不能只看 `killed`** —— `killed` 只表示「我们给它发过信号」。
 * 宿主自己崩了（比如 require 不到 node-pty）`killed` 还是 false，但 IPC 通道已经没了，
 * 之后每一次 `send()` 都返回 false，界面上就是那句没头没尾的「无法联系终端宿主」。
 */
function getHost() {
  if (host && host.connected && !host.killed) return host;
  const script = resolveHostScript();
  const child = spawn(resolveNode(), [script], {
    cwd: path.dirname(script),
    // stderr 要收着。以前是 "ignore"：宿主一挂，崩溃原因一个字都不留，
    // 只剩界面上那句「无法联系终端宿主」，除了重新打包没别的办法查。
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: {
      ...process.env,
      ALLAI_MAIN_PID: String(process.pid),
      // 终端宿主是纯 node 进程，拿不到 resourcesPath，管理员宿主的路径由这里交过去。
      ALLAI_ADMIN_HOST_SCRIPT: adminHostScript(),
      ALLAI_NODE_EXE: resolveNode(),
    },
    windowsHide: true,
  });
  host = child;
  child.stderr?.on("data", (chunk: Buffer) => logLine(`pty-host stderr: ${String(chunk).trimEnd()}`));
  // 没有这个监听，spawn 失败时 ChildProcess 的 error 事件会把主进程掀了。
  child.on("error", (error) => logLine(`pty-host spawn failed: ${error.message}`));
  child.on("message", onHostMessage);
  const drop = (why: string) => {
    if (host === child) host = null;
    for (const [id, waiter] of pending) {
      waiter.reject(new Error(why));
      pending.delete(id);
    }
  };
  // exit 和 close 都要接：通道先断、进程后退是常事，只等 exit 会留一个「看着还活着」的空壳。
  child.on("exit", (code) => {
    logLine(`pty-host exited with code ${code}`);
    drop("终端宿主已退出");
  });
  child.on("disconnect", () => drop("终端宿主断开了"));
  return child;
}

// 登录要等用户在浏览器里授权，最长 180s；其余调用不该无限期挂着。
// 管理员授权也要等用户在系统弹窗里点确认。
const LONG_CALLS = new Set(["cli-auth-login", "login", "admin-ensure"]);

/*
 * 给终端宿主发一条请求。
 *
 * **`child.send()` 的返回值是背压，不是成败。** 队列里攒够约 256KB 它就返回 false，
 * 而消息照样会送到（实测：连发 5 条、其中两条 500KB/2MB 返回 false，子进程 5 条全收到，
 * `connected` 一直是 true）。以前这里把 false 当成「联系不上」直接报错 ——
 * 小消息（list / attach / kill）永远碰不到，只有 `agent:prompt` 会：
 * 它带着整段历史，Claude Code 续上下文时轻松几百 KB。也就是说会话越长越必然失败。
 *
 * 真失败只有一个来源：send 的回调收到 error（通道关了、进程没起来）。
 */
function request<T>(payload: Record<string, unknown>): Promise<T> {
  const id = crypto.randomUUID();
  const timeoutMs = LONG_CALLS.has(String(payload.type)) ? 200_000 : 90_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error("终端宿主没有响应"));
    }, timeoutMs);
    const settle = (fn: (value: never) => void) => (value: never) => {
      clearTimeout(timer);
      fn(value);
    };
    pending.set(id, {
      resolve: settle(resolve as (value: never) => void) as (value: unknown) => void,
      reject: settle(reject as (value: never) => void) as (error: Error) => void,
    });
    const deliver = (attempt: number) => {
      const child = getHost();
      // 带回调时 Node 不再 emit "error"，错误只从这里来。
      child.send({ id, ...payload }, (error) => {
        if (!error) return;
        logLine(`pty-host send failed: ${error.message}`);
        // 宿主刚没了（被杀、崩了）：丢掉重起一个再试一次。
        if (attempt === 0) {
          host = null;
          deliver(1);
          return;
        }
        if (!pending.has(id)) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`无法联系终端宿主（本机 CLI 都由它启动）。原因记在 ${logPath()}`));
      });
    };
    deliver(0);
  });
}

export function listSessions() {
  return request<DesktopSession[]>({ type: "list" });
}

export function attach(sessionId: string) {
  return request<{ history: string; session: DesktopSession | null }>({
    type: "attach",
    sessionId,
  });
}

export function write(sessionId: string, data: string) {
  void request({ type: "write", sessionId, data }).catch(() => undefined);
}

export function resize(sessionId: string, cols: number, rows: number) {
  void request({ type: "resize", sessionId, cols, rows }).catch(() => undefined);
}

export function kill(sessionId: string) {
  return request({ type: "kill", sessionId });
}

export function killAll() {
  host?.kill();
  host = null;
}

export function start(opts: {
  sessionId: string;
  agentId: string;
  action: "run" | "login";
  cwd: string;
  cols: number;
  rows: number;
}) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "start", opts });
}

export function promptChat(opts: {
  sessionId: string;
  agentId: string;
  prompt: string;
  cwd: string;
  resumeId?: string;
  newSessionId?: string;
  model?: string;
  endpointId?: string;
  providerId?: string;
  effort?: string;
  images?: string[];
  webSearch?: boolean;
  permissionMode?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  elevated?: boolean;
}) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "chat", opts });
}

export function watchWork(work: unknown) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "watch-work", work });
}

export function unwatchWork() {
  return request<{ ok: true }>({ type: "unwatch-work" });
}

export function deleteWork(work: unknown) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "delete-work", work });
}

export function loginAgent(agentId: string) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "login", agentId });
}

export function cliAuthStatus(kind: string, command?: string) {
  return request<{
    kind: string;
    installed: boolean;
    loggedIn: boolean;
    email: string;
    account: string;
  }>({ type: "cli-auth-status", kind, command });
}

export function cliAuthLogin(kind: string, command?: string) {
  return request<{ ok: true } | { ok: false; error: string }>({
    type: "cli-auth-login",
    kind,
    command,
  });
}

export function cliAuthLogout(kind: string, command?: string) {
  return request<{ ok: true } | { ok: false; error: string }>({
    type: "cli-auth-logout",
    kind,
    command,
  });
}

export function cliListModels(kind: string, command?: string) {
  return request<
    | { ok: true; models: { id: string; label: string; reasoningLevels?: string[] }[] }
    | { ok: false; error: string }
  >({ type: "cli-models", kind, command });
}

export function officialChat(opts: {
  kind: "claude" | "grok" | "chatgpt";
  sessionId: string;
  prompt: string;
  resumeId?: string;
  newSessionId?: string;
  model?: string;
  effort?: string;
  webSearch?: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
  elevated?: boolean;
}) {
  return request<{ ok: true } | { ok: false; error: string }>({ type: "official-chat", opts });
}

/** 拿到管理员宿主（必要时弹 UAC）。真正干活的在终端宿主里，见 admin-client.ts。 */
export function adminEnsure() {
  return request<{ ok: true; elevated: boolean } | { ok: false; error: string }>({
    type: "admin-ensure",
  });
}

export function adminLinkStatus() {
  return request<{ elevated: boolean; linked: boolean; script: string }>({
    type: "admin-status",
  });
}
