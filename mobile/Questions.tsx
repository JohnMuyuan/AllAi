import { Check, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { useT } from "../components/I18n";
import { answerText } from "../lib/agent-answer";
import type { AgentAsk } from "./ui";

/**
 * Agent 向用户提问（Claude Code 的 AskUserQuestion）在手机上的卡片。
 *
 * 以前手机上完全看不到这个：AllAi 用非交互模式跑 CLI，没人能在终端里回答，
 * 而 trace 传到手机时 `ask` 被丢掉了 —— 结果就是 Agent 停在那儿等，
 * 你在手机上只看到一行「问用户」，**整条工作卡死，只能回电脑上答**（0.16.33 补的）。
 *
 * 回答不会显示成你的消息（那不是你打的字），和桌面一样：
 * 文字开头带 ANSWER_MARK，列表里把这条藏起来，只在卡片上写「你的选择」。
 * 拼装用 `lib/agent-answer.ts` 的 answerText，和桌面共用一份，免得两边文字对不上。
 */
export function Questions({
  asks,
  disabled,
  onAnswer,
}: {
  asks: AgentAsk[];
  disabled?: boolean;
  onAnswer: (text: string) => Promise<void> | void;
}) {
  const t = useT();
  const questions = asks.flatMap((ask) => ask.questions);
  const [picks, setPicks] = useState<string[][]>([]);
  const [others, setOthers] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!questions.length) return null;

  const locked = sent || busy || Boolean(disabled);
  const ready = questions.every(
    (_, index) => (picks[index]?.length ?? 0) > 0 || Boolean(others[index]?.trim()),
  );

  function toggle(index: number, label: string, multi: boolean) {
    if (locked) return;
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
    <div className="rounded-2xl border border-accent/30 bg-accent/6 p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
        <MessageCircleQuestion className="size-4 shrink-0" />
        {sent ? t("已回答") : t("Agent 想问你")}
      </div>
      {questions.map((question, index) => {
        const multi = Boolean(question.multiSelect);
        const chosen = picks[index] ?? [];
        return (
          <div key={`${question.question}-${index}`} className="mt-3">
            {question.header ? (
              <span className="mb-1 inline-block rounded-md bg-user px-1.5 py-px text-[11px] text-muted">
                {question.header}
              </span>
            ) : null}
            <p className="text-[14px] leading-6">{question.question}</p>
            <div className="mt-2 grid gap-1.5">
              {question.options.map((option) => {
                const on = chosen.includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={locked}
                    onClick={() => toggle(index, option.label, multi)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${
                      on ? "border-accent bg-accent text-accent-fg" : "border-line"
                    }`}
                  >
                    {on ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-5">{option.label}</span>
                      {option.description ? (
                        <span className={`block text-[12px] leading-5 ${on ? "opacity-80" : "text-muted"}`}>
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              value={others[index] ?? ""}
              disabled={locked}
              placeholder={t("其它…（自己写）")}
              onChange={(event) => {
                const value = event.target.value;
                setOthers((current) => questions.map((_, k) => (k === index ? value : current[k] ?? "")));
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-3 py-2 text-[14px] outline-none disabled:opacity-60"
            />
          </div>
        );
      })}
      <button
        type="button"
        disabled={locked || !ready}
        onClick={async () => {
          setBusy(true);
          try {
            await onAnswer(answerText(questions, picks, others));
            setSent(true);
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 w-full rounded-xl bg-accent py-2.5 text-[15px] font-medium text-accent-fg disabled:opacity-40"
      >
        {sent ? t("已发送") : busy ? t("发送中…") : t("发送回答")}
      </button>
    </div>
  );
}
