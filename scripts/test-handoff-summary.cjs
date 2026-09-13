/**
 * 交接摘要的来源、以及「复制恢复命令」按钮。跑法（先 npm run electron:compile）：
 *   1. ALLAI_DATA_DIR=<临时目录> npx next dev --port 4683
 *      ⚠️ dev server 启动会把本机 CLI 配置里的真实中转站和 Key 导进这个目录，跑完删掉它。
 *   2. SHOT_URL=http://127.0.0.1:4683 node_modules/electron/dist/electron.exe scripts/test-handoff-summary.cjs
 *
 * 复现的是 0.16.21 修的两条，根因是同一个：交接常常要**开一条新的 CLI 会话**
 * （上下文满了 / 换了模型），而这条工作本地记的 messagesFile 要等下一次扫描才更新。
 *
 *   1. 摘要以前取「会话文件里最后一条 assistant」—— 那几秒读到的是**上一条会话**，
 *      于是用户拿到的「交接摘要」是上一轮的普通回复（真实案例：一段「晚安，辛苦啦～」）。
 *   2. sendAgent 开新会话时会把 source 设成 "new"，而 mergeAgentWorkLists 从不合并 source，
 *      于是 canResume() 永远为假，顶栏「复制恢复命令」那个按钮再也不回来。
 *
 * 所以这里的假 IPC 故意让 loadMessages 一直只返回**旧会话**的内容。
 *
 * ⚠️ 改完源码**第一次**跑多半会挂：dev server 还在重编译，窗口加载到的是半成品，
 *    表现是「本地工作 / 未选择 Agent」（根本没打开工作）。先 `curl 一下页面` 再跑。
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const URL = process.env.SHOT_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const now = Date.now();
const OLD_REPLY = "改好了，已经打成 0.16.13，从桌面快捷方式打开就是新版。晚安，辛苦啦～";
const REAL_SUMMARY = "## 任务目标\n把 AllAi 的提问卡片做完\n## 还没做完 / 下一步\n把回答同步到手机端";

// 会话文件里就这两条，永远不会多出摘要那条（模拟「新会话写在别的文件里」）。
const history = [
  { id: "u1", role: "user", content: "继续做提问卡片", createdAt: now - 3600e3 },
  { id: "a1", role: "assistant", content: OLD_REPLY, createdAt: now - 3500e3 },
];

const work = {
  id: "claude-code:sess-old", kind: "claude-code", agentName: "Claude Code", title: "ALLAI开发1",
  cwd: "D:\\tmp\\proj", cliSessionId: "sess-old", running: false, model: "claude-sonnet-5",
  createdAt: now - 7200e3, updatedAt: now - 60e3, preview: "", source: "history",
  messagesFile: "D:\\tmp\\sess-old.jsonl",
};

let emit = null;
/** 交接那一轮实际发给 CLI 的参数，用来断言它续的是原会话、没另起一条。 */
let promptOpts = null;

// lib/agent-handoff.ts 是零依赖纯函数，直接打出来测。
const fs = require("fs");
const os = require("os");
const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "allai-handoff-lib-"));
const libOut = path.join(tmp, "handoff.cjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "lib", "agent-handoff.ts")],
  bundle: true, format: "cjs", platform: "node", outfile: libOut, logLevel: "silent",
});
const { HANDOFF_MARK, stripHandoffTurns } = require(libOut);

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  try {
    let win = null;
    const handlers = {
      "window:state": () => ({ maximized: false }),
      "agent:works": () => [work],
      "agent:messages": () => history,
      "agent:context": () => null, "cli:detect": () => [], "cli:auth-status": () => null,
      "cli:models": () => ({ ok: false, error: "x" }), "quota:official": () => ({}),
      "computer:info": () => null, "admin:status": () => ({ elevated: false, linked: false, script: "" }),
      "agent:watch-work": () => ({ ok: true }), "agent:unwatch-work": () => ({ ok: true }), "pty:list": () => [],
      "remote:status": () => ({ state: "off", sessions: [] }),
      "cli:update-state": () => ({ autoUpdate: true, running: null, queue: [], results: {} }),
      "agent:kill": () => ({ ok: true }), "notify:show": () => undefined,
      "agent:prompt": (_e, opts) => {
        promptOpts = opts;
        emit = (event) => win.webContents.send("agent:event", opts.sessionId, event);
        return { ok: true };
      },
    };
    for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);

    win = new BrowserWindow({
      width: 1440, height: 900, frame: false, show: false,
      webPreferences: { preload: path.join(ROOT, "electron-dist", "preload.js"), contextIsolation: true, sandbox: true },
    });
    const js = (s) => win.webContents.executeJavaScript(s, true);
    await win.loadURL(URL);
    for (let i = 0; i < 60; i++) {
      await wait(1000);
      if (await js(`document.body.innerText.includes('好')`).catch(() => false)) break;
    }
    await wait(1500);
    await js(`
      window.__btn = (text) => [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.includes(text)) || null;
      window.__aria = (label) => document.querySelector('button[aria-label="' + label + '"]');
      window.__clickText = (text) => { const b = window.__btn(text); if (b) b.click(); return Boolean(b); };
      true;`);
    // 这个脚本会改名、会建接续关系，临时 db 里可能还留着上一轮的覆盖层。
    // 不清掉的话侧栏按标题点不中（改过名），或者被画成接续链里的一节。
    await js(`fetch('/api/agent-works', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ${JSON.stringify(work.id)}, title: null, continuedFrom: null, continuedTo: null }),
    }).then((r) => r.ok)`);
    await wait(1500);
    await js(`window.__clickText('本地 Agent') || window.__clickText('Agent')`);
    await wait(1200);
    await js(`window.__clickText('ALLAI开发1')`);
    await wait(2000);

    check("一开始有「复制恢复命令」按钮", await js(`Boolean(window.__aria('复制恢复命令'))`));

    // 交接：这一轮的正文只从事件流来，会话文件永远只有旧回复
    await js(`window.__clickText('接续到新对话')`);
    await wait(800);
    // AllAi 自己 spawn 的那一轮，按下发送就该亮绿点，不用等 4 秒一轮的扫描。
    // 只看顶栏和侧栏的绿点 —— 整页搜「运行中」会匹配到进度面板里的「后台运行中」。
    const runDbg = JSON.parse(
      await js(`JSON.stringify({
        header: (document.querySelector('header') || {}).innerText || '',
        dot: document.querySelectorAll('span.animate-pulse').length,
      })`),
    );
    check(
      "AllAi 自己跑的那一轮立刻显示运行中",
      runDbg.header.includes("运行中") && runDbg.dot > 0,
      JSON.stringify(runDbg),
    );
    emit({ type: "tool", name: "读取文件", detail: "docs/HANDOFF.md" });
    await wait(300);
    emit({ type: "delta", text: REAL_SUMMARY.slice(0, 20) });
    await wait(300);
    emit({ type: "delta", text: REAL_SUMMARY.slice(20) });
    await wait(400);
    emit({ type: "done" });
    await wait(2500);
    check(
      "这一轮结束后运行中就撤掉了",
      !(await js(`((document.querySelector('header') || {}).innerText || '').includes('运行中')`)),
    );

    // 整理请求必须续原来那条 CLI 会话：另起一条会在磁盘上多出一个会话文件，
    // 用户的 Agent 列表里就凭空多一条对话。
    check("整理请求续的是原会话", promptOpts?.resumeId === work.cliSessionId, `resumeId=${promptOpts?.resumeId}`);
    check("没有另起一条新会话", !promptOpts?.newSessionId, `newSessionId=${promptOpts?.newSessionId}`);
    check("整理请求带着标记", String(promptOpts?.prompt || "").startsWith(HANDOFF_MARK));
    check(
      "整理请求没显示成用户的消息",
      !(await js(`document.body.innerText.includes('请写一份「交接摘要」')`)),
    );

    const panel = await js(`(document.querySelector('[aria-label="接续到新对话的进度"]') || {}).innerText || ""`);
    check("交接完成", panel.includes("接续完成"), panel.replace(/\n/g, " | ").slice(0, 120));

    const draft = await js(`(document.querySelector('textarea') || {}).value || ""`);
    check("摘要是这一轮真正写的那段", draft.includes("把 AllAi 的提问卡片做完"), draft.slice(0, 90).replace(/\n/g, " | "));
    check("摘要不是上一轮的普通回复", !draft.includes("晚安"), draft.includes("晚安") ? "又把「晚安，辛苦啦～」当摘要了" : "");

    // 回到原来那条工作：开过新会话之后按钮也要还在
    await js(`window.__clickText('ALLAI开发1')`);
    await wait(2000);
    check("开过新会话后「复制恢复命令」按钮还在", await js(`Boolean(window.__aria('复制恢复命令'))`));

    // 重命名之后同样还在
    const renamed = await js(`fetch('/api/agent-works', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ${JSON.stringify(work.id)}, title: '改个名字' }),
    }).then((r) => r.ok)`);
    check("重命名接口成功", renamed);
    await wait(2500);
    check("重命名之后按钮还在", await js(`Boolean(window.__aria('复制恢复命令'))`));

    // 换会话重放历史时，整理请求和它写的摘要要整轮丢掉。
    const replayed = stripHandoffTurns([
      { role: "user", content: "帮我做值班表" },
      { role: "assistant", content: "做好了。" },
      { role: "user", content: HANDOFF_MARK + "\n请写一份「交接摘要」…" },
      { role: "assistant", content: "## 任务目标\n…" },
      { role: "user", content: "继续" },
    ]);
    check("重放历史里没有整理请求", !replayed.some((item) => item.content.includes("请写一份")));
    check("摘要那条回复也一起丢掉", !replayed.some((item) => item.content.includes("## 任务目标")));
    check("其它消息一条不少", replayed.length === 3, JSON.stringify(replayed.map((i) => i.content)));

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
    app.exit(results.every(Boolean) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
