import type {
  AgentEndpoint,
  AgentProfile,
  Conversation,
  ConversationSummary,
  Provider,
  PublicAgent,
  PublicEndpoint,
  PublicProvider,
} from "./types";

export function maskKey(key: string) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function toPublicProvider(provider: Provider): PublicProvider {
  const { apiKey, ...rest } = provider;
  return {
    ...rest,
    hasKey: Boolean(apiKey),
    apiKeyMasked: maskKey(apiKey),
  };
}

export function toSummary(conversation: Conversation): ConversationSummary {
  const last = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "user" || message.role === "assistant");
  return {
    id: conversation.id,
    title: conversation.title,
    modelKey: conversation.modelKey,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    preview: (last?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
  };
}

export function makeModelKey(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function parseModelKey(key: string) {
  const index = key.indexOf("::");
  if (index === -1) return { providerId: "", modelId: key };
  return { providerId: key.slice(0, index), modelId: key.slice(index + 2) };
}

export function titleFrom(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "新对话";
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

export function firstModelKey(
  providers: { id: string; models: { id: string; kind?: string }[] }[],
) {
  for (const provider of providers) {
    const chat = provider.models.find((model) => !model.kind || model.kind === "chat");
    if (chat) return makeModelKey(provider.id, chat.id);
  }
  return "";
}

/** 接口往界面走之前先把 key 抹掉，只留「有没有」和一小截尾巴。 */
export function publicEndpoint(item: AgentEndpoint): PublicEndpoint {
  return {
    id: item.id,
    label: item.label,
    mode: item.mode === "api" ? "api" : "official",
    baseUrl: item.baseUrl,
    model: item.model,
    models: item.models ?? [],
    global: item.global,
    hasKey: Boolean(item.apiKey),
    apiKeyMasked: maskKey(item.apiKey),
  };
}

export function toPublicAgent(agent: AgentProfile): PublicAgent {
  const { apiKey, endpoints = [], ...rest } = agent;
  return {
    ...rest,
    endpoints: endpoints.map(publicEndpoint),
    hasKey: Boolean(apiKey),
    apiKeyMasked: maskKey(apiKey),
  };
}
