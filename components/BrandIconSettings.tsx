"use client";

import { Download, RotateCcw, Server, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BRAND_LABEL,
  BUILT_IN_BRANDS,
  brandFor,
  providerIconKey,
  type BrandId,
} from "@/lib/brand";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { ModelIcon } from "./ModelIcon";

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onChange: (patch: Partial<AppPrefs>) => void;
  onToast?: (text: string) => void;
};

type Row = {
  key: string;
  label: string;
  sample: string;
  baseUrl: string;
  /** 接口行要带上接口 id，图标才认得出是给这个接口配的。 */
  providerId?: string;
  /** vector = 自带矢量图，monogram = 品牌色块，unknown = 认不出牌子，provider = 接口 */
  kind: "vector" | "monogram" | "unknown" | "provider";
};

/**
 * 图标管理。三组，从具体到笼统：
 * - **接口**：给某个中转站配一个图标，它下面所有模型都跟着换；
 * - **厂商**：认得出牌子的按厂商归一行；
 * - **模型**：认不出牌子的单独列出来。
 *
 * 抓到的图标存成 data URI，离线也能显示。
 */
export function BrandIconSettings({ providers, prefs, onChange, onToast }: Props) {
  const t = useT();
  const icons = prefs.brandIcons ?? {};
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKey = useRef("");

  const rows = useMemo(() => {
    const own = new Map<string, Row>();
    const brands = new Map<string, Row>();
    const unknown = new Map<string, Row>();
    for (const provider of providers) {
      // 接口行：官方登录那两个（Claude 账号 / Grok 账号）不列 —— 它们不是「接口地址」，
      // 用户也不会想给它们配图标。
      const official = provider.auth && provider.auth !== "api";
      if (!official && !own.has(provider.id)) {
        own.set(provider.id, {
          key: providerIconKey(provider.id),
          label: provider.name,
          sample: provider.models[0]?.id ?? "",
          baseUrl: provider.baseUrl,
          providerId: provider.id,
          kind: "provider",
        });
      }
      for (const model of provider.models) {
        const brand = brandFor(model.id, provider.baseUrl);
        if (brand) {
          if (!brands.has(brand)) {
            brands.set(brand, {
              key: brand,
              label: BRAND_LABEL[brand as BrandId] || brand,
              sample: model.id,
              baseUrl: provider.baseUrl,
              kind: BUILT_IN_BRANDS.includes(brand) ? "vector" : "monogram",
            });
          }
          continue;
        }
        const key = model.id.toLowerCase();
        if (!unknown.has(key)) {
          unknown.set(key, {
            key,
            label: model.label || model.id,
            sample: model.id,
            baseUrl: provider.baseUrl,
            kind: "unknown",
          });
        }
      }
    }
    return {
      providers: [...own.values()].sort((a, b) => a.label.localeCompare(b.label)),
      brands: [...brands.values()].sort((a, b) => a.label.localeCompare(b.label)),
      unknown: [...unknown.values()].sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [providers]);

  function save(key: string, icon: string | null) {
    const next = { ...icons };
    if (icon) next[key] = icon;
    else delete next[key];
    onChange({ brandIcons: next });
  }

  async function fetchIcon(key: string, source: string) {
    if (!source.trim()) return;
    setBusy(key);
    try {
      const response = await fetch("/api/brand-icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = (await response.json()) as { icon?: string; error?: string };
      if (!response.ok || !data.icon) throw new Error(data.error || t("抓不到图标"));
      save(key, data.icon);
      setDraft((current) => ({ ...current, [key]: "" }));
      onToast?.(t("图标已保存"));
    } catch (error) {
      onToast?.(error instanceof Error ? t(error.message) : t("抓不到图标"));
    } finally {
      setBusy("");
    }
  }

  function pickFile(key: string) {
    pendingKey.current = key;
    fileRef.current?.click();
  }

  function onFile(file: File) {
    const key = pendingKey.current;
    if (!key) return;
    if (file.size > 360 * 1024) {
      onToast?.(t("图标不能超过 360KB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => save(key, String(reader.result || ""));
    reader.onerror = () => onToast?.(t("读取图片失败"));
    reader.readAsDataURL(file);
  }

  function IconRow({ row }: { row: Row }) {
    const custom = icons[row.key];
    return (
      <div className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-canvas">
          {/* 接口行：配了就显示配的那张，没配就给个中性的占位 ——
              拿第一个模型的厂商图标来当接口图标是骗人的，OpenRouter 上面挂着十几家。 */}
          {row.kind === "provider" ? (
            custom ? (
              // eslint-disable-next-line @next/next/no-img-element -- 用户自己配的图标，可能是任意来源
              <img
                src={custom}
                alt=""
                aria-hidden="true"
                className="size-5 shrink-0 rounded-[4px] object-contain"
              />
            ) : (
              <Server className="size-4 text-muted opacity-60" />
            )
          ) : (
            <ModelIcon
              modelId={row.sample}
              baseUrl={row.baseUrl}
              providerId={row.providerId}
              icons={icons}
              className="size-5"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{t(row.label)}</div>
          <div className="truncate text-[11px] text-muted">
            {custom
              ? t("自定义图标")
              : row.kind === "provider"
                ? t("接口默认")
                : row.kind === "vector"
                  ? t("内置图标")
                  : row.kind === "monogram"
                    ? t("品牌色块")
                    : t("没有图标")}
          </div>
        </div>
        <input
          value={draft[row.key] ?? ""}
          onChange={(event) => setDraft((c) => ({ ...c, [row.key]: event.target.value }))}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text").trim();
            if (!text) return;
            // 粘贴一个网址就自动去抓，不用再点一次按钮 —— 用户要的就是「填网址就识别」。
            window.setTimeout(() => void fetchIcon(row.key, text), 0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") void fetchIcon(row.key, draft[row.key] ?? "");
          }}
          placeholder={t("图片网址或网站域名")}
          className="hidden w-44 rounded-lg border border-line bg-elevated px-2 py-1 font-mono text-[11px] outline-none focus:border-accent sm:block"
        />
        <button
          type="button"
          onClick={() => void fetchIcon(row.key, draft[row.key] ?? "")}
          disabled={busy === row.key || !(draft[row.key] ?? "").trim()}
          title={t("从网上抓取")}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink disabled:opacity-30"
        >
          <Download className={`size-3.5 ${busy === row.key ? "animate-pulse" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => pickFile(row.key)}
          title={t("从本地选图片")}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
        >
          <Upload className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => save(row.key, null)}
          disabled={!custom}
          title={t("恢复默认")}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-danger disabled:opacity-30"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      <p className="mb-3 text-xs leading-5 text-muted">
        {t("模型名前面的厂商图标。Anthropic / xAI / OpenAI 是自带的矢量图，其余认得出牌子的画品牌色块（DeepSeek、通义、Kimi、智谱这些都有）。想换成真图标：填网站域名会去它页面上找图标，填图片网址就直接用那张图，也可以从本地选一张。给「接口」配的图标会盖住它下面所有模型的厂商图标 —— 比逐个厂商配省事，又比按单个模型配省得重复。图标存在本机，不会每次渲染都去打别人的服务器。")}
      </p>

      {rows.providers.length ? (
        <div className="mb-4 rounded-2xl border border-line px-3 py-1">
          <div className="border-b border-line py-2 text-[11px] font-medium text-muted">
            {t("接口（配了这个，它下面的模型都跟着换）")}
          </div>
          {rows.providers.map((row) => (
            <IconRow key={row.key} row={row} />
          ))}
        </div>
      ) : null}

      {rows.brands.length ? (
        <div className="mb-4 rounded-2xl border border-line px-3 py-1">
          <div className="border-b border-line py-2 text-[11px] font-medium text-muted">
            {t("认出来的厂商")}
          </div>
          {rows.brands.map((row) => (
            <IconRow key={row.key} row={row} />
          ))}
        </div>
      ) : null}

      {rows.unknown.length ? (
        <div className="rounded-2xl border border-line px-3 py-1">
          <div className="border-b border-line py-2 text-[11px] font-medium text-muted">
            {t("认不出牌子的模型（{n}）", { n: rows.unknown.length })}
          </div>
          {rows.unknown.slice(0, 40).map((row) => (
            <IconRow key={row.key} row={row} />
          ))}
          {rows.unknown.length > 40 ? (
            <div className="border-t border-line py-2 text-[11px] text-muted">
              {t("还有 {n} 个没列出来", { n: rows.unknown.length - 40 })}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-2xl border border-line px-3 py-4 text-center text-xs text-muted">
          {t("所有模型都认出牌子了")}
        </p>
      )}
    </div>
  );
}
