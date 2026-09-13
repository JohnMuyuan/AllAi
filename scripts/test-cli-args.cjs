/**
 * 本机 CLI 的 prompt 是怎么交过去的。跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-cli-args.cjs
 *
 * 盯的是 `spawn ENAMETOOLONG`：Windows 整条命令行上限 32767 个字符，
 * 而 Agent 换会话要把整段历史重放过去，几百 KB 很正常。
 * 0.16.20 之前 claude 和 codex 都把它当 argv 传（claude 那一支甚至先写了临时文件、
 * 又读回来塞进 argv），会话一长必炸。
 *
 * 前半段是纯函数断言（buildArgs 单独导出就是为了这个）；
 * 后半段真的 spawn 一个假 CLI，确认 stdin 这条线从头到尾是通的、也确实不会超长。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { buildArgs } = require(path.join(__dirname, "..", "electron-dist", "chat-run.js"));

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Windows 的 CreateProcess 上限。留一半余量，剩下的是命令本身和其它参数。 */
const CMDLINE_MAX = 32767;
const LONG = "这是一段很长的 Agent 历史，换会话时要原样重放给新模型。".repeat(2000);

function opts(kind, extra = {}) {
  return {
    sessionId: "sess-test",
    command: "fake",
    cwd: os.tmpdir(),
    agent: { id: "a", name: kind, kind, args: [], model: "", apiKey: "", baseUrl: "", extraEnv: {} },
    prompt: LONG,
    mode: "agent",
    ...extra,
  };
}

function argvLength(args) {
  return args.reduce((sum, item) => sum + String(item).length + 3, 0);
}

for (const kind of ["claude-code", "codex", "grok-build"]) {
  const built = buildArgs(opts(kind));
  const inArgv = built.args.some((item) => String(item).includes(LONG.slice(0, 200)));
  check(`${kind}：长 prompt 不出现在 argv 里`, !inArgv);
  check(
    `${kind}：命令行长度远低于 ${CMDLINE_MAX}`,
    argvLength(built.args) < CMDLINE_MAX / 2,
    `${argvLength(built.args)} 字符`,
  );
  const carried = built.stdin ? "stdin" : built.cleanup ? "--prompt-file" : "(没有)";
  check(`${kind}：prompt 有别的入口`, carried !== "(没有)", carried);
  if (built.cleanup) {
    check(`${kind}：prompt 文件里是完整原文`, fs.readFileSync(built.cleanup, "utf8") === LONG);
    fs.rmSync(built.cleanup, { force: true });
  }
  if (built.stdin) check(`${kind}：stdin 里是完整原文`, built.stdin.includes(LONG));
}

// codex 的文档写得很清楚：又给参数又给 stdin，stdin 会被当成额外的 <stdin> 块追加。
const codex = buildArgs(opts("codex"));
check("codex：走 stdin 时不再另外给 PROMPT 参数", Boolean(codex.stdin) && !codex.args.includes(LONG));

// 短 prompt 仍然走 argv，别把常见路径也改了
for (const kind of ["claude-code", "codex", "grok-build"]) {
  const short = buildArgs(opts(kind, { prompt: "你好" }));
  check(`${kind}：短 prompt 照旧走 argv`, short.args.includes("你好") && !short.stdin);
}

// 真 spawn 一个假 CLI：stdin 这条线要真的通。
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allai-cli-args-"));
const fake = path.join(dir, "fake-cli.js");
fs.writeFileSync(
  fake,
  `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ argvChars: process.argv.slice(2).join(" ").length, stdinChars: input.length }));
});
`,
);

const built = buildArgs(opts("claude-code"));
const child = spawn(process.execPath, [fake, ...built.args], {
  cwd: dir,
  stdio: ["pipe", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (chunk) => { out += chunk; });
child.stdin.end(built.stdin || "");
child.on("exit", () => {
  let report = {};
  try { report = JSON.parse(out); } catch {}
  check(
    "假 CLI 真的从 stdin 收到了整段 prompt",
    report.stdinChars >= LONG.length,
    `argv ${report.argvChars} 字符 / stdin ${report.stdinChars} 字符`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 通过`);
  assert.equal(passed, results.length, "cli args regression failed");
});
