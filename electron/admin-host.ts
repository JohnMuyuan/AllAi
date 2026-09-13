import { spawn, type ChildProcess } from "child_process";
import net from "net";

/**
 * 提权后的 CLI 宿主。必须作为 resources 下的真实文件、用 RunAs 拉起来。
 *
 * 它是**客户端**：连上 AllAi 开好的管道，第一行报上启动时拿到的一次性密钥，
 * 之后替 AllAi 以管理员身份 spawn 进程。为什么方向是这样见 admin-client.ts 文件头
 * （提权进程开的管道，没提权的 AllAi 写不进去）。
 *
 * 链路一断就退出 —— 不能让一个提权进程在后台无主地挂着。
 *
 * 协议：一行一条 JSON。stdout/stderr 用 base64，避免编码和换行把帧切坏。
 */
type Inbound =
  | {
      id: string;
      op: "spawn";
      file: string;
      args: string[];
      cwd: string;
      env?: Record<string, string>;
      stdin?: boolean;
      verbatim?: boolean;
    }
  | { id: string; op: "write"; data: string }
  | { id: string; op: "kill" }
  | { id: string; op: "shutdown" };

const pipe = process.argv[2];
const secret = process.argv[3];
if (!pipe || !secret) {
  process.stderr.write("admin-host: usage: admin-host <pipe> <secret>\n");
  process.exit(1);
}

const children = new Map<string, ChildProcess>();
let connected = false;

function shutdown(code: number) {
  for (const child of children.values()) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  children.clear();
  process.exit(code);
}

const socket = net.connect(pipe);

function send(payload: Record<string, unknown>) {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(payload)}\n`);
}

socket.on("connect", () => {
  connected = true;
  send({ hello: secret });
});
socket.on("error", () => shutdown(1));
socket.on("close", () => shutdown(0));

// 30 秒还没连上（AllAi 已经关了、或者等不及放弃了），就别在后台挂着。
setTimeout(() => {
  if (!connected) shutdown(1);
}, 30_000).unref();

let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index: number;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let msg: Inbound;
    try {
      msg = JSON.parse(line) as Inbound;
    } catch {
      continue;
    }
    if (msg.op === "spawn") {
      try {
        const child = spawn(msg.file, msg.args, {
          cwd: msg.cwd,
          env: { ...process.env, ...(msg.env ?? {}) },
          windowsHide: true,
          stdio: [msg.stdin ? "pipe" : "ignore", "pipe", "pipe"],
          windowsVerbatimArguments: Boolean(msg.verbatim),
        });
        const id = msg.id;
        children.set(id, child);
        child.stdout?.on("data", (data: Buffer) => {
          send({ id, type: "out", data: data.toString("base64") });
        });
        child.stderr?.on("data", (data: Buffer) => {
          send({ id, type: "err", data: data.toString("base64") });
        });
        child.on("error", (error) => {
          send({ id, type: "error", message: error.message });
        });
        child.on("close", (code) => {
          children.delete(id);
          send({ id, type: "exit", code: code ?? 0 });
        });
        send({ id, type: "spawned", pid: child.pid ?? 0 });
      } catch (error) {
        send({
          id: msg.id,
          type: "error",
          message: error instanceof Error ? error.message : "无法启动进程",
        });
      }
      continue;
    }
    if (msg.op === "write") {
      const child = children.get(msg.id);
      if (!child?.stdin) continue;
      try {
        if (!msg.data) child.stdin.end();
        else child.stdin.write(Buffer.from(msg.data, "base64"));
      } catch {
        // ignore
      }
      continue;
    }
    if (msg.op === "kill") {
      const child = children.get(msg.id);
      children.delete(msg.id);
      try {
        child?.kill();
      } catch {
        // ignore
      }
      continue;
    }
    if (msg.op === "shutdown") shutdown(0);
  }
});
