/**
 * 扫描结果并进 Agent 工作列表时，`source` 必须跟着回来。跑法：
 *
 *   node scripts/test-work-merge.cjs
 *
 * 背景：`sendAgent` 开一条新的 CLI 会话时（换模型、压缩上下文、刚接续出来的工作）
 * 会把这条工作标成 `source: "new"`。但 CLI 把会话文件写出来之后它就不是「新的」了 ——
 * 定时扫描会把它作为 history 扫回来。`mergeAgentWorkLists` 以前从不合并 `source`，
 * 于是它永远停在 "new"，`canResume()` 一直为假，顶栏「复制恢复命令」那个按钮
 * **开过一次新会话就再也不回来**（0.16.21 修的）。
 *
 * 用 esbuild 把 ChatApp 里那个函数单独打出来跑 —— 它是纯函数，不碰 React。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));

// 打到仓库里面：external 的那几个包要能从仓库自己的 node_modules 解析出来。
const dir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".allai-work-merge-"));
const out = path.join(dir, "merge.cjs");
esbuild.buildSync({
  stdin: {
    contents: [
      `export { mergeAgentWorkLists } from ${JSON.stringify(path.join(ROOT, "components", "ChatApp.tsx"))};`,
      `export { canResume } from ${JSON.stringify(path.join(ROOT, "lib", "agent-resume.ts"))};`,
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  external: ["react", "react-dom", "next", "lucide-react", "react-markdown", "remark-gfm", "rehype-*"],
  logLevel: "silent",
});
const { mergeAgentWorkLists, canResume } = require(out);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const base = {
  kind: "claude-code", agentName: "Claude Code", title: "做值班表", cwd: "D:\\tmp",
  preview: "", createdAt: 1, updatedAt: 10, running: false,
};

// 刚发过一轮、开了新会话：本地标成 "new"
const local = [{ ...base, id: "claude-code:sess-1", cliSessionId: "sess-1", source: "new" }];
// CLI 已经把会话文件写出来了，扫描把它当 history 扫回来
const scanned = [{ ...base, id: "claude-code:sess-1", cliSessionId: "sess-1", source: "history", updatedAt: 20, messagesFile: "D:\\tmp\\sess-1.jsonl" }];

const merged = mergeAgentWorkLists(local, scanned);
check("扫到之后 source 回到 history", merged[0].source === "history", merged[0].source);
check("messagesFile 也跟着更新", merged[0].messagesFile === "D:\\tmp\\sess-1.jsonl");

// 还没被扫到的（CLI 一个字都还没写）要老老实实留在 "new"
const pending = [{ ...base, id: "local-temp", cliSessionId: "live-temp", source: "new" }];
const untouched = mergeAgentWorkLists(pending, []);
check("扫不到的仍然是 new", untouched[0].source === "new", untouched[0].source);

// 这才是用户看得见的那一格：顶栏「复制恢复命令」按钮就挂在 canResume 上。
check("合并后这条工作可以恢复（按钮会回来）", canResume(merged[0]) === true);
check("没被扫到的仍然不能恢复", canResume(untouched[0]) === false);

// 同一条工作压缩后 CLI 会话号变了，但 AllAi 工作 id 不变：扫描不能再插出第二条。
const compacting = [{ ...base, id: "claude-code:old", cliSessionId: "new-sess", source: "new" }];
const compactScan = [
  { ...base, id: "claude-code:old", cliSessionId: "old", source: "history", updatedAt: 11 },
  { ...base, id: "claude-code:new-sess", cliSessionId: "new-sess", source: "history", updatedAt: 30, messagesFile: "D:\\tmp\\new.jsonl" },
];
const compactMerged = mergeAgentWorkLists(compacting, compactScan);
check("压缩后仍是一条工作", compactMerged.length === 1, String(compactMerged.length));
check("压缩后跟上新会话文件", compactMerged[0].messagesFile === "D:\\tmp\\new.jsonl");
check("压缩后 id 没变", compactMerged[0].id === "claude-code:old");

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} 通过`);
assert.equal(passed, results.length, "work merge regression failed");
