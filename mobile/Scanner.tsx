import jsQR from "jsqr";
import { ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../components/I18n";

/**
 * 扫码配对。iPhone 的 Safari 没有 BarcodeDetector，所以用 jsQR 自己在画布上解。
 * 相机用不了（没权限、没摄像头）时，可以从相册选一张二维码截图。
 */

/** 只在触屏设备上给扫码入口；电脑浏览器上不显示。 */
export function canScan() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/** 缩到这个边长再解，手机后置摄像头原始画面太大，每帧都解会很卡。 */
const MAX_SIDE = 720;

function decode(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return jsQR(image.data, w, h, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const resultRef = useRef(onResult);
  const [supported] = useState(() => Boolean(navigator.mediaDevices?.getUserMedia));
  const [error, setError] = useState("");

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  const getCanvas = () => (canvas.current ??= document.createElement("canvas"));

  useEffect(() => {
    const el = video.current;
    if (!supported || !el) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(async (media) => {
        stream = media;
        if (!alive) return;
        el.srcObject = media;
        await el.play();
        const tick = () => {
          if (!alive || done.current) return;
          if (el.readyState >= 2 && el.videoWidth) {
            const text = decode(el, el.videoWidth, el.videoHeight, getCanvas());
            if (text) {
              done.current = true;
              resultRef.current(text);
              return;
            }
          }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "没有相机权限。到 iPhone「设置」里给 Safari（或这个 App）打开相机，或者点下面「从相册选图」。"
            : name === "NotFoundError"
              ? "没找到相机。可以点下面「从相册选图」。"
              : "打不开相机。可以点下面「从相册选图」。",
        );
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [supported]);

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const text = decode(bitmap, bitmap.width, bitmap.height, getCanvas());
      bitmap.close();
      if (text) {
        done.current = true;
        onResult(text);
      } else {
        setError("这张图里没找到二维码，换一张清楚点的试试。");
      }
    } catch {
      setError("读不了这张图片。");
    }
  }

  const message = error || (supported ? "" : "这个浏览器不能用相机。可以点下面「从相册选图」，选一张二维码截图。");
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="size-64 max-w-[75vw] rounded-3xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
      </div>
      <div className="safe-top relative flex justify-end p-3">
        <button
          type="button"
          aria-label={t("关闭扫码")}
          onClick={onClose}
          className="grid size-10 place-items-center rounded-full bg-white/15"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="safe-bottom relative mt-auto px-6 pb-8 text-center">
        <p className="text-sm text-white/90">{t("对准电脑上「设置 → 远程」里的配对二维码")}</p>
        {message ? <p className="mt-2 text-sm text-amber-300">{t(message)}</p> : null}
        <button
          type="button"
          onClick={() => picker.current?.click()}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm"
        >
          <ImageIcon className="size-4" />
          {t("从相册选图")}
        </button>
        <input
          ref={picker}
          data-scan-file
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void pickImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
