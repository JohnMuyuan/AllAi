"use client";

import { Download, RotateCcw, Server, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

async function fetchSiteIcon(source: string): Promise<string> {
  const response = await fetch("/api/brand-icon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
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
  /** 当前图标，data URI。空字符串表示还没配。 */
  icon: string;
  onIcon: (icon: string) => void;
  /** 接口地址。auto 打开且还没配图标时，用它去抓网站图标。 */
  autoSource?: string;
  auto?: boolean;
  onToast?: (text: string) => void;
};

/**
 * 给某一个服务 / 接口配图标。
 *
 * 用在「添加服务」和每条接口自己的设置里：第一次填地址会自动抓网站图标，
 * 之后可以改网址再抓，或从本地选一张图。
 */
export function ProviderIconField({ icon, onIcon, autoSource = "", auto = false, onToast }: Props) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fetchedFor = useRef("");
  const generation = useRef(0);

  useEffect(() => {
    if (!auto || icon || busy) return;
    if (!looksLikeSite(autoSource)) return;
    if (fetchedFor.current === autoSource) return;
    const handle = window.setTimeout(() => {
      fetchedFor.current = autoSource;
      void grab(autoSource, true);
    }, 500);
    return () => window.clearTimeout(handle);
    // busy / grab 不能进 deps：抓的过程里 busy 会变，不该取消这次自动抓。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在地址或是否已有图标变化时再考虑自动抓
  }, [auto, autoSource, icon]);

  async function grab(source: string, silent = false) {
    if (!source.trim()) return;
    const mine = ++generation.current;
    setBusy(true);
    try {
      const next = await fetchSiteIcon(source);
      if (mine !== generation.current) return;
      onIcon(next);
      setDraft("");
      if (!silent) onToast?.(t("图标已保存"));
    } catch (error) {
      if (mine !== generation.current) return;
      if (!silent) onToast?.(error instanceof Error ? t(error.message) : t("抓不到图标"));
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  }

  function onFile(file: File) {
    if (file.size > 360 * 1024) {
      onToast?.(t("图标不能超过 360KB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onIcon(String(reader.result || ""));
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
    </div>
  );
}
