/**
 * 用量数字的写法（纯函数，界面和统计页共用）：
 * - 简略：2.6K、1.23M、10.00B —— 以前只到 M，一百亿会写成「10000.00M」；
 * - 精确：2,614、10,000,000,000 —— 千位分隔，多大都能写全；
 * - 中文：3.1 亿、69 亿 —— K/M/B 是四位一级换算（千/百万/十亿），中文是**万、亿**（四位一级），
 *   两套对不上，所以「3.14B」到底是多少亿得心算一下。统计页在旁边补一个中文写法。
 */
const UNITS: [number, string, number][] = [
  [1e12, "T", 2],
  [1e9, "B", 2],
  [1e6, "M", 2],
  [1e3, "K", 1],
];

export function formatCount(value: number, exact = false) {
  if (!Number.isFinite(value)) return "—";
  const n = Math.round(value);
  if (exact) return n.toLocaleString("en-US");
  const abs = Math.abs(n);
  for (const [size, unit, digits] of UNITS) {
    if (abs >= size) return `${(n / size).toFixed(digits)}${unit}`;
  }
  return String(n);
}

/**
 * 中文写法：万（1e4）、亿（1e8）、万亿（1e12）。
 *
 * 只在数字够大时才给：几千个 token 写成「0.3 万」反而更难读，所以 1 万以下返回空串，
 * 调用方拿到空串就不显示这一截。
 */
export function formatCountCN(value: number) {
  if (!Number.isFinite(value)) return "";
  const n = Math.round(value);
  const abs = Math.abs(n);
  if (abs < 1e4) return "";
  const pick = (size: number, unit: string) => {
    const scaled = n / size;
    // 10 以下留一位小数（3.1 亿），10 以上取整（69 亿）—— 再多的小数没人看。
    return `${Math.abs(scaled) >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${unit}`;
  };
  if (abs >= 1e12) return pick(1e12, "万亿");
  if (abs >= 1e8) return pick(1e8, "亿");
  return pick(1e4, "万");
}
