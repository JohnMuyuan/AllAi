"use client";

import { brandFor, iconFor, type BrandIcons } from "@/lib/brand";
import { BrandGlyph } from "./BrandMarks";

/**
 * 模型名前面的厂商图标。
 * 顺序：用户自己配的图 → 内置矢量图（三家）→ 品牌色块（其余认得出的牌子）→ 什么都不画。
 *
 * 色块这一档是给国内模型准备的：以前认得出 DeepSeek / 通义 / Kimi / 智谱
 * 也不画任何东西，看着就像「没认出来」。认不出牌子的仍然留白（不画错）。
 */
export function ModelIcon({
  modelId,
  baseUrl = "",
  providerId = "",
  icons = {},
  className = "size-4",
}: {
  modelId: string;
  baseUrl?: string;
  /** 模型所属接口的 id。给了就能用上「给接口配的图标」。 */
  providerId?: string;
  icons?: BrandIcons;
  className?: string;
}) {
  const custom = iconFor(icons, modelId, baseUrl, providerId);
  if (custom) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 用户自己配的图标，可能是任意来源
      <img
        src={custom}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 rounded-[4px] object-contain`}
      />
    );
  }

  return <BrandGlyph brand={brandFor(modelId, baseUrl)} className={className} />;
}
