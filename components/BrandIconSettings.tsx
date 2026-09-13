"use client";

import { Download, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BRAND_LABEL,
  BUILT_IN_BRANDS,
  brandFor,
  type BrandId,
} from "@/lib/brand";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { ModelIcon } from "./ModelIcon";
import { PresetIconPicker } from "./PresetIconPicker";
import { BRAND_PRESET_FILE, presetSrc } from "@/lib/preset-icons";

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
  /** vector = 自带矢量图，monogram = 品牌色块，unknown = 认不出牌子 */
  kind: "vector" | "monogram" | "unknown";
};

/**
 * 按厂商 / 认不出的模型配图标。
 * 某一条服务自己的图标在「添加服务 / 点进那条接口」里配，不在这里。
 */
export function BrandIconSettings({ providers, prefs, onChange, onToast }: Props) {
  const t = useT();
  const icons = prefs.brandIcons ?? {};
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [focusKey, setFocusKey] = useState("");
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
      <div
        className={`flex items-center gap-2 border-t border-line py-2 first:border-t-0 ${
          focusKey === row.key ? "bg-user/60" : ""
        }`}
        onClick={() => setFocusKey(row.key)}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-canvas">
          <ModelIcon modelId={row.sample} baseUrl={row.baseUrl} icons={icons} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{t(row.label)}</div>
          <div className="truncate text-[11px] text-muted">
            {custom
              ? t("自定义图标")
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
        {t("模型名前面的厂商图标。点下面一行再选预设，或自己填网址、上传。某一条服务自己的图标去「聊天模型 / Agent 接口」里那条服务上配。")}
      </p>
      {focusKey ? (
        <div className="mb-3">
          <PresetIconPicker
            value={icons[focusKey] || (BRAND_PRESET_FILE[focusKey as BrandId] ? presetSrc(BRAND_PRESET_FILE[focusKey as BrandId]!) : "")}
            onPick={(src) => save(focusKey, src)}
          />
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
