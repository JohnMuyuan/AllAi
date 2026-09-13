"use client";

import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

/**
 * 替掉原生的 window.confirm —— 那个是 Windows 的系统弹窗，
 * 和这个软件的皮肤完全对不上，而且会冻住渲染进程。
 */
export type ConfirmOptions = {
  title: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

/** 在任意组件里 `const confirm = useConfirm()` 然后 `await confirm({...})`。 */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((options) => {
    setOpen(options);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setOpen(null);
    resolveRef.current?.(value);
    resolveRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 20);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <button
            type="button"
            aria-label={t("取消")}
            onClick={() => close(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="confirm-in relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl shadow-black/40"
          >
            <div className="flex gap-3 px-5 pb-4 pt-5">
              {open.danger ? (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger/12 text-danger">
                  <AlertTriangle className="size-4.5" />
                </span>
              ) : null}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-sm font-semibold leading-6">
                  {t(open.title)}
                </h2>
                {open.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-muted">
                    {t(open.detail)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-user hover:text-ink"
              >
                {t(open.cancelText || "取消")}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => close(true)}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium ${
                  open.danger
                    ? "bg-danger text-white hover:opacity-90"
                    : "bg-ink text-canvas hover:opacity-90"
                }`}
              >
                {t(open.confirmText || "确定")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
