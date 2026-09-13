// 兜底型号表在 electron/ 下，两边共用一份，见那个文件里的说明。
import OFFICIAL_MODELS from "../electron/official-models.json";
import type { CliAuthKind } from "@/types/desktop";
import type { ModelRef, ProviderAuth, PublicProvider } from "./types";

/**
 * 「官方登录聊天」：不走 HTTP，用本机已登录的 CLI 打，吃的是你自己的订阅额度。
 * Claude 和 Grok 是同一套东西，只是命令不同 —— 别再各写一份。
 *
 * 和 Agent 的接口列表是两套：这里只管聊天。
 */
export type OfficialChatKind = "claude" | "grok" | "chatgpt";

export type OfficialChatSpec = {
  kind: OfficialChatKind;
  /** 同时也是 provider id 和 modelKey 的前缀。 */
  providerId: string;
  auth: ProviderAuth;
  name: string;
  /** 本机 CLI，登录状态/拉模型都按它走。 */
  cliKind: CliAuthKind;
  cliName: string;
  models: ModelRef[];
  defaultModelId: string;
  hint: string;
  loggedOutHint: string;
};

export const CLAUDE_OFFICIAL_MODELS: ModelRef[] = OFFICIAL_MODELS.claude;
export const GROK_OFFICIAL_MODELS: ModelRef[] = OFFICIAL_MODELS.grok;
export const CHATGPT_OFFICIAL_MODELS: ModelRef[] = OFFICIAL_MODELS.chatgpt;

export const OFFICIAL_CHATS: OfficialChatSpec[] = [
  {
    kind: "claude",
    providerId: "claude-official",
    auth: "claude-official",
    name: "Claude 账号",
    cliKind: "claude-code",
    cliName: "Claude Code",
    models: CLAUDE_OFFICIAL_MODELS,
    defaultModelId: "claude-sonnet-5",
    hint: "用本机 Claude Code 登录 Anthropic 账号，聊天走订阅额度",
    loggedOutHint: "登录后聊天里会出现 Sonnet 5 / Opus 5 等型号",
  },
  {
    kind: "grok",
    providerId: "grok-official",
    auth: "grok-official",
    name: "Grok 账号",
    cliKind: "grok-build",
    cliName: "Grok",
    models: GROK_OFFICIAL_MODELS,
    defaultModelId: "grok-4.6",
    hint: "用本机 Grok 登录 xAI 账号，聊天走订阅额度",
    loggedOutHint: "登录后聊天里会出现 Grok 4.6 等型号",
  },
  {
    kind: "chatgpt",
    providerId: "chatgpt-official",
    auth: "chatgpt-official",
    name: "ChatGPT 账号",
    cliKind: "codex",
    cliName: "Codex CLI",
    models: CHATGPT_OFFICIAL_MODELS,
    defaultModelId: "gpt-5.6-sol",
    hint: "用本机 Codex 登录的 ChatGPT 账号，聊天走订阅额度，界面还是 AllAi 自己的",
    loggedOutHint: "登录后聊天里会出现 GPT-5.6 / GPT-6 等型号",
  },
];

export function officialSpec(kind: OfficialChatKind) {
  const found = OFFICIAL_CHATS.find((item) => item.kind === kind);
  if (!found) throw new Error(`未知的官方聊天：${kind}`);
  return found;
}

/** modelKey 长这样：`claude-official::claude-sonnet-5`。 */
export function officialSpecForModelKey(modelKey: string): OfficialChatSpec | null {
  return (
    OFFICIAL_CHATS.find((item) => modelKey.startsWith(`${item.providerId}::`)) ?? null
  );
}

export function isOfficialChat(modelKey: string) {
  return officialSpecForModelKey(modelKey) !== null;
}

export function officialModelId(modelKey: string) {
  const spec = officialSpecForModelKey(modelKey);
  if (!spec) return "";
  return modelKey.slice(spec.providerId.length + 2);
}

export function officialDefaultModelKey(spec: OfficialChatSpec) {
  return `${spec.providerId}::${spec.defaultModelId}`;
}

export function officialSpecForProvider(provider: {
  id?: string;
  auth?: string;
  baseUrl?: string;
}): OfficialChatSpec | null {
  return (
    OFFICIAL_CHATS.find(
      (item) =>
        provider.id === item.providerId ||
        provider.auth === item.auth ||
        provider.baseUrl === item.providerId,
    ) ?? null
  );
}

export function isOfficialProvider(provider: {
  id?: string;
  auth?: string;
  baseUrl?: string;
}) {
  return officialSpecForProvider(provider) !== null;
}

export function findOfficialProvider(providers: PublicProvider[], kind: OfficialChatKind) {
  const spec = officialSpec(kind);
  return providers.find((item) => officialSpecForProvider(item)?.kind === spec.kind) ?? null;
}

/** 一轮官方聊天的会话 id，和 AllAi 自己的对话 id 区分开。 */
export function officialChatSessionId(kind: OfficialChatKind, conversationId: string) {
  return `${kind}-chat:${conversationId}`;
}

/** 推理档位识别用的名字：Grok 的模型 id 本身就够，Claude 的要补前缀。 */
export function officialReasoningId(modelKey: string) {
  const spec = officialSpecForModelKey(modelKey);
  if (!spec) return "";
  const modelId = officialModelId(modelKey);
  if (spec.kind === "claude" && !modelId.startsWith("claude-")) return `claude-${modelId}`;
  return modelId;
}
