/**
 * Agent 换模型：同一家 CLI 里换后端，不要另开对话、不要改去 spawn 另一家。
 *
 *   node scripts/test-agent-session.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const ROOT = path.join(__dirname, "..");
const sessionSrc = fs.readFileSync(path.join(ROOT, "lib", "agent-session.ts"), "utf8");
const windowSrc = fs.readFileSync(path.join(ROOT, "lib", "context-window.ts"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "components", "ChatApp.tsx"), "utf8");
const compactSrc = fs.readFileSync(path.join(ROOT, "lib", "compact.ts"), "utf8");
const modelsSrc = fs.readFileSync(path.join(ROOT, "lib", "agent-models.ts"), "utf8");
const launchSrc = fs.readFileSync(path.join(ROOT, "electron", "launch.ts"), "utf8");

check("agent-session.ts 还在", sessionSrc.includes("PENDING_SESSION_MODEL"));
check("换模型走 agentModelSwitched", appSrc.includes("agentModelSwitched("));
check("续会话走 agentContinueSession", appSrc.includes("agentContinueSession("));
check("超限才按交接压缩", appSrc.includes("handoff: agentMustCompact"));
check("compactIfNeeded 认 handoff", compactSrc.includes("handoffShouldCompact"));
check("context-window 有 handoffShouldCompact", windowSrc.includes("export function handoffShouldCompact"));
check("不再按型号名改 CLI", !sessionSrc.includes("id.includes(\"grok\")"));
check("选择器只用当前 Agent", appSrc.includes("agentModelProviders(workAgent)"));
check("不再把另外两家塞进选择器", !appSrc.includes("agentModelSwitcherProviders"));
check("不再 agentForModel", !appSrc.includes("agentForModel("));
check("ANTHROPIC_MODEL 吃这一轮型号", launchSrc.includes("ANTHROPIC_MODEL = model"));

function continueSession(opts) {
  if (opts.keepSession && opts.resumable) return true;
  if (opts.mustCompact || (opts.sourceNew && !opts.hasAssistant)) return false;
  return opts.resumable;
}

check(
  "续会话",
  continueSession({
    resumable: true,
    mustCompact: false,
    sourceNew: false,
    hasAssistant: true,
  }),
);
check(
  "换模型未超限仍续当前对话",
  continueSession({
    resumable: true,
    mustCompact: false,
    sourceNew: false,
    hasAssistant: true,
  }),
);
check(
  "超限才放弃续会话",
  !continueSession({
    resumable: true,
    mustCompact: true,
    sourceNew: false,
    hasAssistant: true,
  }),
);
check(
  "交接那一轮仍续",
  continueSession({
    keepSession: true,
    resumable: true,
    mustCompact: true,
    sourceNew: false,
    hasAssistant: true,
  }),
);

const KEEP_RATIO = 0.35;
function handoffShouldCompact(used, limit) {
  return used > Math.floor(Math.max(1, limit) * KEEP_RATIO);
}
check("很小的历史交接不用压", !handoffShouldCompact(20_000, 500_000));
check("全局接口不过滤 grok 型号", !modelsSrc.includes("inferAgentKind(model.id)"));
check("prompt 仍用当前 Agent", appSrc.includes("const sendAgentProfile = workAgent"));
check("压缩走流式进度", appSrc.includes('stream: agentMustCompact'));
check("压缩进度写在当前对话", appSrc.includes('upsertToolTrace(item.trace, "压缩上下文"'));
check(
  "同 CLI 压缩不改工作 id",
  appSrc.includes("if (!continueId && endpointChanged)") && !appSrc.includes("endpointChanged || agentMustCompact"),
);

const failed = results.filter((item) => !item).length;
console.log(failed ? `\n${failed} failed` : `\n${results.length} passed`);
process.exit(failed ? 1 : 0);
