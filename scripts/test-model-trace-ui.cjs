/**
 * 设置 → 溯源 的界面回归。跑法（先 npm run electron:compile）：
 *   1. ALLAI_NO_SUPPLIER_SCAN=1 ALLAI_DATA_DIR=<临时目录> npx next dev --port 4695
 *   2. ALLAI_DATA_DIR=<同一个目录> SHOT_DIR=<截图目录> SHOT_URL=http://127.0.0.1:4695 \
 *        node_modules/electron/dist/electron.exe scripts/test-model-trace-ui.cjs
 *
 * 脚本自己往数据目录里写一份假的探测记录（含候选排名和旧格式记录各一种），
 * 不发任何真实请求、不打任何模型。
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = process.env.ALLAI_DATA_DIR;
const OUT = process.env.SHOT_DIR;
const URL = process.env.SHOT_URL;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
app.on("window-all-closed", () => undefined);

const HOUR = 3_600_000;
const now = Date.now();

function seed() {
  fs.mkdirSync(DATA, { recursive: true });
  const records = [];
  for (let i = 0; i < 26; i++) {
    const mismatch = i % 7 === 3;
    const expected = i % 2 ? "claude-opus-5" : "gpt-6-astra";
    records.push({
      id: `r${i}`,
      at: now - i * 7 * HOUR,
      expected,
      predicted: mismatch ? "claude-haiku-4-5-20251001" : expected,
      predictedName: mismatch ? "Claude Haiku 4.5" : expected === "claude-opus-5" ? "Claude Opus 5" : "GPT-6 Astra",
      family: expected.startsWith("claude") ? "claude" : "gpt",
      probability: mismatch ? 0.62 : 0.93,
      mismatch,
      source: i % 3 === 0 ? "manual" : "auto",
      // 最后一条故意做成旧格式：没有 candidates，界面要给出解释而不是空白
      ...(i === 25
        ? {}
        : {
            candidates: [
              { model: mismatch ? "claude-haiku-4-5-20251001" : expected, name: mismatch ? "Claude Haiku 4.5" : "本尊", probability: mismatch ? 0.62 : 0.93 },
              { model: "claude-sonnet-5", name: "Claude Sonnet 5", probability: 0.21 },
              { model: "gpt-5.5", name: "GPT-5.5", probability: 0.09 },
            ],
            usedOutputs: 3,
            queries: 3,
            familyProbability: 0.97,
          }),
    });
  }
  fs.writeFileSync(path.join(DATA, "model-trace.json"), JSON.stringify({ records: [...records].reverse() }, null, 2));
}

app.whenReady().then(async () => {
  seed();
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
  await js(
    "window.__click = (t) => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim().includes(t)); if (b) b.click(); return Boolean(b); }; true;",
  );

  await js("window.__click('设置')");
  await wait(1500);
  check("设置里有「溯源」页签", await js("window.__click('溯源')"));
  for (let i = 0; i < 30; i++) {
    await wait(500);
    if (await js("document.body.innerText.includes('累计探测')")) break;
  }

  const text = await js("document.body.innerText");
  check("有结论卡（最近多少次里几次对不上）", /最近 \d+ 次里有 \d+ 次对不上/.test(text), (text.match(/最近 \d+ 次里有[^\n]*/) || [""])[0]);
  check("四个指标卡都在", ["累计探测", "对不上", "平均把握", "覆盖型号"].every((k) => text.includes(k)));
  check("有近 14 天趋势和按型号统计", /最近 14 天/.test(text) && /按型号/.test(text));
  check("按型号里列出了实测过的型号", /gpt-6-astra/.test(text) && /claude-opus-5/.test(text));
  check("指纹库信息写了覆盖型号数和构建日期", /指纹库覆盖 13 个型号/.test(text) && /构建于 20/.test(text), (text.match(/指纹库覆盖[^\n]*/) || [""])[0]);
  const charts = await js("document.querySelectorAll('svg[role=img]').length");
  check("有趋势图", charts >= 1, String(charts));
  await shot("trace-light.png");

  // 展开一条记录：要能看到候选排名
  const expanded = await js(`(async () => {
    const rows = [...document.querySelectorAll('button[aria-expanded]')];
    const row = rows.find((b) => /对不上：|相符：/.test(b.textContent));
    if (!row) return 'no-row';
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    return document.body.innerText.includes('Claude Sonnet 5') ? 'ok' : 'no-candidates';
  })()`);
  check("展开记录能看到候选排名", expanded === "ok", String(expanded));
  await shot("trace-expanded.png");

  // 深色
  await js("document.documentElement.classList.add('dark'); true;");
  await wait(400);
  await shot("trace-dark.png");
  await js("document.documentElement.classList.remove('dark'); true;");

  // 窄窗口
  win.setSize(640, 1000);
  await wait(800);
  const overflow = await js(
    "(() => { const el = [...document.querySelectorAll('div')].find((d) => d.className && String(d.className).includes('overflow-y-auto') && d.innerText.includes('累计探测')); return el ? el.scrollWidth - el.clientWidth : -1; })()",
  );
  check("窄窗口不横向溢出", overflow >= 0 && overflow <= 1, String(overflow));
  await shot("trace-narrow.png");
  win.setSize(1280, 1000);
  await wait(400);

  // 清空重测
  const cleared = await js(`(async () => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("清空重测"));
    if (!btn) return "no-button";
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const ok = [...document.querySelectorAll("button")].find((b) => b.offsetParent !== null && b.textContent.trim() === "清空");
    if (!ok) return "no-confirm";
    ok.click();
    await new Promise((r) => setTimeout(r, 1500));
    return document.body.innerText.includes("还没有探测记录") ? "empty" : document.body.innerText.slice(0, 60);
  })()`);
  check("清空重测：确认后记录归零", cleared === "empty", String(cleared));

  check("控制台没有报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await js("try { localStorage.removeItem('allai-theme'); } catch {} true;").catch(() => undefined);

  console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
