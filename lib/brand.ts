/**
 * 认牌子：把模型 id / 服务名 / 接口地址映射到一个厂商标识。
 *
 * 显示图标一共三条路，优先级从高到低：
 *   1. 用户自己在设置里配的（`brandIcons`，key 可以是 brandId，也可以是具体 modelId）
 *   2. 自带矢量图的牌子（`BUILT_IN_BRANDS`）
 *   3. **认出来但没有矢量图的牌子** —— 画一个「品牌色 + 缩写」的色块
 * 完全认不出来的什么都不画 —— 画错牌子比不画更糟。
 *
 * 认国内模型有个要点：聚合平台（硅基流动 / 魔搭 / 火山方舟 / 阿里百炼…）导出来的
 * 是 HuggingFace 风格的 id —— `Qwen/Qwen3-235B`、`deepseek-ai/DeepSeek-R1`、
 * `moonshotai/Kimi-K2-Instruct`、`zai-org/GLM-4.6`、`meta-llama/Llama-3.3-70B`。
 * 所以规则要按「厂商关键词」匹配，不能假设 id 是个干净的产品名。
 */

export type BrandId =
  // 国外
  | "anthropic"
  | "xai"
  | "openai"
  | "google"
  | "meta"
  | "mistral"
  | "cohere"
  | "nvidia"
  | "microsoft"
  // 国内
  | "deepseek"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "doubao"
  | "hunyuan"
  | "ernie"
  | "spark"
  | "minimax"
  | "stepfun"
  | "yi"
  | "baichuan"
  | "internlm"
  | "sensenova"
  | "skywork"
  | "longcat"
  // 聚合平台
  | "openrouter"
  | "siliconflow"
  | "groq";

export const BRAND_LABEL: Record<BrandId, string> = {
  anthropic: "Anthropic",
  xai: "xAI",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  cohere: "Cohere",
  nvidia: "NVIDIA",
  microsoft: "Microsoft",
  deepseek: "DeepSeek",
  qwen: "通义千问",
  moonshot: "Kimi",
  zhipu: "智谱 GLM",
  doubao: "豆包",
  hunyuan: "腾讯混元",
  ernie: "文心一言",
  spark: "讯飞星火",
  minimax: "MiniMax",
  stepfun: "阶跃星辰",
  yi: "零一万物",
  baichuan: "百川智能",
  internlm: "书生·浦语",
  sensenova: "商汤日日新",
  skywork: "昆仑万维",
  longcat: "美团 LongCat",
  openrouter: "OpenRouter",
  siliconflow: "硅基流动",
  groq: "Groq",
};

/**
 * 认出来但没矢量图的牌子，画成「品牌色底 + 缩写」的色块。
 * 颜色取各家主色，只用来**区分**，不是官方色值。
 */
export const BRAND_COLOR: Record<BrandId, string> = {
  anthropic: "#D97757",
  xai: "#111111",
  openai: "#10A37F",
  google: "#4285F4",
  meta: "#0866FF",
  mistral: "#FA520F",
  cohere: "#39594D",
  nvidia: "#76B900",
  microsoft: "#0078D4",
  deepseek: "#4D6BFE",
  qwen: "#615CED",
  moonshot: "#16191E",
  zhipu: "#3859FF",
  doubao: "#2B5CE6",
  hunyuan: "#0052D9",
  ernie: "#2932E1",
  spark: "#1A6FEE",
  minimax: "#F23F5D",
  stepfun: "#0F9D8F",
  yi: "#00543D",
  baichuan: "#0F62FE",
  internlm: "#1E5EFF",
  sensenova: "#00A0E9",
  skywork: "#7C3AED",
  longcat: "#FFB400",
  openrouter: "#6467F2",
  siliconflow: "#6E29F7",
  groq: "#F55036",
};

/** 色块里的缩写，1–2 个字符。 */
export const BRAND_SHORT: Record<BrandId, string> = {
  anthropic: "A",
  xai: "X",
  openai: "O",
  google: "G",
  meta: "M",
  mistral: "Mi",
  cohere: "Co",
  nvidia: "Nv",
  microsoft: "Ms",
  deepseek: "D",
  qwen: "Q",
  moonshot: "K",
  zhipu: "Z",
  doubao: "Db",
  hunyuan: "Hy",
  ernie: "Er",
  spark: "Sp",
  minimax: "Mm",
  stepfun: "St",
  yi: "Yi",
  baichuan: "Bc",
  internlm: "In",
  sensenova: "Sn",
  skywork: "Sk",
  longcat: "Lc",
  openrouter: "Or",
  siliconflow: "Sf",
  groq: "Gq",
};

/** 我们自带矢量图标的牌子，其余认出来的画品牌色块。 */
export const BUILT_IN_BRANDS: BrandId[] = ["anthropic", "xai", "openai"];

/*
 * 模型名规则。**顺序有意义**：越具体的越靠前。
 *
 * 几条踩过的坑：
 * - `gpt` / `^o[134]` 这类要放最后，否则会把 `gpt-oss`、`openai/gpt-oss-120b`
 *   这种社区模型抢在别的规则前面。
 * - `seed`（字节）单独出现太容易误伤，只认 `seed-oss` / `doubao` / `skylark` 这些
 *   有明确归属的写法。
 * - `^yi[-_]` 必须锚开头，不然 `qinyi`、`zhanyi` 之类会被误判成零一万物。
 */
const MODEL_RULES: [RegExp, BrandId][] = [
  [/claude|anthropic|sonnet|opus|haiku|fable/, "anthropic"],
  // `\bxai\b` 不能省：`MiniMaxAI/MiniMax-M2` 里 "mini**maxai**" 含 xai，
  // 裸 `xai` 会把 MiniMax 认成 xAI。真正的 xAI id 都是 `grok-*` 或 `xai/grok-*`。
  [/grok|\bxai\b/, "xai"],
  // —— 国内 ——
  [/deepseek/, "deepseek"],
  [/qwen|qwq|qvq|tongyi|dashscope|wanx/, "qwen"],
  [/kimi|moonshot/, "moonshot"],
  [/glm|zhipu|chatglm|cogview|cogvideo|zai-org/, "zhipu"],
  [/doubao|bytedance|skylark|seed-oss|volcengine|volces/, "doubao"],
  [/hunyuan|tencent/, "hunyuan"],
  [/ernie|wenxin|baidu|qianfan/, "ernie"],
  [/spark|iflytek|generalv/, "spark"],
  [/minimax|abab/, "minimax"],
  [/stepfun|step-\d/, "stepfun"],
  [/^yi[-_]|01-ai|lingyiwanwu/, "yi"],
  [/baichuan/, "baichuan"],
  [/internlm|intern-ai|internvl/, "internlm"],
  [/sensenova|sensechat|sense-\d/, "sensenova"],
  [/skywork/, "skywork"],
  [/longcat/, "longcat"],
  // —— 聚合平台 ——
  [/siliconflow/, "siliconflow"],
  [/openrouter/, "openrouter"],
  [/groq/, "groq"],
  // —— 国外（通用）——
  [/gemini|imagen|palm|gemma/, "google"],
  // `nvidia` 必须排在 `llama` 前面：NVIDIA 的 Nemotron 是拿 Llama 改的，
  // `nvidia/llama-3.1-nemotron-70b` 里两个关键词都有，该认 NVIDIA。
  [/nemotron|nvidia/, "nvidia"],
  [/phi-\d|microsoft/, "microsoft"],
  [/llama|meta-llama|meta-/, "meta"],
  [/mistral|mixtral|codestral|magistral|devstral/, "mistral"],
  [/command-r|cohere/, "cohere"],
  // gpt / o1-o4 放最后：别把社区模型抢在前面。
  [/gpt|openai|dall-e|dalle|^o[134]\b|codex|astra|sora|whisper/, "openai"],
];

const HOST_RULES: [RegExp, BrandId][] = [
  [/anthropic\.com/, "anthropic"],
  [/x\.ai/, "xai"],
  [/openai\.com|azure/, "openai"],
  // —— 国内 ——
  [/deepseek\.com/, "deepseek"],
  [/dashscope|aliyun|alibabacloud/, "qwen"],
  [/moonshot/, "moonshot"],
  [/bigmodel|zhipu/, "zhipu"],
  [/volces|volcengine|bytedance/, "doubao"],
  [/hunyuan|tencent/, "hunyuan"],
  [/baidubce|qianfan|baidu\.com/, "ernie"],
  [/xfyun|iflytek/, "spark"],
  [/minimaxi|minimax/, "minimax"],
  [/stepfun/, "stepfun"],
  [/01\.ai|lingyiwanwu/, "yi"],
  [/baichuan-ai/, "baichuan"],
  [/intern-ai|internlm/, "internlm"],
  [/sensenova/, "sensenova"],
  [/skywork/, "skywork"],
  [/longcat/, "longcat"],
  // —— 聚合平台 ——
  [/siliconflow/, "siliconflow"],
  [/openrouter\.ai/, "openrouter"],
  [/groq\.com/, "groq"],
  [/modelscope/, "qwen"],
  // —— 国外 ——
  [/googleapis|google|generativelanguage/, "google"],
  [/mistral\.ai/, "mistral"],
  [/cohere\.(ai|com)/, "cohere"],
  [/nvidia\.com|integrate\.api\.nvcf/, "nvidia"],
  [/microsoft|azure\.com\/.*openai/, "microsoft"],
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

/**
 * 「接口」图标的 key。加前缀是为了和模型 id、品牌 id 隔开 ——
 * 接口 id 是自己生成的短串，直接拿去当 key 有撞车的可能。
 */
export function providerIconKey(providerId: string) {
  return `provider:${providerId || ""}`.toLowerCase();
}

/** 给某一条服务写/清图标。每次从最新的 map 出发，避免抓图回来时把别人刚配的盖掉。 */
export function writeProviderIcon(icons: BrandIcons, providerId: string, icon: string): BrandIcons {
  const next = { ...icons };
  const key = providerIconKey(providerId);
  if (icon) next[key] = icon;
  else delete next[key];
  return next;
}

/**
 * 找图标。优先级从具体到笼统：**单个模型 → 接口 → 厂商**。
 *
 * 接口排在厂商前面：一个中转站上可能挂着好几家的模型，用户给这个接口配了图标，
 * 就是要让它们都换掉；厂商图标是「所有地方都换」那一档，更笼统。
 */
export function iconFor(
  icons: BrandIcons,
  modelId: string,
  baseUrl = "",
  providerId = "",
): string | null {
  const id = (modelId || "").toLowerCase();
  if (id && icons[id]) return icons[id];
  if (providerId) {
    const own = icons[providerIconKey(providerId)];
    if (own) return own;
  }
  const brand = brandFor(modelId, baseUrl);
  if (brand && icons[brand]) return icons[brand];
  return null;
}
