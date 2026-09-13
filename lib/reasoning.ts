export type ReasoningLevel = {
  id: string;
  label: string;
  description?: string;
};

export type ReasoningParam =
  | "reasoning_effort"
  | "output_config"
  | "thinking_budget"
  | "enable_thinking"
  | "glm"
  | "none";

export type ReasoningProfile = {
  family: string;
  param: ReasoningParam;
  levels: ReasoningLevel[];
  defaultId: string;
};

type LabelPack = Record<string, { label: string; description: string }>;

const LABELS: LabelPack = {
  none: { label: "不思考", description: "不额外思考，尽量快答" },
  minimal: { label: "极简", description: "极少推理 token" },
  low: { label: "轻量", description: "少量思考，优先速度" },
  medium: { label: "均衡", description: "质量和速度折中（默认）" },
  high: { label: "深入", description: "更多思考，适合复杂问题" },
  xhigh: { label: "更高", description: "接近满档的深度推理" },
  max: { label: "最强", description: "该模型允许的最深思考" },
};

const CODEX_LABELS: LabelPack = {
  none: { label: "不思考", description: "Codex 关闭思考" },
  low: { label: "轻量", description: "Codex 轻量" },
  medium: { label: "中", description: "Codex 中" },
  high: { label: "高", description: "Codex 高" },
  xhigh: { label: "极高", description: "Codex 极高" },
  max: { label: "Max", description: "Codex Max" },
  ultra: { label: "Ultra", description: "Codex Ultra" },
};

const GROK_LABELS: LabelPack = {
  low: { label: "low", description: "Grok low" },
  medium: { label: "medium", description: "Grok medium" },
  high: { label: "high", description: "Grok high" },
  xhigh: { label: "xhigh", description: "Grok xhigh" },
};

function levels(ids: string[], pack: LabelPack = LABELS): ReasoningLevel[] {
  return ids.map((id) => ({
    id,
    label: pack[id]?.label || LABELS[id]?.label || id,
    description: pack[id]?.description || LABELS[id]?.description,
  }));
}

function profile(
  family: string,
  param: ReasoningParam,
  ids: string[],
  pack: LabelPack = LABELS,
): ReasoningProfile {
  const list = levels(ids, pack);
  const defaultId = ids.includes("medium") ? "medium" : ids[Math.floor((ids.length - 1) / 2)] || "medium";
  return { family, param, levels: list, defaultId };
}

export function detectReasoning(modelId: string, custom?: string[]): ReasoningProfile {
  const ids = (custom ?? []).map((item) => item.trim()).filter(Boolean);
  const id = modelId.toLowerCase();
  if (ids.length) {
    const pack = /grok/.test(id) ? GROK_LABELS : /gpt-|codex|o3|o1|astra/.test(id) ? CODEX_LABELS : LABELS;
    return profile("自定义", "reasoning_effort", ids, pack);
  }

  if (/^(sonnet|opus|haiku|fable)$/.test(id)) return detectReasoning(`claude-${id}`);

  if (/o1-pro|o3-pro|gpt-5-pro/.test(id)) return profile("OpenAI Pro", "reasoning_effort", ["high"]);
  if (/(^|[^a-z])o1([^a-z]|$)|(^|[^a-z])o3([^a-z]|$)|o4-mini/.test(id)) {
    return profile("Codex / o 系列", "reasoning_effort", ["low", "medium", "high"], CODEX_LABELS);
  }
  if (/gpt-6|gpt-5\.6|astra/.test(id)) {
    return profile("Codex / GPT-6", "reasoning_effort", ["low", "medium", "high", "xhigh", "max", "ultra"], CODEX_LABELS);
  }
  if (/gpt-5\.5|gpt-5\.4|gpt-5\.2|codex/.test(id)) {
    return profile("Codex", "reasoning_effort", ["low", "medium", "high", "xhigh", "max"], CODEX_LABELS);
  }
  if (/gpt-5\.1/.test(id)) {
    return profile("Codex / GPT-5.1", "reasoning_effort", ["low", "medium", "high", "xhigh"], CODEX_LABELS);
  }
  if (/gpt-5/.test(id)) {
    return profile("Codex / GPT-5", "reasoning_effort", ["low", "medium", "high", "xhigh"], CODEX_LABELS);
  }
  if (/gpt-oss/.test(id)) return profile("GPT-OSS", "reasoning_effort", ["low", "medium", "high"]);

  if (/claude.*(opus-5|sonnet-5|fable-5|opus-4\.8|opus-4\.7|4-8|4-7)/.test(id)) {
    return profile("Claude 5 / 4.7+", "output_config", ["low", "medium", "high", "xhigh", "max"]);
  }
  if (/claude.*opus-4\.6|claude.*opus-4-6/.test(id)) {
    return profile("Claude Opus 4.6", "output_config", ["low", "medium", "high", "max"]);
  }
  if (/claude.*sonnet-4\.6|claude.*sonnet-4-6/.test(id)) {
    return profile("Claude Sonnet 4.6", "output_config", ["low", "medium", "high"]);
  }
  if (/claude.*(3-7|3\.7|sonnet-4|opus-4|haiku-4|4-5|4\.5)/.test(id)) {
    return profile("Claude 扩展思考", "thinking_budget", ["low", "medium", "high"]);
  }
  if (/claude/.test(id)) {
    return profile("Claude", "output_config", ["low", "medium", "high"]);
  }

  if (/grok-4\.6|grok-4\.20|grok-4-6|grok-4-20/.test(id)) {
    return profile("Grok 4.6", "reasoning_effort", ["low", "medium", "high", "xhigh"], GROK_LABELS);
  }
  if (/grok-4\.5|grok-4-5/.test(id)) {
    return profile("Grok 4.5", "reasoning_effort", ["low", "medium", "high"], GROK_LABELS);
  }
  if (/grok-3-mini/.test(id)) {
    return profile("Grok 3 Mini", "reasoning_effort", ["low", "high"], GROK_LABELS);
  }
  if (/grok-4|grok-build/.test(id)) {
    return profile("Grok 4", "reasoning_effort", ["low", "medium", "high"], GROK_LABELS);
  }

  if (/deepseek-v4-pro|deepseek-v4.pro/.test(id)) {
    return profile("DeepSeek V4 Pro", "reasoning_effort", ["high", "max"]);
  }
  if (/deepseek-r1|deepseek-reasoner/.test(id)) {
    return profile("DeepSeek Reasoner", "none", ["medium", "high"]);
  }
  if (/deepseek-v3\.1|deepseek-v4/.test(id)) {
    return profile("DeepSeek", "enable_thinking", ["none", "medium", "high"]);
  }

  if (/glm-5\.3/.test(id)) return profile("GLM-5.3", "glm", ["low", "high", "max"]);
  if (/glm-5\.2/.test(id)) {
    return profile("GLM-5.2", "glm", ["none", "low", "medium", "high", "max"]);
  }
  if (/glm-4\.5|glm-4\.6|glm-4\.7|glm-5/.test(id)) {
    return profile("GLM", "glm", ["none", "medium", "high"]);
  }

  if (/qwen3|qwq/.test(id)) {
    return profile("Qwen 思考", "enable_thinking", ["none", "low", "medium", "high"]);
  }
  if (/gemini-2\.5|gemini-3/.test(id)) {
    return profile("Gemini", "enable_thinking", ["none", "low", "medium", "high"]);
  }
  if (/kimi|moonshot/.test(id)) {
    return profile("Kimi", "enable_thinking", ["none", "medium", "high"]);
  }

  if (/reasoner|thinking/.test(id)) {
    return profile("通用思考模型", "reasoning_effort", ["low", "medium", "high"]);
  }

  return profile("未识别", "none", []);
}

function budgetFor(id: string) {
  if (id === "low" || id === "minimal") return 2048;
  if (id === "high") return 16384;
  if (id === "xhigh") return 32768;
  if (id === "max") return 65536;
  return 8192;
}

export function applyReasoning(
  body: Record<string, unknown>,
  profile: ReasoningProfile,
  levelId: string,
) {
  const selected = profile.levels.find((item) => item.id === levelId);
  if (!selected || profile.param === "none") return;

  if (profile.param === "reasoning_effort") {
    if (selected.id === "none") return;
    body.reasoning_effort = selected.id;
    body.reasoning = { effort: selected.id };
    return;
  }
  if (profile.param === "output_config") {
    body.output_config = { effort: selected.id };
    body.thinking = { type: "adaptive" };
    return;
  }
  if (profile.param === "thinking_budget") {
    if (selected.id === "none") {
      body.thinking = { type: "disabled" };
      return;
    }
    body.thinking = { type: "enabled", budget_tokens: budgetFor(selected.id) };
    return;
  }
  if (profile.param === "enable_thinking") {
    body.enable_thinking = selected.id !== "none";
    if (selected.id !== "none") body.thinking_budget = budgetFor(selected.id);
    return;
  }
  if (profile.param === "glm") {
    if (selected.id === "none") {
      body.thinking = { type: "disabled" };
      return;
    }
    body.thinking = { type: "enabled" };
    body.reasoning_effort = selected.id;
  }
}

export function resolveReasoningLevel(profile: ReasoningProfile, requested?: string) {
  if (requested && profile.levels.some((item) => item.id === requested)) return requested;
  if (profile.levels.some((item) => item.id === "medium")) return "medium";
  return profile.defaultId;
}
