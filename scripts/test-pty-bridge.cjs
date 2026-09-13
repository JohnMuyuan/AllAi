/**
 * 终端宿主这条 IPC 的回归。跑法：
 *
 *   node scripts/test-pty-bridge.cjs
 *
 * 盯的是 0.16.19 那个 BUG：`child.send()` 的返回值是**背压**，不是成败 ——
 * 队列攒到一定量它就返回 false，而消息照样送到。`electron/pty.ts` 以前把 false
 * 当成「无法联系终端宿主」直接报错，于是只有 `agent:prompt` 会中招（它带着整段历史，
 * Claude Code 续上下文时几百 KB），会话越长越必然失败，小消息永远碰不到。
 *
 * 这里不起 Electron：把 `request()` 的那套逻辑对着一个回声子进程跑一遍就够了。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allai-pty-bridge-"));
const echo = path.join(dir, "echo.js");
fs.writeFileSync(
  echo,
  `process.on("message", (m) => process.send({ id: m.id, bytes: JSON.stringify(m).length }));
setInterval(() => {}, 1e6);
`,
);

function start() {
  const child = spawn(process.execPath, [echo], {
    cwd: dir,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const pending = new Map();
  child.on("message", (message) => {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter(message);
  });
  // 和 electron/pty.ts 的 request() 同一套：只信回调里的 error，不看返回值。
  const request = (payload) =>
    new Promise((resolve, reject) => {
      const id = `${pending.size}-${Math.random().toString(16).slice(2)}`;
      const timer = setTimeout(() => reject(new Error("没有响应")), 15_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.send({ id, ...payload }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  return { child, request };
}

async function main() {
  const { child, request } = start();
  try {
    // 1. 确认前提：大 payload 的 send() 真的会返回 false，而通道还连着。
    const big = { id: "probe", type: "chat", blob: "x".repeat(2_000_000) };
    const returned = child.send(big);
    check(
      "大 payload 的 send() 返回 false（这就是那个假信号）",
      returned === false && child.connected === true,
      `returned=${returned} connected=${child.connected}`,
    );

    // 2. 而它其实送到了 —— 所以不能当成失败。
    const small = await request({ type: "list" });
    check("返回 false 之后通道照常可用", small.bytes > 0, `${small.bytes} 字节`);

    // 3. agent:prompt 那种量级要能一来一回。
    const history = Array.from({ length: 400 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "这是一轮很长的 Agent 历史，压缩之前会原样重放给新会话。".repeat(20),
    }));
    const payload = { type: "chat", opts: { prompt: "继续", history } };
    const bytes = JSON.stringify(payload).length;
    const reply = await request(payload);
    check(
      `${Math.round(bytes / 1024)}KB 的 agent:prompt 能一来一回`,
      reply.bytes >= bytes,
      `回声 ${Math.round(reply.bytes / 1024)}KB`,
    );

    // 4. 真断了才算失败，而且要报出来。
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    let failed = null;
    await request({ type: "list" }).catch((error) => {
      failed = error;
    });
    check("宿主真的没了才报错", Boolean(failed), failed ? failed.code || failed.message : "没有报错");
  } finally {
    try { child.kill(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 通过`);
  assert.equal(passed, results.length, "pty bridge regression failed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
