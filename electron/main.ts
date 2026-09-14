import { ChildProcess, spawn } from "child_process";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import fs from "fs";
import net from "net";
import path from "path";
import { destroyChatGpt, hideChatGpt, showChatGpt } from "./chatgpt-view";
import { openLogStream } from "./log";
import {
  beginComputer,
  captureScreen,
  computerInfo,
  pauseComputer,
  resumeComputer,
  runAction,
  stopComputer,
  type ComputerAction,
  type ComputerShotContext,
} from "./computer";
import { detectClis } from "./detect";
import { loadMessages, readContextUsage, scanHistory, type AgentWork } from "./history";
import { fetchOfficialQuota } from "./quota";
import { mergeWorks, scanLive } from "./live";
import {
  adminEnsure,
  adminLinkStatus,
  attach,
  cliAuthLogin,
  cliAuthLogout,
  cliAuthStatus,
  cliListModels,
  deleteWork,
  kill,
  killAll,
  listSessions,
  loginAgent,
  officialChat,
  officialProbe,
  promptChat,
  resize,
  start,
  unwatchWork,
  watchWork,
  write,
} from "./pty";
import { initRemote, stopRemote } from "./remote";
import { cliUpdateState, initCliUpdate, setCliAutoUpdate, updateClis } from "./cli-update";
import {
  appUpdateState,
  checkAppUpdate,
  initAppUpdate,
  installAppUpdate,
  setAppAutoUpdate,
} from "./app-update";
import { scanLocalUsage } from "./usage-scan";
import { importCcSwitch, previewCcSwitch } from "./cc-switch";
import { setNotifyWindow, showNotice, windowFocused } from "./notify";

let nextProcess: ChildProcess | null = null;

let mainWindow: BrowserWindow | null = null;
/** 界面所在的本机地址。远程控制要借它读上传文件、调创作接口。 */
let rendererUrl: string | null = null;

function isDev() {
  return !app.isPackaged;
}

async function waitForRenderer(url: string, timeoutMs = 40000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`等不到界面：${url}`);
}

function pickPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法分配端口"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function findServerJs(root: string) {
  const direct = path.join(root, "server.js");
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(root)) {
    throw new Error("找不到界面资源，请重新安装 AllAi");
  }
  for (const name of fs.readdirSync(root)) {
    const nested = path.join(root, name, "server.js");
    if (fs.existsSync(nested)) return nested;
  }
  throw new Error("找不到界面服务，请重新安装 AllAi");
}

async function startStandalone() {
  const port = await pickPort();
  const standalone = path.join(process.resourcesPath, "standalone");
  const serverJs = findServerJs(standalone);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";

  // 路径、轮转、ALLAI_DATA_DIR 都在 electron/log.ts，终端宿主也写同一份。
  const log = openLogStream();
  log.write(
    `\n[${new Date().toISOString()}] starting ${process.execPath} ${serverJs} :${port}\n`,
  );

  nextProcess = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  nextProcess.stdout?.on("data", (chunk) => log.write(chunk));
  nextProcess.stderr?.on("data", (chunk) => log.write(chunk));
  const url = `http://127.0.0.1:${port}`;
  await waitForRenderer(url, 60000);
  return url;
}

function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function localPathFromHref(href: string, cwd?: string) {
  let raw = href.trim().replace(/^<|>$/g, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  if (raw.startsWith("file:")) {
    try {
      raw = new URL(raw).pathname;
      if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1);
      raw = raw.replace(/\//g, path.sep);
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)) return null;
  const resolved = path.isAbsolute(raw) ? raw : cwd ? path.resolve(cwd, raw) : raw;
  try {
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    return null;
  }
  return null;
}

function revealLocal(href: string, cwd?: string) {
  const target = localPathFromHref(href, cwd);
  if (!target) return false;
  try {
    if (fs.statSync(target).isDirectory()) void shell.openPath(target);
    else shell.showItemInFolder(target);
    return true;
  } catch {
    return false;
  }
}

function safeExternalUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function uiThemeFile() {
  return path.join(app.getPath("userData"), "ui-theme");
}

function splashTheme(): "dark" | "light" {
  try {
    const stored = fs.readFileSync(uiThemeFile(), "utf8").trim();
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // 还没存过就跟系统
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

async function createWindow() {
  const theme = splashTheme();
  const splashBg = theme === "light" ? "#f4f4f5" : "#09090b";
  const splashFg = theme === "light" ? "#3f3f46" : "#a1a1aa";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: "AllAi",
    icon: isDev() ? path.join(app.getAppPath(), "packaging", "icon.png") : path.join(process.resourcesPath, "icon.png"),
    backgroundColor: splashBg,
    autoHideMenuBar: true,
    // 用自己的标题栏：系统那条会跟着 Windows 主题色变，和皮肤对不上。
    frame: false,
    backgroundMaterial: "none",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!revealLocal(url) && safeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    dialog.showErrorBox("AllAi 界面加载失败", `${desc} (${code})\n${url}`);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    setNotifyWindow(null);
  });
  setNotifyWindow(mainWindow);
  // 最大化状态要同步给界面，按钮图标得跟着变。
  const pushWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state", { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on("maximize", pushWindowState);
  mainWindow.on("unmaximize", pushWindowState);
  mainWindow.on("enter-full-screen", pushWindowState);
  mainWindow.on("leave-full-screen", pushWindowState);

  await mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${splashBg};color:${splashFg};font-family:Segoe UI,sans-serif"><div>AllAi 启动中…</div></body></html>`,
      ),
  );
  revealWindow();

  const url = isDev()
    ? process.env.ALLAI_DEV_URL || "http://localhost:3000"
    : await startStandalone();
  if (isDev()) {
    await waitForRenderer(url.replace("localhost", "127.0.0.1"));
  }
  rendererUrl = url.replace("localhost", "127.0.0.1");
  await mainWindow.loadURL(url);
  revealWindow();
}

function registerIpc() {
  ipcMain.handle("cli:detect", () => detectClis());
  // 设置 → 关于：更新本机 CLI。真正干活在 cli-update.ts，这里只转发。
  ipcMain.handle("cli:update", (_event, kinds?: string[]) => updateClis(kinds));
  ipcMain.handle("cli:update-state", () => cliUpdateState());
  /*
   * 本机所有 CLI 的用量统计。扫会话文件是同步的（实测 220 个文件首轮 1.6 秒、
   * 之后增量 18 毫秒），放主进程里跑；界面只管叫它，不碰那 400 多兆文件。
   */
  ipcMain.handle("usage:scan", () => scanLocalUsage());
  ipcMain.handle("usage:cc-switch", (_event, doImport: boolean) =>
    doImport ? importCcSwitch() : previewCcSwitch(),
  );
  ipcMain.handle("cli:auto-update", (_event, value: boolean) => setCliAutoUpdate(Boolean(value)));
  // 设置 → 关于：更新 AllAi 自己。真正干活在 app-update.ts，这里只转发。
  ipcMain.handle("app:update-check", () => checkAppUpdate());
  ipcMain.handle("app:update-state", () => appUpdateState());
  ipcMain.handle("app:update-install", () => installAppUpdate());
  ipcMain.handle("app:auto-update", (_event, value: boolean) => setAppAutoUpdate(Boolean(value)));
  ipcMain.handle("dialog:folder", async () => {
    const options = {
      title: "选择工作目录",
      properties: ["openDirectory" as const, "createDirectory" as const],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("pty:start", (_event, opts) => start(opts));
  ipcMain.handle("pty:kill", (_event, sessionId: string) => {
    kill(sessionId);
  });
  ipcMain.handle("pty:attach", (_event, sessionId: string) => attach(sessionId));
  ipcMain.handle("pty:list", () => listSessions());
  ipcMain.on("pty:write", (_event, sessionId: string, data: string) => write(sessionId, data));
  ipcMain.on("pty:resize", (_event, sessionId: string, cols: number, rows: number) => {
    resize(sessionId, cols, rows);
  });
  ipcMain.handle("agent:history", () => scanHistory());
  ipcMain.handle("agent:live", () => scanLive());
  ipcMain.handle("agent:works", async () => {
    const [history, live] = await Promise.all([scanHistory(), scanLive()]);
    return mergeWorks(history, live);
  });
  ipcMain.handle("agent:messages", (_event, work: AgentWork) => loadMessages(work));
  ipcMain.handle("agent:context", (_event, work: AgentWork) => readContextUsage(work));

  // Computer Use：先绑定目标窗口，再只截/操作那一个窗口。
  ipcMain.handle("computer:begin", () => beginComputer(mainWindow));
  ipcMain.handle("computer:screenshot", () => captureScreen());
  ipcMain.handle(
    "computer:act",
    (_event, action: ComputerAction, shot: ComputerShotContext) =>
      runAction(action, shot),
  );
  ipcMain.handle("computer:pause", () => pauseComputer(mainWindow));
  ipcMain.handle("computer:resume", () => resumeComputer(mainWindow));
  ipcMain.handle("computer:info", () => computerInfo());
  ipcMain.handle("computer:stop", () => {
    stopComputer();
    void pauseComputer(mainWindow);
    return { ok: true };
  });
  // 管理员宿主由终端宿主管理（本机 CLI 都在那边 spawn），这里只转发。
  // 带 elevated 的聊天/Agent 请求，终端宿主自己会先把管理员宿主连上。
  ipcMain.handle("admin:ensure", () => adminEnsure());
  ipcMain.handle("admin:status", () => adminLinkStatus());
  ipcMain.handle("agent:prompt", (_event, opts) => promptChat(opts));
  ipcMain.handle("agent:login", (_event, agentId: string) => loginAgent(agentId));
  ipcMain.handle("agent:delete-work", (_event, work) => deleteWork(work));
  ipcMain.handle("window:state", () => ({
    maximized: Boolean(mainWindow?.isMaximized()),
  }));
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.on("theme:resolved", (_event, theme: string) => {
    const next = theme === "light" ? "light" : "dark";
    try {
      fs.writeFileSync(uiThemeFile(), next, "utf8");
    } catch {
      // 写不进去下次启动就跟系统
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(next === "light" ? "#f4f4f5" : "#09090b");
    }
  });
  ipcMain.handle("agent:watch-work", (_event, work) => watchWork(work));
  ipcMain.handle("agent:unwatch-work", () => unwatchWork());
  ipcMain.handle("cli:auth-status", (_event, kind: string, command?: string) =>
    cliAuthStatus(kind, command),
  );
  ipcMain.handle("cli:auth-login", (_event, kind: string, command?: string) =>
    cliAuthLogin(kind, command),
  );
  ipcMain.handle("cli:auth-logout", (_event, kind: string, command?: string) =>
    cliAuthLogout(kind, command),
  );
  ipcMain.handle("cli:models", (_event, kind: string, command?: string) =>
    cliListModels(kind, command),
  );
  ipcMain.handle("official:chat", (_event, opts) => officialChat(opts));
  ipcMain.handle("official:probe", (_event, opts) => officialProbe(opts));
  ipcMain.handle(
    "chatgpt:show",
    (event, bounds: { x: number; y: number; width: number; height: number }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      showChatGpt(win, bounds);
    },
  );
  ipcMain.handle("chatgpt:hide", () => hideChatGpt());
  ipcMain.handle("shell:reveal", (_event, href: string, cwd?: string) => revealLocal(href, cwd));
  ipcMain.handle("quota:official", () => fetchOfficialQuota());
  ipcMain.handle("notify:show", (_event, payload: { title?: string; body?: string; evenIfFocused?: boolean }) => {
    if (!payload?.title) return { shown: false };
    if (!payload.evenIfFocused && windowFocused()) return { shown: false };
    return { shown: showNotice(String(payload.title), String(payload.body || "")) };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    revealWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.allai.desktop");
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || permission === "clipboard-sanitized-write");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media" || permission === "clipboard-sanitized-write";
    });
    registerIpc();
    initRemote({ getWindow: () => mainWindow, getLocalUrl: () => rendererUrl });
    // 本机用量：启动 8 秒后扫一次，之后每 5 分钟补扫（增量，几十毫秒）。
    setTimeout(() => {
      try {
        scanLocalUsage();
      } catch {
        // 扫不动不影响用
      }
      setInterval(() => {
        try {
          scanLocalUsage();
        } catch {
          // 同上
        }
      }, 5 * 60_000).unref?.();
    }, 8000).unref?.();
    // 官方额度：每 5 分钟问一次，fetchOfficialQuota 里顺手记进 quota-history.json。
    // 「额度监控」算速度、预测用完时间都靠这份历史 —— 不管设置页开没开都得记。
    setTimeout(() => {
      const sample = () => void fetchOfficialQuota().catch(() => undefined);
      sample();
      setInterval(sample, 5 * 60_000).unref?.();
    }, 15_000).unref?.();
    // 开着「启动时自动更新」就在后台把本机 CLI 都更新一遍（等 20 秒，别和启动抢资源）。
    initCliUpdate((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("cli:update-state", state);
    });
    // AllAi 自己：启动 30 秒后查一次新版本，查到就地后台下载（见 app-update.ts）。
    initAppUpdate((state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:update-state", state);
    });
    try {
      await createWindow();
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      dialog.showErrorBox("AllAi 启动失败", message);
      app.quit();
    }
  });

  app.on("before-quit", () => {
    stopRemote();
    destroyChatGpt();
    killAll();
    nextProcess?.kill();
  });

  app.on("window-all-closed", () => {
    killAll();
    app.quit();
  });
}
