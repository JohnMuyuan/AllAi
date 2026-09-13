import type { AgentKind } from "./types";

/**
 * 在官方终端里接着这条会话的命令。
 * 语法按各家 CLI 的 --help 核对过（0.6.0）：
 *   grok  --resume <id>       （`-r` 是别名，值可以是 id 或标题）
 *   codex resume <id>         （子命令，不是选项）
 *   claude --resume <id>      （`-r` 是别名）
 */
export function resumeCommand(kind: AgentKind, cliSessionId: string): string {
  const id = cliSessionId.trim();
  if (!id) return "";
  if (kind === "grok-build") return `grok --resume ${id}`;
  if (kind === "codex") return `codex resume ${id}`;
  if (kind === "claude-code") return `claude --resume ${id}`;
  return "";
}

/** 这条会话是不是能拿去终端里续 —— 我们自己新建、还没跑过的就不行。 */
export function canResume(work: {
  kind: AgentKind;
  cliSessionId: string;
  source: string;
}): boolean {
  if (!work.cliSessionId || work.source === "new") return false;
  // live- 开头的是我们临时编的号，不是 CLI 认的会话。
  if (work.cliSessionId.startsWith("live-")) return false;
  return Boolean(resumeCommand(work.kind, work.cliSessionId));
}
