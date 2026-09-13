import { OFFICIAL_CHATS } from "./official-chat";
import type { ProviderAuth } from "./types";

export type ProviderTemplate = {
  name: string;
  baseUrl: string;
  models: { id: string; label: string }[];
  hint: string;
  auth?: ProviderAuth;
};

// 官方登录的两个（Claude 账号 / Grok 账号）从 OFFICIAL_CHATS 生成，别再手抄一遍。
const OFFICIAL_TEMPLATES: ProviderTemplate[] = OFFICIAL_CHATS.map((item) => ({
  name: item.name,
  baseUrl: item.providerId,
  models: item.models,
  hint: item.hint,
  auth: item.auth,
}));

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  ...OFFICIAL_TEMPLATES,
  {
    name: "SpaceXAI",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-imagine-image-2.0", label: "Grok Imagine 2.0" },
      { id: "grok-imagine-video", label: "Grok Imagine Video" },
    ],
    hint: "console.x.ai 创建密钥",
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
    hint: "platform.openai.com",
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ],
    hint: "platform.deepseek.com",
  },
  {
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", label: "Qwen Plus" },
      { id: "qwen-max", label: "Qwen Max" },
    ],
    hint: "DashScope 兼容模式",
  },
  {
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [{ id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo" }],
    hint: "platform.moonshot.cn",
  },
  {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-plus", label: "GLM-4 Plus" },
      { id: "glm-4-flash", label: "GLM-4 Flash" },
    ],
    hint: "open.bigmodel.cn",
  },
  {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [],
    hint: "保存后可从接口同步模型",
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    hint: "一个密钥聚合多家模型",
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }],
    hint: "console.groq.com",
  },
];
