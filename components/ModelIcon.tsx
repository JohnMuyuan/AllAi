"use client";

import { Server } from "lucide-react";
import { brandFor, brandFromHost, iconFor, serviceIcon, type BrandIcons } from "@/lib/brand";
import { BrandGlyph } from "./BrandMarks";

/**
 * 模型名前面的图标。
 * 顺序：这只模型自己配的图 → 内置矢量图 → 品牌色块 → 什么都不画。
 * 供应商图标不走这里。
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

  return <BrandGlyph brand={brandFor(modelId, baseUrl)} className={className} />;
}

/**
 * 左侧「这条服务」自己的图标。配过就用配的那张，
 * 没配再按接口地址认牌子，再没有就中性占位。
 */
export function ServiceIcon({
  providerId,
  baseUrl = "",
  icons = {},
  className = "size-4",
}: {
  providerId: string;
  baseUrl?: string;
  icons?: BrandIcons;
  className?: string;
}) {
  const own = serviceIcon(icons, providerId);
  if (own) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 用户自己配的图标，可能是任意来源
      <img
        src={own}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 rounded-[4px] object-contain`}
      />
    );
  }
  const brand = brandFromHost(baseUrl);
  if (brand) return <BrandGlyph brand={brand} className={className} />;
  return <Server className={`${className} shrink-0 text-muted opacity-60`} />;
}
