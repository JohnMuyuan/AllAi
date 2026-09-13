"use client";

import { memo, useEffect, useState } from "react";
import { Check, GitBranchPlus, LoaderCircle, Square, TriangleAlert, X } from "lucide-react";
import { useT } from "./I18n";

/**
 * 「接续到新对话」的进度面板。
 *
 * 为什么单独一个组件、而且由 ChatApp 在最外层渲染：这件事要跑几十秒到几分钟，
 * 期间用户会去看别的工作、切到聊天页。面板挂在 AgentWorkspace 里的话，一切走就卸载了
 * （0.16.15 的写法），关掉之后也再没有入口回来。
 *
 * 面板只是**看**，关掉不影响后台那一轮 —— 停止只有面板里这一个按钮。
 */

export type HandoffPhase = "准备" | "生成摘要" | "已完成" | "已停止" | "出错";

export type HandoffState = {
  open: boolean;
  running: boolean;
  /** 正在写摘要的那条旧工作的 id，事件按它筛。 */
  sessionId: string | null;
  workTitle: string;
  model: string;
  phase: HandoffPhase;
  /** 执行到哪一步：模型自己报的工具调用和思考，最新的在最后。 */
  steps: { id: number; text: string }[];
  /** 摘要正文已经写了多少字，用来说明「确实在写」。 */
  chars: number;
  startedAt: number;
  error?: string;
  /** 写完之后开出来的新工作，面板里直接能跳过去。 */
  newWorkId?: string;
};

export const emptyHandoff = (): HandoffState => ({
  open: false,
  running: false,
  sessionId: null,
  workTitle: "",
  model: "",
  phase: "准备",
  steps: [],
  chars: 0,
  startedAt: 0,
});

function elapsedSeconds(startedAt: number) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export const HandoffPanel = memo(function HandoffPanel({
  state,
  onClose,
  onStop,
  onOpenNewWork,
}: {
  state: HandoffState;
  onClose: () => void;
  onStop: () => void;
  onOpenNewWork: (id: string) => void;
}) {
  const t = useT();
  // 「已运行 N 秒」得自己走。这一轮是静默跑的，界面上没有别的东西在变，
  // 不自己 tick 的话这个数字会一直停在打开面板的那一秒（0.16.15 的 BUG）。
  const [, tick] = useState(0);
  const running = state.running;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!state.open) return null;

  const done = state.phase === "已完成";
  const failed = state.phase === "出错" || state.phase === "已停止";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t("接续到新对话的进度")}
        className="w-full max-w-md rounded-2xl border border-line bg-elevated p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${
              failed ? "bg-danger/12 text-danger" : done ? "bg-emerald-500/12 text-emerald-500" : "bg-accent/12 text-accent"
            }`}
          >
            {failed ? (
              <TriangleAlert className="size-5" />
            ) : done ? (
              <Check className="size-5" />
            ) : (
              <GitBranchPlus className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {done ? t("接续完成") : failed ? t(state.phase) : t("正在接续到新对话")}
            </div>
            <div className="mt-1 truncate text-xs text-muted">
              {running ? t("后台运行中，关掉这个面板不会停") : t("来自《{title}》", { title: state.workTitle || t("上一条工作") })}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("关闭")}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-2.5 rounded-xl bg-user/50 p-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-muted">{t("当前工作")}</span>
            <span className="truncate font-medium">{state.workTitle || "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-muted">{t("当前模型")}</span>
            <span className="truncate font-medium">{state.model || t("默认型号")}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-muted">{t("当前阶段")}</span>
            <span className="font-medium">{t(state.phase)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-muted">{t("已写摘要")}</span>
            <span className="font-medium">{state.chars ? t("{n} 字", { n: state.chars }) : t("还没开始写")}</span>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 text-xs text-muted">{t("执行到哪一步")}</div>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-line p-2.5 text-xs leading-5">
            {state.steps.length ? (
              state.steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`flex gap-2 ${index === state.steps.length - 1 ? "text-ink" : "text-muted"}`}
                >
                  <span className="shrink-0 opacity-60">{index + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">{step.text}</span>
                </div>
              ))
            ) : (
              <div className="text-muted">{running ? t("已经发给模型，等它开口…") : t("这一轮没有留下步骤")}</div>
            )}
          </div>
        </div>

        {state.error ? (
          <div className="mt-3 rounded-xl border border-danger/30 bg-danger/8 p-2.5 text-xs leading-5 text-danger">
            {state.error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>{t("已运行 {time}", { time: (() => {
            const seconds = elapsedSeconds(state.startedAt);
            if (seconds < 60) return t("{n} 秒", { n: seconds });
            return t("{m} 分 {s} 秒", { m: Math.floor(seconds / 60), s: String(seconds % 60).padStart(2, "0") });
          })() })}</span>
          {running ? <LoaderCircle className="size-4 animate-spin text-accent" /> : null}
        </div>

        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 py-2.5 text-sm text-danger hover:bg-danger/8"
          >
            <Square className="size-3.5 fill-current" />
            {t("停止接续")}
          </button>
        ) : state.newWorkId ? (
          <button
            type="button"
            onClick={() => onOpenNewWork(state.newWorkId!)}
            className="mt-3 w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            {t("打开新对话")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-xl border border-line py-2.5 text-sm hover:bg-user"
          >
            {t("知道了")}
          </button>
        )}
      </div>
    </div>
  );
});
