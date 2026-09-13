/**
 * 各家 CLI 斜杠指令怎么翻译。跑法：
 *
 *   node scripts/test-cli-commands.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
const dir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".allai-cli-cmd-"));
const out = path.join(dir, "cli-commands.cjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "lib", "cli-commands.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});
const {
  adaptCliCommand,
  isCliSlashCommand,
  matchSlashCommands,
  nativeCompactPrompt,
  parseSlashCommand,
  slashCommandCatalog,
} = require(out);

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

check("普通话不是指令", !isCliSlashCommand("帮我改这个文件"));
check("认出 /compact", Boolean(parseSlashCommand("/compact")));
check("中文 /压缩", parseSlashCommand("/压缩").name === "compact");
check("Claude 压缩", adaptCliCommand("claude-code", "/压缩").prompt.startsWith("/compact"));
check("Grok 压缩", adaptCliCommand("grok-build", "/compact").prompt === "/compact");
check("Codex 压缩不带参数", adaptCliCommand("codex", "/compact 保留目标").prompt === "/compact");
check("Claude 清空", adaptCliCommand("claude-code", "/清空").prompt === "/clear");
check("Codex 清空是 /new", adaptCliCommand("codex", "/clear").prompt === "/new");
check("Claude 状态是 /context", adaptCliCommand("claude-code", "/状态").prompt === "/context");
check("Grok 状态是 /session-info", adaptCliCommand("grok-build", "/status").prompt === "/session-info");
check("Codex 状态是 /status", adaptCliCommand("codex", "/status").prompt === "/status");
check("Grok 用量是 /usage", adaptCliCommand("grok-build", "/cost").prompt === "/usage");
check("不认识的指令原样交", adaptCliCommand("claude-code", "/mcp").prompt === "/mcp");
check(
  "不是指令就不改",
  adaptCliCommand("claude-code", "写个函数").prompt === "写个函数" &&
    !adaptCliCommand("claude-code", "写个函数").command,
);
check("原生压缩指令是斜杠", nativeCompactPrompt("claude-code").startsWith("/compact"));
check("自定义 Agent 不翻译", adaptCliCommand("custom", "/compact").command === false);

const claudeMenu = matchSlashCommands("claude-code", "/");
const grokMenu = matchSlashCommands("grok-build", "/");
const codexMenu = matchSlashCommands("codex", "/");
check("打 / 弹出 Claude 指令", Array.isArray(claudeMenu) && claudeMenu.length >= 6);
check("Claude 有压缩和计划", claudeMenu.some((item) => item.insert === "/compact") && claudeMenu.some((item) => item.insert === "/plan"));
check("Grok 状态是 /session-info", grokMenu.some((item) => item.insert === "/session-info"));
check("Codex 清空是 /new", codexMenu.some((item) => item.insert === "/new"));
check("Codex 没有重复的 /status", codexMenu.filter((item) => item.insert === "/status").length === 1);
check("中文 /压 对上压缩", matchSlashCommands("claude-code", "/压").some((item) => item.insert === "/compact"));
check("打了空格就收起", matchSlashCommands("claude-code", "/compact ") === null);
check("普通句子不弹", matchSlashCommands("claude-code", "帮我改文件") === null);
check("自定义 Agent 不弹", matchSlashCommands("custom", "/") === null);
check("目录带用法", slashCommandCatalog("claude-code").every((item) => item.title && item.usage && item.insert.startsWith("/")));

fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((item) => !item).length;
console.log(failed ? `\n${failed} failed` : `\n${results.length} passed`);
process.exit(failed ? 1 : 0);
