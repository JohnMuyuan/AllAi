/**
 * 删 Agent 会话。跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-codex-delete.cjs
 *
 * 盯的是「删了又回来」那个 BUG：**codex 一条会话会被拆成多个 rollout 文件**
 * （见 electron/history.ts 的 scanCodex，按 cliSessionId 分组），
 * 只删 messagesFile 那一个，剩下的分片下次扫描又会凑成同一条会话。
 *
 * 用临时 HOME，不碰你真的 ~/.codex、~/.claude。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "allai-del-home-"));
const realHome = os.homedir;
os.homedir = () => home;
// PATH 清空：让 resolveCommand 找不到真的 codex / grok，测的就是删文件这条兜底路径
const realPath = process.env.PATH;
process.env.PATH = path.join(home, "no-such-bin");

const { deleteWork } = require(path.join(ROOT, "electron-dist", "history.js"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const SESSION = "01a0aaaa-bbbb-7000-8000-ccccddddeeee";
const sessionsDir = path.join(home, ".codex", "sessions", "2026", "09", "16");
const parts = [
  path.join(sessionsDir, `rollout-2026-09-16T08-00-00-${SESSION}.jsonl`),
  path.join(sessionsDir, `rollout-2026-09-16T09-30-00-${SESSION}.jsonl`),
];
const indexFile = path.join(home, ".codex", "session_index.jsonl");

function seed() {
  fs.mkdirSync(sessionsDir, { recursive: true });
  for (const file of parts) {
    fs.writeFileSync(
      file,
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-09-16T08:00:00.000Z",
        payload: { id: SESSION, session_id: SESSION, cwd: "D:/tmp/proj", model_provider: "openai" },
      }) + "\n",
    );
  }
  fs.writeFileSync(indexFile, JSON.stringify({ id: SESSION, thread_name: "要删掉的会话", updated_at: "2026-09-16T09:30:00Z" }) + "\n");
}

(async () => {
  try {
    // ---- 1. 列表带了全部分片 ----
    seed();
    let out = await deleteWork({
      id: `codex:${SESSION}`,
      kind: "codex",
      cliSessionId: SESSION,
      cwd: "D:/tmp/proj",
      messagesFile: parts[1],
      messagesFiles: parts,
    });
    check("删除成功", out.ok, JSON.stringify(out));
    check("两个分片都删掉了（以前只删最新那个，旧分片会把对话带回来）", parts.every((file) => !fs.existsSync(file)), parts.filter((f) => fs.existsSync(f)).join(", "));
    check("session_index.jsonl 里也清掉了", !fs.readFileSync(indexFile, "utf8").includes(SESSION));

    // ---- 2. 只给了 messagesFile：按会话 id 现找其它分片 ----
    seed();
    out = await deleteWork({
      id: `codex:${SESSION}`,
      kind: "codex",
      cliSessionId: SESSION,
      cwd: "D:/tmp/proj",
      messagesFile: parts[1],
    });
    check("没带分片列表时也要删干净", out.ok && parts.every((file) => !fs.existsSync(file)), JSON.stringify(out));

    // ---- 3. 不在 ~/.codex/sessions 里的文件不许删 ----
    const outside = path.join(home, "outside.jsonl");
    fs.writeFileSync(outside, "{}\n");
    out = await deleteWork({
      id: `codex:${SESSION}`,
      kind: "codex",
      cliSessionId: SESSION,
      cwd: "D:/tmp/proj",
      messagesFile: outside,
      messagesFiles: [outside],
    });
    check("历史目录之外的文件不删", !out.ok && fs.existsSync(outside), JSON.stringify(out));

    // ---- 4. claude 只有一个文件，照旧 ----
    const claudeFile = path.join(home, ".claude", "projects", "proj", "s1.jsonl");
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
    fs.writeFileSync(claudeFile, "{}\n");
    out = await deleteWork({
      id: "claude-code:s1",
      kind: "claude-code",
      cliSessionId: "s1",
      cwd: "D:/tmp/proj",
      messagesFile: claudeFile,
    });
    check("Claude 会话照旧能删", out.ok && !fs.existsSync(claudeFile), JSON.stringify(out));
  } finally {
    os.homedir = realHome;
    process.env.PATH = realPath;
    fs.rmSync(home, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} 通过`);
  assert.equal(passed, results.length, "codex delete regression failed");
})();
