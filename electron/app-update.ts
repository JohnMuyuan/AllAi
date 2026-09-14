/**
 * AllAi 自己的后台更新。跑在主进程里，全程后台，**不弹窗**（产品约定 22）。
 *
 * 更新包发在 GitHub Release（`JohnMuyuan/AllAi`）。仓库地址不用写在这儿 ——
 * 打包时 electron-builder 会把 git remote 里的 owner/repo 写进
 * `resources/app-update.yml`，electron-updater 自己去读那一份。
 *
 * 节奏：启动 30 秒后查一次，之后每 6 小时一次；查到就地后台下载（走 blockmap
 * 差分，通常只有几 MB）。**下好不打断用户** —— 退出 AllAi 时自动装上，
 * 下次打开就是新版本（这就是「重启生效」）。设置 → 关于里能手动查、能立刻重启、能关。
 *
 * 和 `electron/cli-update.ts` 的分工：那个更新的是本机的 Claude Code / Codex /
 * Grok Build，这个更新的是 AllAi 自己。两个状态各存各的文件，别混。
 */
import { app } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import fs from "fs";
import os from "os";
import path from "path";
import { logLine } from "./log";

export type AppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdateState = {
  autoUpdate: boolean;
  status: AppUpdateStatus;
  /** 现在装着的版本（不受「检查」影响的固定值）。 */
  current: string;
  /** 要装的新版本号。 */
  version?: string;
  /** 下载进度 0-100。 */
  percent?: number;
  /** 出错时的原始信息。**不是给人看的中文，不翻、不加工**，原样小字显示。 */
  detail?: string;
  /** 上次检查（或开始检查）的时间。 */
  at?: number;
};

/** 启动后等一会儿再查，别和启动抢资源（和 CLI 更新同一套思路）。 */
const FIRST_CHECK_DELAY = 30_000;
/** 之后多久补查一次。开着好几天也不会一直错过新版本。 */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

let state: AppUpdateState = { autoUpdate: true, status: "idle", current: "" };
let notify: (state: AppUpdateState) => void = () => undefined;
/** 一次只跑一条链路：自动查和手动点可能撞在一起。 */
let busy = false;

function stateFile() {
  return path.join(
    process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai"),
    "app-update.json",
  );
}

function save() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({
        autoUpdate: state.autoUpdate,
        status: state.status,
        version: state.version,
        detail: state.detail,
        at: state.at,
      }),
    );
  } catch {
    // 写不进去只是下次看不到上次结果，不影响更新
  }
}

function push(patch: Partial<AppUpdateState> = {}) {
  state = { ...state, ...patch };
  save();
  notify({ ...state });
}

/** 上一轮是「查/下到一半」退出的，这次启动不能接着显示那些临时状态。 */
function load() {
  let saved: Partial<AppUpdateState> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as unknown;
    if (raw && typeof raw === "object") saved = raw as Partial<AppUpdateState>;
  } catch {
    // 第一次用，没有文件
  }
  state.autoUpdate = saved.autoUpdate !== false;
  // 只有 latest / error / downloaded 值得留到下次；checking、downloading 那些是本轮的。
  const keep = saved.status === "latest" || saved.status === "error" ? saved.status : null;
  const stillNewer = saved.version && saved.version !== app.getVersion();
  state.status = keep ?? (saved.status === "downloaded" && stillNewer ? "downloaded" : "idle");
  state.version = stillNewer ? saved.version : undefined;
  state.detail = saved.detail;
  state.at = saved.at;
}

/** app-update.yml 不在（开发模式，或者打包漏了）就别去查，报一句人话。 */
function feedReady() {
  return fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function describe(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

function onUpdateAvailable(info: UpdateInfo) {
  push({ status: "available", version: info.version, percent: 0, detail: undefined });
  // 查到就下，不等用户点 —— 这是「后台自己更新」的全部意义。
  void autoUpdater.downloadUpdate().catch((error: unknown) => {
    busy = false;
    logLine(`[update] 下载失败：${describe(error)}`);
    push({ status: "error", detail: describe(error) });
  });
}

function onProgress(progress: ProgressInfo) {
  push({ status: "downloading", percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
}

function onDownloaded(info: UpdateInfo) {
  busy = false;
  logLine(`[update] ${info.version} 已下载，退出时自动安装`);
  push({ status: "downloaded", version: info.version, percent: 100, at: Date.now() });
}

function onError(error: unknown) {
  busy = false;
  logLine(`[update] ${describe(error)}`);
  push({ status: "error", detail: describe(error), at: Date.now() });
}

/** 查一次。自动和手动都走这里。 */
export async function checkAppUpdate() {
  if (!state.current || state.status === "unsupported") return { ...state };
  if (busy) return { ...state };
  busy = true;
  push({ status: "checking", at: Date.now() });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    onError(error);
  }
  return { ...state };
}

/** 手动查完发现已经是最新了：checkForUpdates 的 update-not-available 事件里落这个状态。 */
function onNotAvailable() {
  busy = false;
  push({ status: "latest", version: undefined, percent: undefined, detail: undefined, at: Date.now() });
}

/** 下好了，用户点了「立即重启并安装」。 */
export function installAppUpdate() {
  if (state.status !== "downloaded") return { ...state };
  logLine("[update] 重启安装新版本");
  // 第二个参数是「装完把 AllAi 再拉起来」。
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ...state };
}

export function setAppAutoUpdate(value: boolean) {
  push({ autoUpdate: Boolean(value) });
  return { ...state };
}

export function appUpdateState() {
  return { ...state };
}

/**
 * 主进程启动时调一次。开发模式（没打包）直接是 unsupported —— 别在 dev 里
 * 偷偷去 GitHub 查版本，那只会让人以为功能坏了。
 */
export function initAppUpdate(send: (state: AppUpdateState) => void) {
  notify = send;
  state.current = app.getVersion();
  load();

  if (!app.isPackaged || !feedReady()) {
    push({ status: "unsupported" });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => logLine(`[update] ${String(message)}`),
    warn: (message?: unknown) => logLine(`[update] 警告 ${String(message)}`),
    error: (message?: unknown) => logLine(`[update] ${String(message)}`),
    debug: () => undefined,
  };

  // 测试用：把更新源换成别的地址（scripts/test-app-update.cjs 拿它接本地假源）。
  const feed = process.env.ALLAI_UPDATE_FEED;
  if (feed) {
    logLine(`[update] 更新源改为 ${feed}`);
    autoUpdater.setFeedURL({ provider: "generic", url: feed });
  }

  // "checking-for-update" 不用接：checkAppUpdate 在发请求前就已经把状态推成 checking 了。
  autoUpdater.on("update-available", onUpdateAvailable);
  autoUpdater.on("update-not-available", onNotAvailable);
  autoUpdater.on("download-progress", onProgress);
  autoUpdater.on("update-downloaded", onDownloaded);
  autoUpdater.on("error", onError);

  if (!state.autoUpdate) return;
  setTimeout(() => void checkAppUpdate(), FIRST_CHECK_DELAY).unref?.();
  setInterval(() => void checkAppUpdate(), CHECK_INTERVAL).unref?.();
}