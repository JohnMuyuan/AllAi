"use client";

import { brandFor, iconFor, type BrandIcons } from "@/lib/brand";
import { BrandMark } from "./BrandMarks";

/**
 * 模型名前面的厂商图标。
 * 顺序：用户自己配的图 → 内置矢量图（三家）→ 什么都不画。
 */
export function ModelIcon({
  modelId,
  baseUrl = "",
  icons = {},
  className = "size-4",
}: {
  modelId: string;
  baseUrl?: string;
  icons?: BrandIcons;
  className?: string;
}) {
  const custom = iconFor(icons, modelId, baseUrl);
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

  const brand = brandFor(modelId, baseUrl);
  if (brand === "anthropic") return <BrandMark kind="claude-code" className={`${className} shrink-0`} />;
  if (brand === "xai") return <BrandMark kind="grok-build" className={`${className} shrink-0`} />;
  if (brand === "openai") return <BrandMark kind="codex" className={`${className} shrink-0`} />;
  return null;
}
