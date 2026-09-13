import { EventEmitter } from "events";
import { execFileSync, spawn } from "child_process";
import { randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import net from "net";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";

/**
 * 管理员宿主的链路。跑在**终端宿主**进程里 —— 本机 CLI 都是在那里 spawn 的。
 *
 * 方向是反的：**AllAi 这边开管道，管理员宿主连过来**。
 *
 * 为什么不能让提权的宿主开管道：提权进程用默认安全描述符建的管道，owner 是
 * Administrators 组；而没提权的 AllAi 令牌里 Administrators 是 deny-only，只剩
 * Everyone 那一条 —— 只读。连上去一写就被拒，UAC 点了「是」也永远连不上（0.15.4 修的）。
 * 反过来就没这个问题：我们建的管道 owner 是当前用户，提权宿主的令牌里既有这个用户、
 * 也有启用的 Administrators，两条 ACE 都给完全控制。
 *
 * 也**不能**图省事给管道开 `writableAll`：那会给 Everyone 读写 + 建实例的权限，
 * 这台机器上任何账号都能连上来，让管理员宿主替它以管理员身份跑任意命令；
 * 管道名还能被枚举出来。
 *
 * 认证：每次随机生成管道名和一次性密钥。密钥放在管理员宿主的命令行里 ——
 * 没提权的进程读不到提权进程的命令行。宿主连上来第一行必须带对密钥，否则直接断开。
 * 链路建好后立刻停止监听，之后谁也连不进来。
 */

export type EnsureResult = { ok: true; elevated: boolean } | { ok: false; error: string };

type Inbound = {
  id?: string;
  type?: string;
  data?: string;
  code?: number;
  message?: string;
  pid?: number;
};

type Link = { socket: net.Socket; children: Map<string, AdminChild> };

let link: Link | null = null;
let connecting: Promise<EnsureResult> | null = null;
let elevatedCache: boolean | null = null;

/** 进程的提权状态一辈子不会变，`net session` 又要起一个进程，缓存起来。 */
export function processIsElevated() {
  if (process.platform !== "win32") return false;
  if (elevatedCache !== null) return elevatedCache;
  try {
    execFileSync("net", ["session"], { windowsHide: true, stdio: "ignore" });
    elevatedCache = true;
  } catch {
    elevatedCache = false;
  }
  return elevatedCache;
}

export function adminLinkStatus() {
  return {
    elevated: processIsElevated(),
    linked: Boolean(link && !link.socket.destroyed),
    script: process.env.ALLAI_ADMIN_HOST_SCRIPT || "",
  };
}

/**
 * 确保管理员宿主已经连上。已经是管理员就什么都不用做；否则弹一次 UAC。
 * 开关和发消息同时触发时只弹一次。
 */
export function ensureAdminLink(): Promise<EnsureResult> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "管理员权限只在 Windows 上可用" });
  }
  if (processIsElevated()) return Promise.resolve({ ok: true, elevated: true });
  if (link && !link.socket.destroyed) return Promise.resolve({ ok: true, elevated: false });
  if (!connecting) {
    connecting = connect().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

export function stopAdminLink() {
  const current = link;
  link = null;
  if (!current) return;
  try {
    current.socket.write(`${JSON.stringify({ id: "shutdown", op: "shutdown" })}\n`);
    current.socket.end();
  } catch {
    current.socket.destroy();
  }
}

function sameSecret(given: unknown, secret: string) {
  if (typeof given !== "string" || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

async function connect(): Promise<EnsureResult> {
  const script = process.env.ALLAI_ADMIN_HOST_SCRIPT || "";
  const node = process.env.ALLAI_NODE_EXE || "node";
  if (!script || !fs.existsSync(script)) {
    return {
      ok: false,
      error: "找不到管理员宿主 admin-host.js（它必须是 resources 下的真实文件，不能在 app.asar 里）",
    };
  }

  const pipe = `\\\\.\\pipe\\allai-admin-${randomBytes(16).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipe, () => resolve());
    });
  } catch (error) {
    return {
      ok: false,
      error: `建不了管理员宿主的管道：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }

  return new Promise<EnsureResult>((resolve) => {
    let settled = false;
    const finish = (result: EnsureResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 不管成没成，都不再接受新连接。链路（如果建好了）不受影响。
      server.close();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: "60 秒内没有等到管理员授权。再点一次「管理员」，在系统弹窗里选「是」。",
        }),
      60_000,
    );

    server.on("connection", (socket) => {
      if (settled) {
        socket.destroy();
        return;
      }
      let buffer = "";
      const onHello = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const index = buffer.indexOf("\n");
        if (index < 0) {
          if (buffer.length > 4096) socket.destroy();
          return;
        }
        socket.off("data", onHello);
        let hello: { hello?: unknown } = {};
        try {
          hello = JSON.parse(buffer.slice(0, index)) as { hello?: unknown };
        } catch {
          // 当作密钥不对处理
        }
        // 不是我们拉起的那个宿主，一个字都不回。
        if (!sameSecret(hello.hello, secret)) {
          socket.destroy();
          return;
        }
        adopt(socket, buffer.slice(index + 1));
        finish({ ok: true, elevated: false });
      };
      socket.on("data", onHello);
      socket.on("error", () => socket.destroy());
    });

    void launch(node, script, pipe, secret).then((launched) => {
      if (!launched.ok) finish(launched);
    });
  });
}

/**
 * 拉起管理员宿主的 PowerShell 脚本。单独拿出来，是为了能在不弹 UAC 的前提下测它：
 * PowerShell 里同名函数会盖过 cmdlet，定义一个假的 Start-Process 就能看到它收到的参数。
 *
 * 退出码约定：0 = 已拉起；2 = 用户在 UAC 里点了「否」；1 = 其它失败（原因写在 stdout）。
 * 取消的判断先认 ERROR_CANCELLED(1223)，再兜底认报错文字 —— 不同系统版本上
 * Start-Process 包不包这一层内部异常不一定。
 */
export function adminLaunchCommand(node: string, script: string, pipe: string, secret: string) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "try {",
    `  Start-Process -FilePath ${psQuote(node)} -Verb RunAs -WindowStyle Hidden -ArgumentList @(${[script, pipe, secret].map(psQuote).join(", ")})`,
    "} catch {",
    "  $e = $_.Exception",
    "  while ($e) { if ($e -is [ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq 1223) { exit 2 }; $e = $e.InnerException }",
    "  if ($_.Exception.Message -match 'cancel|取消') { exit 2 }",
    "  [Console]::Out.WriteLine($_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("\n");
}

/** PowerShell 单引号字符串：只有单引号本身需要转义（写两遍）。 */
function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 拉起管理员宿主。用户在 UAC 里点「否」时 Start-Process 会抛 ERROR_CANCELLED(1223)，
 * 这时立刻告诉用户，别让用户白等 60 秒。
 *
 * `ALLAI_ADMIN_NO_RUNAS=1` 只给自动化测试用：不走 RunAs、直接以当前权限拉起宿主，
 * 用来验证链路和协议（拿不到管理员权限，不会弹窗）。
 */
function launch(
  node: string,
  script: string,
  pipe: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.env.ALLAI_ADMIN_NO_RUNAS === "1") {
    const child = spawn(node, [script, pipe, secret], { windowsHide: true, stdio: "ignore" });
    return new Promise((resolve) => {
      child.once("error", (error) => resolve({ ok: false, error: error.message }));
      child.once("spawn", () => resolve({ ok: true }));
    });
  }

  const command = adminLaunchCommand(node, script, pipe, secret);

  return new Promise((resolve) => {
    let output = "";
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (error) => resolve({ ok: false, error: `拉不起 PowerShell：${error.message}` }));
    child.once("exit", (code) => {
      if (code === 0) return resolve({ ok: true });
      if (code === 2) {
        return resolve({ ok: false, error: "你在系统弹窗里选了「否」，没有获得管理员权限。" });
      }
      resolve({
        ok: false,
        error: `拉起管理员宿主失败：${output.trim().slice(0, 200) || `PowerShell 退出码 ${code}`}`,
      });
    });
  });
}

function adopt(socket: net.Socket, initial: string) {
  const current: Link = { socket, children: new Map() };
  link = current;
  let buffer = initial;
  const drain = () => {
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
      if (msg.id) current.children.get(msg.id)?.handle(msg);
    }
  };
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    drain();
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    if (link === current) link = null;
    for (const child of [...current.children.values()]) child.linkLost();
    current.children.clear();
  });
  if (buffer) drain();
}

/**
 * 在管理员宿主里跑的子进程，对外装成一个 ChildProcess。
 * 事件顺序照真的 ChildProcess 来：正常结束先 `exit` 再 `close`；起不来就 `error` + `close`。
 */
class AdminChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  pid = 0;
  killed = false;
  exitCode: number | null = null;

  constructor(
    readonly id: string,
    private readonly owner: Link | null,
  ) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.post({ op: "write", data: Buffer.from(chunk).toString("base64") });
    });
    this.stdin.on("end", () => this.post({ op: "write", data: "" }));
  }

  post(payload: Record<string, unknown>) {
    if (!this.owner || this.owner.socket.destroyed) return;
    try {
      this.owner.socket.write(`${JSON.stringify({ id: this.id, ...payload })}\n`);
    } catch {
      // 链路断了，close 回调会收尾
    }
  }

  handle(msg: Inbound) {
    if (msg.type === "spawned") {
      this.pid = msg.pid || 0;
    } else if (msg.type === "out" && msg.data) {
      this.stdout.write(Buffer.from(msg.data, "base64"));
    } else if (msg.type === "err" && msg.data) {
      this.stderr.write(Buffer.from(msg.data, "base64"));
    } else if (msg.type === "error") {
      this.fail(msg.message || "管理员宿主报错");
    } else if (msg.type === "exit") {
      this.end(msg.code ?? 0);
    }
  }

  fail(message: string) {
    if (this.exitCode !== null) return;
    this.exitCode = 1;
    this.owner?.children.delete(this.id);
    queueMicrotask(() => {
      this.emit("error", new Error(message));
      this.stdout.end();
      this.stderr.end();
      this.emit("close", 1);
    });
  }

  end(code: number) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.owner?.children.delete(this.id);
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }

  linkLost() {
    this.fail("管理员宿主断开了。再点一次「管理员」重新授权。");
  }

  kill() {
    this.killed = true;
    this.post({ op: "kill" });
    return true;
  }
}

/** 同步返回一个「子进程」，签名和 chat-run 里的 spawn 分支对齐。 */
export function spawnViaAdminHost(
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  wantsStdin?: boolean,
  verbatim?: boolean,
): ChildProcess {
  const current = link && !link.socket.destroyed ? link : null;
  const child = new AdminChild(crypto.randomUUID(), current);
  if (!current) {
    // 调用方应该先 ensureAdminLink()；走到这里说明链路中途断了。
    child.fail("管理员宿主没有连上。再点一次「管理员」重新授权。");
    return child as unknown as ChildProcess;
  }
  current.children.set(child.id, child);
  child.post({
    op: "spawn",
    file,
    args,
    cwd,
    env,
    stdin: Boolean(wantsStdin),
    verbatim: Boolean(verbatim),
  });
  return child as unknown as ChildProcess;
}
