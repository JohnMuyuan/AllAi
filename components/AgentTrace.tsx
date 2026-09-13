"use client";

import {
  AlertTriangle,
  Braces,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileText,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { createElement, memo, useState } from "react";
import type { AgentTraceItem, FileDiff } from "@/lib/types";
import { Foldable } from "./Foldable";
import { useT } from "./I18n";

type Props = {
  items: AgentTraceItem[];
  streaming: boolean;
  hasContent: boolean;
};

/** 按 label 猜个图标。名字是主进程翻好的中文，这里只管好看。 */
function iconFor(label: string) {
  if (label.includes("命令") || label.includes("输出")) return Terminal;
  if (label.includes("读")) return FileText;
  if (label.includes("写")) return FilePlus;
  if (label.includes("改") || label.includes("删")) return FileEdit;
  if (label.includes("搜") || label.includes("找") || label.includes("目录")) return Search;
  if (label.includes("网页") || label.includes("联网")) return Globe;
  if (label.includes("计划")) return ListTodo;
  if (label.includes("子任务")) return Workflow;
  if (label.includes("问用户")) return MessageCircleQuestion;
  if (label.includes("压缩") || label.includes("上下文")) return Sparkles;
  return Braces;
}

export const AgentTrace = memo(function AgentTrace({ items, streaming, hasContent }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasError = items.some((item) => item.type === "tool" && item.name === "出错");
  const autoOpen = (streaming && !hasContent) || hasError;
  if (autoOpen && !open) setOpen(true);

  if (!items.length) return null;

  const thinking = items.filter((item) => item.type === "thinking");
  const tools = items.filter((item) => item.type === "tool");
  const hasThinking = thinking.some((item) => item.type === "thinking" && item.text.trim());

  // 标题要说实话：没有真的思考内容就别叫「思考过程」。
  // Claude Code 和 Codex 的会话记录里思考正文是空的（只留签名 / 加密），
  // 那一栏里其实全是工具调用。
  // 出错了标题就直说，别还叫「执行过程」。
  const summary = hasError
    ? t("执行出错 · {n} 步操作", { n: tools.length })
    : hasThinking
    ? tools.length
      ? t("思考过程 · {n} 步操作", { n: tools.length })
      : t("思考过程")
    : t("执行过程 · {n} 步操作", { n: tools.length });

  return (
    <div className={`trace mb-3 rounded-xl border border-line bg-elevated text-sm text-muted ${open ? "trace-open" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-left text-xs font-medium"
      >
        <ChevronRight className="trace-chevron size-3.5 shrink-0 transition-transform duration-150" />
        {hasThinking ? <Sparkles className="size-3.5 shrink-0 text-accent" /> : null}
        <span className="truncate">{summary}</span>
        {streaming ? <span className="ml-auto shrink-0 text-[10px]">{t("进行中…")}</span> : null}
      </button>
      {open ? (
      <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5">
        {items.map((item, index) =>
          item.type === "thinking" ? (
            item.text.trim() ? (
              <Foldable key={`t-${index}`} text={item.text}>
                {(shown) => (
                  <div className="whitespace-pre-wrap rounded-lg bg-canvas px-2.5 py-2 leading-6 text-ink/80">
                    {shown}
                  </div>
                )}
              </Foldable>
            ) : null
          ) : (
            <ToolRow key={`tool-${index}`} name={item.name} detail={item.detail} diff={item.diff} />
          ),
        )}
      </div>
      ) : null}
    </div>
  );
});

function ToolRow({ name, detail, diff }: { name: string; detail?: string; diff?: FileDiff[] }) {
  const t = useT();
  const bad = name === "出错";
  const icon = bad ? AlertTriangle : iconFor(name);
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {createElement(icon, {
        className: `size-3.5 shrink-0 translate-y-0.5 ${bad ? "text-danger" : "text-muted"}`,
      })}
      <span className={`shrink-0 text-[11px] font-medium ${bad ? "text-danger" : "text-ink"}`}>
        {t(name)}
      </span>
      {detail ? (
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${bad ? "text-danger" : "font-mono text-muted"}`}
          title={detail}
        >
          {detail}
        </span>
      ) : null}
      {diff?.length ? (
        <span className="shrink-0 font-mono text-[11px]">
          <span className="text-emerald-500">+{diff.reduce((sum, item) => sum + item.added, 0)}</span>{" "}
          <span className="text-danger">−{diff.reduce((sum, item) => sum + item.removed, 0)}</span>
        </span>
      ) : null}
    </div>
  );
}
