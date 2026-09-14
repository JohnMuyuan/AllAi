"use client";

import { AlertTriangle, Check, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { officialSpecForProvider } from "@/lib/official-chat";
import { lampLevel, traceFamily } from "@/lib/model-trace/match";
import { runTraceFromUi } from "@/lib/model-trace/client";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";

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
};

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onPrefs: (patch: Partial<AppPrefs>) => void;
  onToast?: (text: string) => void;
};

export function ModelTraceSettings({ providers, prefs, onPrefs, onToast }: Props) {
  const t = useT();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [rate, setRate] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

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

  async function reload() {
    const response = await fetch("/api/model-trace");
    const data = (await response.json()) as { records?: RecordRow[]; rate?: number; enabled?: boolean };
    setRecords(data.records || []);
    setRate(data.rate || 0);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时读一次，写状态都在 await 之后
    void reload().catch(() => undefined);
  }, []);

  async function runManual() {
    const option = options.find((item) => item.key === pick) || options[0];
    if (!option) {
      onToast?.(t("没有可探测的 OpenAI / Claude 接口"));
      return;
    }
    setBusy(true);
    try {
      await runTraceFromUi({
        providerId: option.providerId,
        modelId: option.modelId,
        queries: 3,
        source: "manual",
      });
      await reload();
      onToast?.(t("探测完成"));
    } catch (error) {
      onToast?.(error instanceof Error ? t(error.message) : t("探测失败"));
    } finally {
      setBusy(false);
    }
  }

  const color = lampLevel(rate);
  const percent = Math.round(rate * 100);
  const enabled = prefs.modelTraceEnabled !== false;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("模型溯源")}</h3>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            {t("用数字指纹探测 OpenAI / Claude 是不是被路由到别的型号。HTTP 接口走 Key；官方登录的 Claude / ChatGPT 走本机 CLI，会用一点订阅额度。方法来自 ModelTrace。")}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onPrefs({ modelTraceEnabled: event.target.checked })}
          />
          {t("自动探测")}
        </label>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-elevated p-4">
        <div
          className={`trace-lamp grid size-14 shrink-0 place-items-center rounded-full text-white ${
            color === "green" ? "bg-emerald-500" : color === "yellow" ? "bg-amber-400" : "bg-red-500"
          }`}
        >
          {color === "green" ? <Check className="size-7" /> : color === "yellow" ? <AlertTriangle className="size-7" /> : <X className="size-7" />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {records.length
              ? t("最近探测路由占比 {n}%", { n: percent })
              : t("还没有探测记录")}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            {color === "green"
              ? t("没有发现被路由到别的型号。")
              : color === "yellow"
                ? t("有一部分回复对不上你选的型号。")
                : t("被路由的比例偏高，建议换接口或核对账号。")}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={pick || options[0]?.key || ""}
          onChange={(event) => setPick(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-line bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {options.length ? (
            options.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))
          ) : (
            <option value="">{t("没有可探测的 OpenAI / Claude 接口")}</option>
          )}
        </select>
        <button
          type="button"
          onClick={() => void runManual()}
          disabled={busy || !options.length}
          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-2 text-sm font-medium text-canvas disabled:opacity-50"
        >
          <Play className="size-3.5" />
          {busy ? t("探测中…") : t("手动探测")}
        </button>
      </div>

      <h4 className="mb-2 text-xs font-medium text-muted">{t("历史检测记录")}</h4>
      {records.length ? (
        <div className="space-y-2">
          {records.map((item) => (
            <div key={item.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={item.mismatch ? "font-medium text-danger" : "text-ink"}>
                  {item.mismatch
                    ? t("对不上：选的 {expected}，指纹更像 {name}", {
                        expected: item.expected,
                        name: item.predictedName,
                      })
                    : t("相符：{expected} ≈ {name}", {
                        expected: item.expected,
                        name: item.predictedName,
                      })}
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {Math.round(item.probability * 100)}%
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {new Date(item.at).toLocaleString()} · {item.source === "manual" ? t("手动") : t("自动")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("发一条 OpenAI 或 Claude 的聊天后，这里会出现记录。")}</p>
      )}
    </div>
  );
}
