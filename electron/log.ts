import fs from "fs";
import os from "os";
import path from "path";

/**
 * `~/.allai/desktop.log`（跟着 ALLAI_DATA_DIR 走）。
 *
 * 主进程和终端宿主的崩溃都往这里写。终端宿主以前是 `stdio: "ignore"` —— 它一挂，
 * 界面只拿得到一句「无法联系终端宿主」，真正的原因（比如 require 不到 node-pty）
 * 一个字都没留下，除了重新打包没别的办法查。
 *
 * 只增不删的东西都要有上限：超过 4MB 轮转一次，留一份上一轮的。
 */

const MAX_BYTES = 4 * 1024 * 1024;

export function logDir() {
  return process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
}

export function logPath() {
  return path.join(logDir(), "desktop.log");
}

function rotate(file: string) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // 没有这个文件、或者被别的进程占着，照常往下写
  }
}

/** 给要长时间接管道的地方用（Next 服务的 stdout/stderr）。 */
export function openLogStream() {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = logPath();
  rotate(file);
  return fs.createWriteStream(file, { flags: "a" });
}

/** 写一行（自带时间戳）。写不进去就算了，日志不该反过来搞崩应用。 */
export function logLine(text: string) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = logPath();
    rotate(file);
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${text}\n`);
  } catch {
    // ignore
  }
}
