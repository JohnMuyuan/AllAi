"use client";

import { Activity, ArrowDownUp, Boxes, Coins, Cpu, DatabaseZap, Gauge } from "lucide-react";
import { formatCount } from "@/lib/format-count";
import { useT, type Translate } from "./I18n";

/** 统计行能显示的项目，设置 → 通用里可以勾选。数组顺序就是显示顺序。 */
export const STATS_FIELDS = [
  { id: "speed", label: "速度" },
  { id: "context", label: "上下文" },
  { id: "tokens", label: "本对话 Token" },
  { id: "io", label: "输入 / 输出" },
  { id: "cache", label: "缓存命中率" },
  { id: "model", label: "模型来源" },
  { id: "cost", label: "花费" },
  { id: "official", label: "官方额度" },
] as const;

export const DEFAULT_STATS_FIELDS = ["speed", "context", "tokens", "cache", "model", "cost", "official"];

export type StatsBarData = {
  /** 本轮流式输出的速度，token/秒。没在跑就是 0。 */
  tokensPerSecond: number;
  /** 估算的上下文长度（这条对话现有内容折算的 token）。 */
  contextTokens: number;
  /** 当前模型的上下文上限。有它就显示 `已用/上限 · 百分比`。 */
  contextLimit?: number;
  /** 到这个比例就自动压缩，超过时把数字标红提醒。 */
  contextLevel?: "ok" | "warn" | "over";
  /** 上限是怎么来的，鼠标悬停时说明。 */
  contextNote?: string;
  /** 这条对话累计消耗。 */
  conversationTokens: number;
  conversationRequests: number;
  conversationInput?: number;
  conversationOutput?: number;
  /** 命中缓存的输入，和送进模型的全部输入（算命中率用，见 lib/usage.ts）。 */
  conversationCacheRead?: number;
  conversationPrompt?: number;
  costUsd: number;
  /** 当前用的模型和它来自哪个服务 / 账号。 */
  model?: { label: string; source: string };
  /** 用户选的显示项，不传就用默认那几项。 */
  fields?: string[];
  /** 官方登录账号在滚动窗口里的用量。有百分比就是官方额度已用；否则是 AllAi 自己记的 token。 */
  official?: {
    name: string;
    fiveHour: number;
    week: number;
    fiveHourPct?: number;
    weekPct?: number;
    weekReset?: string;
    credits?: number;
    resetCredits?: number;
  };
};

const fmt = (n: number) => formatCount(n);

function officialValue(official: NonNullable<StatsBarData["official"]>, t: Translate) {
  const parts: string[] = [];
  const hasOfficialWindow = official.fiveHourPct != null || official.weekPct != null;
  if (official.fiveHourPct != null) parts.push(`5h ${Math.round(official.fiveHourPct)}%`);
  else if (!hasOfficialWindow && official.credits == null) parts.push(`5h ${fmt(official.fiveHour)}`);
  if (official.weekPct != null) parts.push(`7d ${Math.round(official.weekPct)}%`);
  else if (official.credits != null) parts.push(t("额度 {n}", { n: Math.round(official.credits) }));
  else if (!hasOfficialWindow) parts.push(`7d ${fmt(official.week)}`);
  if (official.resetCredits != null) parts.push(t("重置 {n}", { n: official.resetCredits }));
  return parts.join(" · ");
}

type Item = {
  id: string;
  icon: typeof Gauge;
  label: string;
  value: string;
  title: string;
  tone?: "ok" | "warn" | "over";
};

export function StatsBar({ data }: { data: StatsBarData }) {
  const t = useT();
  const fields = new Set(data.fields ?? DEFAULT_STATS_FIELDS);
  const all: Item[] = [
    {
      id: "speed",
      icon: Gauge,
      label: t("速度"),
      value: data.tokensPerSecond ? `${data.tokensPerSecond.toFixed(1)} tok/s` : "—",
      title: t("本轮输出速度，只在生成时有值"),
    },
    {
      id: "context",
      icon: Boxes,
      label: t("上下文"),
      value: data.contextLimit
        ? `${fmt(data.contextTokens)}/${fmt(data.contextLimit)} · ${Math.round(
            (data.contextTokens / data.contextLimit) * 100,
          )}%`
        : fmt(data.contextTokens),
      title: data.contextLimit
        ? t("此刻窗口占用 / 上限（{note}）。到设定比例会自动压缩早期内容。", {
            note: t(data.contextNote || "自动识别"),
          })
        : t("这条对话现有内容的估算长度（按字符折算，不是精确值）"),
      tone: data.contextLevel,
    },
    {
      id: "tokens",
      icon: Activity,
      label: t("本对话"),
      value: `${fmt(data.conversationTokens)}${data.conversationRequests ? t("· {n} 轮", { n: data.conversationRequests }) : ""}`,
      title: t("这条对话累计消耗的 token（输入 + 输出）：{n}", {
        n: data.conversationTokens.toLocaleString("en-US"),
      }),
    },
  ];
  if (data.conversationInput !== undefined && data.conversationOutput !== undefined) {
    all.push({
      id: "io",
      icon: ArrowDownUp,
      label: t("输入/输出"),
      value: `${fmt(data.conversationInput)} / ${fmt(data.conversationOutput)}`,
      title: t("这条对话累计的输入 token / 输出 token"),
    });
  }
  if (data.conversationPrompt !== undefined) {
    const prompt = data.conversationPrompt;
    const hit = data.conversationCacheRead ?? 0;
    all.push({
      id: "cache",
      icon: DatabaseZap,
      label: t("缓存命中"),
      value: prompt ? `${Math.round((hit / prompt) * 100)}%` : "—",
      title: prompt
        ? t("这条对话送进模型的输入里，有 {n} 个 token 命中了缓存。命中越多越省钱、越快。", {
            n: `${hit.toLocaleString("en-US")} / ${prompt.toLocaleString("en-US")}`,
          })
        : t("还没有用量记录，或者这个接口不报缓存"),
    });
  }
  if (data.model) {
    all.push({
      id: "model",
      icon: Cpu,
      label: t("模型"),
      value: data.model.source ? `${data.model.label} · ${data.model.source}` : data.model.label,
      title: t("当前选的模型，和它来自哪个服务 / 账号"),
    });
  }
  if (data.costUsd > 0) {
    all.push({
      id: "cost",
      icon: Coins,
      label: t("花费"),
      value: `$${data.costUsd.toFixed(4)}`,
      title: t("CLI 上报的实际花费，第三方接口一般没有"),
    });
  }
  const order = STATS_FIELDS.map((field) => field.id as string);
  const items = all
    .filter((item) => fields.has(item.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const showOfficial = Boolean(data.official) && fields.has("official");
  if (!items.length && !showOfficial) return null;

  return (
    /*
     * 外层是一条通栏、带底色的条：以前只有中间 max-w-3xl 那一栏、没有底色，
     * 还用 -mt-1 往上顶，消息滚到底时字会和它叠在一起（0.15.5 修的）。
     */
    <div className="relative z-10 w-full shrink-0 bg-canvas">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-1.5 text-[11px] text-muted md:px-5">
        {items.map((item) => (
          <span key={item.id} className="inline-flex min-w-0 items-center gap-1" title={item.title}>
            <item.icon className="size-3 shrink-0" />
            <span className="shrink-0">{item.label}</span>
            <span
              className={`truncate font-mono tabular-nums ${
                item.tone === "over" ? "text-danger" : item.tone === "warn" ? "text-amber-500" : "text-ink/70"
              }`}
            >
              {item.value}
            </span>
          </span>
        ))}
        {showOfficial && data.official ? (
          <span
            className="inline-flex items-center gap-1"
            title={
              data.official.fiveHourPct != null || data.official.weekPct != null
                ? `${t("{name} 官方额度已用", { name: data.official.name })}${data.official.weekReset ? t("，周窗口至 {date}", { date: data.official.weekReset.slice(0, 10) }) : ""}${data.official.resetCredits != null ? t("，重置 {n} 次", { n: data.official.resetCredits }) : ""}`
                : data.official.resetCredits != null
                  ? t("{name} 重置 {n} 次", { name: data.official.name, n: data.official.resetCredits })
                  : t("{name} 通过 AllAi 记下的已用 token", { name: data.official.name })
            }
          >
            <span className="text-muted/70">|</span>
            <span>{data.official.name}</span>
            <span className="font-mono tabular-nums text-ink/70">{officialValue(data.official, t)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
