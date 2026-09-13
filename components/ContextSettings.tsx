"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_COMPACT_PERCENT,
  contextLimit,
  formatTokens,
} from "@/lib/context-window";
import type { AppPrefs, PublicAgent, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { OptionSelect } from "./OptionSelect";

/**
 * 上下文上限与自动压缩的设置。
 *
 * 内置表按型号认（Claude 5 系 1M、grok-build 256K、Codex 可输入 272K…），
 * 但中转站上同一个名字可能被限成更小的窗口，只有用户自己知道 —— 所以留了手填。
 */
export function ContextSettings({
  prefs,
  providers,
  agents,
  onChange,
}: {
  prefs: AppPrefs;
  providers: PublicProvider[];
  agents: PublicAgent[];
  onChange: (patch: Partial<AppPrefs>) => void;
}) {
  const t = useT();
  const [draftId, setDraftId] = useState("");
  const [draftValue, setDraftValue] = useState("");

  // 把所有在用的模型列出来，让用户看到每个被认成了多少。
  const known = new Map<string, string>();
  for (const provider of providers) {
    for (const model of provider.models ?? []) known.set(model.id, provider.name);
  }
  for (const agent of agents) {
    for (const endpoint of agent.endpoints ?? []) {
      for (const model of endpoint.models ?? []) known.set(model.id, agent.name);
    }
  }
  const rows = [...known.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const overrides = prefs.contextLimits ?? {};
  const percent = prefs.compactPercent || DEFAULT_COMPACT_PERCENT;

  function setOverride(id: string, tokens: number | null) {
    const next = { ...overrides };
    if (tokens && tokens > 0) next[id] = Math.round(tokens);
    else delete next[id];
    onChange({ contextLimits: next });
  }

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{t("自动压缩上下文")}</div>
      <div className="mb-2 text-xs leading-5 text-muted">
        {t("每个模型能装的上下文不一样（Claude 5 系 1M、Grok 4.6 500K、grok-build 256K、Codex 可输入约 272K）。聊到接近上限时，AllAi 会把更早的内容压成一段摘要、保留最近几轮原文 —— 和三家 CLI 自己在 83%–85% 做的事一样。走官方登录时，压缩意味着放弃")}{" "}
        <code className="font-mono">--resume</code>
        {t("、用摘要开一条新会话。三个专区都生效。")}
      </div>
      <OptionSelect
        label="自动压缩"
        value={prefs.autoCompact === false ? "off" : "on"}
        onChange={(value) => onChange({ autoCompact: value !== "off" })}
        options={[
          { value: "on", label: "开启", description: "默认。到量自动压，对话里会说明" },
          { value: "off", label: "关闭", description: "只显示进度，撑爆了模型自己会报错" },
        ]}
      />

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium">{t("压缩阈值")}</span>
          <span className="font-mono tabular-nums text-muted">{t("用到 {n}% 时压缩", { n: percent })}</span>
        </div>
        <input
          type="range"
          min={50}
          max={95}
          step={5}
          value={percent}
          disabled={prefs.autoCompact === false}
          onChange={(event) => onChange({ compactPercent: Number(event.target.value) })}
          className="w-full accent-[var(--accent)] disabled:opacity-40"
        />
        <p className="mt-1 text-[11px] text-muted">
          {t("调低会更早压缩：省钱、少幻觉，但细节丢得早。调高更省事，但越接近上限模型的表现越差（业界经验是过 70–80% 就开始明显下滑）。")}
        </p>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-1 text-sm font-medium">{t("模型上限")}</div>
        <div className="mb-2 text-xs leading-5 text-muted">
          {t("下面是自动识别的结果。中转站把窗口限小了的话，在这儿手填一个覆盖它。认不出的型号一律按 128K 保守处理。")}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-line">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">{t("还没有接入模型")}</p>
          ) : (
            rows.map(([id, from]) => {
              const limit = contextLimit(id, overrides);
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px]">{id}</div>
                    <div className="truncate text-[10px] text-muted">
                      {from} · {t(limit.note)}
                    </div>
                  </div>
                  <input
                    inputMode="numeric"
                    value={overrides[id] ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^\d]/g, "");
                      setOverride(id, raw ? Number(raw) : null);
                    }}
                    placeholder={formatTokens(limit.tokens)}
                    className="w-28 shrink-0 rounded-lg border border-line bg-elevated px-2 py-1 text-right font-mono text-[12px] outline-none focus:border-accent"
                  />
                  {overrides[id] ? (
                    <button
                      type="button"
                      aria-label={t("恢复 {id} 的自动识别", { id })}
                      onClick={() => setOverride(id, null)}
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : (
                    <span className="size-7 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 列表里没有的（例如官方登录用的型号）也能手动加一条 */}
        <div className="mt-2 flex gap-2">
          <input
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            placeholder={t("模型 ID")}
            className="min-w-0 flex-1 rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <input
            inputMode="numeric"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value.replace(/[^\d]/g, ""))}
            placeholder={t("上限 token")}
            className="w-32 rounded-xl border border-line bg-elevated px-3 py-2 text-right font-mono text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!draftId.trim() || !draftValue}
            onClick={() => {
              setOverride(draftId.trim(), Number(draftValue));
              setDraftId("");
              setDraftValue("");
            }}
            className="shrink-0 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-canvas disabled:opacity-40"
          >
            {t("添加")}
          </button>
        </div>
      </div>
    </div>
  );
}
