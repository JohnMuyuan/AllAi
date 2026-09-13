"use client";

import { Download, RotateCcw, Server, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bestPreset, presetSrc } from "@/lib/preset-icons";
import { PresetIconPicker } from "./PresetIconPicker";
import { useT } from "./I18n";

async function fetchSiteIcon(source: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/brand-icon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
    signal,
  });
  const data = (await response.json()) as { icon?: string; error?: string };
  if (!response.ok || !data.icon) throw new Error(data.error || "抓不到图标");
  return data.icon;
}

function looksLikeSite(source: string) {
  const raw = source.trim();
  if (!raw) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname);
  } catch {
    return false;
  }
}

type Props = {
  /** 这一条服务的 id。切到另一条时必须换，状态才不会串。 */
  ownerId: string;
  icon: string;
  onIcon: (icon: string) => void;
  autoSource?: string;
  auto?: boolean;
  onToast?: (text: string) => void;
};

/**
 * 给**这一条**服务配图标。父组件要用 `key={ownerId}` 挂载，
 * 切提供商时整棵拆掉，输入框和图标都不会带到下一家。
 */
export function ProviderIconField({
  ownerId,
  icon,
  onIcon,
  autoSource = "",
  auto = false,
  onToast,
}: Props) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fetchedFor = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, [ownerId]);

  useEffect(() => {
    if (!auto || icon) return;
    if (!looksLikeSite(autoSource)) return;
    if (fetchedFor.current === autoSource) return;
    const handle = window.setTimeout(() => {
      fetchedFor.current = autoSource;
      const hit = bestPreset(autoSource);
      if (hit) {
        onIcon(presetSrc(hit.file));
        return;
      }
      void grab(autoSource, true);
    }, 400);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟地址和图标走，grab 是稳定的对本条 owner 的闭包
  }, [auto, autoSource, icon, ownerId]);

  async function grab(source: string, silent = false) {
    if (!source.trim()) return;
    const hit = bestPreset(source);
    if (hit) {
      onIcon(presetSrc(hit.file));
      setDraft("");
      if (!silent) onToast?.(t("图标已保存"));
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const next = await fetchSiteIcon(source, ac.signal);
      if (!alive.current || ac.signal.aborted) return;
      onIcon(next);
      setDraft("");
      if (!silent) onToast?.(t("图标已保存"));
    } catch (error) {
      if (!alive.current || ac.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!silent) onToast?.(error instanceof Error ? t(error.message) : t("抓不到图标"));
    } finally {
      if (alive.current && abortRef.current === ac) setBusy(false);
    }
  }

  function onFile(file: File) {
    if (file.size > 360 * 1024) {
      onToast?.(t("图标不能超过 360KB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (alive.current) onIcon(String(reader.result || ""));
    };
    reader.onerror = () => onToast?.(t("读取图片失败"));
    reader.readAsDataURL(file);
  }

  return (
    <div className="mb-4">
      <span className="mb-1.5 block text-sm font-medium">{t("图标")}</span>
      <div className="flex items-center gap-2">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-canvas">
          {icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- 用户自己配的图标，可能是任意来源
            <img src={icon} alt="" aria-hidden="true" className="size-6 rounded-[4px] object-contain" />
          ) : (
            <Server className={`size-4 text-muted ${busy ? "opacity-40" : "opacity-60"}`} />
          )}
        </div>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text").trim();
            if (!text) return;
            window.setTimeout(() => void grab(text), 0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void grab(draft);
            }
          }}
          placeholder={t("图片网址或网站域名")}
          className="min-w-0 flex-1 rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void grab(draft || autoSource)}
          disabled={busy || !(draft.trim() || looksLikeSite(autoSource))}
          title={t("从网上抓取")}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink disabled:opacity-30"
        >
          <Download className={`size-3.5 ${busy ? "animate-pulse" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title={t("从本地选图片")}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
        >
          <Upload className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            fetchedFor.current = "";
            onIcon("");
          }}
          disabled={!icon}
          title={t("恢复默认")}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-danger disabled:opacity-30"
        >
          <RotateCcw className="size-3.5" />
        </button>
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
      </div>
      <span className="mt-1 block text-xs text-muted">
        {busy ? t("正在抓取图标…") : t("填接口地址后会自动抓网站图标，也可以自己上传或填网址。")}
      </span>
      <PresetIconPicker value={icon} onPick={onIcon} />
    </div>
  );
}
