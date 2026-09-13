/**
 * 「接续到新对话」发给 CLI 的那条整理请求。
 *
 * 它是这条工作里**真实的一轮**（约定 63：摘要由这条工作正在用的模型写，续同一个会话），
 * 所以它一定会落进 CLI 自己的会话文件。但它不是用户打的字，也不是这段工作的内容：
 *
 * - 界面和手机上都不画成用户消息（和 [[ANSWER_MARK]] 一个道理）；
 * - **换会话重放历史时要整轮丢掉** —— 不丢的话，这条工作以后每开一条新会话，
 *   「请写一份交接摘要…」都会被原样重放进去，看着就像凭空跑到别的 Agent 对话里了，
 *   而且模型真有可能照着它再写一份摘要（0.16.22 修的）。
 *
 * 纯函数，界面、服务端和手机同步都用。electron/remote.ts 引不到 lib/，
 * 那边有一份同样的常量，改这里要一起改。
 */
export const HANDOFF_MARK = "〔AllAi：生成交接摘要〕";

export function isHandoffPrompt(text: string | undefined) {
  return Boolean(text && text.trimStart().startsWith(HANDOFF_MARK));
}

/**
 * 把整理请求连同它的回答一起摘掉。
 *
 * 回答（摘要本身）也要丢：它已经原样交给新对话了，再随历史重放一遍是纯噪音，
 * 还会让模型以为「刚才不是已经总结过了吗」。
 */
export function stripHandoffTurns<T extends { role: string; content: string }>(messages: T[]): T[] {
  const out: T[] = [];
  let dropReply = false;
  for (const message of messages) {
    if (message.role === "user" && isHandoffPrompt(message.content)) {
      dropReply = true;
      continue;
    }
    if (dropReply && message.role === "assistant") {
      dropReply = false;
      continue;
    }
    if (message.role === "user") dropReply = false;
    out.push(message);
  }
  return out;
}
