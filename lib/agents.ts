import { emptyApiEndpoint } from "./agent-endpoints";
import type { AgentKind, AgentProfile } from "./types";

export type AgentKindInfo = {
  kind: AgentKind;
  title: string;
  blurb: string;
  bin: string;
  officialHint: string;
  apiHint: string;
  baseUrlPlaceholder: string;
};

export const AGENT_KINDS: AgentKindInfo[] = [
  {
    kind: "grok-build",
    title: "Grok Build",
    blurb: "xAI 官方编程 Agent",
    bin: "grok",
    officialHint: "用浏览器登录 xAI 账号。成功后这里会显示已登录。",
    apiHint: "写入 XAI_API_KEY。第三方兼容接口可同时填 Base URL。",
    baseUrlPlaceholder: "https://api.x.ai/v1",
  },
  {
    kind: "claude-code",
    title: "Claude Code",
    blurb: "Anthropic 官方编程 Agent",
    bin: "claude",
    officialHint: "用浏览器登录 Anthropic 账号。成功后这里会显示已登录。",
    apiHint: "官方 Key 用 ANTHROPIC_API_KEY。第三方填 Base URL + Key（ANTHROPIC_AUTH_TOKEN）。",
    baseUrlPlaceholder: "https://api.anthropic.com",
  },
  {
    kind: "codex",
    title: "Codex CLI",
    blurb: "OpenAI 官方编程 Agent",
    bin: "codex",
    officialHint: "用浏览器登录 ChatGPT 账号。成功后这里会显示已登录。",
    apiHint: "写入 OPENAI_API_KEY。第三方网关可填 Base URL。",
    baseUrlPlaceholder: "https://api.openai.com/v1",
  },
  {
    kind: "custom",
    title: "自定义命令",
    blurb: "任意本地 CLI",
    bin: "",
    officialHint: "直接在工作目录运行你填写的命令。",
    apiHint: "按需填写环境变量：API Key 会注入 ALLAI_API_KEY，也可写额外环境变量。",
    baseUrlPlaceholder: "https://",
  },
];

export function kindInfo(kind: AgentKind) {
  return AGENT_KINDS.find((item) => item.kind === kind) ?? AGENT_KINDS[3];
}

export function defaultAgents(): AgentProfile[] {
  const now = Date.now();
  return (["grok-build", "claude-code", "codex"] as const).map((kind, index) => {
    const endpoint = emptyApiEndpoint("默认接口");
    const info = kindInfo(kind);
    return {
      id: crypto.randomUUID(),
      name: info.title,
      kind,
      command: "",
      args: [],
      cwd: "",
      authMode: "api" as const,
      apiKey: "",
      baseUrl: "",
      model: "",
      extraEnv: {},
      endpoints: [endpoint],
      activeEndpointId: endpoint.id,
      createdAt: now + index,
    };
  });
}
