/**
 * 更新本机的 Claude Code / Codex / Grok Build。跑在主进程里，全程异步，不卡界面。
 *
 * 三家都有自己的更新命令：`claude update`、`codex update`、`grok update`，
 * 不自己去猜是 npm 装的还是原生安装包 —— 各家命令自己知道怎么更新自己。
 * 一次只更新一个，排队执行；结果写进 ~/.allai/cli-update.json，设置 → 关于里能看到。
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { cliInvocation, detectClis, versionOf, type DetectedCli } from "./detect";

export type CliUpdateResult = { at: number; ok: boolean; before?: string; after?: string; message: string };

export type CliUpdateState = {
  autoUpdate: boolean;
  running: DetectedCli["kind"] | null;
  queue: DetectedCli["kind"][];
  results: Partial<Record<DetectedCli["kind"], CliUpdateResult>>;
};

const UPDATE_ARGS: Record<DetectedCli["kind"], string[]> = {
  "claude-code": ["update"],
  codex: ["update"],
  "grok-build": ["update"],
};

/** 下载新版本可能很慢，给足时间。 */
const UPDATE_TIMEOUT = 5 * 60 * 1000;

function stateFile() {
  return path.join(process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai"), "cli-update.json");
}

let state: CliUpdateState = { autoUpdate: true, running: null, queue: [], results: {} };
let notify: (state: CliUpdateState) => void = () => undefined;
let chain: Promise<unknown> = Promise.resolve();

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Partial<CliUpdateState>;
    state = {
      ...state,
      autoUpdate: saved.autoUpdate !== false,
      results: saved.results && typeof saved.results === "object" ? saved.results : {},
    };
  } catch {
    // 第一次用，没有文件
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ autoUpdate: state.autoUpdate, results: state.results }, null, 2));
  } catch {
    // 写不进去只是下次看不到上次结果，不影响更新
  }
}

function push() {
  notify({ ...state, queue: [...state.queue], results: { ...state.results } });
}

/** 去掉终端颜色码，只留最后几行给界面看。 */
function tail(text: string) {
  const clean = text.replace(/\[[0-9;?]*[A-Za-z]/g, "").trim();
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-2).join(" ").slice(0, 240);
}

function runUpdate(cli: DetectedCli) {
  const inv = cliInvocation(cli.command, UPDATE_ARGS[cli.kind]);
  return new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      inv.file,
      inv.args,
      {
        windowsHide: true,
        timeout: UPDATE_TIMEOUT,
        maxBuffer: 4 * 1024 * 1024,
        windowsVerbatimArguments: inv.verbatim,
        // 有的更新命令会问「要不要更新」，stdin 不是终端时按默认走；再加个环境变量兜底。
        env: { ...process.env, CI: "1" },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? Number((error as { code: number }).code) : 1) : 0;
        resolve({ code, output: `${stdout ?? ""}\n${stderr ?? ""}${error && !stdout && !stderr ? error.message : ""}` });
      },
    );
  });
}

/** 更新指定的几个（不传就是全部已安装的）。排队执行，返回跑完后的状态。 */
export function updateClis(kinds?: string[]) {
  const task = chain.then(async () => {
    const installed = await detectClis();
    const targets = installed.filter((cli) => !kinds?.length || kinds.includes(cli.kind));
    state.queue = targets.map((cli) => cli.kind);
    push();
    for (const cli of targets) {
      state.running = cli.kind;
      state.queue = state.queue.filter((kind) => kind !== cli.kind);
      push();
      const result = await runUpdate(cli);
      const after = await versionOf(cli.command);
      const ok = result.code === 0;
      const message = ok
        ? after && after !== cli.version
          ? `已更新：${cli.version} → ${after}`
          : "已是最新版本"
        : `更新失败：${tail(result.output) || `退出码 ${result.code}`}`;
      state.results[cli.kind] = { at: Date.now(), ok, before: cli.version, after, message };
      save();
      push();
    }
    state.running = null;
    state.queue = [];
    push();
    return state;
  });
  chain = task.catch(() => undefined);
  return task;
}

export function cliUpdateState() {
  return state;
}

export function setCliAutoUpdate(value: boolean) {
  state.autoUpdate = value;
  save();
  push();
  return state;
}

/** 主进程启动时调一次：读上次的结果；开着自动更新就等界面起来后在后台更新。 */
export function initCliUpdate(send: (state: CliUpdateState) => void) {
  load();
  notify = send;
  if (state.autoUpdate) {
    // 等界面和本机服务都起来再跑，别和启动抢资源。
    setTimeout(() => void updateClis().catch(() => undefined), 20_000);
  }
}
