/**
 * 语言切换 / 深浅色三档 / Agent 顶栏窄窗口换行 的界面回归。跑法（先 npm run electron:compile）：
 *   1. ALLAI_NO_SUPPLIER_SCAN=1 ALLAI_DATA_DIR=<临时目录> npx next dev --port 4693
 *      （不带 ALLAI_NO_SUPPLIER_SCAN 的话，dev server 会把本机 CLI 的真实中转站和 Key 导进去）
 *   2. SHOT_DIR=<截图目录> SHOT_URL=http://127.0.0.1:4693  *        node_modules/electron/dist/electron.exe scripts/test-i18n-ui.cjs
 *
 * 两件只有真跑起来才暴露的事：
 *   - 外观/语言用的是 OptionSelect，选项挂在 body 上的 portal 里，**折叠时 innerText 里根本没有
 *     「日间」「English」** —— 必须先点开触发器（它的标题只在 aria-label 上）再点选项；
 *   - 换模型和「接续到新对话」高度不同，判断「同一排」要比**中线**，比 top 会假失败。
 *
 * 这个 Electron profile 是几个 UI 回归共用的，开头和结尾都把 allai-lang / allai-theme 清掉，
 * 免得留下 en 让 test-handoff-ui 找不到中文按钮。
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR;
const URL = process.env.SHOT_URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = "") => { results.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
app.on("window-all-closed", () => undefined);

const now = Date.now();
const work = {
  id: "claude-code:s1", kind: "claude-code", agentName: "Claude Code",
  title: "把整个统计模块重构一遍并且补上英文适配和三档主题切换",
  cwd: "D:\\CodePorject\\Web\\AllAi", cliSessionId: "s1", running: false, model: "claude-opus-5",
  createdAt: now - 3600e3, updatedAt: now - 60e3, preview: "", source: "history",
};

app.whenReady().then(async () => {
  const handlers = {
    "window:state": () => ({ maximized: false }),
    "agent:works": () => [work],
    "agent:messages": () => [
      { id: "u1", role: "user", content: "继续", createdAt: now - 3600e3 },
      { id: "a1", role: "assistant", content: "好的。", createdAt: now - 3500e3 },
    ],
    "agent:context": () => null, "cli:detect": () => [], "cli:auth-status": () => null,
    "cli:models": () => ({ ok: false, error: "x" }), "quota:official": () => ({}),
    "computer:info": () => null, "admin:status": () => ({ elevated: false, linked: false, script: "" }),
    "agent:watch-work": () => ({ ok: true }), "agent:unwatch-work": () => ({ ok: true }), "pty:list": () => [],
    "remote:status": () => ({ state: "off", sessions: [] }),
    "cli:update-state": () => ({ autoUpdate: true, running: null, queue: [], results: {} }),
    "usage:scan": () => ({ files: 0, changed: 0, skipped: true }),
    "usage:cc-switch": () => ({ found: false, path: "", days: 0, requests: 0, tokens: 0, costUsd: 0, from: "", to: "", bySource: [] }),
    "agent:prompt": () => ({ ok: true }),
  };
  for (const [n, fn] of Object.entries(handlers)) ipcMain.handle(n, fn);
  const win = new BrowserWindow({
    width: 1400, height: 950, frame: false, show: false,
    webPreferences: { preload: path.join(ROOT, "electron-dist", "preload.js"), contextIsolation: true, sandbox: true },
  });
  const js = (s) => win.webContents.executeJavaScript(s, true);
  const shot = async (n) => { try { fs.writeFileSync(path.join(OUT, n), (await win.webContents.capturePage()).toPNG()); } catch {} };
  await win.loadURL(URL);
  await js(`try { localStorage.removeItem('allai-lang'); localStorage.removeItem('allai-theme'); } catch {} true;`).catch(() => {});
  await win.webContents.reload();
  for (let i = 0; i < 60; i++) { await wait(1000); if (await js(`document.body.innerText.length > 40`).catch(() => false)) break; }
  await wait(1500);
  await js(`window.__click = (t) => { const b=[...document.querySelectorAll('button')].find(e=>e.offsetParent!==null&&e.textContent.includes(t)); if(b)b.click(); return Boolean(b); }; true;`);
  // 给这个 Agent 配个模型，不然顶栏根本不渲染「换模型」
  const agents = await js(`fetch('/api/agents').then(r=>r.json())`);
  const ag = agents.agents.find((a) => a.kind === "claude-code");
  const body = JSON.stringify({ endpoints: [{ ...ag.endpoints[0], mode: "api", apiKey: "k", baseUrl: "https://x.invalid", models: [{ id: "claude-opus-5", label: "claude-opus-5" }] }] });
  await js(`fetch(${JSON.stringify("/api/agents/" + (ag && ag.id))}, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: ${JSON.stringify(body)} }).then(r=>r.ok)`);
  await wait(1500);

  // 打开 OptionSelect 下拉（它的标题只在 aria-label 里），再点里面的选项
  await js(`window.__pick = async (label, option) => {
    const t = [...document.querySelectorAll('button[aria-haspopup=menu]')].find(b => (b.getAttribute('aria-label')||'').startsWith(label + '：'));
    if (!t) return 'no-trigger';
    t.click();
    await new Promise(r => setTimeout(r, 250));
    const items = [...document.querySelectorAll('[role=menuitemradio]')];
    const labels = items.map(b => b.textContent);
    if (!option) { t.click(); return labels; }
    const hit = items.find(b => b.textContent.includes(option));
    if (!hit) return 'no-option:' + JSON.stringify(labels);
    hit.click();
    return 'ok';
  }; true;`);

  // ---- 窄窗口下 Agent 顶栏换行 ----
  await js(`window.__click('Agent')`);
  await wait(1200);
  await js(`window.__click('把整个统计模块')`);
  await wait(1800);
  const measure = `(() => {
    const h = document.querySelector('header'); if (!h) return { err: 'no-header' };
    const kids = [...h.children];
    const title = kids[0], second = kids[1];
    if (!second) return { err: 'one-row' };
    const handoff = [...h.querySelectorAll('button')].find(b => /接续到新对话|Continue in a new chat/.test(b.textContent));
    const model = second.querySelector('.ui-select');
    const mid = (el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
    return {
      titleTop: Math.round(title.getBoundingClientRect().top),
      secondTop: Math.round(second.getBoundingClientRect().top),
      wrapped: Math.round(second.getBoundingClientRect().top) > Math.round(title.getBoundingClientRect().top) + 8,
      handoffInSecond: Boolean(handoff && second.contains(handoff)),
      hasModel: Boolean(model),
      sameRow: Boolean(model && handoff && Math.abs(mid(model) - mid(handoff)) <= 2),
      modelLeft: Boolean(model && handoff && model.getBoundingClientRect().left < handoff.getBoundingClientRect().left),
      overflow: h.scrollWidth > h.clientWidth + 1,
    };
  })()`;
  const wide = await js(measure);
  check("宽窗口时都在标题同一排", wide && !wide.wrapped && wide.hasModel && wide.sameRow && wide.modelLeft, JSON.stringify(wide));
  win.setSize(560, 950);
  await wait(900);
  const rows = await js(measure);
  check("窄窗口下整组掉到第二排", rows && rows.wrapped && rows.handoffInSecond, JSON.stringify(rows));
  check("第二排里换模型在左、和接续同排", rows && rows.hasModel && rows.sameRow && rows.modelLeft && !rows.overflow, JSON.stringify(rows));
  await shot("narrow.png");
  win.setSize(1400, 950);
  await wait(600);

  // ---- 主题三档 ----
  await js(`window.__click('设置')`);
  await wait(2000);
  await js(`window.__click('通用')`);
  await wait(1200);
  const themeOpts = await js(`window.__pick('外观')`);
  check("设置里有外观三档（日间/夜间/跟随系统）",
    Array.isArray(themeOpts) && themeOpts.length === 3 && themeOpts.join("").includes("日间") && themeOpts.join("").includes("夜间") && themeOpts.join("").includes("跟随系统"),
    JSON.stringify(themeOpts));
  await wait(400);
  console.log("  选日间:", await js(`window.__pick('外观', '日间')`));
  await wait(800);
  check("选日间后切到浅色", !(await js(`document.documentElement.classList.contains('dark')`)));
  check("存下来的是模式而不是颜色", (await js(`localStorage.getItem('allai-theme')`)) === "light");
  await shot("light.png");
  await js(`window.__pick('外观', '夜间')`);
  await wait(800);
  check("选夜间后切回深色", await js(`document.documentElement.classList.contains('dark')`));
  await js(`window.__pick('外观', '跟随系统')`);
  await wait(800);
  check("跟随系统存的是 system", (await js(`localStorage.getItem('allai-theme')`)) === "system");

  // ---- 语言 ----
  const langOpts = await js(`window.__pick('语言')`);
  check("设置里有语言选项",
    Array.isArray(langOpts) && langOpts.join("").includes("English") && langOpts.join("").includes("中文"),
    JSON.stringify(langOpts));
  await wait(400);
  await js(`window.__pick('语言', 'English')`);
  await wait(1200);
  const en = await js(`document.body.innerText`);
  check("切英文后设置页签变英文", /General/.test(en) && /Usage/.test(en) && /About/.test(en), en.slice(0, 90).replace(/\n/g, " | "));
  check("语言存进 localStorage", (await js(`localStorage.getItem('allai-lang')`)) === "en");
  await shot("en-settings.png");
  await js(`window.__click('Close') || window.__click('关闭')`);
  await wait(1200);
  const shell = await js(`document.body.innerText`);
  check("侧栏也变英文", /New chat|New task/.test(shell) && /Search/.test(shell), shell.slice(0, 110).replace(/\n/g, " | "));
  await shot("en-shell.png");

  // 这个 Electron profile 是几个 UI 回归共用的，别把 en / light 留给下一个脚本
  await js(`try { localStorage.removeItem('allai-lang'); localStorage.removeItem('allai-theme'); } catch {} true;`).catch(() => {});

  console.log(`
${results.filter(Boolean).length}/${results.length} 通过`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
