"use client";

import { Activity, AlertTriangle, CheckCircle2, CircleAlert, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { getDesktop } from "@/lib/desktop";
import { formatCount, formatCountCN } from "@/lib/format-count";
import { OFFICIAL_CHATS } from "@/lib/official-chat";
import {
  HOUR_MS,
  WEEK_MS,
  type AccountKind,
  type AccountReport,
  type HealthLevel,
  type HealthReason,
  type WindowReport,
} from "@/lib/quota-monitor";
import { useLang, useT, type Translate } from "./I18n";

/**
 * 设置 → 额度监控。数据和算法在 app/api/quota-monitor + lib/quota-monitor.ts，这里只管画。
 *
 * 图表规矩（和统计页一样手写 SVG，不引图表库）：
 * - 单系列不放图例框，标题说清楚画的是什么；型号占比是多系列，下面的表格就是图例。
 * - 颜色跟着型号走（按第一次出现的先后排座次），不跟排名走 —— 刷新后排名变了颜色也不跳。
 * - 状态色只表示好坏，永远配图标和文字；分类色见 app/globals.css 的 --series-*。
 * - 悬停提示只是补充：每张图都能在「查看表格」里读到同样的数。
 */

type Sessions = { included: number; excluded: number };
type Payload = { now: number; accounts: AccountReport[]; sessions: Record<AccountKind, Sessions> };

const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];
const OTHER_COLOR = "var(--series-other)";

const STATUS: Record<HealthLevel, { color: string; Icon: typeof Activity }> = {
  good: { color: "var(--status-good)", Icon: CheckCircle2 },
  warning: { color: "var(--status-warning)", Icon: AlertTriangle },
  serious: { color: "var(--status-serious)", Icon: CircleAlert },
  critical: { color: "var(--status-critical)", Icon: XCircle },
  unknown: { color: "var(--muted)", Icon: Activity },
};

const HEALTH_TITLE: Record<HealthReason, string> = {
  "no-data": "数据还不够",
  exhausted: "额度已用完",
  "runs-out-soon": "马上就要用完",
  "runs-out": "会提前用完",
  tight: "有点紧",
  "five-hour-high": "5 小时窗口快满了",
  ok: "额度充裕",
};

const CONFIDENCE = { low: "低", medium: "中", high: "高" } as const;

function accountName(kind: AccountKind) {
  return OFFICIAL_CHATS.find((spec) => spec.kind === kind)?.name ?? kind;
}

function useFormat() {
  const t = useT();
  const lang = useLang();
  return useMemo(() => {
    const locale = lang === "en" ? "en-US" : "zh-CN";
    const whenFmt = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    const clockFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return {
      pct: (n?: number) =>
        n == null || !Number.isFinite(n) ? "—" : `${n >= 10 || Number.isInteger(n) ? Math.round(n) : n.toFixed(1)}%`,
      rate: (n?: number) =>
        n == null || !Number.isFinite(n) ? "—" : n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2),
      money: (n: number) =>
        n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`,
      count: (n: number) => formatCount(Math.round(n)),
      /** 中文写法（万 / 亿）。英文界面不显示。 */
      cn: (n: number) => (lang === "en" ? "" : formatCountCN(Math.round(n))),
      when: (at?: number) => (at == null ? "—" : whenFmt.format(at)),
      clock: (at: number) => clockFmt.format(at),
      day: (at: number) => dayFmt.format(at),
      span: (ms: number) => {
        const minutes = Math.max(0, ms) / 60_000;
        if (minutes < 60) return t("{n} 分钟", { n: Math.max(1, Math.round(minutes)) });
        const hours = minutes / 60;
        if (hours < 48) return t("{n} 小时", { n: hours < 10 ? Number(hours.toFixed(1)) : Math.round(hours) });
        const days = hours / 24;
        return t("{n} 天", { n: days < 10 ? Number(days.toFixed(1)) : Math.round(days) });
      },
    };
  }, [lang, t]);
}

type Format = ReturnType<typeof useFormat>;

export function QuotaMonitor({ onToast }: { onToast?: (text: string) => void }) {
  const t = useT();
  const f = useFormat();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<AccountKind | null>(null);
  const [isDesktop] = useState(() => Boolean(getDesktop()));

  const load = useCallback(
    async (fresh: boolean) => {
      const desktop = getDesktop();
      try {
        if (fresh && desktop) {
          // 先真的问一次接口（主进程顺手记一个采样点）、补扫一次本机会话，再读算好的结果。
          await Promise.all([
            desktop.officialQuota?.().catch(() => undefined),
            desktop.scanUsage?.().catch(() => undefined),
          ]);
        }
        const response = await fetch("/api/quota-monitor");
        if (!response.ok) throw new Error(String(response.status));
        setData((await response.json()) as Payload);
      } catch {
        onToast?.(t("读不到额度监控数据"));
      } finally {
        setLoading(false);
      }
    },
    [onToast, t],
  );

  useEffect(() => {
    if (!isDesktop) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时读一次，写状态都在 await 之后
    void load(true);
    // 采样是主进程每 5 分钟做的，这里每分钟重读一次就够跟上。
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => window.clearInterval(timer);
  }, [isDesktop, load]);

  const accounts = data?.accounts ?? [];
  const report = accounts.find((item) => item.kind === picked) ?? accounts[0];

  if (!isDesktop) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <Empty title={t("额度监控需要桌面版")} detail={t("要读本机的官方登录文件和 CLI 会话记录，网页版拿不到。")} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {accounts.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("官方账号")}>
            {accounts.map((item) => {
              const on = item.kind === report?.kind;
              return (
                <button
                  key={item.kind}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPicked(item.kind)}
                  className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs ${
                    on ? "bg-user font-medium" : "text-muted hover:bg-user/60"
                  }`}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: STATUS[item.health.level].color }}
                    aria-hidden="true"
                  />
                  {t(accountName(item.kind))}
                </button>
              );
            })}
          </div>
        ) : report ? (
          <span className="text-sm font-medium">{t(accountName(report.kind))}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {report?.lastSampleAt && data ? (
            <span className="text-[11px] text-muted">
              {t("{time}前采样 · AllAi 开着时每 5 分钟一次", { time: f.span(data.now - report.lastSampleAt) })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load(true);
            }}
            aria-label={t("刷新")}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {!data && loading ? (
        <p className="py-12 text-center text-sm text-muted">{t("正在读取…")}</p>
      ) : !report || !data ? (
        <Empty
          title={t("还没有额度记录")}
          detail={t(
            "登录 Claude / ChatGPT / Grok 官方账号后，AllAi 开着时每 5 分钟记一次额度。攒上一两个小时，这里就能算出消耗速度和预计用完的时间。",
          )}
        />
      ) : (
        // 刷新时保留上一次的画面、只是变淡，不闪骨架屏
        <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
          <AccountView report={report} now={data.now} sessions={data.sessions[report.kind]} f={f} />
        </div>
      )}
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {sub ? <span className="text-[11px] text-muted">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function AccountView({ report, now, sessions, f }: { report: AccountReport; now: number; sessions: Sessions; f: Format }) {
  const t = useT();
  const status = STATUS[report.health.level];
  const Icon = status.Icon;
  const tiles = buildTiles(report, now, f, t);
  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-line bg-elevated px-4 py-3">
        <Icon className="mt-0.5 size-5 shrink-0" style={{ color: status.color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium">{t(HEALTH_TITLE[report.health.reason])}</span>
            {report.plan ? (
              <span className="rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
                {report.plan}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted">{healthDetail(report, now, f, t)}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Tile key={tile.label} {...tile} />
        ))}
      </div>

      {report.week ? (
        <Section
          title={t("周额度已用走势")}
          sub={report.week.resetAt != null ? t("{time} 重置", { time: f.when(report.week.resetAt) }) : undefined}
        >
          <TrendChart week={report.week} trend={report.trend} now={now} f={f} />
        </Section>
      ) : null}

      <Section title={t("近 24 小时每小时消耗")} sub={t("本机记录的这个账号的 token")}>
        <HourlyChart hourly={report.hourly} f={f} />
      </Section>

      <Section
        title={t("型号占比")}
        sub={report.models.some((item) => item.costUsd > 0) ? t("按 API 价折算的花费计算") : t("按 token 计算")}
      >
        <ModelShare models={report.models} f={f} />
      </Section>

      <Notes kind={report.kind} sessions={sessions} />
    </>
  );
}

function healthDetail(report: AccountReport, now: number, f: Format, t: Translate) {
  const main = report.week ?? report.five;
  switch (report.health.reason) {
    case "no-data":
      return t("官方接口暂时没有返回这个账号的额度。");
    case "exhausted": {
      const out = report.week && report.week.used >= 100 ? report.week : report.five;
      return t("已经用完，{time} 重置。", { time: f.when(out?.resetAt) });
    }
    case "runs-out-soon":
    case "runs-out":
      return t("按现在的速度，大约 {time}（{left}后）用完，比重置早 {early}。", {
        time: f.when(main?.etaAt),
        left: f.span((main?.etaAt ?? now) - now),
        early: f.span((main?.resetAt ?? 0) - (main?.etaAt ?? 0)),
      });
    case "tight":
      return t("按现在的速度，重置时会用到 {p}，接近上限。", { p: f.pct(main?.projectedAtReset) });
    case "five-hour-high":
      return t("5 小时窗口已用 {p}，短时间内再大量使用可能会被限速。", { p: f.pct(report.five?.used) });
    default:
      return main?.projectedAtReset != null
        ? t("按现在的速度，重置时大约用到 {p}。", { p: f.pct(main.projectedAtReset) })
        : t("再采样一段时间就能给出预测。");
  }
}

type TileSpec = { label: string; value: string; cn?: string; sub?: string; meter?: number };

function meterColor(pct: number) {
  return pct >= 90 ? "var(--status-critical)" : pct >= 70 ? "var(--status-warning)" : "var(--series-1)";
}

function buildTiles(report: AccountReport, now: number, f: Format, t: Translate): TileSpec[] {
  const { week, five } = report;
  const tiles: TileSpec[] = [];
  const resetSub = (w: WindowReport) => (w.resetAt != null ? t("{time} 重置", { time: f.when(w.resetAt) }) : undefined);
  const perHour = (n?: number) => (n != null ? t("{n}%/小时", { n: f.rate(n) }) : "—");
  const tokens = (n: number) => f.cn(n) || f.count(n);

  if (week) tiles.push({ label: t("周额度已用"), value: f.pct(week.used), sub: resetSub(week), meter: week.used });
  if (five) tiles.push({ label: t("5 小时已用"), value: f.pct(five.used), sub: resetSub(five), meter: five.used });

  const main = week ?? five;
  if (main) {
    tiles.push({
      label: t("消耗速度"),
      value: perHour(main.ratePerH),
      sub: t("最近 {a} · 平均 {b}", { a: perHour(main.recentPerH), b: perHour(main.averagePerH) }),
    });

    const exhausted = main.used >= 100;
    const runsOut = main.runsOutBeforeReset && main.etaAt != null;
    tiles.push({
      label: t("预计用完"),
      value: exhausted
        ? t("已用完")
        : runsOut
          ? f.when(main.etaAt)
          : main.resetAt != null && main.ratePerH != null
            ? t("重置前用不完")
            : "—",
      sub: exhausted
        ? resetSub(main)
        : runsOut
          ? t("约 {d}后", { d: f.span((main.etaAt ?? now) - now) })
          : main.projectedAtReset != null
            ? t("重置时约 {p}", { p: f.pct(Math.min(main.projectedAtReset, 999)) })
            : t("采样跨度还不够"),
    });

    const cap = main.capacity;
    const capLabel = main === week ? t("周额度折合") : t("5 小时额度折合");
    if (cap) {
      const confidence = t(CONFIDENCE[cap.confidence]);
      tiles.push(
        cap.costUsd > 0
          ? {
              label: capLabel,
              value: f.money(cap.costUsd),
              sub: t("≈ {n} token · 可信度{c}", { n: tokens(cap.tokens), c: confidence }),
            }
          : { label: capLabel, value: `${f.count(cap.tokens)} token`, cn: f.cn(cap.tokens), sub: t("可信度{c}", { c: confidence }) },
      );
      tiles.push({
        label: t("每 1% 约"),
        value: `${f.count(cap.tokens / 100)} token`,
        cn: f.cn(cap.tokens / 100),
        sub: cap.costUsd > 0 ? t("约 {m}", { m: f.money(cap.costUsd / 100) }) : undefined,
      });
    } else {
      tiles.push({ label: capLabel, value: "—", sub: t("已用 2% 以上、且本机有这个账号的用量后才能估") });
    }

    tiles.push({
      label: main === week ? t("本周已消耗") : t("这 5 小时已消耗"),
      value: `${f.count(main.usedTokens)} token`,
      cn: f.cn(main.usedTokens),
      sub: main.usedCostUsd > 0 ? t("按 API 价约 {m}", { m: f.money(main.usedCostUsd) }) : undefined,
    });
  }
  if (report.resetCredits != null) tiles.push({ label: t("可用重置次数"), value: String(report.resetCredits) });
  return tiles;
}

function Tile({ label, value, cn, sub, meter }: TileSpec) {
  return (
    <div className="rounded-2xl border border-line px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 break-words font-semibold ${value.length > 12 ? "text-sm" : "text-lg"}`}>
        {value}
        {cn ? <span className="ml-1.5 text-[11px] font-normal text-muted">≈ {cn}</span> : null}
      </div>
      {meter != null ? (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${meterColor(meter)} 18%, transparent)` }}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meter)}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, meter))}%`, background: meterColor(meter) }}
          />
        </div>
      ) : null}
      {sub ? <div className="mt-1 text-[10px] leading-4 text-muted">{sub}</div> : null}
    </div>
  );
}

/** 悬停提示。x 是 0..1 的相对位置，过了中线就往左翻，别出框。 */
function Tip({ x, children }: { x: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-28 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-sm"
      style={x > 0.6 ? { right: `calc(${(1 - x) * 100}% + 8px)` } : { left: `calc(${x * 100}% + 8px)` }}
    >
      {children}
    </div>
  );
}

/** 左右方向键在点之间移动，和鼠标悬停显示同样的提示。 */
function stepKeys(count: number, set: (update: (current: number | null) => number | null) => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    set((current) => {
      const from = current ?? count - 1;
      return Math.min(count - 1, Math.max(0, from + (event.key === "ArrowRight" ? 1 : -1)));
    });
  };
}

function TrendChart({
  week,
  trend,
  now,
  f,
}: {
  week: WindowReport;
  trend: AccountReport["trend"];
  now: number;
  f: Format;
}) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  if (trend.length < 2) {
    return <p className="py-8 text-center text-xs text-muted">{t("至少要两次采样才能画出曲线。AllAi 开着时每 5 分钟采一次。")}</p>;
  }

  const W = 720;
  const H = 190;
  const pad = { top: 10, right: 44, bottom: 22, left: 38 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const x0 = week.startAt ?? trend[0].at;
  const x1 = Math.max(x0 + HOUR_MS, week.resetAt ?? now);
  const x = (at: number) => pad.left + ((Math.min(x1, Math.max(x0, at)) - x0) / (x1 - x0)) * innerW;
  const y = (pct: number) => pad.top + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;

  const line = trend.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(" ");
  const last = trend[trend.length - 1];
  const area = `${line} L${x(last.at).toFixed(1)} ${y(0)} L${x(trend[0].at).toFixed(1)} ${y(0)} Z`;

  // 虚线 = 按当前速度往后推，到 100% 或者到重置为止
  let projection: { x: number; y: number } | null = null;
  if (week.ratePerH && week.ratePerH > 0 && week.resetAt != null && last.pct < 100) {
    const hitAt = last.at + ((100 - last.pct) / week.ratePerH) * HOUR_MS;
    const endAt = Math.min(week.resetAt, hitAt);
    projection = { x: x(endAt), y: y(last.pct + week.ratePerH * ((endAt - last.at) / HOUR_MS)) };
  }

  const byDay = x1 - x0 > 2 * 24 * HOUR_MS;
  const step = byDay ? 24 * HOUR_MS : 6 * HOUR_MS;
  const ticks: number[] = [];
  for (let at = x0; at <= x1 + 1 && ticks.length < 10; at += step) ticks.push(at);

  const active = hover != null ? trend[hover] : null;
  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let dist = Infinity;
    trend.forEach((point, i) => {
      const d = Math.abs(x(point.at) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };

  return (
    <>
      <div className="overflow-x-auto">
        <div className="relative min-w-[520px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full touch-none select-none"
            role="img"
            aria-label={t("周额度已用走势")}
            tabIndex={0}
            onPointerMove={(event) => setHover(pick(event.clientX, event.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={stepKeys(trend.length, setHover)}
          >
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
                <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                  {tick}%
                </text>
              </g>
            ))}
            {ticks.map((at) => (
              <text key={at} x={x(at)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {byDay ? f.day(at) : f.clock(at)}
              </text>
            ))}
            {now > x0 && now < x1 ? (
              <line x1={x(now)} x2={x(now)} y1={pad.top} y2={pad.top + innerH} stroke="var(--line)" strokeWidth={1} />
            ) : null}
            <path d={area} fill="var(--series-1)" fillOpacity={0.1} />
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {projection ? (
              <line
                x1={x(last.at)}
                y1={y(last.pct)}
                x2={projection.x}
                y2={projection.y}
                stroke="var(--series-1)"
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            ) : null}
            {active ? (
              <line x1={x(active.at)} x2={x(active.at)} y1={pad.top} y2={pad.top + innerH} stroke="var(--muted)" strokeWidth={1} />
            ) : null}
            <circle cx={x(last.at)} cy={y(last.pct)} r={4} fill="var(--series-1)" stroke="var(--canvas)" strokeWidth={2} />
            <text x={x(last.at) + 8} y={y(last.pct) + 4} fontSize={11} fontWeight={600} fill="var(--ink)">
              {f.pct(last.pct)}
            </text>
            {active ? (
              <circle cx={x(active.at)} cy={y(active.pct)} r={4} fill="var(--series-1)" stroke="var(--canvas)" strokeWidth={2} />
            ) : null}
          </svg>
          {active ? (
            <Tip x={x(active.at) / W}>
              <div className="text-sm font-semibold text-ink">{f.pct(active.pct)}</div>
              <div className="text-muted">{f.when(active.at)}</div>
            </Tip>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true">
            <line x1="0" x2="16" y1="2" y2="2" stroke="var(--series-1)" strokeWidth="2" />
          </svg>
          {t("已用")}
        </span>
        {projection ? (
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" x2="16" y1="2" y2="2" stroke="var(--series-1)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
            {t("按当前速度推算")}
          </span>
        ) : null}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted">{t("查看表格")}</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">{t("时间")}</th>
                <th className="py-1 text-right font-normal">{t("已用")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...trend].reverse().slice(0, 48).map((point) => (
                <tr key={point.at} className="border-t border-line">
                  <td className="py-1">{f.when(point.at)}</td>
                  <td className="py-1 text-right">{f.pct(point.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function niceCeil(n: number) {
  if (n <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(n));
  const r = n / e;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * e;
}

/** 顶端 4px 圆角、底边方角的柱子。 */
function columnPath(left: number, top: number, width: number, base: number) {
  const height = base - top;
  if (height <= 0) return "";
  const r = Math.min(4, height, width / 2);
  return `M${left} ${base} V${top + r} Q${left} ${top} ${left + r} ${top} H${left + width - r} Q${left + width} ${top} ${left + width} ${top + r} V${base} Z`;
}

function HourlyChart({ hourly, f }: { hourly: AccountReport["hourly"]; f: Format }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const total = hourly.reduce((sum, item) => sum + item.tokens, 0);
  if (!total) {
    return <p className="py-8 text-center text-xs text-muted">{t("近 24 小时本机没有这个账号的用量记录。")}</p>;
  }

  const W = 720;
  const H = 170;
  const pad = { top: 18, right: 8, bottom: 22, left: 46 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceCeil(Math.max(...hourly.map((item) => item.tokens)));
  const band = innerW / hourly.length;
  const barW = Math.min(24, band - 4);
  const base = pad.top + innerH;
  const y = (value: number) => base - (value / max) * innerH;
  const peak = hourly.reduce((best, item, i) => (item.tokens > hourly[best].tokens ? i : best), 0);
  const active = hover != null ? hourly[hover] : null;

  return (
    <>
      <div className="overflow-x-auto">
        <div className="relative min-w-[520px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full touch-none select-none"
            role="img"
            aria-label={t("近 24 小时每小时消耗")}
            tabIndex={0}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={stepKeys(hourly.length, setHover)}
          >
            {[0, max / 2, max].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
                <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                  {f.count(tick)}
                </text>
              </g>
            ))}
            {hourly.map((item, i) => {
              const left = pad.left + i * band + (band - barW) / 2;
              return (
                <g key={item.hour}>
                  {item.tokens > 0 ? (
                    <path
                      d={columnPath(left, y(item.tokens), barW, base)}
                      fill="var(--series-1)"
                      opacity={hover == null || hover === i ? 1 : 0.45}
                    />
                  ) : null}
                  {i % 6 === 0 ? (
                    <text x={pad.left + (i + 0.5) * band} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                      {f.clock(item.hour)}
                    </text>
                  ) : null}
                  {/* 整条竖带都是悬停区域，不用瞄准细柱子 */}
                  <rect
                    x={pad.left + i * band}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
            <text
              x={pad.left + (peak + 0.5) * band}
              y={y(hourly[peak].tokens) - 5}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink)"
            >
              {f.count(hourly[peak].tokens)}
            </text>
          </svg>
          {active && hover != null ? (
            <Tip x={(pad.left + (hover + 0.5) * band) / W}>
              <div className="text-sm font-semibold text-ink">
                {f.count(active.tokens)} token
                {f.cn(active.tokens) ? <span className="ml-1 font-normal text-muted">≈ {f.cn(active.tokens)}</span> : null}
              </div>
              <div className="text-muted">
                {f.clock(active.hour)}–{f.clock(active.hour + HOUR_MS)}
              </div>
              {active.costUsd > 0 ? <div className="text-muted">{t("按 API 价约 {m}", { m: f.money(active.costUsd) })}</div> : null}
              {active.requests ? <div className="text-muted">{t("{n} 次请求", { n: active.requests })}</div> : null}
              {active.pctDelta != null ? (
                <div className="text-muted">{t("周额度 +{p}", { p: f.pct(active.pctDelta) })}</div>
              ) : null}
            </Tip>
          ) : null}
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted">{t("查看表格")}</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">{t("时间")}</th>
                <th className="py-1 text-right font-normal">Token</th>
                <th className="py-1 text-right font-normal">{t("花费（估）")}</th>
                <th className="py-1 text-right font-normal">{t("请求")}</th>
                <th className="py-1 text-right font-normal">{t("周额度变化")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...hourly].reverse().map((item) => (
                <tr key={item.hour} className="border-t border-line">
                  <td className="py-1">
                    {f.clock(item.hour)}–{f.clock(item.hour + HOUR_MS)}
                  </td>
                  <td className="py-1 text-right">{item.tokens ? f.count(item.tokens) : "—"}</td>
                  <td className="py-1 text-right">{item.costUsd ? f.money(item.costUsd) : "—"}</td>
                  <td className="py-1 text-right">{item.requests || "—"}</td>
                  <td className="py-1 text-right">{item.pctDelta != null ? `+${f.pct(item.pctDelta)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function ModelShare({ models, f }: { models: AccountReport["models"]; f: Format }) {
  const t = useT();
  if (!models.length) {
    return <p className="py-6 text-center text-xs text-muted">{t("这个窗口里本机还没有这个账号的用量记录。")}</p>;
  }
  const byCost = models.some((item) => item.costUsd > 0);
  const valueOf = (item: { tokens: number; costUsd: number }) => (byCost ? item.costUsd : item.tokens);
  const sorted = [...models].sort((a, b) => valueOf(b) - valueOf(a));
  const top = sorted.slice(0, SERIES.length);
  const rest = sorted.slice(SERIES.length);
  // 颜色按型号第一次出现的先后排座次，不按排名 —— 刷新后排名变了，颜色也不跟着换。
  const seats = [...top].sort((a, b) => a.firstHour - b.firstHour || a.model.localeCompare(b.model));
  const colorOf = new Map(seats.map((item, i) => [item.model, SERIES[i]]));
  const rows = top.map((item) => ({
    key: item.model,
    label: item.model,
    color: colorOf.get(item.model) ?? OTHER_COLOR,
    tokens: item.tokens,
    costUsd: item.costUsd,
    requests: item.requests,
  }));
  if (rest.length) {
    rows.push({
      key: "__other",
      label: t("其他 {n} 个型号", { n: rest.length }),
      color: OTHER_COLOR,
      tokens: rest.reduce((sum, item) => sum + item.tokens, 0),
      costUsd: rest.reduce((sum, item) => sum + item.costUsd, 0),
      requests: rest.reduce((sum, item) => sum + item.requests, 0),
    });
  }
  const total = rows.reduce((sum, row) => sum + valueOf(row), 0) || 1;
  const share = (row: { tokens: number; costUsd: number }) => f.pct((valueOf(row) / total) * 100);

  return (
    <>
      {/* 段与段之间留 2px 空隙，不画描边；两头 4px 圆角 */}
      <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={t("型号占比")}>
        {rows.map((row, i) => (
          <div
            key={row.key}
            title={`${row.label} · ${share(row)}`}
            className={`h-full min-w-[2px] ${i === 0 ? "rounded-l" : ""} ${i === rows.length - 1 ? "rounded-r" : ""}`}
            style={{ flexGrow: valueOf(row), flexBasis: 0, background: row.color }}
          />
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-normal">{t("型号")}</th>
              <th className="py-1 text-right font-normal">{t("占比")}</th>
              <th className="py-1 text-right font-normal">Token</th>
              <th className="py-1 text-right font-normal">{t("花费（估）")}</th>
              <th className="py-1 text-right font-normal">{t("请求")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  {/* 型号名就是这一行的身份，窄窗口也不能截成「clau…」：按内容宽度排，太长才截 */}
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: row.color }} aria-hidden="true" />
                    <span className="block max-w-[16rem] truncate" title={row.label} data-model-name>
                      {row.label}
                    </span>
                  </span>
                </td>
                <td className="py-1.5 text-right">{share(row)}</td>
                <td className="py-1.5 text-right">{f.count(row.tokens)}</td>
                <td className="py-1.5 text-right">{row.costUsd ? f.money(row.costUsd) : "—"}</td>
                <td className="py-1.5 text-right">{row.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Notes({ kind, sessions }: { kind: AccountKind; sessions: Sessions }) {
  const t = useT();
  const attribution =
    kind === "claude"
      ? t(
          "Claude Code 会话：~/.claude/settings.json 里没配中转地址就算官方账号（AllAi 里用 API 接口跑的 Claude Code 也会被算进来）。已计入 {n} 个会话。",
          { n: sessions.included },
        )
      : kind === "chatgpt"
        ? t("Codex 会话：看每个会话自己记录的 model_provider，只算 openai 的。已计入 {a} 个，排除走中转的 {b} 个。", {
            a: sessions.included,
            b: sessions.excluded,
          })
        : sessions.excluded > 0
          ? t(
              "Grok 会话文件不记录走的是哪个接口，而本机 Grok 配置了中转地址，所以 {n} 个 Grok Build 会话都没有计入，只算 AllAi 里官方登录聊天的用量 —— Grok 的折算可能偏低或算不出来。",
              { n: sessions.excluded },
            )
          : t("Grok 会话：~/.grok/config.toml 里没配中转地址就算官方账号。已计入 {n} 个会话。", { n: sessions.included });
  return (
    <div className="space-y-1.5 rounded-2xl border border-line px-3 py-2.5 text-[11px] leading-5 text-muted">
      <p>
        {t(
          "百分比来自官方接口，AllAi 开着时每 5 分钟记一次（~/.allai/quota-history.json）；token 和花费来自本机 CLI 会话和 AllAi 的聊天记录。",
        )}
      </p>
      <p>
        {t(
          "额度折合 = 这个窗口里用掉的量 ÷ 官方显示的已用百分比。已用越多越准；花费按各家 API 公开价估算，不是账单。",
        )}
      </p>
      <p>{t("速度取「最近」和「整个窗口平均」里较快的一个，预警宁可偏早。")}</p>
      <p>{attribution}</p>
    </div>
  );
}

export { WEEK_MS };
