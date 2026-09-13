import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import {
  app,
  type BrowserWindow,
  type NativeImage,
  nativeImage,
  screen,
} from "electron";

/**
 * Computer Use 的能力层。
 *
 * 0.14.x 只截主屏再按整屏坐标盲点：AllAi 自己经常挡住目标，多显示器和小控件也容易偏。
 * 这里改成先锁定一个目标窗口，之后只截那个窗口；每次输入前都重新激活并核对句柄。
 * 模型给的坐标始终是“目标窗口截图”的相对坐标，DPI 和窗口位置统一在这里换算。
 */

const SHOT_WIDTH = 1600;
const SHOT_HEIGHT = 1200;

export type ComputerTarget = {
  id: string;
  pid: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ComputerShotContext = {
  width: number;
  height: number;
  target: ComputerTarget;
};

export type ComputerControl = {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ComputerWindow = Pick<ComputerTarget, "id" | "pid" | "title" | "x" | "y" | "width" | "height">;

export type ComputerAction =
  | { op: "switch"; id: string }
  | { op: "element"; id: number; action?: "invoke" | "focus" | "toggle" | "expand" | "select" }
  | { op: "move"; x: number; y: number }
  | { op: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { op: "drag"; x: number; y: number; toX: number; toY: number }
  | { op: "scroll"; x?: number; y?: number; amount: number }
  | { op: "text"; text: string; element?: number; x?: number; y?: number; submit?: boolean }
  | { op: "key"; keys: string }
  | { op: "cursor" }
  | { op: "foreground" };

type Reply = {
  ok: boolean;
  id?: number;
  error?: string;
  ready?: boolean;
  cls?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  title?: string;
  w?: number;
  h?: number;
  handle?: string;
  pid?: number;
  controls?: {
    id?: number;
    type?: string;
    name?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }[];
  windows?: Reply[];
  data?: string;
};

let host: ChildProcess | null = null;
let pending: { id: number; resolve: (reply: Reply) => void }[] = [];
let nextCallId = 1;
let buffer = "";
let physical = { width: 0, height: 0 };
let target: ComputerTarget | null = null;
let previousSignature: Uint8Array | null = null;
let previousTargetId = "";
let knownWindows = new Map<string, ComputerWindow>();
const SHELL_TITLES = new Set(["", "program manager", "windows input experience"]);

function hostScript() {
  const candidates = [
    path.join(process.resourcesPath || "", "computer.ps1"),
    path.join(app.getAppPath(), "electron", "computer.ps1"),
    path.join(__dirname, "computer.ps1"),
  ];
  for (const file of candidates) {
    if (!file || file.includes(".asar")) continue;
    if (fs.existsSync(file)) return file;
  }
  return "";
}

function settle(reply: Reply) {
  const id = typeof reply.id === "number" ? reply.id : null;
  if (id == null) {
    const next = pending.shift();
    if (next) next.resolve(reply);
    return;
  }
  const at = pending.findIndex((item) => item.id === id);
  if (at < 0) return;
  const [waiter] = pending.splice(at, 1);
  waiter.resolve(reply);
}

export function stopComputer() {
  const current = host;
  host = null;
  pending.forEach((item) => item.resolve({ ok: false, error: "已停止" }));
  pending = [];
  buffer = "";
  physical = { width: 0, height: 0 };
  target = null;
  previousSignature = null;
  previousTargetId = "";
  knownWindows.clear();
  if (!current) return;
  try {
    current.stdin?.write("quit\n");
  } catch {
    // process may already be gone
  }
  setTimeout(() => {
    try {
      current.kill();
    } catch {
      // already gone
    }
  }, 300);
}

async function ensureHost(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (host && !host.killed && physical.width && physical.height) return { ok: true };
  if (host) {
    try {
      host.kill();
    } catch {
      // 上一份宿主卡死了，先清掉再起
    }
    host = null;
  }
  const script = hostScript();
  if (!script) {
    return {
      ok: false,
      error: "找不到输入宿主脚本 computer.ps1（必须是 resources 下的真实文件）",
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    host = child;
    pending = [];
    buffer = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("{")) continue;
        let reply: Reply;
        try {
          reply = JSON.parse(line) as Reply;
        } catch {
          continue;
        }
        if (reply.ready) {
          physical = { width: reply.width || 0, height: reply.height || 0 };
          if (!settled) {
            settled = true;
            resolve({ ok: true });
          }
          continue;
        }
        settle(reply);
      }
    });
    child.on("error", (error) => {
      if (host === child) host = null;
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: error.message });
      }
    });
    child.on("exit", () => {
      if (host === child) host = null;
      pending.forEach((item) => item.resolve({ ok: false, error: "输入宿主已退出" }));
      pending = [];
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      if (host === child) {
        try {
          child.kill();
        } catch {
          // already gone
        }
        host = null;
      }
      resolve({ ok: false, error: "输入宿主 8 秒内没有就绪" });
    }, 8000);
  });
}

function call(command: Record<string, unknown>, timeoutMs = 10_000): Promise<Reply> {
  return new Promise((resolve) => {
    if (!host?.stdin) return resolve({ ok: false, error: "输入宿主没在跑" });
    const id = nextCallId++;
    const waiter = {
      id,
      resolve: (reply: Reply) => {
        clearTimeout(timer);
        resolve(reply);
      },
    };
    const timer = setTimeout(() => {
      const at = pending.findIndex((item) => item.id === id);
      if (at < 0) return;
      pending.splice(at, 1);
      resolve({ ok: false, error: `${String(command.op || "动作")}超时` });
    }, timeoutMs);
    pending.push(waiter);
    try {
      host.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    } catch (error) {
      pending = pending.filter((item) => item.id !== id);
      clearTimeout(timer);
      resolve({ ok: false, error: error instanceof Error ? error.message : "写入失败" });
    }
  });
}

function targetFromReply(reply: Reply): ComputerTarget | null {
  if (
    !reply.ok ||
    !reply.handle ||
    !reply.pid ||
    typeof reply.x !== "number" ||
    typeof reply.y !== "number" ||
    typeof reply.w !== "number" ||
    typeof reply.h !== "number" ||
    reply.w <= 0 ||
    reply.h <= 0
  ) {
    return null;
  }
  return {
    id: reply.handle,
    pid: reply.pid,
    title: reply.title || "(无标题)",
    x: reply.x,
    y: reply.y,
    width: reply.w,
    height: reply.h,
  };
}

async function foreground() {
  return targetFromReply(await call({ op: "foreground" }));
}

function isUsableTarget(item: ComputerTarget, cls?: string) {
  if (item.pid === process.pid) return false;
  if (item.width < 80 || item.height < 80) return false;
  const title = item.title.trim().toLowerCase();
  if (SHELL_TITLES.has(title)) return false;
  if (title === "allai") return false;
  const kind = (cls || "").toLowerCase();
  if (
    kind === "shell_traywnd" ||
    kind === "shell_secondarytraywnd" ||
    kind === "progman" ||
    kind === "workerw" ||
    kind === "foregroundstaging" ||
    kind === "windows.ui.core.corewindow"
  ) {
    return false;
  }
  return true;
}

async function focusTarget(): Promise<
  { ok: true; target: ComputerTarget } | { ok: false; error: string }
> {
  if (!target) return { ok: false, error: "还没有锁定目标窗口" };
  const reply = await call({ op: "focus", handle: target.id, pid: target.pid });
  if (!reply.ok) return { ok: false, error: reply.error || "无法激活目标窗口" };
  const active = targetFromReply(reply);
  if (!active) return { ok: false, error: "无法核对当前前台窗口" };
  // 同一进程弹出的对话框要跟过去；不同进程说明用户或系统切走了，不能盲打。
  if (active.pid !== target.pid) {
    return { ok: false, error: `前台窗口已变成「${active.title}」，已阻止盲目输入` };
  }
  target = active;
  return { ok: true, target: active };
}

/**
 * 用户按下发送后先把 AllAi 最小化，让 Windows 恢复发送前位于它后面的窗口。
 * 那个窗口成为本次任务的目标；后续截图和输入都绑定它，不再截整块桌面碰运气。
 */
export async function beginComputer(mainWindow: BrowserWindow | null): Promise<
  { ok: true; target: ComputerTarget } | { ok: false; error: string }
> {
  const started = await ensureHost();
  if (!started.ok) return started;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  const deadline = Date.now() + 1800;
  let last: ComputerTarget | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    const reply = await call({ op: "foreground" });
    const active = targetFromReply(reply);
    last = active;
    if (active && isUsableTarget(active, reply.cls)) {
      target = active;
      previousSignature = null;
      previousTargetId = "";
      return { ok: true, target: active };
    }
  }
  if (last && last.pid === process.pid) {
    return { ok: false, error: "没有找到 AllAi 后面的目标窗口，请先打开要操作的应用" };
  }
  return {
    ok: false,
    error: last
      ? `「${last.title}」不能作为操作目标，请先点开要操作的应用`
      : "没有找到 AllAi 后面的目标窗口，请先打开要操作的应用",
  };
}

export async function pauseComputer(mainWindow: BrowserWindow | null) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export async function resumeComputer(mainWindow: BrowserWindow | null) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return focusTarget();
}

function signature(image: NativeImage) {
  const bitmap = image.resize({ width: 64, height: 40, quality: "good" }).toBitmap();
  const out = new Uint8Array(64 * 40);
  for (let pixel = 0; pixel < out.length; pixel++) {
    const at = pixel * 4;
    out[pixel] = Math.round((bitmap[at] + bitmap[at + 1] + bitmap[at + 2]) / 3);
  }
  return out;
}

function changedRatio(before: Uint8Array | null, after: Uint8Array) {
  if (!before || before.length !== after.length) return undefined;
  let changed = 0;
  for (let index = 0; index < after.length; index++) {
    if (Math.abs(before[index] - after[index]) >= 12) changed++;
  }
  return changed / after.length;
}

export type Screenshot = ComputerShotContext & {
  dataUrl: string;
  /** 与上一帧相比发生明显变化的采样像素比例。 */
  changedRatio?: number;
  /** Windows UI Automation 暴露的可交互控件，坐标已经换成截图坐标。 */
  controls?: ComputerControl[];
  windows?: { id: string; title: string }[];
};

export async function captureScreen(): Promise<
  { ok: true; shot: Screenshot } | { ok: false; error: string }
> {
  try {
    const started = await ensureHost();
    if (!started.ok) return started;
    const focused = await focusTarget();
    if (!focused.ok) return focused;
    const current = focused.target;

    /*
     * 不再用 desktopCapturer 的 source.id/title 去猜目标窗口。不同 Electron/Chromium
     * 版本和部分应用给出的窗口源 id 格式、标题都不稳定，会出现 begin 已锁定成功、
     * 下一行却“找不到目标窗口”的假失败。输入宿主已经掌握真实 HWND 和物理矩形，
     * 直接从屏幕按该矩形抓图最可靠，也天然支持负坐标和不同 DPI 的显示器。
     */
    const captured = await call(
      {
        op: "capture",
        handle: current.id,
        pid: current.pid,
        maxWidth: SHOT_WIDTH,
        maxHeight: SHOT_HEIGHT,
      },
      15_000,
    );
    if (!captured.ok || !captured.data) {
      return { ok: false, error: captured.error || `无法读取目标窗口「${current.title}」的画面` };
    }
    const capturedTarget = targetFromReply(captured);
    if (!capturedTarget || capturedTarget.pid !== current.pid) {
      return { ok: false, error: "截图时目标窗口已经切换，已停止本次操作" };
    }
    target = capturedTarget;
    const image = nativeImage.createFromBuffer(Buffer.from(captured.data, "base64"));
    if (image.isEmpty()) return { ok: false, error: "目标窗口截图为空" };
    const size = image.getSize();
    const nextSignature = signature(image);
    const change =
      previousTargetId === capturedTarget.id ? changedRatio(previousSignature, nextSignature) : undefined;
    previousSignature = nextSignature;
    previousTargetId = capturedTarget.id;

    const inspected = await call({ op: "inspect", handle: capturedTarget.id }, 20_000);
    const controls: ComputerControl[] = inspected.ok
      ? (inspected.controls ?? [])
          .flatMap((item) => {
            if (
              typeof item.id !== "number" ||
              typeof item.x !== "number" ||
              typeof item.y !== "number" ||
              typeof item.w !== "number" ||
              typeof item.h !== "number" ||
              item.w <= 0 ||
              item.h <= 0
            ) {
              return [];
            }
            return [{
              id: item.id,
              type: item.type || "Control",
              name: (item.name || "").replace(/\s+/g, " ").trim().slice(0, 100),
              x: Math.round(((item.x - capturedTarget.x) / capturedTarget.width) * size.width),
              y: Math.round(((item.y - capturedTarget.y) / capturedTarget.height) * size.height),
              width: Math.max(1, Math.round((item.w / capturedTarget.width) * size.width)),
              height: Math.max(1, Math.round((item.h / capturedTarget.height) * size.height)),
            }];
          })
          .filter(
            (item) =>
              item.x + item.width > 0 &&
              item.y + item.height > 0 &&
              item.x < size.width &&
              item.y < size.height,
          )
      : [];
    const listed = await call({ op: "windows" });
    const windows = (listed.windows ?? [])
      .map(targetFromReply)
      .filter((item): item is ComputerTarget => Boolean(item))
      .filter((item) => item.pid !== process.pid && item.id !== capturedTarget.id)
      .slice(0, 30);
    knownWindows = new Map(windows.map((item) => [item.id, item]));

    return {
      ok: true,
      shot: {
        dataUrl: `data:image/jpeg;base64,${image.toJPEG(78).toString("base64")}`,
        width: size.width,
        height: size.height,
        target: capturedTarget,
        changedRatio: change,
        controls: controls.length ? controls : undefined,
        windows: windows.length
          ? windows.map((item) => ({ id: item.id, title: item.title }))
          : undefined,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "截屏失败" };
  }
}

function inRange(value: number, max: number) {
  return Number.isFinite(value) && value >= 0 && value < max;
}

function validateCoordinates(action: ComputerAction, shot: ComputerShotContext) {
  if (action.op === "click" || action.op === "move") {
    return inRange(action.x, shot.width) && inRange(action.y, shot.height);
  }
  if (action.op === "drag") {
    return (
      inRange(action.x, shot.width) &&
      inRange(action.y, shot.height) &&
      inRange(action.toX, shot.width) &&
      inRange(action.toY, shot.height)
    );
  }
  if (action.op === "scroll" && action.x !== undefined && action.y !== undefined) {
    return inRange(action.x, shot.width) && inRange(action.y, shot.height);
  }
  if (action.op === "text" && action.x !== undefined && action.y !== undefined) {
    return inRange(action.x, shot.width) && inRange(action.y, shot.height);
  }
  return true;
}

export async function runAction(
  action: ComputerAction,
  shot: ComputerShotContext,
): Promise<
  | { ok: true; cursor?: { x: number; y: number }; foreground?: ComputerTarget }
  | { ok: false; error: string }
> {
  const started = await ensureHost();
  if (!started.ok) return started;
  if (!target) return { ok: false, error: "还没有锁定目标窗口" };

  if (action.op === "foreground") {
    const active = await foreground();
    return active
      ? { ok: true, foreground: active }
      : { ok: false, error: "拿不到前台窗口" };
  }
  if (action.op === "cursor") {
    const reply = await call({ op: "cursor" });
    return reply.ok && typeof reply.x === "number" && typeof reply.y === "number"
      ? { ok: true, cursor: { x: reply.x, y: reply.y } }
      : { ok: false, error: reply.error || "拿不到鼠标位置" };
  }
  if (action.op === "switch") {
    const picked = knownWindows.get(action.id);
    if (!picked) return { ok: false, error: "窗口编号已失效，需要重新观察" };
    target = picked;
    previousSignature = null;
    previousTargetId = "";
    const focused = await focusTarget();
    return focused.ok ? { ok: true } : focused;
  }

  const focused = await focusTarget();
  if (!focused.ok) return focused;
  if (focused.target.id !== shot.target.id) {
    return {
      ok: false,
      error: `目标窗口已切换到「${focused.target.title}」，需要重新截图定位`,
    };
  }
  if (!validateCoordinates(action, shot)) {
    return { ok: false, error: "模型给的坐标落在目标窗口截图之外，已阻止执行" };
  }

  const px = (value: number) =>
    Math.round(shot.target.x + (value / shot.width) * shot.target.width);
  const py = (value: number) =>
    Math.round(shot.target.y + (value / shot.height) * shot.target.height);

  let command: Record<string, unknown>;
  switch (action.op) {
    case "element":
      command = { op: "element", id: action.id, action: action.action ?? "invoke" };
      break;
    case "move":
      command = { op: "move", x: px(action.x), y: py(action.y) };
      break;
    case "click":
      command = {
        op: "click",
        x: px(action.x),
        y: py(action.y),
        button: action.button ?? "left",
        double: Boolean(action.double),
      };
      break;
    case "drag":
      command = {
        op: "drag",
        x: px(action.x),
        y: py(action.y),
        toX: px(action.toX),
        toY: py(action.toY),
      };
      break;
    case "scroll":
      command = {
        op: "scroll",
        x: action.x === undefined ? null : px(action.x),
        y: action.y === undefined ? null : py(action.y),
        amount: action.amount,
      };
      break;
    case "text":
      command = {
        op: "text",
        b64: Buffer.from(action.text, "utf8").toString("base64"),
        element: action.element ?? null,
        x: action.x === undefined ? null : px(action.x),
        y: action.y === undefined ? null : py(action.y),
        submit: Boolean(action.submit),
      };
      break;
    case "key":
      command = { op: "key", keys: action.keys };
      break;
    default:
      return { ok: false, error: "不认识的动作" };
  }

  const reply = await call(command);
  return reply.ok ? { ok: true } : { ok: false, error: reply.error || "动作失败" };
}

export function computerInfo() {
  const display = screen.getPrimaryDisplay();
  return {
    running: Boolean(host && !host.killed),
    script: hostScript(),
    logical: display.size,
    physical: physical.width ? physical : null,
    shotWidth: SHOT_WIDTH,
    target,
  };
}
