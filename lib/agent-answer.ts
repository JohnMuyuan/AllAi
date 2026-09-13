/**
 * 回答 Agent 提问（Claude Code 的 AskUserQuestion）时发给 CLI 的那条消息。
 *
 * AllAi 用非交互模式跑 CLI，回答只能作为下一条消息发过去，Agent 才能接着干活。
 * 但这句话不是用户自己打的，不能显示成用户的气泡 —— 和 Claude Code 终端里一样，
 * 回答只显示在提问卡片里（「你的选择：…」）。所以开头带一个固定标记：
 * 界面见到它就不画成用户消息，从 CLI 会话文件读回来的历史也一样认得出来。
 *
 * 纯函数，界面和手机同步都用。electron/remote.ts 引不到 lib/，那边有一份同样的常量，改这里要一起改。
 */
export const ANSWER_MARK = "〔AllAi：回答提问〕";

export function isAnswerMessage(text: string | undefined) {
  return Boolean(text && text.trimStart().startsWith(ANSWER_MARK));
}

/**
 * 把选择拼成发给 Agent 的回答：标记 + 每个问题一行「问题：选择」。
 * 桌面卡片和手机卡片必须拼出**一模一样**的文字，所以只留这一份。
 */
export function answerText(
  questions: { question: string }[],
  picks: string[][],
  others: string[] = [],
) {
  const lines = questions.map((question, index) => {
    const extra = others[index]?.trim();
    const chosen = [...(picks[index] ?? []), ...(extra ? [extra] : [])];
    return `${question.question}：${chosen.join("、")}`;
  });
  return [ANSWER_MARK, ...lines].join("\n");
}

/** 去掉标记，剩下「问题：选择」那几行。 */
export function answerBody(text: string) {
  return text.trimStart().slice(ANSWER_MARK.length).trim();
}
