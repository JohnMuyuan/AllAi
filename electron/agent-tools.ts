/**
 * 把各家 Agent 的工具调用翻成人能看懂的一行。
 *
 * 放在 electron/ 是因为这个 tsconfig 用 rootDir:"."，引不到 lib/。
 * 解析在主进程做，界面只负责显示已经翻好的字。
 *
 * 以前直接把工具的 input 原样 JSON.stringify 塞进「思考过程」，于是：
 * - Claude 那栏全是 {"command":"...","description":"..."}；
 * - Codex 全是 name="exec"（真正的命令埋在 input 里）。
 * 两个都不是思考，是执行记录。
 */

export type ToolKind =
  | "command"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "web"
  | "task"
  | "todo"
  | "ask"
  | "mcp"
  | "other";

export type ToolInfo = { kind: ToolKind; label: string; detail: string };

/** Agent 向用户提的问题（Claude Code 的 AskUserQuestion）。lib/types.ts 里有同样的 AgentAsk。 */
export type AskPayload = {
  questions: {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: { label: string; description?: string }[];
  }[];
};

/**
 * 认出「问用户」的工具调用，取出问题和选项；不是就返回 undefined。
 * 输入形如 { questions: [{ question, header, multiSelect, options: [{ label, description }] }] }。
 */
export function askFromInput(name: string, input: unknown): AskPayload | undefined {
  const key = (name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!["askuserquestion", "askuser", "requestuserinput"].includes(key)) return undefined;
  let fields: unknown = input;
  if (typeof input === "string") {
    try {
      fields = JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  const raw = fields && typeof fields === "object" ? (fields as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(raw)) return undefined;
  const questions: AskPayload["questions"] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const question = typeof item.question === "string" ? item.question.trim() : "";
    if (!question) continue;
    const options = Array.isArray(item.options)
      ? item.options.flatMap((option) => {
          if (!option || typeof option !== "object") return [];
          const rec = option as Record<string, unknown>;
          const label = typeof rec.label === "string" ? rec.label.trim() : "";
          if (!label) return [];
          return [{ label, description: typeof rec.description === "string" ? rec.description : undefined }];
        })
      : [];
    questions.push({
      question,
      header: typeof item.header === "string" ? item.header : undefined,
      multiSelect: item.multiSelect === true,
      options,
    });
  }
  return questions.length ? { questions } : undefined;
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(" ");
  return "";
}

function firstString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(input[key]).trim();
    if (value) return value;
  }
  return "";
}

/** 只留文件名和上一层目录，绝对路径太长了。 */
function shortPath(value: string): string {
  const cleaned = value.replace(/^file:\/\/\/?/i, "").replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= 2) return cleaned;
  return parts.slice(-2).join("/");
}

function oneLine(value: string, max = 120): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Codex 的 exec 工具把真命令埋在 `text(await tools.exec_command({cmd:"…"}))` 里。 */
function unwrapCodexExec(raw: string): string {
  const hit = raw.match(/exec_command\(\s*\{[\s\S]*?cmd\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (hit) return hit[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\");
  const alt = raw.match(/"(?:cmd|command)"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (alt) return alt[1].replace(/\\"/g, '"');
  return raw;
}

const NAME_MAP: Record<string, { kind: ToolKind; label: string }> = {
  bash: { kind: "command", label: "运行命令" },
  powershell: { kind: "command", label: "运行命令" },
  shell: { kind: "command", label: "运行命令" },
  exec: { kind: "command", label: "运行命令" },
  exec_command: { kind: "command", label: "运行命令" },
  run_terminal_cmd: { kind: "command", label: "运行命令" },
  命令: { kind: "command", label: "运行命令" },
  read: { kind: "read", label: "读文件" },
  readfile: { kind: "read", label: "读文件" },
  view: { kind: "read", label: "读文件" },
  cat: { kind: "read", label: "读文件" },
  notebookread: { kind: "read", label: "读笔记本" },
  write: { kind: "write", label: "写文件" },
  create: { kind: "write", label: "写文件" },
  改文件: { kind: "edit", label: "改文件" },
  edit: { kind: "edit", label: "改文件" },
  multiedit: { kind: "edit", label: "改文件" },
  str_replace: { kind: "edit", label: "改文件" },
  apply_patch: { kind: "edit", label: "改文件" },
  notebookedit: { kind: "edit", label: "改笔记本" },
  glob: { kind: "search", label: "找文件" },
  grep: { kind: "search", label: "搜代码" },
  search: { kind: "search", label: "搜索" },
  codebase_search: { kind: "search", label: "搜代码" },
  webfetch: { kind: "web", label: "打开网页" },
  websearch: { kind: "web", label: "联网搜索" },
  web_search: { kind: "web", label: "联网搜索" },
  "web.search": { kind: "web", label: "联网搜索" },
  websearchtool: { kind: "web", label: "联网搜索" },
  fetch: { kind: "web", label: "打开网页" },
  task: { kind: "task", label: "子任务" },
  agent: { kind: "task", label: "子任务" },
  todowrite: { kind: "todo", label: "更新计划" },
  update_plan: { kind: "todo", label: "更新计划" },
  askuserquestion: { kind: "ask", label: "问用户" },
  // Grok Build 的工具名
  read_file: { kind: "read", label: "读文件" },
  list_dir: { kind: "search", label: "看目录" },
  run_terminal_command: { kind: "command", label: "运行命令" },
  get_command_or_subagent_output: { kind: "command", label: "取命令输出" },
  search_replace: { kind: "edit", label: "改文件" },
  web_fetch: { kind: "web", label: "打开网页" },
  todo_write: { kind: "todo", label: "更新计划" },
  create_file: { kind: "write", label: "写文件" },
  delete_file: { kind: "edit", label: "删文件" },
};

/**
 * name 是工具名，input 是它的参数（对象或已经序列化的字符串）。
 * 返回给界面直接显示的一行。
 */
export function describeTool(name: string, input?: unknown): ToolInfo {
  // Grok 的 title 长这样 "Web search:"，把尾巴上的冒号去掉再查表。
  const raw = (name || "").trim().replace(/[:：]\s*$/, "");
  const key = raw.toLowerCase().replace(/^mcp__/, "").replace(/\s+/g, "");
  const mapped = NAME_MAP[key];

  let fields: Record<string, unknown> = {};
  let text = "";
  if (typeof input === "string") {
    text = input;
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object") fields = parsed as Record<string, unknown>;
    } catch {
      // 不是 JSON 就当纯文本
    }
  } else if (input && typeof input === "object") {
    fields = input as Record<string, unknown>;
  }

  // MCP 工具名长这样：mcp__server__tool
  if (raw.startsWith("mcp__") || key.includes("__")) {
    const parts = raw.replace(/^mcp__/, "").split("__");
    return {
      kind: "mcp",
      label: parts[parts.length - 1] || raw,
      detail: oneLine(firstString(fields, ["title", "query", "code", "description"]) || ""),
    };
  }

  const kind = mapped?.kind ?? "other";
  const label = mapped?.label ?? (raw || "工具");

  if (kind === "command") {
    const command =
      firstString(fields, ["command", "cmd", "script"]) ||
      (text ? unwrapCodexExec(text) : "");
    return { kind, label, detail: oneLine(command) };
  }
  if (kind === "read" || kind === "write" || kind === "edit") {
    const file = firstString(fields, [
      "file_path",
      "path",
      "filePath",
      "notebook_path",
      "file",
      "target_file",
      "target_directory",
    ]);
    return { kind, label, detail: file ? shortPath(file) : oneLine(text) };
  }
  if (kind === "search") {
    const pattern = firstString(fields, ["pattern", "query", "glob", "q"]);
    const where = firstString(fields, ["path", "dir", "target_directory", "target_file"]);
    return {
      kind,
      label,
      detail: oneLine([pattern, where ? `于 ${shortPath(where)}` : ""].filter(Boolean).join(" ")),
    };
  }
  if (kind === "web") {
    return { kind, label, detail: oneLine(firstString(fields, ["url", "query", "prompt", "q"])) };
  }
  if (kind === "task") {
    return {
      kind,
      label,
      detail: oneLine(firstString(fields, ["description", "prompt", "subagent_type"])),
    };
  }
  if (kind === "todo") {
    return { kind, label, detail: "" };
  }
  if (kind === "ask") {
    // 执行过程里那一行显示第一个问题，完整的问题和选项在回复下面的提问卡片里。
    const ask = askFromInput(raw, fields);
    return { kind, label, detail: ask ? oneLine(ask.questions[0].question) : "" };
  }

  return {
    kind: "other",
    label,
    detail: oneLine(
      firstString(fields, ["description", "title", "query", "command", "path", "prompt"]) ||
        (text && text.length < 160 ? text : ""),
    ),
  };
}
