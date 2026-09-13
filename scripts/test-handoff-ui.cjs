// 「接续到新对话」进度面板的界面回归。跑法（先 npm run electron:compile）：
//   1. ALLAI_DATA_DIR=<临时目录> npx next dev --port 4681
//      ⚠️ dev server 启动会把本机 CLI 配置里的真实中转站和 Key 导进这个目录，跑完删掉它。
//   2. SHOT_DIR=<截图目录> SHOT_URL=http://127.0.0.1:4681 node_modules/electron/dist/electron.exe scripts/test-handoff-ui.cjs
//
// 真界面 + 真 preload + 假 IPC：agent:prompt 只记下 sessionId，事件由脚本手动发，
// 所以能一步步停下来看面板。覆盖打开、步骤、字数、秒数在走、关掉再用「查看进度」回来、
// 完成态入口，以及静默那一轮不许弄脏旧工作最后一条回复。
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR;
const URL = process.env.SHOT_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const now = Date.now();
const work = {
  id: "claude-code:sess-old", kind: "claude-code", agentName: "Claude Code", title: "做值班表",
  cwd: "D:\\tmp\\proj", cliSessionId: "sess-old", running: false, model: "claude-sonnet-5",
  createdAt: now - 3600e3, updatedAt: now - 60e3, preview: "", source: "history",
};
const SUMMARY = "## 任务目标\n做值班表\n## 还没做完 / 下一步\n导出 Excel 并核对名单";
const history = [
  { id: "u1", role: "user", content: "帮我做一个值班表", createdAt: now - 3600e3 },
  { id: "a1", role: "assistant", content: "做好了第一版。", createdAt: now - 3500e3 },
];
// done 之后 loadMessages 要能读到摘要（真实环境里这是 CLI 写进会话文件的）。
let doneSummary = false;
let emit = null;

app.whenReady().then(async () => {
  try {
    let win = null;
    const handlers = {
      "window:state": () => ({ maximized: false }),
      "agent:works": () => [work],
      "agent:messages": () =>
        doneSummary ? [...history, { id: "a2", role: "assistant", content: SUMMARY, createdAt: Date.now() }] : history,
      "agent:context": () => null, "cli:detect": () => [], "cli:auth-status": () => null,
      "cli:models": () => ({ ok: false, error: "x" }), "quota:official": () => ({}),
      "computer:info": () => null, "admin:status": () => ({ elevated: false, linked: false, script: "" }),
      "agent:watch-work": () => ({ ok: true }), "agent:unwatch-work": () => ({ ok: true }), "pty:list": () => [],
      "remote:status": () => ({ state: "off", sessions: [] }),
      "cli:update-state": () => ({ autoUpdate: true, running: null, queue: [], results: {} }),
      "agent:kill": () => ({ ok: true }),
      // 手动驱动：不自动结束，方便逐步检查面板
      "agent:prompt": (_e, opts) => {
        emit = (event) => win.webContents.send("agent:event", opts.sessionId, event);
        return { ok: true };
      },
    };
    for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);
    win = new BrowserWindow({
      width: 1440, height: 900, frame: false, show: true,
      webPreferences: { preload: path.join(ROOT, "electron-dist", "preload.js"), contextIsolation: true, sandbox: true },
    });
    const js = (s) => win.webContents.executeJavaScript(s, true);
    const shot = async (name) => {
      try { fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG()); }
      catch (e) { console.log("shot failed", name, e.message); }
    };
    await win.loadURL(URL);
    for (let i = 0; i < 60; i++) {
      await wait(1000);
      if (await js(`document.body.innerText.includes('好')`).catch(() => false)) break;
    }
    await wait(1500);
    await js(`
      window.__btn = (text) => [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.includes(text)) || null;
      window.__clickText = (text) => { const b = window.__btn(text); if (b) b.click(); return Boolean(b); };
      window.__panel = () => document.querySelector('[aria-label="接续到新对话的进度"]');
      window.__panelText = () => { const p = window.__panel(); return p ? p.innerText : ""; };
      true;`);
    await js(`window.__clickText('本地 Agent') || window.__clickText('Agent')`);
    await wait(1500);
    await js(`window.__clickText('做值班表')`);
    await wait(2000);

    check("顶栏有「接续到新对话」", await js(`Boolean(window.__btn('接续到新对话'))`));
    await js(`window.__clickText('接续到新对话')`);
    await wait(600);

    let text = await js(`window.__panelText()`);
    check("点了立刻弹出进度面板", text.includes("正在接续到新对话"), text.slice(0, 60).replace(/\n/g, " | "));
    check("面板里有当前工作", text.includes("做值班表"));
    check("面板里有当前模型", text.includes("claude-sonnet-5"), text.replace(/\n/g, " | ").slice(0, 200));
    check("面板里有停止按钮", await js(`Boolean(window.__btn('停止接续'))`));
    await shot("handoff-1-open.png");

    // 模型开始干活：工具 + 思考 + 正文
    await js(`true`);
    emit({ type: "tool", name: "读取文件", detail: "src/roster.ts" });
    emit({ type: "thinking", text: "先看看现在排班表长什么样" });
    await wait(500);
    emit({ type: "delta", text: SUMMARY.slice(0, 20) });
    await wait(400);
    emit({ type: "delta", text: SUMMARY.slice(20) });
    await wait(600);

    text = await js(`window.__panelText()`);
    check("「执行到哪一步」列出了工具调用", text.includes("读取文件") && text.includes("src/roster.ts"), text.replace(/\n/g, " | ").slice(0, 260));
    check("「执行到哪一步」列出了思考", text.includes("先看看现在排班表长什么样"));
    check("显示已写摘要字数", /已写摘要\s*\n?\s*\d+ 字/.test(text), text.replace(/\n/g, " | ").slice(0, 260));
    check("阶段变成「生成摘要」", text.includes("生成摘要"));
    await shot("handoff-2-progress.png");

    // 静默这一轮不许污染旧工作最后那条回复
    const polluted = await js(`document.body.innerText.includes('做好了第一版。${SUMMARY.slice(0, 6)}')`);
    check("旧工作最后一条回复没被摘要污染", !polluted);

    // 秒数要自己走
    const t1 = await js(`(window.__panelText().match(/已运行 (\\d+) 秒/) || [])[1] || "-"`);
    await wait(2600);
    const t2 = await js(`(window.__panelText().match(/已运行 (\\d+) 秒/) || [])[1] || "-"`);
    check("「已运行 N 秒」在走", t1 !== "-" && t2 !== "-" && Number(t2) > Number(t1), `${t1} → ${t2}`);

    // 关掉 → 后台继续 → 按钮变「查看进度」且可点 → 能再打开
    await js(`window.__clickText('关闭') || (window.__panel() && window.__panel().parentElement.click())`);
    await wait(500);
    check("关掉后面板消失", !(await js(`Boolean(window.__panel())`)));
    const viewBtn = await js(`(() => { const b = window.__btn('查看进度'); return b ? { found: true, disabled: b.disabled } : { found: false }; })()`);
    check("原按钮变成「查看进度」", viewBtn.found);
    check("「查看进度」可以点（不是禁用）", viewBtn.found && !viewBtn.disabled, JSON.stringify(viewBtn));
    await js(`window.__clickText('查看进度')`);
    await wait(500);
    check("点「查看进度」面板回来了", (await js(`window.__panelText()`)).includes("正在接续到新对话"));
    await shot("handoff-3-reopen.png");

    // 跑完
    doneSummary = true;
    emit({ type: "done" });
    await wait(2500);
    text = await js(`window.__panelText()`);
    check("跑完面板变成「接续完成」", text.includes("接续完成"), text.replace(/\n/g, " | ").slice(0, 200));
    check("跑完有「打开新对话」入口", await js(`Boolean(window.__btn('打开新对话'))`));
    check("跑完不再显示停止按钮", !(await js(`Boolean(window.__btn('停止接续'))`)));
    await shot("handoff-4-done.png");

    await js(`window.__clickText('打开新对话')`);
    await wait(1500);
    const draft = await js(`(document.querySelector('textarea') || {}).value || ""`);
    check("新对话输入框里是交接摘要、没有自动发送", draft.includes("接续自") && draft.includes("导出 Excel"), draft.slice(0, 80).replace(/\n/g, " | "));
    await shot("handoff-5-newwork.png");

    console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
    app.exit(results.every(Boolean) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
