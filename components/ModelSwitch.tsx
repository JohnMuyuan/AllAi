"use client";

import { Archive, ArrowRight } from "lucide-react";
import type { PublicProvider } from "@/lib/types";
import { parseModelKey } from "@/lib/public";
import { brandFor } from "@/lib/brand";
import { BrandGlyph } from "./BrandMarks";
import { useT } from "./I18n";

export function modelInfo(modelKey: string | undefined, providers: PublicProvider[]) {
  if (!modelKey) return null;
  const { providerId, modelId } = parseModelKey(modelKey);
  const provider = providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return {
    label: model?.label || modelId,
    provider: provider?.name || "",
    // 认牌子统一走 lib/brand.ts：先看模型名，认不出再看服务地址。
    // 以前这里用 BrandMarks 里另抄的一份规则，国内模型全认不出来。
    brand: brandFor(modelId, provider?.baseUrl),
    // 空状态要画「当前模型的图标」，得把这几个带出去（约定 93：只走 ModelIcon 一条路）。
    modelId,
    baseUrl: provider?.baseUrl || "",
    providerId: provider?.id || "",
  };
}

function ModelChip({ item }: { item: NonNullable<ReturnType<typeof modelInfo>> }) {
  const t = useT();
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <BrandGlyph brand={item.brand} className="size-3.5" />
      <span className="truncate font-medium text-ink">{item.label}</span>
      {item.provider ? <span className="truncate text-muted">· {t(item.provider)}</span> : null}
    </span>
  );
}

/** 「A · 来源 → B · 来源」 */
export function SwitchBadge({
  from,
  to,
}: {
  from: ReturnType<typeof modelInfo>;
  to: ReturnType<typeof modelInfo>;
}) {
  const t = useT();
  if (!to) return null;
  return (
    <div className="flex justify-center">
      <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1 text-[11px] text-muted">
        {from ? (
          <>
            <ModelChip item={from} />
            <ArrowRight className="size-3 shrink-0" />
          </>
        ) : (
          <span className="shrink-0">{t("已切换到")}</span>
        )}
        <ModelChip item={to} />
      </span>
    </div>
  );
}

/**
 * 对话开头那一条：这条对话是用哪个模型开始的。
 * 发第一条消息之前怎么换模型都不算，第一条回复用的是谁，开头就写谁。
 */
export function StartBadge({ model }: { model: ReturnType<typeof modelInfo> }) {
  const t = useT();
  if (!model) return null;
  return (
    <div className="flex justify-center">
      <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1 text-[11px] text-muted">
        <span className="shrink-0">{t("使用")}</span>
        <ModelChip item={model} />
        <span className="shrink-0">{t("开始对话")}</span>
      </span>
    </div>
  );
}

/** 上下文被压缩时插在历史里的那条说明。和换模型徽章同一个视觉档次。 */
export function CompactBadge({ text }: { text: string }) {
  return (
    <div className="flex justify-center">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1 text-[11px] text-muted">
        <Archive className="size-3 shrink-0" />
        <span className="min-w-0">{text}</span>
      </span>
    </div>
  );
}
