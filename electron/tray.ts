import { app, Menu, nativeImage, Tray } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 托盘常驻。
 *
 * 关掉窗口不等于退出 —— 远程控制（手机那头）和额度采样（每 5 分钟一次）都跑在主进程里，
 * 进程一退，这两件事就断了。所以默认「关闭窗口 = 收进托盘」，真退出走托盘菜单里的那一项。
 *
 * 注意窗口那边还要把 `backgroundThrottling` 关掉：窗口隐藏后 Chromium 会把渲染进程的
 * 定时器压到每分钟一次，手机端发来的指令会卡住 —— 后台常驻就没意义了。
 */

let tray: Tray | null = null;

function iconFile() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "packaging", "icon.png");
}

function dataDir() {
  return process.env.ALLAI_DATA_DIR || path.join(os.homedir(), ".allai");
}

/** 第一次收进托盘要提示一次，不然用户以为自己把软件关掉了。 */
function hintFile() {
  return path.join(dataDir(), "tray-hint.json");
}

export function needsBackgroundHint() {
  try {
    const raw = JSON.parse(fs.readFileSync(hintFile(), "utf8")) as { shown?: boolean };
    return raw?.shown !== true;
  } catch {
    return true;
  }
}

export function markBackgroundHintShown() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(hintFile(), JSON.stringify({ shown: true, at: Date.now() }), "utf8");
  } catch {
    // 记不下就下次再提示一遍，不影响功能
  }
}

/** 关窗口时是收起来还是真退出。 */
export function shouldHideOnClose(opts: { quitting: boolean; closeToTray: boolean }) {
  return !opts.quitting && opts.closeToTray;
}

export function initTray(actions: { show: () => void; quit: () => void }) {
  if (tray && !tray.isDestroyed()) return tray;
  const image = nativeImage.createFromPath(iconFile());
  // 托盘要的是小图；原图是 512，直接塞进去在 Windows 上会糊
  const icon = image.isEmpty() ? image : image.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("AllAi（后台运行中）");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 AllAi", click: actions.show },
      { type: "separator" },
      { label: "退出 AllAi", click: actions.quit },
    ]),
  );
  // Windows 上单击就该打开；双击也认，省得用户习惯不同
  tray.on("click", actions.show);
  tray.on("double-click", actions.show);
  return tray;
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
