import type { BrandId } from "./brand";

/**
 * 软件自带的厂商图标。文件在 `public/brand/presets/`。
 *
 * 自动匹配按关键词打分，多个都沾边时取分最高的那张
 * （比如 aliyun.com 会碰到阿里云 / 百炼 / 通义，阿里云更贴）。
 */
export type PresetIcon = {
  id: string;
  file: string;
  label: string;
  brand?: BrandId;
  keywords: string[];
  /** 彩色图不用反色；单色线稿在深色底上要反色。 */
  color: boolean;
};

export const PRESET_ICONS: PresetIcon[] = [
  { id: "claude", file: "claude-color.svg", label: "Claude", brand: "anthropic", keywords: ["claude", "sonnet", "opus", "haiku", "anthropic"], color: true },
  { id: "anthropic", file: "anthropic.svg", label: "Anthropic", brand: "anthropic", keywords: ["anthropic"], color: false },
  { id: "grok", file: "grok.svg", label: "Grok", brand: "xai", keywords: ["grok", "xai", "x.ai"], color: false },
  { id: "openai", file: "openai.svg", label: "OpenAI", brand: "openai", keywords: ["openai", "chatgpt", "gpt-4", "gpt-5", "gpt-3", "dall-e", "sora", "whisper", "codex"], color: false },
  { id: "gemini", file: "gemini-color.svg", label: "Gemini", brand: "google", keywords: ["gemini", "gemma", "imagen", "google.ai", "googleapis", "generativelanguage"], color: true },
  { id: "deepmind", file: "deepmind-color.svg", label: "DeepMind", brand: "google", keywords: ["deepmind"], color: true },
  { id: "deepseek", file: "deepseek-color.svg", label: "DeepSeek", brand: "deepseek", keywords: ["deepseek"], color: true },
  { id: "qwen", file: "qwen-color.svg", label: "通义千问", brand: "qwen", keywords: ["qwen", "qwq", "qvq", "tongyi", "dashscope"], color: true },
  { id: "alibaba", file: "alibaba-color.svg", label: "阿里巴巴", brand: "alibaba", keywords: ["alibaba.com", "alibaba"], color: true },
  { id: "alibabacloud", file: "alibabacloud-color.svg", label: "阿里云", brand: "alibaba", keywords: ["aliyun", "alibabacloud", "aliyun.com", "alibabacloud.com"], color: true },
  { id: "bailian", file: "bailian-color.svg", label: "阿里云百炼", brand: "bailian", keywords: ["bailian", "bailian.aliyun"], color: true },
  { id: "kimi", file: "kimi.svg", label: "Kimi", brand: "moonshot", keywords: ["kimi", "moonshot"], color: false },
  { id: "chatglm", file: "chatglm-color.svg", label: "智谱 GLM", brand: "zhipu", keywords: ["chatglm", "glm", "zhipu", "bigmodel"], color: true },
  { id: "zai", file: "zai.svg", label: "Z.ai", brand: "zhipu", keywords: ["zai-org", "z.ai", "zai."], color: false },
  { id: "doubao", file: "doubao-color.svg", label: "豆包", brand: "doubao", keywords: ["doubao", "skylark", "seed-oss"], color: true },
  { id: "bytedance", file: "bytedance-color.svg", label: "字节跳动", brand: "doubao", keywords: ["bytedance", "volcengine", "volces"], color: true },
  { id: "tencentcloud", file: "tencentcloud-color.svg", label: "腾讯云", brand: "hunyuan", keywords: ["tencentcloud", "tencent", "hunyuan", "qcloud"], color: true },
  { id: "baiducloud", file: "baiducloud-color.svg", label: "百度智能云", brand: "ernie", keywords: ["baiducloud", "baidubce", "qianfan", "ernie", "wenxin", "baidu.com"], color: true },
  { id: "meta", file: "meta-color.svg", label: "Meta", brand: "meta", keywords: ["meta-llama", "llama", "meta.com"], color: true },
  { id: "microsoft", file: "microsoft-color.svg", label: "Microsoft", brand: "microsoft", keywords: ["microsoft", "azure", "phi-"], color: true },
  { id: "copilot", file: "copilot-color.svg", label: "GitHub Copilot", brand: "copilot", keywords: ["copilot", "github"], color: true },
  { id: "huaweicloud", file: "huaweicloud-color.svg", label: "华为云", brand: "huawei", keywords: ["huaweicloud", "huawei", "pangu", "myhuaweicloud"], color: true },
  { id: "luma", file: "luma-color.svg", label: "Luma", brand: "luma", keywords: ["luma", "lumalabs", "dream-machine"], color: true },
  { id: "midjourney", file: "midjourney.svg", label: "Midjourney", brand: "midjourney", keywords: ["midjourney"], color: false },
  { id: "ollama", file: "ollama.svg", label: "Ollama", brand: "ollama", keywords: ["ollama"], color: false },
];

export function presetSrc(file: string) {
  return `/brand/presets/${file}`;
}

/** 每个牌子默认用哪张预设（BrandGlyph 走这里）。 */
export const BRAND_PRESET_FILE: Partial<Record<BrandId, string>> = {
  anthropic: "claude-color.svg",
  xai: "grok.svg",
  openai: "openai.svg",
  google: "gemini-color.svg",
  meta: "meta-color.svg",
  microsoft: "microsoft-color.svg",
  deepseek: "deepseek-color.svg",
  qwen: "qwen-color.svg",
  alibaba: "alibabacloud-color.svg",
  bailian: "bailian-color.svg",
  moonshot: "kimi.svg",
  zhipu: "chatglm-color.svg",
  doubao: "doubao-color.svg",
  hunyuan: "tencentcloud-color.svg",
  ernie: "baiducloud-color.svg",
  copilot: "copilot-color.svg",
  huawei: "huaweicloud-color.svg",
  luma: "luma-color.svg",
  midjourney: "midjourney.svg",
  ollama: "ollama.svg",
};

function hostOf(text: string) {
  const raw = text.trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/** 多个都沾边时返回分最高的。分太低当没认出来。 */
export function bestPreset(query: string): PresetIcon | null {
  const hay = query.trim().toLowerCase();
  if (!hay) return null;
  const host = hostOf(hay);
  let best: { icon: PresetIcon; score: number } | null = null;
  for (const icon of PRESET_ICONS) {
    let score = 0;
    for (const keyword of icon.keywords) {
      const key = keyword.toLowerCase();
      if (hay === key) score += 80 + key.length;
      else if (host === key || host.endsWith(`.${key}`)) score += 70 + key.length;
      else if (host.includes(key)) score += 40 + key.length * 3;
      else if (hay.includes(key)) score += 10 + key.length * 2;
    }
    if (score <= 0) continue;
    if (!best || score > best.score) best = { icon, score };
  }
  return best && best.score >= 16 ? best.icon : null;
}
