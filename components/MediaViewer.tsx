"use client";

import { Copy, Download, ImagePlus, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatAttachment } from "@/lib/types";
import { useT, type Translate } from "./I18n";
import { VideoPlayer } from "./VideoPlayer";

export type StudioOutput = { id: string; mime: string; prompt?: string };

/** `t` 由调用方传进来：这个函数不在组件里，拿不到 hook。 */
export function uploadDragPayload(
  output: StudioOutput,
  t: Translate = (text) => text,
): ChatAttachment {
  const image = output.mime.startsWith("image/");
  return {
    id: output.id,
    name: image ? t("参考图.png") : t("参考视频.mp4"),
    mime: output.mime,
    kind: image ? "image" : output.mime.startsWith("video/") ? "video" : "file",
  };
}

export function MediaViewer({
  output,
  onClose,
  onUseReference,
  onToast,
}: {
  output: StudioOutput;
  onClose: () => void;
  onUseReference: (item: ChatAttachment) => void;
  onToast: (text: string) => void;
}) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const src = `/api/uploads/${output.id}`;
  const isVideo = output.mime.startsWith("video/");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={onClose}>
      <div className="flex items-center justify-end gap-1 px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {isVideo ? null : (
          <>
            <button
              type="button"
              aria-label={t("缩小")}
              onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
              className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("放大")}
              onClick={() => setScale((value) => Math.min(4, value + 0.25))}
              className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
            >
              <ZoomIn className="size-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void downloadOutput(output, (text) => onToast(t(text)))}
          className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
          aria-label={t("下载")}
        >
          <Download className="size-4" />
        </button>
        {isVideo ? null : (
          <button
            type="button"
            onClick={() => void copyOutput(output, (text) => onToast(t(text)))}
            className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
            aria-label={t("复制图片")}
          >
            <Copy className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!output.mime.startsWith("image/")) {
              onToast(t("请用图片作参考"));
              return;
            }
            onUseReference(uploadDragPayload(output, t));
            onClose();
          }}
          className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
          aria-label={t("用作参考")}
        >
          <ImagePlus className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"
          aria-label={t("关闭")}
        >
          <X className="size-4" />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
        onClick={(event) => event.stopPropagation()}
        onWheel={
          isVideo
            ? undefined
            : (event) => {
                event.preventDefault();
                setScale((value) =>
                  Math.min(4, Math.max(0.5, value + (event.deltaY < 0 ? 0.15 : -0.15))),
                );
              }
        }
      >
        {isVideo ? (
          <VideoPlayer src={src} autoPlay className="max-h-full max-w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={output.prompt || ""}
            style={{ transform: `scale(${scale})` }}
            className="max-h-full max-w-full origin-center rounded-xl transition-transform"
          />
        )}
      </div>
    </div>
  );
}

export async function downloadOutput(output: StudioOutput, onToast: (text: string) => void) {
  try {
    const response = await fetch(`/api/uploads/${output.id}`);
    if (!response.ok) throw new Error("下载失败");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = output.mime.startsWith("video/") ? "allai-video.mp4" : "allai-image.png";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    onToast(error instanceof Error ? error.message : "下载失败");
  }
}

export async function copyOutput(output: StudioOutput, onToast: (text: string) => void) {
  try {
    const response = await fetch(`/api/uploads/${output.id}`);
    if (!response.ok) throw new Error("复制失败");
    const blob = await response.blob();
    const type = blob.type || output.mime || "image/png";
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    onToast("已复制图片");
  } catch (error) {
    onToast(error instanceof Error ? error.message : "复制失败");
  }
}
