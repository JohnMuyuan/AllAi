"use client";

import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { useLang, useT } from "./I18n";
import { UsageHeatmap } from "./UsageHeatmap";
import { getDesktop } from "@/lib/desktop";
import { formatCount, formatCountCN } from "@/lib/format-count";
import { OFFICIAL_CHATS } from "@/lib/official-chat";
import { addTotals, emptyTotals, windowUsage, type UsageArea, type UsageEvent } from "@/lib/usage";
import type { CcSwitchPreview, OfficialQuotaMap } from "@/types/desktop";
import type { RollupSummary } from "@/lib/usage-rollups";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { ModelIcon } from "./ModelIcon";

type Props = {
  onToast?: (text: string) => void;
  /** 用来给「按模型」那张表补上接口地址和模型图标。 */
  providers?: PublicProvider[];
  prefs?: AppPrefs;
};

const AREA_LABEL: Record<UsageArea, string> = { chat: "聊天", agent: "Agent", studio: "创作" };
const AREA_COLOR: Record<UsageArea, string> = {
  chat: "var(--chart-chat)",
  agent: "var(--chart-agent)",
  studio: "var(--chart-studio)",
};
const RANGES = [
  { id: "7", label: "7 天" },
  { id: "30", label: "30 天" },
  { id: "90", label: "90 天" },
  { id: "all", label: "全部" },
] as const;

/** 折线图的纵轴刻度一直用简略写法，精确数字放在轴上太挤。 */
function fmt(n: number) {
  return formatCount(n);
}

function dayKey(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 手写的折线图：项目里没有图表库，也不该为这一个页面加一个。 */
function LineChart({
  series,
  labels,
}: {
  series: { name: string; color: string; points: number[] }[];
  labels: string[];
}) {
  const t = useT();
  const w = 720;
  const h = 200;
  const pad = { top: 12, right: 12, bottom: 22, left: 46 };
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const x = (i: number) => pad.left + (labels.length > 1 ? i * stepX : innerW / 2);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-52 w-full min-w-[520px]" role="img" aria-label={t("用量趋势")}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              className="text-line"
              strokeWidth="1"
            />
            <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-current text-[9px] text-muted">
              {fmt(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, i) =>
          i % labelEvery === 0 ? (
            <text
              key={label}
              x={x(i)}
              y={h - 6}
              textAnchor="middle"
              className="fill-current text-[9px] text-muted"
            >
              {label.slice(5)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          if (!s.points.some((p) => p > 0)) return null;
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p)}`).join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              {labels.length <= 40
                ? s.points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r="2" fill={s.color} />)
                : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function UsageStats({ onToast, providers = [], prefs }: Props) {
  const t = useT();
  const lang = useLang();
  const confirm = useConfirm();
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<RollupSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ccSwitch, setCcSwitch] = useState<CcSwitchPreview | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30");
  const [areas, setAreas] = useState<UsageArea[]>(["chat", "agent", "studio"]);
  const [loading, setLoading] = useState(true);
  /** 读到数据的时刻，时间范围以它为准（渲染里不能直接调 Date.now）。 */
  const [loadedAt, setLoadedAt] = useState(0);
  const [officialQuota, setOfficialQuota] = useState<OfficialQuotaMap>({});
  /** 简略（2.6K）还是精确（2,614）。各人习惯不同，记在本机就够了。 */
  const [exact, setExactState] = useState(() => {
    try {
      return localStorage.getItem("allai-count-exact") === "1";
    } catch {
      return false;
    }
  });
  const setExact = (value: boolean) => {
    setExactState(value);
    try {
      localStorage.setItem("allai-count-exact", value ? "1" : "0");
    } catch {
      // 写不进去只是下次打开回到默认，不影响
    }
  };
  const count = (n: number) => formatCount(n, exact);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/usage");
      const data = (await response.json()) as { events: UsageEvent[]; summary?: RollupSummary };
      setEvents(data.events ?? []);
      setSummary(data.summary ?? null);
      setLoadedAt(Date.now());
    } catch {
      onToast?.(t("读不到用量数据"));
    } finally {
      setLoading(false);
    }
  }, [onToast, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时读一次，写状态都在 await 之后
    void load();
  }, [load]);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.officialQuota) return;
    void desktop.officialQuota().then(setOfficialQuota).catch(() => undefined);
  }, []);

  useEffect(() => {
    // 只是看看本机有没有装 CC Switch、有多少可导，不写任何东西。
    void getDesktop()?.ccSwitchUsage?.(false).then(setCcSwitch).catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    const days = range === "all" ? 0 : Number(range);
    const since = days && loadedAt ? loadedAt - days * 86400000 : 0;
    return events.filter((item) => areas.includes(item.area) && item.at >= since);
  }, [areas, events, loadedAt, range]);

  // 热力图自己挑跨度，所以只按专区筛，不按上面的时间范围筛。
  const heatmapEvents = useMemo(
    () => events.filter((item) => areas.includes(item.area)),
    [areas, events],
  );

  const totals = useMemo(() => filtered.reduce((acc, e) => addTotals(acc, e), emptyTotals()), [filtered]);

  const byArea = useMemo(() => {
    const map = new Map<UsageArea, ReturnType<typeof emptyTotals>>();
    for (const event of filtered) {
      const current = map.get(event.area) ?? emptyTotals();
      map.set(event.area, addTotals(current, event));
    }
    return map;
  }, [filtered]);

  /** 用量里的 source 存的是接口名（见 app/api/chat/route.ts），按名字换回接口，好取地址。 */
  const providerByName = useMemo(() => {
    const map = new Map<string, PublicProvider>();
    for (const provider of providers) map.set(provider.name, provider);
    return map;
  }, [providers]);

  const byModel = useMemo(() => {
    type Row = {
      model: string;
      source: string;
      baseUrl: string;
      providerId: string;
      totals: ReturnType<typeof emptyTotals>;
    };
    const map = new Map<string, Row>();
    for (const event of filtered) {
      const key = `${event.source}::${event.modelId}`;
      const hit = providerByName.get(event.source || "");
      const row = map.get(key) ?? {
        model: event.modelId || t("未记录型号"),
        source: event.source || "—",
        baseUrl: hit?.baseUrl ?? "",
        providerId: hit?.id ?? "",
        totals: emptyTotals(),
      };
      addTotals(row.totals, event);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.totals.tokens - a.totals.tokens);
  }, [filtered, providerByName, t]);

  const chart = useMemo(() => {
    const days = new Map<string, Record<UsageArea, number>>();
    for (const event of filtered) {
      const key = dayKey(event.at);
      const row = days.get(key) ?? { chat: 0, agent: 0, studio: 0 };
      row[event.area] += event.input + event.output;
      days.set(key, row);
    }
    const labels = [...days.keys()].sort();
    return {
      labels,
      series: (["chat", "agent", "studio"] as UsageArea[])
        .filter((area) => areas.includes(area))
        .map((area) => ({
          name: AREA_LABEL[area],
          color: AREA_COLOR[area],
          points: labels.map((label) => days.get(label)?.[area] ?? 0),
        })),
    };
  }, [areas, filtered]);

  function exportCsv() {
    // 导出的表头也跟着语言走 —— 用 Excel 打开时列名叫「时间/专区」还是 Time/Area 得一致。
    const header = [
      t("时间"), t("专区"), t("服务"), t("模型"), t("输入"), t("输出"),
      t("缓存读"), t("缓存写"), t("思考"), t("请求"), t("产出"), t("花费USD"),
    ].join(",");
    const rows = filtered.map((e) =>
      [
        new Date(e.at).toISOString(),
        t(AREA_LABEL[e.area]),
        `"${e.source.replace(/"/g, '""')}"`,
        `"${e.modelId.replace(/"/g, '""')}"`,
        e.input,
        e.output,
        e.cacheRead,
        e.cacheWrite,
        e.reasoning,
        e.requests,
        e.images,
        e.costUsd.toFixed(6),
      ].join(","),
    );
    const blob = new Blob([`﻿${header}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allai-usage-${dayKey(loadedAt || Date.now())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearAll() {
    const ok = await confirm({
      title: t("清空全部 {n} 条用量记录？", { n: events.length }),
      detail: "统计数据会归零，无法恢复。",
      confirmText: "清空",
      danger: true,
    });
    if (!ok) return;
    await fetch("/api/usage", { method: "DELETE" });
    setLoading(true);
    await load();
    onToast?.(t("已清空用量记录"));
  }

  const official = OFFICIAL_CHATS.map((spec) => ({
    spec,
    quota: officialQuota[spec.kind],
    ...windowUsage(events, spec.name, loadedAt || 0),
  })).filter(
    (row) =>
      row.week > 0 ||
      row.fiveHour > 0 ||
      row.quota?.fiveHourPct != null ||
      row.quota?.weekPct != null ||
      row.quota?.credits != null ||
      row.quota?.resetCredits != null,
  );

  /*
   * K/M/B 是三位一级（千 / 百万 / 十亿），中文是四位一级（万 / 亿）—— 两套错开，
   * 「3.14B 到底几亿」得心算。所以数字旁边再给一个中文写法，一眼就能看懂。
   */
  const cn = (n: number) => (lang === "en" ? "" : formatCountCN(n));
  const cards: { label: string; value: string; cn?: string; hint?: string }[] = [
    { label: t("总 Token"), value: count(totals.tokens), cn: cn(totals.tokens), hint: t("输入 + 输出") },
    { label: t("输入"), value: count(totals.input), cn: cn(totals.input) },
    { label: t("输出"), value: count(totals.output), cn: cn(totals.output) },
    {
      label: t("命中缓存"),
      value: count(totals.cacheRead),
      cn: cn(totals.cacheRead),
      hint: totals.input ? t("占输入 {n}%", { n: Math.round((totals.cacheRead / totals.input) * 100) }) : undefined,
    },
    { label: t("写入缓存"), value: count(totals.cacheWrite), cn: cn(totals.cacheWrite) },
    { label: t("思考"), value: count(totals.reasoning), cn: cn(totals.reasoning) },
    { label: t("请求数"), value: count(totals.requests), cn: cn(totals.requests) },
    {
      label: t("花费"),
      value: totals.costUsd ? `$${totals.costUsd.toFixed(2)}` : "—",
      hint: totals.costUsd ? t("仅 CLI 上报") : t("接口没有上报"),
    },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line p-0.5">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRange(item.id)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                range === item.id ? "bg-user font-medium" : "text-muted hover:bg-user/60"
              }`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["chat", "agent", "studio"] as UsageArea[]).map((area) => {
            const on = areas.includes(area);
            return (
              <button
                key={area}
                type="button"
                onClick={() =>
                  setAreas((current) =>
                    current.includes(area)
                      ? current.filter((item) => item !== area)
                      : [...current, area],
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  on ? "border-line bg-user" : "border-line text-muted opacity-50"
                }`}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: AREA_COLOR[area] }}
                  aria-hidden="true"
                />
                {t(AREA_LABEL[area])}
              </button>
            );
          })}
        </div>
        <div className="flex rounded-xl border border-line p-0.5" role="group" aria-label={t("数字写法")}>
          {(
            [
              [false, "简略", "显示简略数字，例如 2.6K"],
              [true, "精确", "显示完整数字，例如 2,614"],
            ] as const
          ).map(([value, label, title]) => (
            <button
              key={label}
              type="button"
              title={t(title)}
              aria-pressed={exact === value}
              onClick={() => setExact(value)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                exact === value ? "bg-user font-medium" : "text-muted hover:bg-user/60"
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            aria-label={t("刷新")}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
            aria-label={t("导出 CSV")}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink disabled:opacity-40"
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void clearAll()}
            disabled={!events.length}
            aria-label={t("清空")}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {events.length === 0 && !loading ? (
        <div className="rounded-2xl border border-line px-4 py-12 text-center">
          <p className="text-sm font-medium">{t("还没有用量记录")}</p>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            {t("聊天、Agent、创作跑起来之后这里会自动累积。")}
            <br />
            {t("数据只存在本机")} <code className="font-mono">~/.allai/usage.json</code>{t("，不会自动清除。")}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-line px-3 py-2.5">
                <div className="text-[11px] text-muted">{card.label}</div>
                <div
                  className={`mt-0.5 break-all font-semibold tabular-nums ${card.value.length > 11 ? "text-sm" : "text-lg"}`}
                >
                  {card.value}
                  {card.cn ? (
                    <span className="ml-1.5 text-[11px] font-normal text-muted">≈ {card.cn}</span>
                  ) : null}
                </div>
                {card.hint ? <div className="text-[10px] text-muted">{card.hint}</div> : null}
              </div>
            ))}
          </div>

          {official.length ? (
            <div className="mb-4 rounded-2xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{t("官方登录账号已用")}</span>
                <span className="text-[11px] text-muted">
                  {t("百分比和重置次数来自官方接口；token 是 AllAi 记下的消耗")}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {official.map((row) => (
                  <div key={row.spec.kind} className="rounded-xl border border-line px-3 py-2">
                    <div className="truncate text-sm font-medium">{row.spec.name}</div>
                    <dl className="mt-1 space-y-0.5 text-[11px] text-muted">
                      {row.quota?.fiveHourPct != null ? (
                        <div className="flex justify-between">
                          <dt>{t("5 小时已用")}</dt>
                          <dd className="tabular-nums text-ink/80">
                            {Math.round(row.quota.fiveHourPct)}%
                          </dd>
                        </div>
                      ) : row.quota?.weekPct != null || row.quota?.resetCredits != null ? null : (
                        <div className="flex justify-between">
                          <dt>{t("近 5 小时")}</dt>
                          <dd className="tabular-nums text-ink/80">{count(row.fiveHour)}</dd>
                        </div>
                      )}
                      {row.quota?.weekPct != null ? (
                        <div className="flex justify-between">
                          <dt>{t("7 天已用")}</dt>
                          <dd className="tabular-nums text-ink/80">
                            {Math.round(row.quota.weekPct)}%
                          </dd>
                        </div>
                      ) : row.quota?.credits != null ? (
                        <div className="flex justify-between">
                          <dt>{t("本周额度")}</dt>
                          <dd className="tabular-nums text-ink/80">
                            {Math.round(row.quota.credits)}
                          </dd>
                        </div>
                      ) : (
                        <div className="flex justify-between">
                          <dt>{t("近 7 天")}</dt>
                          <dd className="tabular-nums text-ink/80">{count(row.week)}</dd>
                        </div>
                      )}
                      {row.quota?.resetCredits != null ? (
                        <div className="flex justify-between">
                          <dt>{t("重置次数")}</dt>
                          <dd className="tabular-nums text-ink/80">{row.quota.resetCredits}</dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between">
                        <dt>{t("请求 / 花费")}</dt>
                        <dd className="tabular-nums">
                          {row.requests}
                          {row.costUsd ? ` · $${row.costUsd.toFixed(3)}` : ""}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 热力图有自己的时间跨度（年/季/月），所以不吃上面那个范围筛选，
              只吃专区筛选 —— 不然「7 天」选中时热力图只剩一列。 */}
          <UsageHeatmap
            events={heatmapEvents}
            now={loadedAt}
            exact={exact}
          />

          <div className="mb-4 rounded-2xl border border-line p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{t("每日 Token")}</span>
              <span className="text-[11px] text-muted">{t("{n} 天有记录", { n: chart.labels.length })}</span>
            </div>
            {chart.labels.length ? (
              <LineChart series={chart.series} labels={chart.labels} />
            ) : (
              <p className="py-10 text-center text-sm text-muted">{t("这个范围内没有数据")}</p>
            )}
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            {(["chat", "agent", "studio"] as UsageArea[]).map((area) => {
              const row = byArea.get(area) ?? emptyTotals();
              return (
                <div key={area} className="rounded-2xl border border-line p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: AREA_COLOR[area] }}
                      aria-hidden="true"
                    />
                    {t(AREA_LABEL[area])}
                  </div>
                  <div className="break-all text-lg font-semibold tabular-nums">
                    {count(row.tokens)}
                    {cn(row.tokens) ? (
                      <span className="ml-1.5 text-[11px] font-normal text-muted">≈ {cn(row.tokens)}</span>
                    ) : null}
                  </div>
                  <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted">
                    <div className="flex justify-between">
                      <dt>{t("输入 / 输出")}</dt>
                      <dd className="tabular-nums">
                        {count(row.input)} / {count(row.output)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{t("命中缓存")}</dt>
                      <dd className="tabular-nums">{count(row.cacheRead)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{area === "studio" ? t("产出") : t("请求")}</dt>
                      <dd className="tabular-nums">{area === "studio" ? row.images : row.requests}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-line">
            <div className="border-b border-line px-3 py-2 text-sm font-medium">{t("按模型")}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="px-3 py-2 text-left font-medium">{t("模型")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("输入")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("输出")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("缓存")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("思考")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("请求")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("合计")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted">
                        {t("这个范围内没有数据")}
                      </td>
                    </tr>
                  ) : (
                    byModel.map((row) => (
                      <tr key={`${row.source}::${row.model}`} className="border-t border-line">
                        <td className="px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* 和设置里的「模型图标」同一套（约定 93）：先按型号认，
                                认不出再按接口地址认 —— 聚合平台上导出的 id 带厂商前缀。 */}
                            <ModelIcon
                              modelId={row.model}
                              baseUrl={row.baseUrl}
                              icons={prefs?.brandIcons ?? {}}
                              className="size-4"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{row.model}</div>
                              <div className="truncate text-[11px] text-muted">
                                {t(row.source)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{count(row.totals.input)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{count(row.totals.output)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">
                          {count(row.totals.cacheRead)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">
                          {count(row.totals.reasoning)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">
                          {row.totals.requests}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {count(row.totals.tokens)}
                          {cn(row.totals.tokens) ? (
                            <div className="text-[10px] font-normal text-muted">≈ {cn(row.totals.tokens)}</div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t("本机 CLI 用量")}</span>
              <span className="text-[11px] text-muted">
                {summary?.scanned.days
                  ? t("已统计 {days} 天 · {n} 次请求 · {from} 起", {
                      days: summary.scanned.days,
                      n: count(summary.scanned.requests),
                      from: summary.scanned.from,
                    })
                  : t("还没扫到本机的 CLI 会话")}
              </span>
              <button
                type="button"
                disabled={scanning}
                onClick={async () => {
                  setScanning(true);
                  try {
                    const result = await getDesktop()?.scanUsage?.();
                    await load();
                    onToast?.(result ? t("扫完了：{n} 个会话文件", { n: result.files }) : t("这个功能要桌面版"));
                  } catch {
                    onToast?.(t("扫描失败"));
                  } finally {
                    setScanning(false);
                  }
                }}
                className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-user disabled:opacity-50"
              >
                {scanning ? t("扫描中…") : t("立即扫描")}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              {t("不管那一轮是 AllAi 发的、你在终端里自己跑的、还是别的壳子跑的，只要 Claude Code / Codex / Grok Build 在这台电脑上留下了会话文件，用量就算进来。每 5 分钟增量补扫一次。")}
            </p>

            {ccSwitch?.found ? (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("从 CC Switch 导入历史")}</span>
                  <span className="text-[11px] text-muted">
                    {ccSwitch.days
                      ? t("{from} → {to} · {n} 次请求 · ${cost}", {
                          from: ccSwitch.from,
                          to: ccSwitch.to,
                          n: count(ccSwitch.requests),
                          cost: ccSwitch.costUsd.toFixed(2),
                        })
                      : t("它那边没有可导的记录")}
                  </span>
                  {ccSwitch.days ? (
                    <button
                      type="button"
                      disabled={importing}
                      onClick={async () => {
                        setImporting(true);
                        try {
                          const result = await getDesktop()?.ccSwitchUsage?.(true);
                          await load();
                          onToast?.(
                            result
                              ? t("已导入 {days} 天、{n} 次请求", { days: result.days, n: result.requests })
                              : t("导入失败"),
                          );
                        } catch {
                          onToast?.(t("导入失败"));
                        } finally {
                          setImporting(false);
                        }
                      }}
                      className="ml-auto rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-50"
                    >
                      {importing ? t("导入中…") : summary?.imports.some((item) => item.name === "cc-switch") ? t("重新导入") : t("导入")}
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  {t("只读它的")} <code className="font-mono">~/.cc-switch/cc-switch.db</code>{t("，不改它任何东西。")}
                  {t("重复导入不会翻倍（整份替换）。同一天同一来源本机已经扫到的，以本机为准，不会重复计。")}
                  {summary?.imports.map((item) => (
                    <span key={item.name} className="block">
                      {t("已导入：{from} → {to}，{days} 天 · {n} 次请求", {
                        from: item.from,
                        to: item.to,
                        days: item.days,
                        n: count(item.requests),
                      })}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
          </div>

          <p className="mt-3 text-[11px] leading-5 text-muted">
            {t("AllAi 自己这边（聊天、创作）的记录存在")} <code className="font-mono">~/.allai/usage.json</code>
            {t("；本机 CLI 的用量和导入的历史按天汇总存在")} <code className="font-mono">~/.allai/usage-rollups.json</code>
            {t("。缓存读的 token 本身算在输入里，所以合计 = 输入 + 输出，没有重复计。")}
            <strong>{t("花费里只有 Grok 和 CC Switch 导入的那部分是真实上报的")}</strong>
            {t("；Claude Code / Codex 的会话文件里没有钱，按型号单价估算（第三方中转站的价和官方也不一样），只能看个量级，别当账单。")}
          </p>
        </>
      )}
    </div>
  );
}
