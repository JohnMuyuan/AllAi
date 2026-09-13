/**
 * Claude Code 官方登录 ↔ 全局 Key 切换时的环境变量。
 * 跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-launch-env.cjs
 *
 * 以前 apiEnv 在有 Base URL 时把 ANTHROPIC_API_KEY 和 ANTHROPIC_AUTH_TOKEN
 * 一起写进去，而本机 ~/.claude 还留着 claude.ai 登录，于是每一轮都报
 * 「claude.ai connectors are disabled because ANTHROPIC_API_KEY…」。
 */
const os = require("node:os");
const path = require("node:path");

const {
  apiEnv,
  childEnv,
  isAnthropicApi,
  isClaudeAuthNoise,
  AUTH_ENV,
} = require(path.join(__dirname, "..", "electron-dist", "launch.js"));
const { buildArgs } = require(path.join(__dirname, "..", "electron-dist", "chat-run.js"));

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function agent(patch = {}) {
  return {
    id: "a",
    name: "Claude Code",
    kind: "claude-code",
    command: "",
    args: [],
    cwd: "",
    authMode: "api",
    apiKey: "sk-test",
    baseUrl: "",
    model: "",
    extraEnv: {},
    ...patch,
  };
}

check("官方 anthropic 主机认得出", isAnthropicApi("https://api.anthropic.com"));
check("带路径的官方主机也认得", isAnthropicApi("https://api.anthropic.com/v1"));
check("第三方主机不是官方", !isAnthropicApi("https://api.example.com"));

const official = apiEnv(agent({ authMode: "official", apiKey: "sk-test", baseUrl: "https://api.example.com" }));
check("官方模式不写 API Key", !official.ANTHROPIC_API_KEY && !official.ANTHROPIC_AUTH_TOKEN);

const direct = apiEnv(agent({ baseUrl: "" }));
check("无 Base URL 只写 ANTHROPIC_API_KEY", direct.ANTHROPIC_API_KEY === "sk-test" && !direct.ANTHROPIC_AUTH_TOKEN);
check("无 Base URL 关掉 claude.ai connectors", direct.ENABLE_CLAUDEAI_MCP_SERVERS === "false");

const gateway = apiEnv(agent({ baseUrl: "https://api.example.com/v1" }));
check("第三方只写 ANTHROPIC_AUTH_TOKEN", gateway.ANTHROPIC_AUTH_TOKEN === "sk-test" && !gateway.ANTHROPIC_API_KEY);
check("第三方 BASE_URL 去掉末尾 /v1", gateway.ANTHROPIC_BASE_URL === "https://api.example.com");
const named = apiEnv(agent({ baseUrl: "https://api.example.com" }), "grok-4.6");
check("这一轮型号写进 ANTHROPIC_MODEL", named.ANTHROPIC_MODEL === "grok-4.6");
check("子模型别名也指向这一轮型号", named.ANTHROPIC_DEFAULT_OPUS_MODEL === "grok-4.6");
check("第三方也关掉 connectors", gateway.ENABLE_CLAUDEAI_MCP_SERVERS === "false");

const anthropicBase = apiEnv(agent({ baseUrl: "https://api.anthropic.com" }));
check("官方地址仍用 API_KEY 不用 AUTH_TOKEN", anthropicBase.ANTHROPIC_API_KEY === "sk-test" && !anthropicBase.ANTHROPIC_AUTH_TOKEN);

const saved = {};
for (const key of AUTH_ENV) {
  saved[key] = process.env[key];
  process.env[key] = `parent-${key}`;
}
try {
  const clean = childEnv({});
  check(
    "父进程残留的 Key 不会带进官方登录",
    !clean.ANTHROPIC_API_KEY && !clean.ANTHROPIC_AUTH_TOKEN && !clean.CLAUDE_CODE_OAUTH_TOKEN,
  );
  const api = childEnv(apiEnv(agent({ baseUrl: "https://api.example.com" })));
  check("API 模式带上这一轮的 Token", api.ANTHROPIC_AUTH_TOKEN === "sk-test");
  check("API 模式不会留下父进程的 API_KEY", api.ANTHROPIC_API_KEY === undefined);
  const oauth = childEnv(apiEnv(agent()), true);
  check("oauthOnly 连这一轮的 Key 也清掉", !oauth.ANTHROPIC_API_KEY && !oauth.ANTHROPIC_AUTH_TOKEN);
} finally {
  for (const key of AUTH_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

const noise =
  "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors";
check("冲突警告认得出", isClaudeAuthNoise(noise));
check("普通报错不是冲突警告", !isClaudeAuthNoise("401 authentication_failed"));

const apiArgs = buildArgs({
  sessionId: "s",
  command: "claude",
  cwd: os.tmpdir(),
  agent: agent(),
  prompt: "你好",
  mode: "agent",
});
check(
  "API 模式告诉 Claude Code 不要拉 claude.ai connectors",
  apiArgs.args.includes('{"disableClaudeAiConnectors":true}'),
);
const officialArgs = buildArgs({
  sessionId: "s",
  command: "claude",
  cwd: os.tmpdir(),
  agent: agent({ authMode: "official" }),
  prompt: "你好",
  mode: "agent",
});
check(
  "官方登录不关 connectors",
  !officialArgs.args.includes('{"disableClaudeAiConnectors":true}'),
);

const failed = results.filter((item) => !item).length;
console.log(failed ? `\n${failed} failed` : `\n${results.length} passed`);
process.exit(failed ? 1 : 0);
