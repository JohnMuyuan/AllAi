"use client";

import { useMemo, useState } from "react";
import { formatCount, formatCountCN } from "@/lib/format-count";
import type { UsageEvent } from "@/lib/usage";
import { useLang, useT } from "./I18n";

/**
 * 每日用量热力图，颜色深浅是当天的 Token 量。
 *
 * 布局：热力图占满整张卡片的宽度，统计是下面一排小卡片。以前格子是写死的像素宽、
 * 外面 inline-block，一个季度才 14 列，右边空出一大片（0.15.5 重做）。统计也不放右侧栏：
 * 侧栏比年/季的热力图高，左下又会空一块。现在列宽用 1fr 撑满容器：
 * - 年 / 季：GitHub 那种一列一周、一格一天，只定行高，宽度跟着容器走；
 * - 月：只有 5 周，横着排撑不满也太稀，改成日历（一行一周），格子里直接写日期和用量。
 */

const SPANS = [
  { id: "year", label: "年", days: 371 },
  { id: "quarter", label: "季", days: 91 },
  { id: "month", label: "月", days: 35 },
] as const;

type SpanId = (typeof SPANS)[number]["id"];

const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_SIDE = ["周一", "", "周三", "", "周五", "", "周日"];
const ALPHA = [0, 0.25, 0.45, 0.7, 1];

type Day = { key: string; date: Date; tokens: number; future: boolean };

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function shortDate(date: Date, t: (text: string, vars?: Record<string, string | number>) => string) {
  return t("{m}月{d}日", { m: date.getMonth() + 1, d: date.getDate() });
}

/** 周一当作一周的第一天（getDay() 里周日是 0，挪一下）。 */
function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function swatch(level: number) {
  return level === 0
    ? "var(--color-user, rgb(127 127 127 / 0.18))"
    : `color-mix(in srgb, var(--chart-chat) ${ALPHA[level] * 100}%, transparent)`;
}

export function UsageHeatmap({
  events,
  /** 读到数据的时刻。渲染里不能直接调 Date.now()，不然每次渲染结果都不一样。 */
  now,
  /** 精确数字（2,614）还是简略（2.6K），跟着使用统计页的开关走。 */
  exact = false,
}: {
  events: UsageEvent[];
  now: number;
  exact?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const [span, setSpan] = useState<SpanId>("quarter");
  const [hover, setHover] = useState<Day | null>(null);
  const fmt = (n: number) => formatCount(n, exact);
  // K/M/B 和中文的万/亿错开一级，大数看着费劲，旁边补一个中文写法（小数字不显示）。
  const cn = (n: number) => (lang === "en" ? "" : formatCountCN(n));

  const data = useMemo(() => {
    const days = SPANS.find((item) => item.id === span)!.days;
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    // 从「days 天前的那一周的周一」开始，列才对得齐。
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - mondayIndex(start));

    const totals = new Map<string, number>();
    for (const event of events) {
      if (event.at < start.getTime() || event.at > end.getTime()) continue;
      const key = dayKey(new Date(event.at));
      totals.set(key, (totals.get(key) ?? 0) + event.input + event.output);
    }

    const weeks: Day[][] = [];
    const months: { label: string; column: number }[] = [];
    const cursor = new Date(start);
    let lastMonth = -1;
    while (cursor.getTime() <= end.getTime()) {
      const week: Day[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(cursor);
        const key = dayKey(date);
        week.push({ key, date, tokens: totals.get(key) ?? 0, future: date.getTime() > end.getTime() });
        cursor.setDate(cursor.getDate() + 1);
      }
      // 月份标签打在这一周第一次进入新月份的位置。
      const first = week.find((cell) => !cell.future) ?? week[0];
      if (first.date.getMonth() !== lastMonth) {
        lastMonth = first.date.getMonth();
        months.push({ label: `${first.date.getMonth() + 1}月`, column: weeks.length });
      }
      weeks.push(week);
    }

    const past = weeks.flat().filter((day) => !day.future);
    let peak: Day | null = null;
    let sum = 0;
    let active = 0;
    let longest = 0;
    let run = 0;
    for (const day of past) {
      sum += day.tokens;
      if (day.tokens > 0) {
        active += 1;
        run += 1;
        longest = Math.max(longest, run);
        if (!peak || day.tokens > peak.tokens) peak = day;
      } else {
        run = 0;
      }
    }
    // 当前连续：今天还没用的话从昨天往回数，别让「今天刚开始」把连续清零。
    let current = 0;
    let index = past.length - 1;
    if (index >= 0 && past[index].tokens === 0) index -= 1;
    while (index >= 0 && past[index].tokens > 0) {
      current += 1;
      index -= 1;
    }

    return {
      weeks,
      months,
      max: peak?.tokens ?? 0,
      peak,
      sum,
      active,
      total: past.length,
      current,
      longest,
    };
  }, [events, now, span]);

  /** 0 当天没用量，1–4 是四档深浅。用相对最大值分档，绝对值差太大时也好看。 */
  function level(tokens: number) {
    if (!tokens || !data.max) return 0;
    const ratio = tokens / data.max;
    if (ratio > 0.6) return 4;
    if (ratio > 0.3) return 3;
    if (ratio > 0.1) return 2;
    return 1;
  }

  const dayButton = (day: Day, className: string, children?: React.ReactNode) =>
    day.future ? (
      <div key={day.key} />
    ) : (
      <button
        key={day.key}
        type="button"
        aria-label={`${day.key} ${fmt(day.tokens)} tokens`}
        onMouseEnter={() => setHover(day)}
        onFocus={() => setHover(day)}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        className={`${className} outline-none ring-offset-1 ring-offset-canvas hover:ring-1 hover:ring-accent focus-visible:ring-1 focus-visible:ring-accent`}
        style={{ background: swatch(level(day.tokens)) }}
      >
        {children}
      </button>
    );

  const cols = data.weeks.length;
  const rowHeight = span === "year" ? 11 : 20;

  return (
    <div className="mb-4 rounded-2xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("每日用量热力图")}</span>
        <div className="flex rounded-full bg-user/60 p-0.5">
          {SPANS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSpan(item.id)}
              className={`rounded-full px-3 py-0.5 text-[11px] ${
                span === item.id ? "bg-elevated font-medium" : "text-muted hover:text-ink"
              }`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          {span === "month" ? (
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_SHORT.map((label) => (
                <span key={label} className="pb-0.5 text-center text-[10px] text-muted">
                  {t(label)}
                </span>
              ))}
              {data.weeks.flat().map((day) =>
                dayButton(
                  day,
                  "flex h-11 flex-col justify-between rounded-lg px-1.5 py-1 text-left",
                  <>
                    <span
                      className={`text-[10px] tabular-nums ${
                        level(day.tokens) >= 3 ? "text-white" : "text-muted"
                      }`}
                    >
                      {day.date.getDate() === 1 ? `${day.date.getMonth() + 1}/1` : day.date.getDate()}
                    </span>
                    {day.tokens > 0 ? (
                      <span
                        className={`truncate text-[10px] font-medium tabular-nums ${
                          level(day.tokens) >= 3 ? "text-white" : "text-ink"
                        }`}
                      >
                        {fmt(day.tokens)}
                        {cn(day.tokens) ? <span className="ml-1 text-muted">≈ {cn(day.tokens)}</span> : null}
                      </span>
                    ) : null}
                  </>,
                ),
              )}
            </div>
          ) : (
            <div
              className="grid"
              style={{
                gridTemplateColumns: `1.75rem repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `0.875rem repeat(7, ${rowHeight}px)`,
                gap: span === "year" ? 2 : 3,
              }}
            >
              {/* 月份标签：和格子同一套列，放在对应那一列上，宽度溢出不影响布局 */}
              {data.months.map((item) => (
                <span
                  key={`${item.label}-${item.column}`}
                  className="whitespace-nowrap text-[10px] leading-none text-muted"
                  style={{ gridColumn: item.column + 2, gridRow: 1 }}
                >
                  {t(item.label)}
                </span>
              ))}
              {WEEKDAY_SIDE.map((label, row) => (
                <span
                  key={row}
                  className="flex items-center text-[10px] leading-none text-muted"
                  style={{ gridColumn: 1, gridRow: row + 2 }}
                >
                  {label ? t(label) : ""}
                </span>
              ))}
              {data.weeks.map((week, column) =>
                week.map((day, row) => (
                  <div key={day.key} style={{ gridColumn: column + 2, gridRow: row + 2 }} className="flex">
                    {dayButton(day, "h-full w-full rounded-[3px]")}
                  </div>
                )),
              )}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
            {t("少")}
            {ALPHA.map((_, index) => (
              <span key={index} className="size-2.5 rounded-[3px]" style={{ background: swatch(index) }} />
            ))}
            {t("多")}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 rounded-xl bg-user/50 px-3 py-2 sm:col-span-1">
            <dt className="text-[11px] text-muted">{hover ? shortDate(hover.date, t) : t("这段时间共计")}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
              {fmt(hover ? hover.tokens : data.sum)}
              <span className="ml-1 text-[11px] font-normal text-muted">
                tokens
                {cn(hover ? hover.tokens : data.sum) ? ` · ${t("约 {n}", { n: cn(hover ? hover.tokens : data.sum) })}` : ""}
              </span>
            </dd>
          </div>
          <Stat label={t("活跃天数")} value={t("{active} / {total} 天", { active: data.active, total: data.total })} />
          <Stat
            label={t("活跃日均")}
            value={data.active ? fmt(Math.round(data.sum / data.active)) : "—"}
            note={data.active ? cn(Math.round(data.sum / data.active)) || undefined : undefined}
          />
          <Stat
            label={t("单日最高")}
            value={data.peak ? fmt(data.peak.tokens) : "—"}
            note={
              data.peak
                ? [shortDate(data.peak.date, t), cn(data.peak.tokens)].filter(Boolean).join(" · ")
                : undefined
            }
          />
          <Stat label={t("连续使用")} value={t("{n} 天", { n: data.current })} note={t("最长 {n} 天", { n: data.longest })} />
        </dl>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 break-all text-[15px] font-medium tabular-nums">
        {value}
        {note ? <span className="ml-1.5 text-[10px] font-normal text-muted">{note}</span> : null}
      </dd>
    </div>
  );
}
