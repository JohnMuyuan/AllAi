/**
 * Claude Code「在跑没在跑」是怎么判的。跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-agent-live.cjs
 *
 * 两种判法：
 *   - **登记表**：Claude Code 每开一个会话进程就写 `~/.claude/sessions/<pid>.json`，
 *     里面有 `sessionId` 和 `status: "busy" | "idle"`，进程正常退出时删掉。这是准信。
 *   - **按文件时间猜**：会话文件 3 分钟内被写过就算在跑。Grok / Codex 没有登记表，只能这么猜。
 *
 * 0.16.23 之前 Claude 也吃这个猜测（而且是 `登记 || 猜测`），于是你**直接关掉终端窗口**之后
 * 进程早没了，AllAi 还会继续说「运行中」整整三分钟。现在对 Claude 以登记表为准：
 * 没登记就是没在跑；只有登记表整个读不出来时才退回猜。
 *
 * 用临时 HOME 造登记表，不碰你真正的 ~/.claude。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "allai-live-"));
const sessions = path.join(home, ".claude", "sessions");
fs.mkdirSync(sessions, { recursive: true });

// 一条真的活着的登记：用本进程的 pid，pidAlive() 一定为真。
fs.writeFileSync(
  path.join(sessions, `${process.pid}.json`),
  JSON.stringify({ pid: process.pid, sessionId: "alive-session", cwd: "D:\\tmp", status: "busy", updatedAt: Date.now() }),
);
// 一条残留的登记（进程号早就没了）—— 关终端窗口来不及清理就是这样。
fs.writeFileSync(
  path.join(sessions, "999999.json"),
  JSON.stringify({ pid: 999999, sessionId: "ghost-session", cwd: "D:\\tmp", status: "busy", updatedAt: Date.now() }),
);

const realHome = os.homedir;
os.homedir = () => home;
const { scanLive, mergeWorks } = require(path.join(ROOT, "electron-dist", "live.js"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const base = { kind: "claude-code", agentName: "Claude Code", cwd: "D:\\tmp", preview: "", createdAt: 1, source: "history" };
// 两条工作都「刚写过文件」，所以历史扫描都猜成 running: true。
const history = [
  { ...base, id: "claude-code:alive-session", title: "还在跑的", cliSessionId: "alive-session", running: true, updatedAt: Date.now() },
  { ...base, id: "claude-code:closed-session", title: "刚关掉终端的", cliSessionId: "closed-session", running: true, updatedAt: Date.now() },
  { ...base, kind: "grok-build", agentName: "Grok Build", id: "grok-build:g1", title: "Grok 的", cliSessionId: "g1", running: true, updatedAt: Date.now() },
];

async function main() {
  const live = await scanLive();
  check("残留的登记（进程号已死）不算数", !live.some((item) => item.cliSessionId === "ghost-session"), JSON.stringify(live.map((i) => i.cliSessionId)));
  check("活着的登记认出来了", live.some((item) => item.cliSessionId === "alive-session"));

  const merged = mergeWorks(history, live);
  const byId = Object.fromEntries(merged.map((item) => [item.id, item]));
  check("有登记且 busy 的仍然是运行中", byId["claude-code:alive-session"].running === true);
  check("有登记的标成在线", byId["claude-code:alive-session"].online === true);
  check(
    "关掉终端后不再显示运行中",
    byId["claude-code:closed-session"].running === false,
    byId["claude-code:closed-session"].running ? "还在按「文件 3 分钟内写过」硬猜" : "",
  );
  check("Grok 没有登记表，仍然按时间猜", byId["grok-build:g1"].running === true);

  // idle 的登记：进程在，但没在干活
  fs.writeFileSync(
    path.join(sessions, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: "alive-session", cwd: "D:\\tmp", status: "idle", updatedAt: Date.now() }),
  );
  const idle = mergeWorks(history, await scanLive());
  const one = idle.find((item) => item.id === "claude-code:alive-session");
  check("闲着的会话：在线但不是运行中", one.online === true && one.running === false, `online=${one.online} running=${one.running}`);

  // 登记表整个读不出来时要退回按时间猜，别把所有 Claude 会话都说成没在跑
  os.homedir = () => path.join(home, "nope");
  const blind = mergeWorks(history, await scanLive());
  check(
    "登记表读不到时退回按时间猜",
    blind.find((item) => item.id === "claude-code:closed-session").running === true,
  );

  os.homedir = realHome;
  fs.rmSync(home, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 通过`);
  assert.equal(passed, results.length, "agent live regression failed");
}

main().catch((error) => {
  os.homedir = realHome;
  console.error(error);
  process.exit(1);
});
