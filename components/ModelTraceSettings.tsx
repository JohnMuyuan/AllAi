"use client";

import { AlertTriangle, Check, ChevronDown, Play, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { officialSpecForProvider } from "@/lib/official-chat";
import { lampLevel, traceFamily } from "@/lib/model-trace/match";
import { runTraceFromUi } from "@/lib/model-trace/client";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";
import { useLang, useT, type Translate } from "./I18n";
import { OptionSelect } from "./OptionSelect";

/**
 * 设置 → 溯源。
 *
 * 界面规矩和额度监控一致：手写 SVG，不引图表库；两个系列才放图例；
 * 状态色（相符 / 对不上）永远配图标和文字，不靠颜色单独表意；
 * 每张图下面都能展开成表格，鼠标悬停只是补充。
 */

type Candidate = { model: string; name: string; probability: number };

type RecordRow = {
  id: string;
  at: number;
  expected: string;
  predicted: string;
  predictedName: string;
  family: string;
  probability: number;
  mismatch: boolean;
  source: "auto" | "manual";
  candidates?: Candidate[];
  usedOutputs?: number;
  queries?: number;
  familyProbability?: number;
};

type BankInfo = {
  builtAt: string;
  recommendedQueries: number;
  models: { id: string; name: string; family: string; familyName: string }[];
};

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onPrefs: (patch: Partial<AppPrefs>) => void;
  onToast?: (text: string) => void;
};

const OK_COLOR = "var(--series-1)";
const BAD_COLOR = "var(--status-critical)";
const DAYS = 14;
const DAY_MS = 86_400_000;

function dayStart(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function ModelTraceSettings({ providers, prefs, onPrefs, onToast }: Props) {
  const t = useT();
  const lang = useLang();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [bank, setBank] = useState<BankInfo | null>(null);
  const [rate, setRate] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const confirm = useConfirm();

  const fmt = useMemo(() => {
    const locale = lang === "en" ? "en-US" : "zh-CN";
    return {
      when: new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
      day: new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }),
    };
  }, [lang]);

  const options = useMemo(() => {
    const out: { key: string; label: string; providerId: string; modelId: string }[] = [];
    for (const provider of providers) {
      const official = officialSpecForProvider(provider);
      if (official) {
        if (official.kind !== "claude" && official.kind !== "chatgpt") continue;
      } else if (!provider.hasKey) {
        continue;
      }
      for (const model of provider.models) {
        if (model.kind && model.kind !== "chat") continue;
        if (!traceFamily(model.id)) continue;
        out.push({
          key: `${provider.id}::${model.id}`,
          label: `${provider.name} · ${model.label || model.id}`,
          providerId: provider.id,
          modelId: model.id,
        });
      }
    }
    return out;
  }, [providers]);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/model-trace");
      const data = (await response.json()) as { records?: RecordRow[]; rate?: number; bank?: BankInfo };
      setRecords(data.records || []);
      setRate(data.rate || 0);
      setBank(data.bank || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  async function runManual() {
    const option = options.find((item) => item.key === pick) || options[0];
    if (!option) {
      onToast?.(t("没有可探测的 OpenAI / Claude 接口"));
      return;
    }
    setBusy(true);
    try {
      await runTraceFromUi({ providerId: option.providerId, modelId: option.modelId, queries: 3, source: "manual" });
      await reload();
      onToast?.(t("探测完成"));
    } catch (error) {
      onToast?.(error instanceof Error ? t(error.message) : t("探测失败"));
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    const ok = await confirm({
      title: t("清空 {n} 条探测记录？", { n: records.length }),
      detail: t("统计和趋势都会归零，无法恢复。指纹库和自动探测开关不受影响。"),
      confirmText: t("清空"),
      danger: true,
    });
    if (!ok) return;
    await fetch("/api/model-trace", { method: "DELETE" });
    await reload();
    onToast?.(t("已清空探测记录"));
  }

  const stats = useMemo(() => summarize(records), [records]);
  const color = lampLevel(rate);
  const percent = Math.round(rate * 100);
  const enabled = prefs.modelTraceEnabled !== false;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("模型溯源")}</h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            {t("用数字指纹探测 OpenAI / Claude 是不是被路由到别的型号。HTTP 接口走 Key；官方登录的 Claude / ChatGPT 走本机 CLI，会用一点订阅额度。方法来自 ModelTrace。")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => onPrefs({ modelTraceEnabled: event.target.checked })} />
            {t("自动探测")}
          </label>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void reload();
            }}
            aria-label={t("刷新")}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 结论卡：一眼看出「有没有被换型号」 */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-elevated p-4">
        <div
          className={`trace-lamp grid size-14 shrink-0 place-items-center rounded-full text-white ${
            color === "green" ? "bg-emerald-500" : color === "yellow" ? "bg-amber-400" : "bg-red-500"
          }`}
        >
          {color === "green" ? <Check className="size-7" /> : color === "yellow" ? <AlertTriangle className="size-7" /> : <X className="size-7" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {records.length ? t("最近 {n} 次里有 {m} 次对不上（{p}%）", { n: stats.recentTotal, m: stats.recentMismatch, p: percent }) : t("还没有探测记录")}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            {!records.length
              ? t("发一条 OpenAI 或 Claude 的聊天，或者在下面手动探测一次。")
              : color === "green"
                ? t("没有发现被路由到别的型号。")
                : color === "yellow"
                  ? t("有一部分回复对不上你选的型号。")
                  : t("被路由的比例偏高，建议换接口或核对账号。")}
          </p>
        </div>
        {stats.lastAt ? (
          <div className="text-right text-[11px] text-muted">
            <div>{t("上次探测")}</div>
            <div className="tabular-nums text-ink/80">{fmt.when.format(stats.lastAt)}</div>
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <OptionSelect
            label={t("探测目标")}
            value={pick || options[0]?.key || ""}
            onChange={setPick}
            disabled={!options.length}
            options={
              options.length
                ? options.map((item) => ({ value: item.key, label: item.label }))
                : [{ value: "", label: t("没有可探测的 OpenAI / Claude 接口") }]
            }
          />
        </div>
        <button
          type="button"
          onClick={() => void clearAll()}
          disabled={busy || !records.length}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm text-muted hover:bg-user hover:text-ink disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          {t("清空重测")}
        </button>
        <button
          type="button"
          onClick={() => void runManual()}
          disabled={busy || !options.length}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-sm font-medium text-canvas disabled:opacity-50"
        >
          <Play className="size-3.5" />
          {busy ? t("探测中…") : t("手动探测 3 次")}
        </button>
      </div>

      {records.length ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={t("累计探测")} value={String(stats.total)} sub={t("自动 {a} · 手动 {m}", { a: stats.auto, m: stats.manual })} />
            <Tile label={t("对不上")} value={String(stats.mismatch)} sub={t("占 {p}%", { p: Math.round(stats.mismatchRate * 100) })} />
            <Tile label={t("平均把握")} value={`${Math.round(stats.avgProbability * 100)}%`} sub={t("指纹和第一名的接近程度")} />
            <Tile label={t("覆盖型号")} value={String(stats.models.length)} sub={t("你实际测过的型号数")} />
          </div>

          <Section title={t("最近 {n} 天")} titleVars={{ n: DAYS }} sub={t("每天探测了几次、其中几次对不上")}>
            <DailyChart days={stats.days} fmt={fmt} />
          </Section>

          <Section title={t("按型号")} sub={t("你选的型号，和指纹实际判成的型号")}>
            <ModelTable rows={stats.models} t={t} />
          </Section>

          <Section title={t("详细记录")} sub={t("点一条展开候选排名")}>
            <div className="space-y-1.5">
              {records.slice(0, 50).map((item) => (
                <RecordCard
                  key={item.id}
                  item={item}
                  open={open === item.id}
                  onToggle={() => setOpen(open === item.id ? null : item.id)}
                  when={fmt.when.format(item.at)}
                  t={t}
                />
              ))}
            </div>
          </Section>
        </>
      ) : null}

      {bank ? (
        <div className="rounded-2xl border border-line px-3 py-2.5 text-[11px] leading-5 text-muted">
          <p>
            {t("指纹库覆盖 {n} 个型号，构建于 {date}；判定完全在本机完成，不上传任何内容。", {
              n: bank.models.length,
              date: bank.builtAt ? bank.builtAt.slice(0, 10) : "—",
            })}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {bank.models.map((model) => (
              <span key={model.id} className="rounded-full border border-line px-1.5 py-px text-[10px] text-ink/70">
                {model.name}
              </span>
            ))}
          </div>
          <p className="mt-1.5">{t("指纹库和算法来自 ModelTrace（MIT）。库里没有的型号（比如 Grok）不测。")}</p>
        </div>
      ) : null}
    </div>
  );
}

function summarize(records: RecordRow[]) {
  const total = records.length;
  const mismatch = records.filter((item) => item.mismatch).length;
  const recent = records.slice(0, 50);
  const models = new Map<string, { expected: string; total: number; mismatch: number; predicted: Map<string, number> }>();
  for (const item of records) {
    const hit = models.get(item.expected) ?? { expected: item.expected, total: 0, mismatch: 0, predicted: new Map() };
    hit.total += 1;
    if (item.mismatch) hit.mismatch += 1;
    hit.predicted.set(item.predictedName, (hit.predicted.get(item.predictedName) || 0) + 1);
    models.set(item.expected, hit);
  }
  const today = dayStart(Date.now());
  const days: { at: number; ok: number; bad: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const at = today - i * DAY_MS;
    const list = records.filter((item) => dayStart(item.at) === at);
    days.push({ at, ok: list.filter((item) => !item.mismatch).length, bad: list.filter((item) => item.mismatch).length });
  }
  return {
    total,
    mismatch,
    mismatchRate: total ? mismatch / total : 0,
    auto: records.filter((item) => item.source !== "manual").length,
    manual: records.filter((item) => item.source === "manual").length,
    avgProbability: total ? records.reduce((sum, item) => sum + item.probability, 0) / total : 0,
    recentTotal: recent.length,
    recentMismatch: recent.filter((item) => item.mismatch).length,
    lastAt: records[0]?.at,
    days,
    models: [...models.values()]
      .map((item) => ({
        expected: item.expected,
        total: item.total,
        mismatch: item.mismatch,
        top: [...item.predicted.entries()].sort((a, b) => b[1] - a[1])[0],
      }))
      .sort((a, b) => b.mismatch / b.total - a.mismatch / a.total || b.total - a.total),
  };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] leading-4 text-muted">{sub}</div> : null}
    </div>
  );
}

function Section({
  title,
  titleVars,
  sub,
  children,
}: {
  title: string;
  titleVars?: Record<string, string | number>;
  sub?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="mb-4 rounded-2xl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{titleVars ? t(title, titleVars) : title}</h4>
        {sub ? <span className="text-[11px] text-muted">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DailyChart({ days, fmt }: { days: { at: number; ok: number; bad: number }[]; fmt: { day: Intl.DateTimeFormat } }) {
  const t = useT();
  const max = Math.max(1, ...days.map((day) => day.ok + day.bad));
  const W = 720;
  const H = 150;
  const pad = { top: 14, right: 8, bottom: 20, left: 30 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const band = innerW / days.length;
  const barW = Math.min(24, band - 6);
  const base = pad.top + innerH;
  const y = (value: number) => base - (value / max) * innerH;

  return (
    <>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[420px]" role="img" aria-label={t("最近每天的探测结果")}>
          {[0, max].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {tick}
              </text>
            </g>
          ))}
          {days.map((day, i) => {
            const left = pad.left + i * band + (band - barW) / 2;
            const okTop = y(day.ok);
            const badTop = y(day.ok + day.bad);
            const title = `${fmt.day.format(day.at)} · ${day.ok + day.bad}`;
            return (
              <g key={day.at}>
                {day.ok > 0 ? <rect x={left} y={okTop} width={barW} height={base - okTop} rx={2} fill={OK_COLOR}><title>{title}</title></rect> : null}
                {/* 两段之间留 2px 空隙，靠底色分隔，不画描边 */}
                {day.bad > 0 ? (
                  <rect x={left} y={badTop} width={barW} height={Math.max(1, okTop - badTop - (day.ok > 0 ? 2 : 0))} rx={2} fill={BAD_COLOR}>
                    <title>{title}</title>
                  </rect>
                ) : null}
                {i % 3 === 0 ? (
                  <text x={pad.left + (i + 0.5) * band} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                    {fmt.day.format(day.at)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: OK_COLOR }} aria-hidden="true" />
          {t("相符")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: BAD_COLOR }} aria-hidden="true" />
          {t("对不上")}
        </span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted">{t("查看表格")}</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">{t("日期")}</th>
                <th className="py-1 text-right font-normal">{t("相符")}</th>
                <th className="py-1 text-right font-normal">{t("对不上")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...days].reverse().map((day) => (
                <tr key={day.at} className="border-t border-line">
                  <td className="py-1">{fmt.day.format(day.at)}</td>
                  <td className="py-1 text-right">{day.ok || "—"}</td>
                  <td className="py-1 text-right">{day.bad || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function ModelTable({
  rows,
  t,
}: {
  rows: { expected: string; total: number; mismatch: number; top?: [string, number] }[];
  t: Translate;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const ratio = row.total ? row.mismatch / row.total : 0;
        return (
          <div key={row.expected} className="rounded-xl border border-line px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{row.expected}</span>
              <span className="shrink-0 text-[11px] text-muted">
                {t("{n} 次 · 对不上 {m} 次", { n: row.total, m: row.mismatch })}
              </span>
            </div>
            <div className="mt-1.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
              <div style={{ flexGrow: Math.max(0.0001, 1 - ratio), background: OK_COLOR }} />
              {row.mismatch ? <div style={{ flexGrow: ratio, background: BAD_COLOR }} /> : null}
            </div>
            {row.top ? (
              <div className="mt-1 text-[11px] text-muted">
                {t("最常判成：{name}（{n} 次）", { name: row.top[0], n: row.top[1] })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RecordCard({
  item,
  open,
  onToggle,
  when,
  t,
}: {
  item: RecordRow;
  open: boolean;
  onToggle: () => void;
  when: string;
  t: Translate;
}) {
  const candidates = item.candidates || [];
  return (
    <div className={`rounded-xl border px-3 py-2 ${item.mismatch ? "border-danger/40" : "border-line"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: item.mismatch ? BAD_COLOR : OK_COLOR }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${item.mismatch ? "font-medium text-danger" : "text-ink"}`}>
            {item.mismatch
              ? t("对不上：选的 {expected}，指纹更像 {name}", { expected: item.expected, name: item.predictedName })
              : t("相符：{expected} ≈ {name}", { expected: item.expected, name: item.predictedName })}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">
            {when} · {item.source === "manual" ? t("手动") : t("自动")}
            {item.usedOutputs != null ? ` · ${t("{a}/{b} 条有效回答", { a: item.usedOutputs, b: item.queries ?? item.usedOutputs })}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted">{Math.round(item.probability * 100)}%</span>
        <ChevronDown className={`mt-0.5 size-3.5 shrink-0 text-muted ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mt-2 border-t border-line pt-2">
          {candidates.length ? (
            <ul className="space-y-1">
              {candidates.map((candidate) => (
                <li key={candidate.model} className="flex items-center gap-2 text-[11px]">
                  <span className="w-40 shrink-0 truncate text-ink/80">{candidate.name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-user">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, Math.round(candidate.probability * 100))}%`,
                        background: candidate.model === item.predicted ? (item.mismatch ? BAD_COLOR : OK_COLOR) : "var(--series-other)",
                      }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted">
                    {Math.round(candidate.probability * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted">{t("这条是旧记录，没有存候选排名。再测一次就有了。")}</p>
          )}
          {item.familyProbability != null ? (
            <p className="mt-2 text-[11px] text-muted">
              {t("判定为 {family} 家族的把握 {p}%", { family: item.family, p: Math.round(item.familyProbability * 100) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
