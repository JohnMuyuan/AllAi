// 用法（先 npm run electron:compile && npm run remote:build）：
//   1. 准备一个隔离数据目录，db.json 里放一个指向 http://127.0.0.1:4611/v1 的假服务
//      （聊天模型 mock-chat、生图模型 mock-image，prefs.studioImageModelKey = "mock::mock-image"），
//      再加一个 kind 为 claude-code 的 Agent。见 docs/HANDOFF.md「远程控制」。
//   2. ALLAI_DATA_DIR=<目录> npx next dev --port 4672
//   3. ALLAI_DATA_DIR=<目录> DEV_URL=http://127.0.0.1:4672 SHOT_DIR=<截图目录> //        node_modules/electron/dist/electron.exe scripts/test-remote-e2e.cjs
// ⚠️ 起 dev server 时一定要带 ALLAI_NO_SUPPLIER_SCAN=1，否则它会把本机 CLI 配置里的
//    真实中转站和 Key 导进这个隔离目录。测完把目录删掉。
// 远程控制端到端测试：中继 + 电脑（真实界面 + 真实 remote.js）+ 模拟手机（真实手机网页）。
// 中间插一个记录所有帧的代理，验证中继能看到的内容里没有任何明文。
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { WebSocket, WebSocketServer } = require(path.join(ROOT, "node_modules/ws"));
const QRCode = require(path.join(ROOT, "node_modules/qrcode"));

const DATA = process.env.ALLAI_DATA_DIR;
const DEV = process.env.DEV_URL;
const OUT = process.env.SHOT_DIR;
const RELAY_PORT = 8790;
const PROXY_PORT = 8791;
const TOKEN = "e2e-token-0123456789abcdef";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// ---------- 模拟模型网关 ----------
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAAAgpAgHz1c5yAAAAAElFTkSuQmCC",
  "base64",
);
let lastChatBody = null;
// 聊完还会有一次生成标题的请求（不带图），所以要看所有请求，不能只看最后一次。
const chatBodies = [];
const gateway = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-chat" }, { id: "mock-image" }] }));
      return;
    }
    if (req.url.endsWith("/images/generations") || req.url.endsWith("/images/edits")) {
      await wait(1500);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
      return;
    }
    if (req.url.endsWith("/chat/completions")) {
      lastChatBody = JSON.parse(body || "{}");
      chatBodies.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const parts = ["Mock 回复：", "收到", "你的", "消息"];
      for (const part of parts) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
        await wait(250);
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

// ---------- 记录帧的代理（站在中继的位置上看流量） ----------
const frames = [];
const phoneLinks = []; // { client, upstream, lastFromClient }
function startProxy() {
  const server = http.createServer((req, res) => {
    const up = http.request(
      { host: "127.0.0.1", port: RELAY_PORT, path: req.url, method: req.method, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      },
    );
    req.pipe(up);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}${req.url}`);
      const entry = { client, upstream, role: null, lastFromClient: null, queue: [] };
      upstream.on("open", () => {
        for (const m of entry.queue) upstream.send(m);
        entry.queue = [];
      });
      client.on("message", (data) => {
        const text = data.toString();
        frames.push(text);
        if (!entry.role) {
          try {
            entry.role = JSON.parse(text).t;
            if (entry.role === "device") phoneLinks.push(entry);
          } catch {}
        }
        if (text.includes('\\"s\\"')) entry.lastFromClient = text;
        if (upstream.readyState === 1) upstream.send(text);
        else entry.queue.push(text);
      });
      upstream.on("message", (data) => {
        const text = data.toString();
        frames.push(text);
        if (client.readyState === 1) client.send(text);
      });
      client.on("close", () => upstream.close());
      upstream.on("close", (code, reason) => {
        try {
          client.close(code >= 4000 ? code : 1000, reason.toString());
        } catch {}
      });
    });
  });
  return new Promise((resolve) => server.listen(PROXY_PORT, "127.0.0.1", resolve));
}

function rawSocket(hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/ws`);
    const got = [];
    ws.on("open", () => ws.send(JSON.stringify(hello)));
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    ws.on("close", (code) => got.push({ closed: code }));
    resolve({ ws, got });
  });
}

// ---------- 假的桌面端 IPC（Agent 不真的启动 CLI） ----------
const prompts = [];
function fakeIpc(getWin) {
  const now = Date.now();
  const work = {
    id: "claude-code:sess-1",
    kind: "claude-code",
    agentName: "Claude Code",
    title: "修复登录问题",
    cwd: "D:\\tmp\\proj",
    cliSessionId: "sess-1",
    running: false,
    createdAt: now - 3600e3,
    updatedAt: now - 60e3,
    preview: "",
    source: "history",
  };
  const handlers = {
    "window:state": () => ({ maximized: false }),
    "agent:works": () => [work],
    "agent:messages": () => [
      { id: "h1", role: "user", content: "登录页报 500", createdAt: now - 3600e3 },
      { id: "h2", role: "assistant", content: "我看了一下，是 session 过期处理的问题。", createdAt: now - 3500e3 },
    ],
    "agent:context": () => null,
    "cli:detect": () => [],
    "cli:auth-status": () => null,
    "cli:models": () => ({ ok: false, error: "test" }),
    "quota:official": () => ({}),
    "computer:info": () => null,
    "admin:status": () => ({ elevated: false, linked: false, script: "" }),
    "agent:watch-work": () => ({ ok: true }),
    "agent:unwatch-work": () => ({ ok: true }),
    "pty:list": () => [],
    "pty:kill": () => undefined,
    "agent:prompt": (_e, opts) => {
      prompts.push(opts);
      const win = getWin();
      const send = (event) => win.webContents.send("agent:event", opts.sessionId, event);
      setTimeout(() => send({ type: "tool", name: "Read", detail: "src/login.ts" }), 300);
      setTimeout(() => send({ type: "delta", text: "Agent 回复：" }), 700);
      setTimeout(() => send({ type: "delta", text: "已经修好了登录。" }), 1100);
      setTimeout(() => send({ type: "done" }), 1500);
      return { ok: true };
    },
  };
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, fn);
}

app.whenReady().then(async () => {
  try {
    await new Promise((r) => gateway.listen(4611, "127.0.0.1", r));
    const relay = spawn(process.env.NODE_EXE || "node", [path.join(ROOT, "relay/dist/server.cjs")], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(RELAY_PORT), HOST: "127.0.0.1", RELAY_TOKEN: TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let relayLog = "";
    relay.stdout.on("data", (d) => (relayLog += d));
    relay.stderr.on("data", (d) => (relayLog += d));
    app.on("before-quit", () => relay.kill());
    await wait(800);
    await startProxy();

    fs.writeFileSync(
      path.join(DATA, "remote.json"),
      JSON.stringify({
        enabled: true,
        relayUrl: `http://127.0.0.1:${PROXY_PORT}`,
        token: `raw:${TOKEN}`,
        desktopId: "0123456789abcdef0123456789abcdef",
        desktopName: "测试电脑",
        caps: { followPermission: true, allowAdmin: false },
        devices: [],
      }),
    );

    let desk = null;
    fakeIpc(() => desk);
    const { initRemote } = require(path.join(ROOT, "electron-dist/remote.js"));
    initRemote({ getWindow: () => desk, getLocalUrl: () => DEV });

    desk = new BrowserWindow({
      width: 1300,
      height: 860,
      frame: false,
      webPreferences: { preload: path.join(ROOT, "electron-dist/preload.js"), contextIsolation: true, sandbox: true },
    });
    await desk.loadURL(DEV);
    const dj = (s) => desk.webContents.executeJavaScript(s, true);
    for (let i = 0; i < 60; i++) {
      await wait(1000);
      const ok = await dj(`document.body.innerText.includes('新对话') || document.body.innerText.includes('聊天')`).catch(() => false);
      if (ok) break;
    }
    await wait(3000);

    let status = null;
    for (let i = 0; i < 20; i++) {
      status = await dj(`window.allaiDesktop.remoteStatus()`);
      if (status.state === "online") break;
      await wait(500);
    }
    check("电脑连上中继", status && status.state === "online", JSON.stringify(status));

    // ---- 口令错误的电脑被拒 ----
    const bad = await rawSocket({ t: "desktop", id: "fedcba9876543210fedcba9876543210", token: "wrong-token-000000000" });
    await wait(600);
    check("口令错误的电脑被中继拒绝", bad.got.some((m) => m.closed === 4401), JSON.stringify(bad.got));

    // ---- 配对 ----
    const pair = await dj(`window.allaiDesktop.remotePair()`);
    check("生成配对链接", pair.ok && pair.link.includes("#pair="), pair.link);
    const invite = JSON.parse(Buffer.from(pair.link.split("#pair=")[1], "base64url").toString());

    const phone = new BrowserWindow({
      width: 400,
      height: 860,
      x: 40,
      y: 40,
      webPreferences: { partition: "persist:phone-e2e-" + Date.now(), contextIsolation: true },
    });
    const pj = (s) => phone.webContents.executeJavaScript(s, true);
    const shot = async (name) => { try { fs.writeFileSync(path.join(OUT, name), (await phone.webContents.capturePage()).toPNG()); } catch (e) { console.log("shot failed", name, e.message); } };
    const deskShot = async (name) => { try { fs.writeFileSync(path.join(OUT, name), (await desk.webContents.capturePage()).toPNG()); } catch (e) { console.log("shot failed", name, e.message); } };
    phone.webContents.on("console-message", (e) => {
      const m = e.message || "";
      if (/error|fail/i.test(m)) console.log("[phone console]", m.slice(0, 200));
    });
    // 先按「电脑浏览器」打开首页，再模拟触屏手机，从扫码入口配对。
    await phone.loadURL(new URL(pair.link).origin + "/");
    await wait(1500);
    await shot("01-pair.png");
    const helpers = `
      window.__vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
      window.__click = (text) => { const b = window.__vis('button').find((e) => e.textContent.trim() === text || e.getAttribute('aria-label') === text); if (b) b.click(); return Boolean(b); };
      window.__clickHas = (text) => { const b = window.__vis('button').find((e) => e.textContent.includes(text)); if (b) b.click(); return Boolean(b); };
      window.__type = (text) => { const t = window.__vis('textarea')[0]; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, text); t.dispatchEvent(new Event('input', { bubbles: true })); return true; };
      true;`;
    await pj(helpers);
    const deskScan = await pj(`window.__vis('button').some((b) => b.textContent.includes('扫码'))`);
    check("电脑浏览器上不显示扫码按钮", !deskScan);
    phone.webContents.debugger.attach("1.3");
    await phone.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    phone.webContents.reload();
    await wait(2500);
    await pj(helpers);
    const scanBtn = await pj(`window.__clickHas('扫码配对')`);
    check("触屏手机上有扫码按钮", scanBtn);
    await wait(1500);
    const qr = (await QRCode.toBuffer(pair.link, { margin: 2, width: 360 })).toString("base64");
    await pj(`(() => {
      const bytes = Uint8Array.from(atob('${qr}'), (c) => c.charCodeAt(0));
      const input = document.querySelector('[data-scan-file]');
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'qr.png', { type: 'image/png' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    let pairScreen = false;
    for (let i = 0; i < 20; i++) {
      await wait(300);
      pairScreen = await pj(`document.body.innerText.includes('和「测试电脑」配对')`);
      if (pairScreen) break;
    }
    check("扫码（从相册选二维码图）识别出配对信息", pairScreen);
    await pj(`window.__click('配对')`);
    let paired = false;
    for (let i = 0; i < 30; i++) {
      await wait(500);
      paired = await pj(`document.body.innerText.includes('修复登录问题')`).catch(() => false);
      if (paired) break;
    }
    await pj(helpers);
    check("手机配对成功并同步到 Agent 列表", paired);

    // 模拟 iPhone 杀后台：整页重开；再模拟 IndexedDB 整个丢了（只剩 localStorage 那份）。
    const reopen = async () => {
      phone.webContents.reload();
      for (let i = 0; i < 30; i++) {
        await wait(500);
        if (await pj(`document.body.innerText.includes('修复登录问题')`).catch(() => false)) return true;
      }
      return false;
    };
    check("重开网页后不用重新配对", await reopen());
    await pj(`new Promise((r) => { const q = indexedDB.deleteDatabase('allai-remote'); q.onsuccess = q.onerror = q.onblocked = () => r(true); })`);
    check("IndexedDB 丢了也能从备份恢复配对", await reopen());
    await pj(helpers);
    await shot("02-agent-list.png");
    const chip = await dj(`document.querySelector('[aria-label="远程控制"]')?.textContent`);
    check("电脑标题栏显示 1 台设备在线", chip === "1", String(chip));

    // ---- 二维码只能用一次 ----
    const reuse = await rawSocket({ t: "device", desktop: invite.d, id: "aa".repeat(16) });
    await wait(400);
    reuse.ws.send(JSON.stringify({ t: "send", d: JSON.stringify({ p: { op: "pair", p: invite.p, d: "AAAA" } }) }));
    await wait(600);
    const reuseReply = reuse.got.find((m) => m.t === "msg");
    check("用过的二维码不能再配对", reuseReply && reuseReply.d.includes("pair-failed"), reuseReply && reuseReply.d);

    // ---- 没配对的设备被拒 ----
    reuse.ws.send(JSON.stringify({ t: "send", d: JSON.stringify({ p: { op: "hello", n: Buffer.alloc(16).toString("base64") } }) }));
    await wait(600);
    check("没配对的设备打招呼被拒", reuse.got.some((m) => m.t === "msg" && m.d.includes("denied")));
    reuse.ws.close();

    // 0.16.7 起手机打开 Agent 由主进程直接盯真实会话文件，这里假的工作没有文件，打不开历史。
    // SKIP_AGENT=1 跳过这一段，其余照常测。
    if (!process.env.SKIP_AGENT) {
    // ---- Agent ----
    await pj(`window.__clickHas('修复登录问题')`);
    await wait(2500);
    await pj(helpers);
    const history = await pj(`document.body.innerText.includes('session 过期')`);
    check("手机打开 Agent 工作能看到历史", history);
    await pj(`window.__type('E2E-AGENT-SECRET 帮我修一下登录')`);
    await wait(200);
    await pj(`window.__click('发送')`);
    let agentDone = false;
    for (let i = 0; i < 30; i++) {
      await wait(500);
      agentDone = await pj(`document.body.innerText.includes('已经修好了登录')`);
      if (agentDone) break;
    }
    check("电脑收到 Agent 任务", prompts.length === 1 && prompts[0].prompt.startsWith("E2E-AGENT-SECRET"), prompts[0] && prompts[0].prompt.slice(0, 40));
    check("远程 Agent 沿用电脑权限模式、不借管理员", prompts[0] && prompts[0].permissionMode === "bypassPermissions" && !prompts[0].elevated, prompts[0] && `${prompts[0].permissionMode} elevated=${prompts[0].elevated}`);
    check("手机上看到 Agent 流式回复", agentDone);
    const traceOk = await pj(`document.body.innerText.includes('执行过程')`);
    check("手机上看到 Agent 执行过程", traceOk);
    await wait(1200);
    const idle = await pj(`!window.__vis('button').some((b) => b.getAttribute('aria-label') === '停止')`);
    check("Agent 跑完后手机上的停止键变回发送", idle);
    const label = await pj(`document.body.innerText.includes('权限：全部放行')`);
    check("手机上权限显示中文名", label);
    const deskAgent = await dj(`document.body.innerText.includes('E2E-AGENT-SECRET') && document.body.innerText.includes('已经修好了登录')`);
    check("电脑屏幕上同步显示这轮 Agent", deskAgent);
    await shot("03-agent-thread.png");
    await deskShot("03-desk-agent.png");

    // ---- 收紧权限后再发一次 ----
    await dj(`window.allaiDesktop.remoteSave({ caps: { followPermission: false } })`);
    await wait(500);
    await pj(`window.__type('第二个任务')`);
    await pj(`window.__click('发送')`);
    await wait(2500);
    check("关掉「沿用权限」后全部放行降为接受编辑", prompts[1] && prompts[1].permissionMode === "acceptEdits", prompts[1] && prompts[1].permissionMode);
    await dj(`window.allaiDesktop.remoteSave({ caps: { followPermission: true } })`);

    }
    // ---- 聊天 + 图片上传 ----
    if (!process.env.SKIP_AGENT) await pj(`window.history.back()`);
    await wait(500);
    await pj(`window.__click('聊天')`);
    await wait(500);
    await pj(`window.__clickHas('新对话')`);
    await wait(1500);
    await pj(helpers);
    await pj(`(() => {
      const bytes = Uint8Array.from(atob('${PNG.toString("base64")}'), (c) => c.charCodeAt(0));
      const input = window.__vis('input[type=file]').concat([...document.querySelectorAll('input[type=file]')]).find((e) => e.closest('.flex.min-h-0.flex-1.flex-col:not(.hidden)'));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait(2000);
    await pj(`window.__type('E2E-CHAT-SECRET 你好')`);
    await wait(200);
    await pj(`window.__click('发送')`);
    let chatDone = false;
    for (let i = 0; i < 30; i++) {
      await wait(500);
      chatDone = await pj(`document.body.innerText.includes('收到你的消息')`);
      if (chatDone) break;
    }
    check("手机聊天收到流式回复", chatDone);
    const sentImage = chatBodies.some((item) => item.includes("E2E-CHAT-SECRET") && item.includes("data:image/png;base64"));
    check("手机上传的图片随聊天发给了模型", sentImage);
    const deskChat = await dj(`document.body.innerText.includes('E2E-CHAT-SECRET') && document.body.innerText.includes('收到你的消息')`);
    check("电脑屏幕上同步显示这轮聊天", deskChat);
    await wait(1500);
    const thumb = await pj(`window.__vis('img').some((i) => i.src.startsWith('blob:'))`);
    check("手机聊天里显示图片缩略图（经加密通道取回）", thumb);
    await shot("04-chat.png");

    // ---- 创作 ----
    await pj(`window.history.back()`);
    await wait(500);
    await pj(`window.__click('创作')`);
    await wait(1500);
    await pj(`window.__clickHas('新创作')`);
    await wait(800);
    await pj(helpers);
    await pj(`window.__type('E2E-STUDIO-SECRET 一只猫')`);
    await wait(200);
    await pj(`window.__click('生成')`);
    let studioDone = false;
    for (let i = 0; i < 40; i++) {
      await wait(500);
      studioDone = await pj(`window.__vis('img').some((i) => i.src.startsWith('blob:'))`);
      if (studioDone) break;
    }
    check("手机创作出图并显示", studioDone);
    await shot("05-studio.png");

    // ---- 中继看到的内容里没有明文 ----
    const all = frames.join("\n");
    const leaks = ["E2E-AGENT-SECRET", "E2E-CHAT-SECRET", "E2E-STUDIO-SECRET", "收到你的消息", "已经修好了登录", "修复登录问题", "session 过期", "测试电脑"].filter((s) => all.includes(s) || all.includes(JSON.stringify(s).slice(1, -1)));
    check(`中继经手的 ${frames.length} 帧里没有任何明文`, leaks.length === 0, leaks.join(","));
    check("中继日志里没有内容", !/SECRET|登录/.test(relayLog), relayLog.trim().split("\n").slice(-3).join(" | "));

    // ---- 重放攻击：把手机发过的一帧再塞一次 ----
    const phoneEntry = phoneLinks.filter((e) => e.lastFromClient && e.upstream.readyState === 1).pop();
    const before = frames.length;
    phoneEntry.upstream.send(phoneEntry.lastFromClient);
    await wait(1500);
    const after = frames.slice(before).join("\n");
    check("重放的帧被电脑识破（会话重置）", after.includes("reset"));
    await wait(1500);
    await pj(`window.__click('创作')`);
    await wait(300);
    await pj(`window.history.back()`);
    await wait(500);
    await pj(`window.__click('聊天')`);
    await wait(800);
    const stillWorks = await pj(`document.body.innerText.includes('E2E-CHAT-SECRET')`);
    check("重置后手机自动重新握手，照常可用", stillWorks);

    // ---- 上下文占用（0.16.33 补的：手机上也要看得出来快满了） ----
    // 上一条检查停在聊天**列表**（列表预览里也有那句 SECRET），要进对话才有顶栏。
    await pj(`window.__clickHas('E2E-CHAT-SECRET')`);
    await wait(1200);
    const ctx = await pj(`Boolean(document.querySelector('[title="上下文占用"]'))`);
    check("手机聊天顶栏显示上下文占用", ctx);

    // ---- 电脑上的 AllAi 关掉：整屏换成「已断开」 ----
    await dj(`window.allaiDesktop.remoteSave({ enabled: false })`);
    let offline = false;
    for (let i = 0; i < 20; i++) {
      await wait(500);
      offline = await pj(`document.body.innerText.includes('与目标电脑上 AllAi 的连接已断开')`);
      if (offline) break;
    }
    check("电脑关掉后手机整屏提示已断开", offline);
    const hint = await pj(`document.body.innerText.includes('不断尝试重连') && document.body.innerText.includes('扫描二维码')`);
    check("断开界面说明会重连、也说了怎么配别的电脑", hint);
    const navGone = await pj(`!window.__vis('button').some((b) => b.textContent.trim() === '创作')`);
    check("断开时收起底部页签（点了只会报错）", navGone);
    await shot("06-offline.png");
    // 电脑回来：自动恢复，不用手动重连
    await dj(`window.allaiDesktop.remoteSave({ enabled: true })`);
    let back = false;
    for (let i = 0; i < 40; i++) {
      await wait(500);
      back = await pj(`!document.body.innerText.includes('与目标电脑上 AllAi 的连接已断开')`);
      if (back) break;
    }
    check("电脑回来后手机自动恢复", back);

    // ---- 移除设备 ----
    const cfg = await dj(`window.allaiDesktop.remoteConfig()`);
    await dj(`window.allaiDesktop.remoteRevoke(${JSON.stringify(cfg.devices[0].id)})`);
    await wait(2000);
    const denied = await pj(`document.body.innerText.includes('已经移除了这台设备')`);
    check("电脑移除设备后手机立刻失效", denied);
    await shot("06-revoked.png");

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
  } catch (error) {
    console.log("HARNESS ERROR", error && error.stack);
  }
  app.quit();
});
