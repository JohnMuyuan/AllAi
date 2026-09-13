"use client";

import { Check, MonitorCog, Square, X } from "lucide-react";
import { describeAction, type ComputerOp } from "@/lib/computer-use";
import { useT } from "./I18n";

/**
 * 「操控电脑」进行中的那条横幅：显示在输入框正上方。
 *
 * 按产品约定 22，动作确认不弹窗 —— 弹窗会挡住屏幕，而这个功能恰恰要用户看着屏幕
 * 判断该不该点头。做成一条不遮挡的横幅。
 */
export function ActionBar({
  busy,
  pending,
  onConfirm,
  onReject,
  onStop,
}: {
  busy: boolean;
  pending: ComputerOp | null;
  onConfirm: () => void;
  onReject: () => void;
  onStop: () => void;
}) {
  const t = useT();
  if (!busy && !pending) return null;

  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-line bg-elevated px-3 py-2 text-[13px] md:px-4">
      <MonitorCog className={`size-4 shrink-0 ${pending ? "text-amber-500" : "text-accent"}`} />
      {pending ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="text-muted">{t("关键操作：")}</span>
            <span className="font-medium">{describeAction(pending)}</span>
            {pending.reason ? (
              <span className="ml-2 text-amber-500">{pending.reason}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onReject}
            className="shrink-0 rounded-lg px-2.5 py-1 text-muted hover:bg-user hover:text-ink"
          >
            <X className="mr-1 inline size-3.5" />
            {t("换一个")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="shrink-0 rounded-lg bg-ink px-3 py-1 font-medium text-canvas hover:opacity-90"
          >
            <Check className="mr-1 inline size-3.5" />
            {t("执行")}
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-muted">
            {t("正在绑定目标窗口并连续执行…你可以随时停止。")}
          </span>
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 hover:bg-user"
          >
            <Square className="mr-1 inline size-3 fill-current" />
            {t("停止")}
          </button>
        </>
      )}
    </div>
  );
}
