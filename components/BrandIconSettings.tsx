"use client";

import { Download, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { BRAND_LABEL, BUILT_IN_BRANDS, brandFor, type BrandId } from "@/lib/brand";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { ModelIcon } from "./ModelIcon";

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onChange: (patch: Partial<AppPrefs>) => void;
  onToast?: (text: string) => void;
};

type Row = { key: string; label: string; sample: string; baseUrl: string; builtIn: boolean };

/**
 * 图标管理：认出来的按厂商归一行，认不出来的模型单独列出来让用户自己配。
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
    const brands = new Map<string, Row>();
    const unknown = new Map<string, Row>();
    for (const provider of providers) {
      for (const model of provider.models) {
        const brand = brandFor(model.id, provider.baseUrl);
        if (brand) {
          if (!brands.has(brand)) {
            brands.set(brand, {
              key: brand,
              label: BRAND_LABEL[brand as BrandId] || brand,
              sample: model.id,
              baseUrl: provider.baseUrl,
              builtIn: BUILT_IN_BRANDS.includes(brand),
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
            builtIn: false,
          });
        }
      }
    }
    return {
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
          <ModelIcon
            modelId={row.sample}
            baseUrl={row.baseUrl}
            icons={icons}
            className="size-5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{row.label}</div>
          <div className="truncate text-[11px] text-muted">
            {custom ? t("自定义图标") : row.builtIn ? t("内置图标") : t("没有图标")}
          </div>
        </div>
        <input
          value={draft[row.key] ?? ""}
          onChange={(event) => setDraft((c) => ({ ...c, [row.key]: event.target.value }))}
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
        {t("模型名前面的厂商图标。Anthropic / xAI / OpenAI 自带矢量图，其余认出了牌子但没有图，可以自己配：填图片网址就直接用那张图，填网站域名会去抓它的站点图标，也可以从本地选一张。图标存在本机，不会每次渲染都去打别人的服务器。")}
      </p>

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
