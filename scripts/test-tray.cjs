/**
 * 托盘常驻。跑法（先 npm run electron:compile）：
 *
 *   ALLAI_DATA_DIR=<临时目录> node_modules/electron/dist/electron.exe scripts/test-tray.cjs
 *
 * 盯的是「关掉窗口之后软件还活着、而且还能退出」这件事：
 *   - 关窗口 = 隐藏，窗口对象不能被销毁（远程控制和额度采样都在主进程里跑着）；
 *   - 设置里改成「直接退出」之后，关窗口就真的关掉；
 *   - 托盘图标建得出来，菜单里有「打开」和「退出」；
 *   - 第一次收进托盘提示一次，之后不再烦人。
 *
 * 用临时 ALLAI_DATA_DIR，不碰你真的 ~/.allai。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = process.env.ALLAI_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "allai-tray-"));
process.env.ALLAI_DATA_DIR = DATA;
fs.mkdirSync(DATA, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
app.on("window-all-closed", () => undefined);

const tray = require(path.join(ROOT, "electron-dist", "tray.js"));
const db = require(path.join(ROOT, "electron-dist", "db.js"));

function writePrefs(closeToTray) {
  fs.writeFileSync(path.join(DATA, "db.json"), JSON.stringify({ prefs: { closeToTray } }), "utf8");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  // ---- 判断逻辑 ----
  check("默认收进托盘", tray.shouldHideOnClose({ quitting: false, closeToTray: true }));
  check("真退出时不拦（托盘菜单、关机、装更新）", !tray.shouldHideOnClose({ quitting: true, closeToTray: true }));
  check("设置成直接退出时不拦", !tray.shouldHideOnClose({ quitting: false, closeToTray: false }));

  // ---- 设置读得到，没写过时默认开 ----
  fs.rmSync(path.join(DATA, "db.json"), { force: true });
  check("没有 db.json 时默认收进托盘", db.readMainPrefs().closeToTray === true);
  writePrefs(false);
  check("设置里关掉后读到 false", db.readMainPrefs().closeToTray === false);
  writePrefs(true);
  check("再打开又读到 true（改完不用重启）", db.readMainPrefs().closeToTray === true);

  // ---- 第一次提示一次 ----
  fs.rmSync(path.join(DATA, "tray-hint.json"), { force: true });
  check("第一次要提示", tray.needsBackgroundHint());
  tray.markBackgroundHintShown();
  check("提示过就不再提示", !tray.needsBackgroundHint());

  // ---- 托盘 ----
  const icon = tray.initTray({ show: () => undefined, quit: () => undefined });
  check("托盘图标建出来了", Boolean(icon) && !icon.isDestroyed());
  check("托盘图标不是空图", !icon.getImage?.().isEmpty?.());

  // ---- 关窗口 = 隐藏，窗口还在 ----
  let quitting = false;
  const win = new BrowserWindow({ show: false, width: 600, height: 400 });
  win.on("close", (event) => {
    if (!tray.shouldHideOnClose({ quitting, closeToTray: db.readMainPrefs().closeToTray })) return;
    event.preventDefault();
    win.hide();
  });
  win.show();
  await wait(300);
  win.close();
  await wait(400);
  check("关窗口之后窗口还在（进程没退）", !win.isDestroyed(), String(win.isDestroyed()));
  check("并且是隐藏状态", !win.isVisible());
  win.show();
  await wait(200);
  check("托盘菜单点「打开」能再显示出来", win.isVisible());

  // ---- 改成「直接退出」后，关窗口就真关 ----
  writePrefs(false);
  win.close();
  await wait(400);
  check("设置成直接退出后，关窗口真的关掉", win.isDestroyed());

  // ---- 托盘菜单里的退出：quitting 置位后不再拦 ----
  quitting = true;
  writePrefs(true);
  check("退出流程里不会被托盘拦住", !tray.shouldHideOnClose({ quitting, closeToTray: true }));
  tray.destroyTray();
  check("退出时托盘图标销毁", icon.isDestroyed());

  console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
