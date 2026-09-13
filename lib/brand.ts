/**
 * 认牌子：把模型 id / 服务名 / 接口地址映射到一个厂商标识。
 *
 * 内置的只画我们自己有 SVG 的三家（Anthropic / xAI / OpenAI），
 * 其余认出来也只是给个名字，图标由用户在设置里自己配（brandIcons）。
 * 认不出来就什么都不画 —— 画错牌子比不画更糟。
 */
export type BrandId =
  | "anthropic"
  | "xai"
  | "openai"
  | "deepseek"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "google"
  | "meta"
  | "mistral"
  | "openrouter"
  | "siliconflow"
  | "groq";

export const BRAND_LABEL: Record<BrandId, string> = {
  anthropic: "Anthropic",
  xai: "xAI",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  moonshot: "Kimi",
  zhipu: "智谱 GLM",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  siliconflow: "硅基流动",
  groq: "Groq",
};

/** 我们自带矢量图标的牌子，其余要靠用户配图。 */
export const BUILT_IN_BRANDS: BrandId[] = ["anthropic", "xai", "openai"];

const MODEL_RULES: [RegExp, BrandId][] = [
  [/claude|anthropic|sonnet|opus|haiku|fable/, "anthropic"],
  [/grok|xai/, "xai"],
  [/deepseek/, "deepseek"],
  [/qwen|qwq|tongyi|wanx/, "qwen"],
  [/kimi|moonshot/, "moonshot"],
  [/glm|zhipu|chatglm|cogview|cogvideo/, "zhipu"],
  [/gemini|imagen|palm|gemma/, "google"],
  [/llama|meta-/, "meta"],
  [/mistral|mixtral|codestral|magistral/, "mistral"],
  // gpt/o1/o3 放最后：别把 "gpt-oss" 这种社区模型抢在前面的规则前面。
  [/gpt|openai|dall-e|dalle|^o[134]\b|codex|astra|sora|whisper/, "openai"],
];

const HOST_RULES: [RegExp, BrandId][] = [
  [/anthropic\.com/, "anthropic"],
  [/x\.ai/, "xai"],
  [/openai\.com|azure/, "openai"],
  [/deepseek\.com/, "deepseek"],
  [/dashscope|aliyun/, "qwen"],
  [/moonshot/, "moonshot"],
  [/bigmodel|zhipu/, "zhipu"],
  [/googleapis|google/, "google"],
  [/mistral\.ai/, "mistral"],
  [/openrouter\.ai/, "openrouter"],
  [/siliconflow/, "siliconflow"],
  [/groq\.com/, "groq"],
];

export function brandFromModel(modelId: string): BrandId | null {
  const id = (modelId || "").toLowerCase();
  if (!id) return null;
  for (const [re, brand] of MODEL_RULES) if (re.test(id)) return brand;
  return null;
}

export function brandFromHost(baseUrl: string): BrandId | null {
  const url = (baseUrl || "").toLowerCase();
  if (!url) return null;
  for (const [re, brand] of HOST_RULES) if (re.test(url)) return brand;
  return null;
}

/**
 * 一个模型显示哪个牌子：先看模型名，认不出再看服务地址。
 * 中转网关上挂着各家模型，所以模型名优先级更高。
 */
export function brandFor(modelId: string, baseUrl = ""): BrandId | null {
  return brandFromModel(modelId) ?? brandFromHost(baseUrl);
}

/** 用户自己配的图标：key 可以是 brandId，也可以是具体的 modelId。 */
export type BrandIcons = Record<string, string>;

export function iconFor(
  icons: BrandIcons,
  modelId: string,
  baseUrl = "",
): string | null {
  const id = (modelId || "").toLowerCase();
  if (icons[id]) return icons[id];
  const brand = brandFor(modelId, baseUrl);
  if (brand && icons[brand]) return icons[brand];
  return null;
}
