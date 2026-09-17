/**
 * 设置里的排序和 Agent 图标。跑法（先 npm run electron:compile）：
 *   1. ALLAI_NO_SUPPLIER_SCAN=1 ALLAI_DATA_DIR=<临时目录> npx next dev --port 4696
 *   2. ALLAI_DATA_DIR=<同一个目录> SHOT_DIR=<截图目录> SHOT_URL=http://127.0.0.1:4696 \
 *        node_modules/electron/dist/electron.exe scripts/test-settings-order-ui.cjs
 *
 * 盯三件事：
 *   - 聊天模型里的服务能上移下移，**刷新之后顺序还在**（顺序存在 db.json 的 providers 数组里）；
 *   - Agent 列表里显示自定义图标；
 *   - Agent 接口里的本地接口能排序，全局接口不给排（它的顺序归「全局提供商」那页管）。
 * 服务是脚本自己通过接口建的，不碰你真的配置。
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = process.env.SHOT_DIR;
const URL = process.env.SHOT_URL;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const handlers = {
    "window:state": () => ({ maximized: false }),
    "agent:works": () => [],
    "agent:context": () => null,
    "cli:detect": () => [],
    "cli:auth-status": () => null,
    "cli:models": () => ({ ok: false, error: "x" }),
    "quota:official": () => ({}),
    "computer:info": () => null,
    "admin:status": () => ({ elevated: false, linked: false, script: "" }),
    "pty:list": () => [],
    "agent:watch-work": () => ({ ok: true }),
    "agent:unwatch-work": () => ({ ok: true }),
    "remote:status": () => ({ state: "off", sessions: [] }),
    "cli:update-state": () => ({ autoUpdate: true, running: null, queue: [], results: {} }),
    "usage:scan": () => ({ files: 0, changed: 0, skipped: true }),
    "usage:cc-switch": () => ({ found: false, path: "", days: 0, requests: 0, tokens: 0, costUsd: 0, from: "", to: "", bySource: [] }),
    "app-update:state": () => ({ status: "idle" }),
  };
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);

  const win = new BrowserWindow({
    width: 1280,
    height: 1000,
    frame: false,
    show: false,
    webPreferences: { preload: path.join(ROOT, "electron-dist", "preload.js"), contextIsolation: true, sandbox: true },
  });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const shot = async (name) => {
    try {
      win.webContents.invalidate();
      await wait(700);
      await win.webContents.capturePage();
      await wait(300);
      fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG());
    } catch {
      // 截图失败不影响断言
    }
  };
  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });

  await win.loadURL(URL);
  await js("try { localStorage.removeItem('allai-lang'); localStorage.setItem('allai-theme', 'light'); } catch {} true;");
  await win.webContents.reload();
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    if (await js("document.body.innerText.length > 40").catch(() => false)) break;
  }
  await wait(1200);

  // 上一次跑剩下的先删掉，免得越堆越多（这个脚本要能反复跑）
  await js(`fetch('/api/providers').then((r) => r.json()).then((d) => Promise.all(
    (d.providers || []).filter((p) => p.name.startsWith('排序')).map((p) => fetch('/api/providers/' + p.id, { method: 'DELETE' })),
  )).then(() => true)`);
  await wait(500);

  // 建三条服务（顺序 甲 → 乙 → 丙）
  for (const name of ["排序甲", "排序乙", "排序丙"]) {
    await js(
      `fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ${JSON.stringify(name)}, baseUrl: 'https://x.invalid/v1', apiKey: 'k', models: [] }) }).then((r) => r.ok)`,
    );
  }
  // 给第一个 Agent 配个自定义图标
  const agentId = await js("fetch('/api/agents').then((r) => r.json()).then((d) => d.agents[0] && d.agents[0].id)");
  const dot = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3E%3Ccircle cx='4' cy='4' r='4' fill='%23e11d48'/%3E%3C/svg%3E";
  await js(
    `fetch('/api/prefs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandIcons: { ${JSON.stringify("agent:" + String(agentId).toLowerCase())}: ${JSON.stringify(dot)} } }) }).then((r) => r.ok)`,
  );
  await win.webContents.reload();
  for (let i = 0; i < 40; i++) {
    await wait(500);
    if (await js("document.body.innerText.length > 40").catch(() => false)) break;
  }
  await wait(1000);
  await js(
    "window.__click = (t) => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim().includes(t)); if (b) b.click(); return Boolean(b); }; true;",
  );

  await js("window.__click('设置')");
  await wait(1200);
  await js("window.__click('模型与接口')");
  await wait(1200);

  // 按钮文字是「排序丙0 个模型」，只取前三个字当名字
  const names = () =>
    js(
      "[...document.querySelectorAll('aside button')].map((b) => b.textContent.trim()).filter((t) => t.startsWith('排序')).map((t) => t.slice(0, 3))",
    );
  const before = await names();
  check("三条服务都在列表里", before.length === 3, JSON.stringify(before));

  // 把「排序丙」上移一格
  const moved = await js(`(async () => {
    const up = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "") === "上移 排序丙");
    if (!up) return "no-up";
    up.click();
    await new Promise((r) => setTimeout(r, 1800));
    return "clicked";
  })()`);
  check("服务行上有上移按钮", moved === "clicked", String(moved));
  await wait(800);
  const after = await names();
  check(
    "上移之后顺序变了（丙 排到了第二个）",
    JSON.stringify(after) === JSON.stringify(["排序甲", "排序丙", "排序乙"]),
    JSON.stringify(after),
  );

  // 拖拽排序：把第一条拖到第三条上（HTML5 拖放，手柄发起）
  const dragged = await js(`(async () => {
    const rows = [...document.querySelectorAll("aside div")].filter((d) => d.querySelector("[title='拖动排序']"));
    const find = (name) => rows.find((d) => d.textContent.trim().startsWith(name));
    const from = find("排序甲");
    const to = find("排序乙");
    if (!from || !to) return "no-rows:" + rows.length;
    const handle = from.querySelector("[title='拖动排序']");
    if (!handle) return "no-handle";
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 100));
    to.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
    handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 1800));
    return "dropped";
  })()`);
  check("行上有拖动手柄，拖放能触发", dragged === "dropped", String(dragged));
  await wait(800);
  const afterDrag = await names();
  // 上一步箭头排成了 甲丙乙；把「甲」拖到「乙」那一格 → 丙乙甲
  check("拖拽之后顺序跟着变", JSON.stringify(afterDrag) === JSON.stringify(["排序丙", "排序乙", "排序甲"]), JSON.stringify(afterDrag));

  // 刷新页面，顺序要留在后端
  await win.webContents.reload();
  for (let i = 0; i < 40; i++) {
    await wait(500);
    if (await js("document.body.innerText.length > 40").catch(() => false)) break;
  }
  await wait(1000);
  await js(
    "window.__click = (t) => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim().includes(t)); if (b) b.click(); return Boolean(b); }; true;",
  );
  await js("window.__click('设置')");
  await wait(1200);
  await js("window.__click('模型与接口')");
  await wait(1500);
  const reloaded = await names();
  check("刷新之后顺序还在（存进了 db.json）", JSON.stringify(reloaded) === JSON.stringify(afterDrag), JSON.stringify(reloaded));
  await shot("order-providers.png");

  // Agent 接口：自定义图标 + 本地接口排序
  await js("window.__click('Agent 接口')");
  await wait(1500);
  const avatar = await js(
    "Boolean([...document.querySelectorAll('aside img')].find((img) => (img.getAttribute('src') || '').startsWith('data:image/svg+xml')))",
  );
  check("Agent 列表显示自定义图标", avatar);
  const endpointOrder = await js(`(async () => {
    const list = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '') === '上移');
    return list.length;
  })()`);
  check("Agent 接口里出现排序按钮", endpointOrder >= 1, String(endpointOrder));
  await shot("order-agents.png");

  // 收尾：把自己建的服务删掉。数据目录是几个探针共用的，
  // 留着会踩「临时目录里不得有 Key」那条断言（额度探针在查）。
  await js(`fetch("/api/providers").then((r) => r.json()).then((d) => Promise.all(
    (d.providers || []).filter((p) => p.name.startsWith("排序")).map((p) => fetch("/api/providers/" + p.id, { method: "DELETE" })),
  )).then(() => true)`);
  await wait(500);
  check("控制台没有报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await js("try { localStorage.removeItem('allai-theme'); } catch {} true;").catch(() => undefined);

  console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
