/**
 * 设置 → 额度监控 的界面回归。跑法（先 npm run electron:compile）：
 *   1. ALLAI_NO_SUPPLIER_SCAN=1 ALLAI_DATA_DIR=<临时目录> npx next dev --port 4694
 *      （一定带 ALLAI_NO_SUPPLIER_SCAN，不然 dev server 会把本机真实中转站和 Key 导进临时目录）
 *   2. ALLAI_DATA_DIR=<同一个目录> SHOT_DIR=<截图目录> SHOT_URL=http://127.0.0.1:4694 \
 *        node_modules/electron/dist/electron.exe scripts/test-quota-monitor-ui.cjs
 *
 * 脚本自己往数据目录里写一份假的额度历史和按小时用量（相对「现在」生成），
 * 桌面 IPC 全是假的：officialQuota 返回空（不追加采样），scanUsage 什么都不扫。
 * 不碰任何真实接口。
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
const iso = (ms) => new Date(ms).toISOString();

function seed() {
  fs.mkdirSync(DATA, { recursive: true });
  const weekReset = now + 50 * HOUR;
  const claude = [];
  // 过去 30 小时每 5 分钟一个点：夜里 8 小时没动，其余时间稳步上涨，最后到 76%
  for (let at = now - 30 * HOUR; at <= now; at += 5 * 60_000) {
    const h = (at - (now - 30 * HOUR)) / HOUR;
    const active = h < 10 ? h : h < 18 ? 10 : 10 + (h - 18);
    claude.push({
      at,
      week: Math.round(52 + (24 * active) / 22),
      weekReset: iso(weekReset),
      five: Math.min(99, Math.round(((at - now + 3 * HOUR) / HOUR) * 12)),
      fiveReset: iso(now + 2 * HOUR),
    });
  }
  for (const s of claude) if (s.five < 0) s.five = 0;
  const chatgpt = [
    { at: now - 3 * HOUR, week: 30, weekReset: iso(now + 140 * HOUR), five: 20, fiveReset: iso(now + HOUR), plan: "plus", resetCredits: 2 },
    { at: now - HOUR, week: 33, weekReset: iso(now + 140 * HOUR), five: 45, fiveReset: iso(now + HOUR), plan: "plus", resetCredits: 2 },
    { at: now, week: 34, weekReset: iso(now + 140 * HOUR), five: 53, fiveReset: iso(now + HOUR), plan: "plus", resetCredits: 2 },
  ];
  const grok = [
    { at: now - 2 * HOUR, week: 64, weekStart: iso(now - 100 * HOUR), weekReset: iso(now + 68 * HOUR), resetCredits: 1 },
    { at: now, week: 66, weekStart: iso(now - 100 * HOUR), weekReset: iso(now + 68 * HOUR), resetCredits: 1 },
  ];
  fs.writeFileSync(path.join(DATA, "quota-history.json"), JSON.stringify({ version: 1, accounts: { claude, chatgpt, grok } }));

  const bucket = (tokens, costUsd = 0) => ({
    input: Math.round(tokens * 0.9),
    output: Math.round(tokens * 0.1),
    cacheRead: Math.round(tokens * 0.6),
    cacheWrite: 0,
    reasoning: 0,
    costUsd,
    requests: Math.max(1, Math.round(tokens / 200_000)),
  });
  const claudeHours = {};
  const codexHours = {};
  const base = Math.floor(now / HOUR) * HOUR;
  for (let i = 0; i < 90; i++) {
    const hour = base - i * HOUR;
    const quiet = i >= 12 && i < 20;
    if (!quiet) {
      claudeHours[hour] = {
        "claude-opus-5": bucket(3_000_000 + (i % 5) * 900_000),
        "claude-sonnet-5": bucket(1_200_000),
        ...(i % 7 === 0 ? { "claude-haiku-4-5": bucket(400_000) } : {}),
      };
    }
    if (i < 3) codexHours[hour] = { "gpt-6-astra": bucket(2_000_000) };
  }
  const file = (kind, official, hours) => ({ size: 1, mtimeMs: now, offset: 1, days: {}, kind, official, v: 2, hours });
  fs.writeFileSync(
    path.join(DATA, "usage-rollups.json"),
    JSON.stringify({
      version: 1,
      files: {
        "C:/fake/.claude/projects/p/s1.jsonl": file("claude-code", true, claudeHours),
        "C:/fake/.codex/sessions/rollout-official.jsonl": file("codex", true, codexHours),
        "C:/fake/.codex/sessions/rollout-relay.jsonl": file("codex", false, { [base]: { "gpt-6-astra": bucket(9_000_000) } }),
        "C:/fake/.grok/sessions/s/updates.jsonl": file("grok-build", false, { [base]: { "grok-4.6": bucket(5_000_000, 1.2) } }),
      },
      imports: {},
    }),
  );
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
      // 窗口是隐藏的，不强制重绘的话 capturePage 可能拿到上一帧（实测截到过切页签之前的画面）
      win.webContents.invalidate();
      await wait(700);
      await win.webContents.capturePage(); // 第一帧常常还是旧的，丢掉
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

  try {
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
    check("设置里有「额度监控」页签", await js("window.__click('额度监控')"));
    for (let i = 0; i < 30; i++) {
      await wait(500);
      if (await js("document.body.innerText.includes('周额度已用')")) break;
    }
    const text = await js("document.body.innerText");
    check("三个账号都出来了", /Claude 账号/.test(text) && /ChatGPT 账号/.test(text) && /Grok 账号/.test(text));
    check("关键指标都在", ["周额度已用", "5 小时已用", "消耗速度", "预计用完", "周额度折合", "每 1% 约", "本周已消耗"].every((k) => text.includes(k)));
    check("周额度已用 76%", /周额度已用\s*76%/.test(text), (text.match(/周额度已用[^\n]*\n[^\n]*/) || [""])[0]);
    check("折合金额按美元显示", /周额度折合\s*\$[\d,.]+/.test(text), (text.match(/周额度折合[^\n]*\n[^\n]*/) || [""])[0]);
    check("型号表里有 claude-opus-5 和 claude-sonnet-5", /claude-opus-5/.test(text) && /claude-sonnet-5/.test(text));
    check("健康提示有标题和说明", /(额度充裕|有点紧|会提前用完|马上就要用完)/.test(text) && /按现在的速度/.test(text));
    check("Claude 的归属说明写清楚了", /settings\.json/.test(text));
    const charts = await js("document.querySelectorAll('svg[role=img]').length");
    check("两张 SVG 图（走势 + 每小时）", charts >= 2, String(charts));
    const projection = await js("Boolean(document.querySelector('svg[role=img] line[stroke-dasharray]'))");
    check("走势图画了按当前速度推算的虚线", projection);
    await shot("quota-light.png");

    // 悬停走势图：出提示
    const tip = await js(`(async () => {
      const svg = document.querySelector('svg[aria-label="周额度已用走势"]');
      if (!svg) return 'no-svg';
      const r = svg.getBoundingClientRect();
      svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.45, clientY: r.top + r.height / 2 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const box = svg.parentElement.querySelector('.pointer-events-none');
      return box ? box.textContent : 'no-tip';
    })()`);
    check("悬停走势图出现百分比提示", /\d+%/.test(tip), tip);
    await shot("quota-hover.png");
    await js("(() => { const el = document.querySelector('svg[aria-label=\"近 24 小时每小时消耗\"]'); if (el) el.scrollIntoView({ block: 'start' }); return true; })()");
    await shot("quota-lower.png");

    // 切到 ChatGPT：订阅档位、重置次数
    await js("window.__click('ChatGPT 账号')");
    await wait(600);
    const gpt = await js("document.body.innerText");
    check("切到 ChatGPT 显示订阅档位和重置次数", /plus/i.test(gpt) && /可用重置次数\s*2/.test(gpt), (gpt.match(/可用重置次数[^\n]*\n[^\n]*/) || [""])[0]);
    check("Codex 排除走中转的会话并写明数量", /排除走中转的 1 个/.test(gpt));

    // Grok：本机 Grok 走中转，会话不算，要说清楚
    await js("window.__click('Grok 账号')");
    await wait(600);
    const grok = await js("document.body.innerText");
    check("Grok 说明了为什么没算本机会话", /1 个 Grok Build 会话都没有计入/.test(grok));
    check("Grok 没有本机用量时不硬编一个折算", /已用 2% 以上、且本机有这个账号的用量后才能估/.test(grok));

    // 深色
    await js("window.__click('Claude 账号')");
    await js("document.documentElement.classList.add('dark'); true;");
    await wait(500);
    await shot("quota-dark.png");
    await js("document.documentElement.classList.remove('dark'); true;");

    // 窄窗口不横向溢出
    win.setSize(640, 1000);
    await wait(800);
    const overflow = await js(
      "(() => { const el = [...document.querySelectorAll('div')].find((d) => d.className && String(d.className).includes('overflow-y-auto') && d.innerText.includes('周额度已用')); return el ? el.scrollWidth - el.clientWidth : -1; })()",
    );
    check("窄窗口页面本身不横向溢出", overflow >= 0 && overflow <= 1, String(overflow));
    const cut = await js(
      "[...document.querySelectorAll('[data-model-name]')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent)",
    );
    const names = await js("document.querySelectorAll('[data-model-name]').length");
    check("窄窗口下型号名不被截断", names > 0 && cut.length === 0, `${names} 个型号，被截断：${cut.join(", ")}`);
    await shot("quota-narrow.png");
    win.setSize(1280, 1000);
    await wait(500);

    // 英文
    await js("localStorage.setItem('allai-lang', 'en'); true;");
    await win.webContents.reload();
    for (let i = 0; i < 40; i++) {
      await wait(500);
      if (await js("document.body.innerText.length > 40").catch(() => false)) break;
    }
    await wait(800);
    await js(
      "window.__click = (t) => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim().includes(t)); if (b) b.click(); return Boolean(b); }; true;",
    );
    await js("window.__click('Settings')");
    await wait(1200);
    check("英文界面有 Quota monitor 页签", await js("window.__click('Quota monitor')"));
    for (let i = 0; i < 30; i++) {
      await wait(500);
      if (await js("document.body.innerText.includes('Burn rate')")) break;
    }
    const en = await js("document.body.innerText");
    check("英文指标", ["Weekly used", "Burn rate", "Runs out", "Weekly quota worth"].every((k) => en.includes(k)));
    await shot("quota-en.png");

    check("控制台没有报错", errors.length === 0, errors.slice(0, 3).join(" | "));
    // 界面启动时会调 POST /api/providers/scan。带了 ALLAI_NO_SUPPLIER_SCAN 就不能往临时目录里导任何真实凭据。
    let leaked = [];
    try {
      const db = JSON.parse(fs.readFileSync(path.join(DATA, "db.json"), "utf8"));
      leaked = [
        ...(db.providers || []).filter((item) => item.apiKey),
        ...(db.agents || []).flatMap((agent) => (agent.endpoints || []).filter((item) => item.apiKey)),
      ];
    } catch {
      // 没有 db.json 就是什么都没导
    }
    check("临时数据目录里没有被导进任何 Key", leaked.length === 0, `${leaked.length} 条带 Key 的接口`);
  } finally {
    await js("try { localStorage.removeItem('allai-lang'); localStorage.removeItem('allai-theme'); } catch {} true;").catch(() => undefined);
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`);
  app.exit(results.every(Boolean) ? 0 : 1);
});
