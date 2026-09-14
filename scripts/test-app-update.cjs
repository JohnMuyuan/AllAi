/*
 * AllAi 自己的更新（electron/app-update.ts）的回归。
 *
 * 跑法：node scripts/test-app-update.cjs      （先 npm run electron:compile）
 *
 * 为什么不去真连 GitHub：真链路上「查到了什么版本」取决于线上有什么包，
 * 断言随时会过期；而这里要盯的是**状态机**——什么事件落什么状态、什么状态
 * 才允许重启、开关存没存下来。所以把 electron 和 electron-updater 换成假的，
 * 自己摆出 update-available / progress / downloaded / error 这些事件。
 *
 * 真连 GitHub、真下载、真装那一段（NSIS 静默安装 + 拉起新进程）不在这个脚本里。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const MODULE_ID = path.join(root, "electron-dist", "app-update.js");
assert.ok(fs.existsSync(MODULE_ID), "先跑 npm run electron:compile 生成 electron-dist/app-update.js");

/* ---------------- 假的 electron / electron-updater ---------------- */

let packaged = true;
let version = "0.17.4";

const fakeElectron = {
  app: {
    getVersion: () => version,
    get isPackaged() {
      return packaged;
    },
  },
};

const calls = { check: 0, download: 0, installs: [], feedUrl: null };
const handlers = new Map();
/** 每个场景自己决定 checkForUpdates / downloadUpdate 怎么走。 */
let onCheck = () => undefined;
let onDownload = () => undefined;

const fakeUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: false,
  logger: null,
  setFeedURL: (options) => {
    calls.feedUrl = options;
  },
  on: (event, cb) => {
    handlers.set(event, cb);
  },
  checkForUpdates: async () => {
    calls.check += 1;
    handlers.get("checking-for-update")?.();
    return onCheck();
  },
  downloadUpdate: async () => {
    calls.download += 1;
    return onDownload();
  },
  quitAndInstall: (...args) => calls.installs.push(args),
};
/** 测试主动触发事件，模拟 electron-updater 的推送。 */
const emit = (event, payload) => handlers.get(event)?.(payload);

const STUBS = {
  electron: fakeElectron,
  "electron-updater": { autoUpdater: fakeUpdater },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return `stub:${request}`;
  return originalResolve.call(this, request, ...rest);
};
for (const [name, exports] of Object.entries(STUBS)) {
  require.cache[`stub:${name}`] = {
    id: `stub:${name}`,
    filename: `stub:${name}`,
    loaded: true,
    exports,
  };
}

/* ---------------- 每个场景一份干净的模块 ---------------- */

const resources = path.join(root, "dist", "win-unpacked", "resources");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "allai-update-test-"));
process.env.ALLAI_DATA_DIR = dataDir;
process.resourcesPath = resources;
delete process.env.ALLAI_UPDATE_FEED;

function fresh() {
  delete require.cache[MODULE_ID];
  return require(MODULE_ID);
}

function stateFile() {
  return path.join(dataDir, "app-update.json");
}

function readState() {
  return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
}

function clearState() {
  fs.rmSync(stateFile(), { force: true });
}

function resetCalls() {
  calls.check = 0;
  calls.download = 0;
  calls.installs = [];
  calls.feedUrl = null;
  handlers.clear();
  onCheck = () => undefined;
  onDownload = () => undefined;
  packaged = true;
  version = "0.17.4";
}

/** downloadUpdate 的失败是从另一条 promise 链上回来的，等一拍再断言。 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/* ---------------- 场景 ---------------- */

const results = [];
async function it(name, fn) {
  resetCalls();
  clearState();
  await fn();
  results.push(name);
  console.log(`  ok  ${name}`);
}

(async () => {
  console.log("app-update 回归");

  await it("查到新版本 → 自动下载 → downloaded（版本和进度都落盘）", async () => {
    onCheck = () => emit("update-available", { version: "99.9.9" });
    onDownload = () => {
      emit("download-progress", { percent: 42.6 });
      emit("update-downloaded", { version: "99.9.9" });
    };
    const update = fresh();
    let seen = [];
    update.initAppUpdate((state) => seen.push(state.status));

    const after = await update.checkAppUpdate();
    assert.equal(calls.check, 1, "应该真的查了一次");
    assert.equal(calls.download, 1, "查到就该自动下，不用用户点");
    assert.equal(after.status, "downloaded");
    assert.equal(after.version, "99.9.9");
    assert.equal(after.percent, 100);
    assert.deepEqual(seen, ["checking", "available", "downloading", "downloaded"], "状态要按顺序推给界面");
    assert.equal(readState().status, "downloaded", "下好了要落盘，界面重开还看得见");
    assert.equal(readState().version, "99.9.9");
  });

  await it("已经是最新 → latest，且没去下载", async () => {
    onCheck = () => emit("update-not-available", { version: "0.17.4" });
    const update = fresh();
    update.initAppUpdate(() => undefined);
    const after = await update.checkAppUpdate();
    assert.equal(after.status, "latest");
    assert.equal(calls.download, 0, "没新版本就别下");
    assert.equal(readState().status, "latest");
  });

  await it("下载失败 → error，带原始报错，不卡在 downloading", async () => {
    onCheck = () => emit("update-available", { version: "99.9.9" });
    onDownload = () => Promise.reject(new Error("net::ERR_CONNECTION_RESET"));
    const update = fresh();
    update.initAppUpdate(() => undefined);
    await update.checkAppUpdate();
    await settle();
    const after = update.appUpdateState();
    assert.equal(after.status, "error");
    assert.match(after.detail, /ERR_CONNECTION_RESET/);
    // 上一次失败了，下一次手动查不能被 busy 卡住。
    onCheck = () => emit("update-not-available", {});
    onDownload = () => undefined;
    assert.equal((await update.checkAppUpdate()).status, "latest", "失败后要能再查");
  });

  await it("查到更新源出错 → error；连查两次不会并发", async () => {
    onCheck = () => Promise.reject(new Error("404 latest.yml"));
    const update = fresh();
    update.initAppUpdate(() => undefined);
    const after = await update.checkAppUpdate();
    assert.equal(after.status, "error");
    assert.match(after.detail, /404/);
    calls.check = 0;
    await Promise.all([update.checkAppUpdate(), update.checkAppUpdate()]);
    assert.equal(calls.check, 1, "同一次里只允许一条链路在跑");
  });

  await it("只有下好了才允许重启安装，装完会拉起新进程", async () => {
    onCheck = () => emit("update-not-available", {});
    const update = fresh();
    update.initAppUpdate(() => undefined);
    await update.checkAppUpdate();
    update.installAppUpdate();
    assert.equal(calls.installs.length, 0, "没下好就别重启");

    onCheck = () => emit("update-available", { version: "99.9.9" });
    onDownload = () => emit("update-downloaded", { version: "99.9.9" });
    await update.checkAppUpdate();
    update.installAppUpdate();
    await settle(); // quitAndInstall 是 setImmediate 里调的，等它落地
    assert.equal(calls.installs.length, 1, "下好了才装");
    assert.deepEqual(calls.installs[0], [false, true], "第二个参数要是 true：装完把 AllAi 拉起来");
  });

  await it("关掉自动检查会存下来，下次启动还认", async () => {
    const update = fresh();
    update.initAppUpdate(() => undefined);
    assert.equal(update.appUpdateState().autoUpdate, true, "默认是开的");
    update.setAppAutoUpdate(false);
    assert.equal(readState().autoUpdate, false);

    const again = fresh();
    again.initAppUpdate(() => undefined);
    assert.equal(again.appUpdateState().autoUpdate, false, "重启后要记得用户关过");
  });

  await it("开发模式 / 没有 app-update.yml → unsupported，绝不去联网", async () => {
    onCheck = () => emit("update-available", { version: "99.9.9" });
    packaged = false;
    const dev = fresh();
    dev.initAppUpdate(() => undefined);
    assert.equal(dev.appUpdateState().status, "unsupported");
    await dev.checkAppUpdate();
    assert.equal(calls.check, 0, "dev 里不许偷偷查版本");

    packaged = true;
    process.resourcesPath = path.join(os.tmpdir(), "allai-no-such-resources");
    const missing = fresh();
    missing.initAppUpdate(() => undefined);
    assert.equal(missing.appUpdateState().status, "unsupported", "打包漏了 app-update.yml 也要说清楚");
    process.resourcesPath = resources;
  });

  await it("上一次是「下到一半」退出的，这次启动不能接着显示 downloading", async () => {
    fs.writeFileSync(stateFile(), JSON.stringify({ autoUpdate: true, status: "downloading", version: "99.9.9" }));
    const update = fresh();
    update.initAppUpdate(() => undefined);
    assert.equal(update.appUpdateState().status, "idle", "临时的状态不带进下一次启动");

    fs.writeFileSync(stateFile(), JSON.stringify({ autoUpdate: true, status: "downloaded", version: "99.9.9" }));
    const reloaded = fresh();
    reloaded.initAppUpdate(() => undefined);
    assert.equal(reloaded.appUpdateState().status, "downloaded", "真下好的要留着，提醒用户重启");

    fs.writeFileSync(stateFile(), JSON.stringify({ autoUpdate: true, status: "downloaded", version: "0.17.4" }));
    const same = fresh();
    same.initAppUpdate(() => undefined);
    assert.equal(same.appUpdateState().status, "idle", "版本都装上了就别再提示");
  });

  await it("ALLAI_UPDATE_FEED 会把更新源换掉（测试和换源用）", async () => {
    process.env.ALLAI_UPDATE_FEED = "http://127.0.0.1:1/fake";
    const update = fresh();
    update.initAppUpdate(() => undefined);
    assert.deepEqual(calls.feedUrl, { provider: "generic", url: "http://127.0.0.1:1/fake" });
    delete process.env.ALLAI_UPDATE_FEED;
  });

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${results.length} 项全过。真连 GitHub / 真装那一段不在这个脚本里。`);
})().catch((error) => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.error("\n失败：", error);
  process.exit(1);
});