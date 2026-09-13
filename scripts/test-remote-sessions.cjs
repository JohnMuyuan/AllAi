/**
 * 远程控制的会话生命周期回归测试。跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-remote-sessions.cjs
 *
 * 不需要中继、不需要界面、不需要 Electron 窗口：把 electron / history / live / watch
 * 四个模块换成假的，直接驱动真实的 electron-dist/remote.js。
 *
 * 盯的是两件只有「手机反复掉线重连」才会暴露的事：
 *   1. 每台手机打开的 Agent 工作挂着 fs.watch。连接断开、或者同一台手机重新握手时，
 *      必须把旧 watcher 关掉 —— 光把 Map 清了，watcher 还在跑，而且每次重连再漏一份。
 *   2. 手机切后台再回来是一次重新握手。之前盯的那条 Agent 工作要自动接上，
 *      否则手机还停在那条工作的界面上，却再也收不到新消息。
 */
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "electron-dist");

/* ---------------- 假模块 ---------------- */

const watches = []; // { workId, closed }

const stubs = {
  electron: {
    app: { getVersion: () => "0.0.0-test" },
    ipcMain: { handle: () => undefined, on: () => undefined },
    safeStorage: { isEncryptionAvailable: () => false },
  },
  [path.join(DIST, "history.js")]: {
    scanHistory: () => [],
    mergeWorks: undefined,
  },
  [path.join(DIST, "live.js")]: {
    scanLive: async () => [],
    mergeWorks: () => [
      { id: "work-1", kind: "claude-code", messagesFile: "fake.jsonl", running: false },
      { id: "work-2", kind: "claude-code", messagesFile: "fake.jsonl", running: false },
    ],
  },
  [path.join(DIST, "watch.js")]: {
    startWorkWatch: (work, onChange) => {
      const entry = { workId: work.id, closed: false };
      watches.push(entry);
      // 推一条带「Agent 向用户提问」的消息，验证 ask 能原样传到手机
      // （以前 packAgentMessages 把 trace 重写成 {type,name,detail}，ask 就此丢掉，
      //  手机上只剩一行「问用户」，整条工作卡死 —— 0.16.33 修的）。
      setTimeout(
        () =>
          onChange({
            workId: work.id,
            running: false,
            // 这条工作自己的占用，和电脑选中那条完全不同的数
            context: { tokens: 11111 },
            messages: [
              {
                id: "m1",
                role: "assistant",
                content: "要用哪种格式？",
                createdAt: Date.now(),
                trace: [
                  {
                    type: "tool",
                    name: "问用户",
                    detail: "",
                    diff: [{ file: "a.ts", added: 1, removed: 0, hunks: [] }],
                    ask: {
                      questions: [
                        { question: "导出成什么格式？", header: "格式", options: [{ label: "Excel" }, { label: "CSV" }] },
                      ],
                    },
                  },
                ],
              },
            ],
          }),
        0,
      );
      return {
        close: () => {
          entry.closed = true;
        },
      };
    },
  },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs[request]) return stubs[request];
  if (parent && request.startsWith(".")) {
    const resolved = path.resolve(path.dirname(parent.filename), request);
    const withExt = resolved.endsWith(".js") ? resolved : `${resolved}.js`;
    if (stubs[withExt]) return stubs[withExt];
  }
  return realLoad(request, parent, isMain);
};

// 不要碰真的 ~/.allai
process.env.ALLAI_DATA_DIR = path.join(
  require("os").tmpdir(),
  `allai-remote-sessions-${process.pid}`,
);

const remote = require(path.join(DIST, "remote.js"));
const protocol = require(path.join(DIST, "remote-protocol.js"));

/* ---------------- 驱动 ---------------- */

// 记下电脑经中继发出去的帧，并冒充中继把手机的帧喂回去。
const outbound = [];
const internals = remote.__testHooks;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  if (!internals) {
    console.error("remote.js 没有导出 __testHooks，测试没法驱动它");
    process.exit(1);
  }
  internals.setRelaySender((payload) => outbound.push(payload));

  const deviceId = "a".repeat(32);
  const deviceKeyBytes = protocol.randomBytes(32);
  internals.addTestDevice({ id: deviceId, name: "测试手机", keyB64: protocol.toB64(deviceKeyBytes) });

  // 手机侧：握手用的长期密钥
  const base = await protocol.importBaseKey(deviceKeyBytes);

  async function handshake() {
    const nonce = protocol.randomBytes(16);
    outbound.length = 0;
    await internals.deliverPlain(deviceId, { op: "hello", n: protocol.toB64(nonce) });
    const welcome = outbound
      .map((item) => JSON.parse(item.d || "{}").p)
      .find((item) => item && item.op === "welcome");
    if (!welcome) throw new Error("电脑没有回 welcome");
    return protocol.SecureChannel.create(base, nonce, protocol.fromB64(welcome.n), "device");
  }

  // 1) 第一次握手 + 打开一条 Agent 工作
  let channel = await handshake();
  await internals.deliverSecure(deviceId, await channel.seal({ id: "1", op: "agent.open", args: { threadId: "work-1" } }));
  await new Promise((r) => setTimeout(r, 50)); // handleRpc 是 void 出去的，等它落地
  check("打开 Agent 工作会起一个 watcher", watches.length === 1 && watches[0].workId === "work-1", `watches=${watches.length}`);

  // 1b) 提问（ask）要原样传到手机；改文件的差异照约定 55 不发
  const sealed = outbound
    .map((item) => JSON.parse(item.d || "{}"))
    .filter((item) => typeof item.s === "string");
  let thread = null;
  for (const frame of sealed) {
    const payload = await channel.open(frame.s).catch(() => null);
    if (payload && payload.ev === "thread") thread = payload.data;
  }
  const packed = thread?.upsert?.[0];
  const tool = (packed?.trace || []).find((row) => row.type === "tool");
  check("Agent 的提问（ask）传到了手机", Boolean(tool?.ask?.questions?.length), JSON.stringify(tool || null));
  check("改文件的差异没跟着发过去（约定 55）", tool ? !("diff" in tool) : false);

  // 1c) 电脑选中的是 work-2，手机打开的是 work-1：凡是「当前这条工作」的东西
  //     都必须按手机自己那条来。漏一个，电脑上一换对话手机那一格就跟着变。
  internals.publish({
    agent: {
      activeId: "work-2",
      streaming: true,
      modelKey: "p::电脑那条的型号",
      compactPercent: 80,
      context: { used: 999999, limit: 200000, level: "over" },
      list: [
        { id: "work-1", running: false, modelKey: "p::手机那条的型号", contextLimit: 123456 },
        { id: "work-2", running: false, modelKey: "p::电脑那条的型号", contextLimit: 200000 },
      ],
    },
    threads: {},
  });
  outbound.length = 0;
  internals.pushAll();
  await new Promise((r) => setTimeout(r, 80));
  let state = null;
  for (const frame of outbound.map((item) => JSON.parse(item.d || "{}")).filter((item) => item.s)) {
    const payload = await channel.open(frame.s).catch(() => null);
    if (payload && payload.ev === "state") state = payload.data;
  }
  check("手机看到的是自己打开的那条", state?.agent?.activeId === "work-1", state?.agent?.activeId);
  check(
    "型号是自己那条的，不是电脑选中那条的",
    state?.agent?.modelKey === "p::手机那条的型号",
    state?.agent?.modelKey,
  );
  check(
    "上下文占用是自己那条的，不跟电脑走",
    state?.agent?.context?.used === 11111 && state?.agent?.context?.limit === 123456,
    JSON.stringify(state?.agent?.context),
  );

  // 2) 手机切后台再回来 = 重新握手。旧 watcher 必须关掉，并且自动接回同一条工作。
  channel = await handshake();
  await new Promise((r) => setTimeout(r, 50)); // 重新盯上是异步的（要找一次工作）
  const firstClosed = watches[0].closed;
  const rewatched = watches.length === 2 && watches[1].workId === "work-1" && !watches[1].closed;
  check("重新握手会关掉旧的 watcher", firstClosed, firstClosed ? "" : "旧 watcher 还开着 —— 每次重连漏一份");
  check("重新握手会接回原来那条 Agent 工作", rewatched, `watches=${JSON.stringify(watches)}`);

  // 3) 和中继断开：所有会话的 watcher 都要关掉
  internals.dropAllSessions();
  const allClosed = watches.every((item) => item.closed);
  check("断线清空会话时关掉所有 watcher", allClosed, allClosed ? "" : JSON.stringify(watches));

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
