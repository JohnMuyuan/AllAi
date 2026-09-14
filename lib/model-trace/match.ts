/** 只认 OpenAI / Claude 两家。其它型号直接跳过。 */
export function traceFamily(modelId: string): "gpt" | "claude" | null {
  const id = (modelId || "").toLowerCase();
  if (!id) return null;
  if (/claude|anthropic|sonnet|opus|haiku/.test(id)) return "claude";
  if (/gpt|openai|chatgpt|^o[134]\b|codex|astra/.test(id)) return "gpt";
  return null;
}

const BANK_IDS = [
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
];

/** 把用户选的型号对到指纹库里的 id。对不上就只比家族，不要用双向 includes（gpt-5 会误撞 gpt-5.4）。 */
export function mapToBankId(modelId: string): string | null {
  const id = (modelId || "").toLowerCase().replace(/_/g, "-");
  if (!id) return null;
  const exact = BANK_IDS.find((item) => id === item);
  if (exact) return exact;
  if (/gpt-5\.4|gpt-5-4/.test(id)) return "gpt-5.4";
  if (/gpt-5\.5|gpt-5-5/.test(id)) return "gpt-5.5";
  if (/luna/.test(id)) return "gpt-5.6-luna";
  if (/terra/.test(id)) return "gpt-5.6-terra";
  if (/\bsol\b|gpt-5\.6-sol|gpt-5-6-sol/.test(id)) return "gpt-5.6-sol";
  if (/gpt-6|astra/.test(id)) return "gpt-6-astra";
  if (/haiku/.test(id)) return "claude-haiku-4-5-20251001";
  if (/sonnet-5|sonnet 5/.test(id)) return "claude-sonnet-5";
  if (/sonnet-4-6|sonnet-4\.6|sonnet 4\.6/.test(id)) return "claude-sonnet-4-6";
  if (/opus-5|opus 5/.test(id)) return "claude-opus-5";
  if (/opus-4-8|opus-4\.8/.test(id)) return "claude-opus-4-8";
  if (/opus-4-7|opus-4\.7/.test(id)) return "claude-opus-4-7";
  if (/opus-4-6|opus-4\.6/.test(id)) return "claude-opus-4-6";
  return null;
}

/** 0% 绿；不到 20% 黄（10% 那一档）；20% 及以上红。 */
export function lampLevel(rate: number): "green" | "yellow" | "red" {
  if (rate <= 0) return "green";
  if (rate < 0.2) return "yellow";
  return "red";
}

export function isRouteMismatch(
  expectedModelId: string,
  predictedId: string,
  predictedFamily: string,
  probability: number,
) {
  const family = traceFamily(expectedModelId);
  if (!family) return false;
  if (predictedFamily !== family) return true;
  const mapped = mapToBankId(expectedModelId);
  if (!mapped) return false;
  if (predictedId === mapped) return false;
  return probability >= 0.35;
}
