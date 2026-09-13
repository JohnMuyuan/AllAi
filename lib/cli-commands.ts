import type { AgentKind } from "./types";

/**
 * 各家 CLI 的斜杠指令并不完全一样。用户在 AllAi 里打 /compact、/状态，
 * 这里翻成当前 Agent 真正认识的那一句，整段当作 prompt 交给 CLI（不要再拼 Skills / 历史）。
 */

type Cmd = { name: string; args: string };

const ALIASES: Record<string, string> = {
  compact: "compact",
  压缩: "compact",
  clear: "clear",
  清空: "clear",
  清除: "clear",
  new: "clear",
  status: "status",
  context: "status",
  状态: "status",
  cost: "cost",
  usage: "cost",
  用量: "cost",
  help: "help",
  帮助: "help",
  model: "model",
  模型: "model",
  plan: "plan",
  diff: "diff",
  memory: "memory",
  "compact-mode": "compact-mode",
  compactmode: "compact-mode",
};

export function parseSlashCommand(text: string): Cmd | null {
  const raw = text.trim();
  const match = raw.match(/^[/／]([\w\u4e00-\u9fff-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const key = match[1].toLowerCase();
  return { name: ALIASES[key] || key, args: (match[2] || "").trim() };
}

export function isCliSlashCommand(text: string) {
  return Boolean(parseSlashCommand(text));
}

type Writer = (args: string) => string;

const MAP: Record<string, Partial<Record<AgentKind, Writer>>> = {
  compact: {
    "claude-code": (args) => (args ? `/compact ${args}` : "/compact"),
    "grok-build": (args) => (args ? `/compact ${args}` : "/compact"),
    codex: () => "/compact",
  },
  clear: {
    "claude-code": () => "/clear",
    "grok-build": () => "/clear",
    codex: () => "/new",
  },
  status: {
    "claude-code": () => "/context",
    "grok-build": () => "/session-info",
    codex: () => "/status",
  },
  cost: {
    "claude-code": () => "/cost",
    "grok-build": () => "/usage",
    codex: () => "/status",
  },
  help: {
    "claude-code": () => "/help",
    "grok-build": () => "/help",
    codex: () => "/help",
  },
  model: {
    "claude-code": (args) => (args ? `/model ${args}` : "/model"),
    "grok-build": (args) => (args ? `/model ${args}` : "/model"),
    codex: (args) => (args ? `/model ${args}` : "/model"),
  },
  plan: {
    "claude-code": () => "/plan",
  },
  diff: {
    codex: () => "/diff",
  },
  memory: {
    "claude-code": () => "/memory",
  },
  "compact-mode": {
    "grok-build": (args) => (args ? `/compact-mode ${args}` : "/compact-mode"),
  },
};

export function adaptCliCommand(
  kind: AgentKind,
  text: string,
): { prompt: string; command: boolean } {
  const parsed = parseSlashCommand(text);
  if (!parsed || kind === "custom") return { prompt: text.trim(), command: false };
  const write = MAP[parsed.name]?.[kind];
  if (write) return { prompt: write(parsed.args), command: true };
  const prompt = parsed.args ? `/${parsed.name} ${parsed.args}` : `/${parsed.name}`;
  return { prompt, command: true };
}

/** 输入框弹出列表用：中文名 + 用法，insert 是这家 CLI 真正认识的那一句。 */
export type SlashCommandHint = {
  name: string;
  insert: string;
  title: string;
  usage: string;
  aliases: string[];
  needsArgs: boolean;
};

type Meta = {
  title: string;
  usage: string;
  aliases: string[];
  needsArgs?: boolean | Partial<Record<AgentKind, boolean>>;
};

const META: Record<string, Meta> = {
  compact: {
    title: "压缩对话",
    usage: "把前面说的浓缩一下，腾出空间继续聊。可在后面加一句你想保留什么。",
    aliases: ["压缩"],
    needsArgs: { "claude-code": true, "grok-build": true, codex: false },
  },
  clear: {
    title: "清空重来",
    usage: "丢掉当前记忆，从头开始。发给 Agent 就会执行。",
    aliases: ["清空", "清除", "new"],
  },
  status: {
    title: "看占用",
    usage: "显示这段对话用了多少上下文。发给 Agent 就会执行。",
    aliases: ["状态", "context"],
  },
  cost: {
    title: "看用量",
    usage: "显示这一轮花了多少。发给 Agent 就会执行。",
    aliases: ["用量", "usage"],
  },
  help: {
    title: "列出指令",
    usage: "让 Agent 自己说它还认识哪些指令。发给 Agent 就会执行。",
    aliases: ["帮助"],
  },
  model: {
    title: "换模型",
    usage: "后面跟型号，例如 /model opus。不写型号会列出可选的。",
    aliases: ["模型"],
    needsArgs: true,
  },
  plan: {
    title: "先出方案",
    usage: "进入计划模式：先想清楚再改代码。发给 Agent 就会执行。",
    aliases: [],
  },
  diff: {
    title: "看改动",
    usage: "显示这一轮改了哪些文件。发给 Agent 就会执行。",
    aliases: [],
  },
  memory: {
    title: "长期记忆",
    usage: "查看或修改这个项目里记住的约定。发给 Agent 就会执行。",
    aliases: [],
  },
  "compact-mode": {
    title: "压缩方式",
    usage: "后面跟 auto 或 manual，例如 /compact-mode auto。",
    aliases: ["compactmode"],
    needsArgs: true,
  },
};

export function slashCommandCatalog(kind: AgentKind): SlashCommandHint[] {
  if (kind === "custom") return [];
  const out: SlashCommandHint[] = [];
  for (const [name, meta] of Object.entries(META)) {
    const write = MAP[name]?.[kind];
    if (!write) continue;
    const insert = write("");
    if (out.some((item) => item.insert === insert)) continue;
    const needsArgs =
      typeof meta.needsArgs === "boolean" ? meta.needsArgs : Boolean(meta.needsArgs?.[kind]);
    out.push({
      name,
      insert,
      title: meta.title,
      usage: kind === "codex" && name === "compact" ? "把前面说的浓缩一下，腾出空间继续聊。" : meta.usage,
      aliases: meta.aliases,
      needsArgs,
    });
  }
  return out;
}

/** 整段还停在「/指令」这一截（没有空格）时，返回要显示的列表；否则不弹。 */
export function matchSlashCommands(kind: AgentKind, text: string): SlashCommandHint[] | null {
  if (kind === "custom") return null;
  if (!/^[/／][^\s]*$/.test(text)) return null;
  const needle = text.slice(1).toLowerCase();
  const catalog = slashCommandCatalog(kind);
  if (!needle) return catalog;
  const hits = catalog.filter((item) => {
    const insert = item.insert.slice(1).toLowerCase();
    if (insert.startsWith(needle) || item.name.toLowerCase().startsWith(needle)) return true;
    if (item.title.includes(needle)) return true;
    return item.aliases.some((alias) => alias.toLowerCase().startsWith(needle));
  });
  return hits;
}

export function nativeCompactPrompt(kind: AgentKind) {
  return adaptCliCommand(kind, "/compact 保留任务目标、已定结论、文件路径和下一步").prompt;
}

export function supportsNativeCompact(kind: AgentKind) {
  return kind === "claude-code" || kind === "grok-build" || kind === "codex";
}
