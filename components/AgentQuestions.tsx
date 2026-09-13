"use client";

import { Check, MessageCircleQuestion } from "lucide-react";
import { memo, useState } from "react";
import { answerText } from "@/lib/agent-answer";
import type { AgentAsk } from "@/lib/types";
import { useT } from "./I18n";

/**
 * Agent 向用户提问（Claude Code 的 AskUserQuestion）。
 *
 * AllAi 用非交互模式跑 CLI，没人能在终端里回答，所以把问题画成卡片：
 * 选好（多选题可以勾多个，也可以自己写「其它」）点「发送回答」，回答发给 Agent，它接着原来的会话干活。
 * 回答**不显示成你的消息**（那不是你打的字）：开头带 ANSWER_MARK，列表里不画这条，
 * 只在卡片里写「你的选择：…」—— 和 Claude Code 终端里一样（0.16.13）。
 */

export const AgentQuestions = memo(function AgentQuestions({
  asks,
  answered,
  moved,
  disabled,
  onAnswer,
}: {
  asks: AgentAsk[];
  /** 通过卡片回答过的内容（去掉标记后的「问题：选择」几行）。 */
  answered?: string;
  /** 没点卡片，自己发了别的消息继续了。 */
  moved?: boolean;
  disabled?: boolean;
  onAnswer?: (text: string) => void;
}) {
  const t = useT();
  const questions = asks.flatMap((ask) => ask.questions);
  const [picks, setPicks] = useState<string[][]>([]);
  const [others, setOthers] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  if (!questions.length) return null;

  const done = Boolean(answered) || Boolean(moved) || sent;
  const locked = done || Boolean(disabled) || !onAnswer;
  const ready = questions.every((_, index) => (picks[index]?.length ?? 0) > 0 || Boolean(others[index]?.trim()));

  function toggle(index: number, label: string, multi: boolean) {
    setPicks((current) =>
      questions.map((_, k) => {
        const list = current[k] ?? [];
        if (k !== index) return list;
        if (!multi) return [label];
        return list.includes(label) ? list.filter((item) => item !== label) : [...list, label];
      }),
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-accent/40 bg-elevated p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-accent">
        <MessageCircleQuestion className="size-3.5" />
        {answered || sent ? t("已回答") : moved ? t("已继续") : t("Agent 在问你")}
      </div>
      <div className="flex flex-col gap-3">
        {questions.map((question, index) => (
          <div key={index}>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {question.header ? (
                <span className="rounded-md bg-user px-1.5 py-0.5 text-[11px] text-muted">{question.header}</span>
              ) : null}
              <span className="text-sm font-medium text-ink">{question.question}</span>
              {question.multiSelect ? <span className="text-[11px] text-muted">{t("（可多选）")}</span> : null}
            </div>
            <div className="grid gap-1.5">
              {question.options.map((option) => {
                const on = picks[index]?.includes(option.label) ?? false;
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={locked}
                    aria-pressed={on}
                    onClick={() => toggle(index, option.label, Boolean(question.multiSelect))}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left disabled:cursor-default ${
                      on ? "border-accent bg-accent/10" : "border-line hover:bg-user/60"
                    } ${locked && !on ? "opacity-60" : ""}`}
                  >
                    <span
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center border ${
                        question.multiSelect ? "rounded-md" : "rounded-full"
                      } ${on ? "border-accent bg-accent text-accent-fg" : "border-line"}`}
                    >
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{option.label}</span>
                      {option.description ? (
                        <span className="block text-xs leading-5 text-muted">{option.description}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {!locked ? (
                <input
                  value={others[index] ?? ""}
                  onChange={(event) =>
                    setOthers(questions.map((_, k) => (k === index ? event.target.value : others[k] ?? "")))
                  }
                  placeholder={t("其它（自己写）")}
                  className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {done ? (
        answered ? (
          <p className="mt-2 text-xs leading-5 text-muted">
            {t("你的选择：")}
            {answered
              .split("\n")
              .map((line) => line.slice(line.lastIndexOf("：") + 1).trim())
              .filter(Boolean)
              .join("；")}
          </p>
        ) : null
      ) : (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!ready || locked}
            onClick={() => {
              setSent(true);
              onAnswer?.(answerText(questions, picks, others));
            }}
            className="rounded-xl bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
          >
            {t("发送回答")}
          </button>
        </div>
      )}
    </div>
  );
});
