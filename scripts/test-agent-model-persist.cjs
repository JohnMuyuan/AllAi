/**
 * 「Agent 选的模型重启后会退回去」的回归。跑法（先 npm run electron:compile）：
 *   1. ALLAI_DATA_DIR=<临时目录> npx next dev --port 4682
 *      ⚠️ dev server 启动会把本机 CLI 配置里的真实中转站和 Key 导进这个目录，跑完删掉它。
 *   2. ALLAI_DATA_DIR=<临时目录> SHOT_URL=http://127.0.0.1:4682 \
 *        node_modules/electron/dist/electron.exe scripts/test-agent-model-persist.cjs
 *
 * 复现的就是用户报的那条：works 每次启动都是重新扫 CLI 会话文件得来的，
 * 里面的 model 是**上一轮 CLI 实际用的**那个。用户在下拉里换了模型但没发送，
 * 选择只活在内存里 —— 重启就退回会话文件里的那个（0.16.19 之前）。
 *
 * 所以这里假的 agent:works 一直报 SESSION_MODEL，重开窗口后选择器必须仍然是用户选的那个。
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

// 会话文件里记的型号：每次「重启」扫出来都是它。
const SESSION_MODEL = "claude-sonnet-4-5";
const PICKED_MODEL = "claude-opus-5";

const now = Date.now();
const work = {
  id: "claude-code:sess-1", kind: "claude-code", agentName: "Claude Code", title: "做值班表",
  cwd: "D:\\tmp\\proj", cliSessionId: "sess-1", running: false, model: SESSION_MODEL,
  createdAt: now - 3600e3, updatedAt: now - 60e3, preview: "", source: "history",
};

async function boot() {
  const win = new BrowserWindow({
    width: 1440, height: 900, frame: false, show: false,
    webPreferences: { preload: path.join(ROOT, "electron-dist", "preload.js"), contextIsolation: true, sandbox: true },
  });
  // 上一个窗口刚销毁时偶尔会 ERR_FAILED，重试两次。
  for (let attempt = 0; ; attempt++) {
    try {
      await win.loadURL(URL);
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      await wait(1500);
    }
  }
  const js = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    if (await js(`document.body.innerText.includes('好')`).catch(() => false)) break;
  }
  await wait(1500);
  await js(`
    window.__btn = (text) => [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.includes(text)) || null;
    window.__clickText = (text) => { const b = window.__btn(text); if (b) b.click(); return Boolean(b); };
    true;`);
  await js(`window.__clickText('本地 Agent') || window.__clickText('Agent')`);
  await wait(1200);
  await js(`window.__clickText('做值班表')`);
  await wait(2000);
  return { win, js };
}

// 关掉最后一个窗口不要退出：这个测试要开三轮窗口模拟「重启 AllAi」。
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  try {
    const handlers = {
      "window:state": () => ({ maximized: false }),
      "agent:works": () => [work],
      "agent:messages": () => [
        { id: "u1", role: "user", content: "帮我做一个值班表", createdAt: now - 3600e3 },
        { id: "a1", role: "assistant", content: "做好了第一版。", createdAt: now - 3500e3 },
      ],
      "agent:context": () => null, "cli:detect": () => [], "cli:auth-status": () => null,
      "cli:models": () => ({ ok: false, error: "x" }), "quota:official": () => ({}),
      "computer:info": () => null, "admin:status": () => ({ elevated: false, linked: false, script: "" }),
      "agent:watch-work": () => ({ ok: true }), "agent:unwatch-work": () => ({ ok: true }), "pty:list": () => [],
      "remote:status": () => ({ state: "off", sessions: [] }),
      "cli:update-state": () => ({ autoUpdate: true, running: null, queue: [], results: {} }),
      "agent:prompt": () => ({ ok: true }),
    };
    for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);

    // 给这个 Agent 配两个模型（真的写进临时 db.json，走真实 /api/agents）。
    const first = await boot();
    const agents = await first.js(`fetch('/api/agents').then((r) => r.json())`);
    const agent = agents.agents.find((item) => item.kind === "claude-code");
    check("找得到 Claude Code 这个 Agent", Boolean(agent));
    const endpoint = agent.endpoints[0];
    const body = JSON.stringify({
      endpoints: [
        {
          ...endpoint,
          apiKey: "k",
          baseUrl: "https://example.invalid",
          models: [
            { id: SESSION_MODEL, label: SESSION_MODEL },
            { id: PICKED_MODEL, label: PICKED_MODEL },
          ],
        },
      ],
    });
    const patched = await first.js(
      `fetch(${JSON.stringify(`/api/agents/${agent.id}`)}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(body)} }).then((r) => r.ok)`,
    );
    check("给这个 Agent 配上两个模型", patched);
    first.win.destroy();

    // 第一次打开：选择器应该跟着会话文件走
    const a = await boot();
    const before = await a.js(`(window.__btn('${SESSION_MODEL}') || window.__btn('${PICKED_MODEL}') || {}).textContent || ''`);
    check("一开始显示会话文件里的型号", before.includes(SESSION_MODEL), before.trim());

    // 换成另一个模型（只选，不发送 —— 这正是会丢的那种情况）
    await a.js(`window.__clickText('${SESSION_MODEL}')`);
    await wait(600);
    // 下拉项的文字是「标签 + 来源 · 模型id」，不能按全等匹配。
    const picked = await a.js(`(() => {
      const items = [...document.querySelectorAll('button')].filter(
        (e) => e.offsetParent !== null && e.textContent.includes('${PICKED_MODEL}'),
      );
      if (!items.length) return false;
      items[items.length - 1].click();
      return true;
    })()`);
    check("能在下拉里选到另一个模型", picked);
    await wait(1200);
    const after = await a.js(`(window.__btn('${PICKED_MODEL}') || {}).textContent || ''`);
    check("选完顶栏的选择器变成新模型", after.includes(PICKED_MODEL), after.trim());
    // 等 PATCH 落盘
    await wait(1200);
    const saved = await a.js(`fetch('/api/agent-works').then((r) => r.json())`);
    check(
      "选择存进了 agentWorks 覆盖层",
      saved.works?.[work.id]?.modelKey?.endsWith('::${PICKED_MODEL}'.slice(2)) ||
        String(saved.works?.[work.id]?.modelKey || "").includes(PICKED_MODEL),
      JSON.stringify(saved.works?.[work.id] || {}),
    );
    a.win.destroy();
    await wait(500);

    // 「重启 AllAi」：新窗口，agent:works 仍然只报会话文件里的型号
    const b = await boot();
    const shown = await b.js(`(window.__btn('${PICKED_MODEL}') || window.__btn('${SESSION_MODEL}') || {}).textContent || ''`);
    check("重启后仍然是你选的那个模型", shown.includes(PICKED_MODEL), shown.trim() || "(找不到选择器)");
    b.win.destroy();

    console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
    app.exit(results.every(Boolean) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
