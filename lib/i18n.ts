/**
 * 界面语言。
 *
 * **用中文原文当 key**，不另编 `settings.general.title` 那种编号：
 * - 代码里读着就是最终文案，不用来回翻词典；
 * - 还没翻的自动回落中文，界面不会出现空白或 `missing.key`；
 * - 原文改了就是新 key，漏翻会直接看见，不会悄悄显示旧译文。
 *
 * 带变量的写成 `{name}`，调用时 `t("已同步 {n} 个模型", { n })`。
 *
 * ⚠️ **只翻给人看的文案。** 这些绝对不能进词典，翻了会直接弄坏功能：
 * 协议标记（`ANSWER_MARK` / `HANDOFF_MARK`，桌面和手机要逐字一致）、
 * 斜杠指令的中文别名（`lib/cli-commands.ts` 里 `压缩`/`清空` 是**输入**，不是显示）、
 * 存进 db.json 的枚举值、以及发给模型的提示词。
 */

export type Lang = "zh" | "en";

export const LANG_KEY = "allai-lang";

export const LANGS: { value: Lang | "system"; label: string; hint: string }[] = [
  { value: "zh", label: "中文", hint: "简体中文" },
  { value: "en", label: "English", hint: "英文界面" },
  { value: "system", label: "跟随系统", hint: "按系统语言自动选" },
];

export type LangMode = Lang | "system";

export function isLangMode(value: unknown): value is LangMode {
  return value === "zh" || value === "en" || value === "system";
}

/** 系统语言里只要不是中文，就按英文来。 */
export function systemLang(): Lang {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const item of list) {
      if (!item) continue;
      if (/^zh/i.test(item)) return "zh";
      return "en";
    }
  } catch {
    // 拿不到就按中文
  }
  return "zh";
}

export function resolveLang(mode: LangMode): Lang {
  return mode === "system" ? systemLang() : mode;
}

export function readLangMode(): LangMode {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (isLangMode(stored)) return stored;
  } catch {
    // 无痕模式等读不到
  }
  return "system";
}

export function saveLangMode(mode: LangMode) {
  try {
    localStorage.setItem(LANG_KEY, mode);
  } catch {
    // 存不下就只在这次会话里生效
  }
}

/* ---------------- 词典 ---------------- */

const EN: Record<string, string> = {
  /* 侧栏与主导航 */
  "聊天": "Chat",
  "Agent": "Agent",
  "创作": "Studio",
  "新对话": "New chat",
  "新创作": "New creation",
  "搜索": "Search",
  "搜索对话": "Search chats",
  "搜索工作": "Search tasks",
  "搜索创作": "Search creations",
  "设置": "Settings",
  "收起侧栏": "Collapse sidebar",
  "打开菜单": "Open menu",
  "重命名": "Rename",
  "删除": "Delete",
  "收起接续的对话": "Collapse continued chats",
  "展开接续的对话": "Expand continued chats",
  "还没有聊天记录": "No chats yet",
  "还没有本地工作": "No local tasks yet",
  "还没有创作": "No creations yet",
  "浅色模式": "Light mode",
  "深色模式": "Dark mode",
  "本地工作": "Local task",
  "未选择 Agent": "No agent selected",
  "运行中": "Running",
  "在线": "Online",
  "共 {n} 段": "{n} parts",
  "接续 {n}": "Continued {n}",

  /* 输入框 */
  "发送": "Send",
  "停止生成": "Stop",
  "添加文件": "Add file",
  "放开即可添加文件": "Drop to attach",
  "上传中…": "Uploading…",
  "读取文件失败": "Could not read the file",
  "上传失败": "Upload failed",
  "推理": "Reasoning",
  "权限": "Permission",
  "联网搜索：开": "Web search: on",
  "联网搜索：关": "Web search: off",
  "联网搜索：开。模型可以查最新信息": "Web search on — the model can look things up",
  "联网搜索：关。模型只用自己的知识": "Web search off — the model uses only what it knows",
  "管理员权限：开": "Administrator: on",
  "管理员权限：关": "Administrator: off",
  "管理员：开。本机 CLI 以管理员权限运行": "Administrator on — local CLIs run elevated",
  "管理员：关。本机 CLI 以当前用户权限运行，打开时会弹一次系统确认":
    "Administrator off — local CLIs run as you; turning it on asks Windows once",
  "操控电脑：开": "Computer use: on",
  "操控电脑：关": "Computer use: off",
  "操控电脑：开。发消息后 AI 会截屏并操作鼠标键盘，截图会发到你配置的接口":
    "Computer use on — the AI takes screenshots and drives mouse/keyboard; screenshots go to your configured endpoint",
  "移除 {name}": "Remove {name}",
  "给这个 Agent 下达任务…": "Give this agent a task… type / for commands",
  "先点新工作选择 Agent": "Pick an agent with New task first",
  "问点什么…": "Ask anything…",

  /* Agent 工作区 */
  "接续到新对话": "Continue in a new chat",
  "查看进度": "View progress",
  "选择工作目录": "Choose a folder",
  "复制工作目录": "Copy folder path",
  "复制恢复命令": "Copy resume command",
  "接续自": "Continued from",
  "已接续到": "Continued to",
  "上一条工作": "previous task",
  "发送你的需求，让 Agent 开始工作": "Describe what you need and the agent gets to work",
  "在 {cwd} 里工作。发一句话开始。": "Working in {cwd}. Send a message to start.",

  "高效地与AI工作": "Work with AI, efficiently",
  "今天": "Today",
  "昨天": "Yesterday",
  "过去 7 天": "Past 7 days",
  "当前": "Today",
  "一天": "24 hours",
  "起始日期": "Start date",
  "结束日期": "End date",
  "更早": "Earlier",

  /* 设置外壳 */
  "通用": "General",
  "模型与接口": "Models & endpoints",
  "Skills": "Skills",
  "使用统计": "Usage",
  "远程": "Remote",
  "关于": "About",
  "保存": "Save",
  "保存中…": "Saving…",
  "已保存": "Saved",
  "保存失败": "Save failed",
  "删除失败": "Delete failed",
  "取消": "Cancel",
  "确定": "OK",
  "版本": "Version",

  /* 关于：AllAi 自己的更新（electron/app-update.ts） */
  "AllAi 更新": "AllAi updates",
  "检查更新": "Check for updates",
  "正在检查…": "Checking…",
  "正在检查更新…": "Checking for updates…",
  "已是最新版本。": "You're up to date.",
  "发现新版本 {v}，正在后台下载…": "Version {v} found — downloading in the background…",
  "正在下载 {v}（{n}%）": "Downloading {v} ({n}%)",
  "{v} 已下载，退出 AllAi 时会自己装上。": "Version {v} downloaded. It installs itself when you quit AllAi.",
  "检查更新失败。": "Update check failed.",
  "上次检查：{when}": "Last checked: {when}",
  "还没检查过。": "Not checked yet.",
  "这个版本不能自动更新（开发模式），请手动装新版本。":
    "This build can't update itself (development mode) — install a new version manually.",
  "立即重启并安装": "Restart and install",
  "启动时自动检查更新": "Check for updates on startup",
  "在后台下载，不影响使用。下好后退出 AllAi 会自动装上，下次打开就是新版本。":
    "Downloads in the background. It installs itself when you quit, so the next launch is already the new version.",
  "只有桌面版能检查更新。": "Only the desktop app can check for updates.",

  /* 外观与语言（这一版新加的） */
  "外观": "Appearance",
  "日间": "Light",
  "夜间": "Dark",
  "跟随系统": "Follow system",
  "一直用浅色": "Always light",
  "一直用深色": "Always dark",
  "跟着系统的深浅色走": "Match the system light/dark setting",
  "语言": "Language",
  "中文": "中文",
  "English": "English",
  "简体中文": "Simplified Chinese",
  "英文界面": "English interface",
  "按系统语言自动选": "Pick automatically from the system language",
  "深浅色。选「跟随系统」就跟着 Windows 的设置走，系统一换这边立刻跟着变。":
    "Light or dark. Follow system tracks the Windows setting and switches the moment it changes.",
  "界面语言。没翻到的地方会显示中文原文。": "Interface language.",
  "界面语言。": "Interface language.",
  "输入框下的统计行": "Stats below the composer",
  "统计行": "Stats row",
  "不显示": "Hidden",
  "显示": "Shown",
  "默认": "Default",
  "显示哪几项（点一下切换）": "Choose what to show",
  "操控电脑": "Computer use",
  "安全档位": "Safety level",
  "逐步审核": "Confirm every step",
  "仅关键提交确认": "Confirm risky actions",
  "完全自动": "Fully automatic",
  "单次任务步数上限": "Maximum steps per task",
  "步": "steps",
  "联网搜索": "Web search",
  "聊天：不联网": "Chat: offline",
  "聊天：联网": "Chat: web search",
  "Agent：联网": "Agent: web search",
  "Agent：不联网": "Agent: offline",
  "通知": "Notifications",
  "Agent 做完": "Agent finished",
  "官方额度": "Official usage",
  "提醒": "Notify",
  "不提醒": "Don't notify",
  "模型图标": "Model icons",
  "本地工作需要桌面版": "Local tasks require the desktop app",
  "新工作": "New task",
  "更新中…": "Updating…",
  "全部更新": "Update all",
  "正在更新…": "Updating…",
  "排队中": "Queued",
  "声明": "About this app",
  "关闭": "Close",
  "复制失败，请手动选中": "Copy failed; select it manually",
  "发送回答": "Send answer",
  "你的选择：": "Your choice: ",
  "可多选": "Multiple selections allowed",
  "Agent 在问你": "Agent is asking",
  "已回答": "Answered",
  "已继续": "Continued",
  "（可多选）": "(multi-select)",
  "其它（自己写）": "Other (type your own)",

  /* 输入框补充 */
  "Enter 发送 · / 看指令": "Enter to send · / for commands",
  "Enter 发送 · 可粘贴/拖入文件": "Enter to send · paste or drop files",
  "停止": "Stop",
  "展开侧栏": "Expand sidebar",
  "关闭菜单": "Close menu",
  "先在左下角接入模型": "Add a model at the bottom left first",
  "夜深了，还在忙？": "Still at it this late?",
  "早上好": "Good morning",
  "下午好": "Good afternoon",
  "晚上好": "Good evening",
  "先接入一个模型": "Add a model first",
  "接入第一个模型": "Add your first model",
  "{name} 愿意为您提供帮助": "{name} is ready to help",
  "可选指令": "Commands",
  "没有匹配的指令。Enter 会把你打的原文发给 Agent。":
    "No matching command. Enter sends what you typed to the agent.",
  "↑↓ 选择 · Enter 填入 · Esc 关闭": "↑↓ to choose · Enter to fill · Esc to close",
  "也可 {alias}": "also {alias}",
  "压缩对话": "Compact chat",
  "把前面说的浓缩一下，腾出空间继续聊。可在后面加一句你想保留什么。":
    "Summarize earlier turns to free space. You can add what to keep.",
  "把前面说的浓缩一下，腾出空间继续聊。": "Summarize earlier turns to free space.",
  "清空重来": "Start over",
  "丢掉当前记忆，从头开始。发给 Agent 就会执行。": "Drop current memory and start fresh. Send to run.",
  "看占用": "Context usage",
  "显示这段对话用了多少上下文。发给 Agent 就会执行。": "Show how much of the context window is used. Send to run.",
  "看用量": "Usage",
  "显示这一轮花了多少。发给 Agent 就会执行。": "Show what this turn cost. Send to run.",
  "列出指令": "List commands",
  "让 Agent 自己说它还认识哪些指令。发给 Agent 就会执行。": "Ask the agent to list the commands it knows. Send to run.",
  "换模型": "Switch model",
  "后面跟型号，例如 /model opus。不写型号会列出可选的。":
    "Follow with a model id, e.g. /model opus. Leave empty to list options.",
  "先出方案": "Plan first",
  "进入计划模式：先想清楚再改代码。发给 Agent 就会执行。": "Enter plan mode: think it through before editing. Send to run.",
  "看改动": "Show diff",
  "显示这一轮改了哪些文件。发给 Agent 就会执行。": "Show files changed this turn. Send to run.",
  "长期记忆": "Memory",
  "查看或修改这个项目里记住的约定。发给 Agent 就会执行。": "View or edit remembered project notes. Send to run.",
  "压缩方式": "Compact mode",
  "后面跟 auto 或 manual，例如 /compact-mode auto。": "Follow with auto or manual, e.g. /compact-mode auto.",

  /* 权限 / 推理 */
  "自动": "Auto",
  "安全操作自动批，其余再问": "Approve safe actions; ask about the rest",
  "接受编辑": "Accept edits",
  "改文件自动批，跑命令还要问": "Approve file edits; still ask before commands",
  "计划": "Plan",
  "只读分析，不改文件、不跑命令": "Read-only analysis; no edits or commands",
  "不询问": "Don't ask",
  "会提示的操作一律拒绝": "Refuse anything that would prompt",
  "全部放行": "Allow all",
  "跳过权限检查，适合你信任的目录": "Skip permission checks; use in folders you trust",
  "安全操作自动批": "Approve safe actions automatically",
  "文件改动自动批": "Approve file edits automatically",
  "只规划，不落地改动": "Plan only; don't apply changes",
  "工具一律自动批准": "Approve every tool automatically",
  "工作区可写，审批走自动审查": "Workspace is writable; approvals go through auto-review",
  "只读": "Read-only",
  "沙箱只读，不能改工作区文件": "Sandbox is read-only; can't change workspace files",
  "关掉沙箱和审批": "Turn off sandbox and approvals",
  "不思考": "Off",
  "不额外思考，尽量快答": "No extra thinking; answer quickly",
  "极简": "Minimal",
  "极少推理 token": "Use as few reasoning tokens as possible",
  "轻量": "Light",
  "少量思考，优先速度": "A little thinking; prefer speed",
  "均衡": "Balanced",
  "质量和速度折中（默认）": "Balance quality and speed (default)",
  "深入": "Deep",
  "更多思考，适合复杂问题": "More thinking; better for hard problems",
  "更高": "Higher",
  "接近满档的深度推理": "Near-maximum reasoning depth",
  "最强": "Max",
  "该模型允许的最深思考": "The deepest thinking this model allows",
  "Codex 关闭思考": "Codex thinking off",
  "Codex 轻量": "Codex light",
  "中": "Medium",
  "Codex 中": "Codex medium",
  "高": "High",
  "Codex 高": "Codex high",
  "极高": "Very high",
  "Codex 极高": "Codex very high",
  "Codex Max": "Codex Max",
  "Codex Ultra": "Codex Ultra",

  /* 通用设置补充 */
  "输入框下面多一行调试信息": "An extra debug row under the composer",
  "每个动作都暂停，仅用于调试": "Pause on every action; for debugging",
  "默认。明确要求的任务连续完成；仅在对象不清或动作超出要求时询问":
    "Default. Finish the requested task continuously; ask only when the target is unclear or the action goes beyond it",
  "整个任务不暂停确认，适合你明确授权的操作": "Run the whole task without pausing; for actions you've clearly authorized",
  "只用模型自己的知识（默认）": "Use only the model's own knowledge (default)",
  "可以查最新信息": "Can look up current information",
  "查文档、找报错（默认）": "Look up docs and errors (default)",
  "断网干活": "Work offline",
  "Agent 做完、官方额度到点时发 Windows 通知。窗口正开着、已经在看的时候不打扰。":
    "Windows notification when an agent finishes or official usage hits a threshold. Skipped if this window is already in front.",
  "一轮结束时提醒（默认）": "Notify when a turn finishes (default)",
  "不通知": "Don't notify",
  "自己回来看": "You'll check back yourself",
  "5 小时 / 7 天已用到 80%、90%（默认）": "At 80% and 90% of the 5-hour / 7-day window (default)",
  "只在统计行里看": "Only show it on the stats row",
  "未选择": "Not selected",

  /* 关于 */
  "电脑上已安装的 CLI": "CLIs installed on this PC",
  "只有桌面版能查看和更新本机 CLI。": "Only the desktop app can view and update local CLIs.",
  "检测中…": "Checking…",
  "没有找到 Claude Code、Codex 或 Grok Build。装好后重新打开这一页即可。":
    "Claude Code, Codex, or Grok Build wasn't found. Install one and reopen this page.",
  "更新": "Update",
  "每次启动 AllAi 时自动更新所有 CLI": "Update all CLIs automatically each time AllAi starts",
  "在后台跑，不影响使用。正在用的 CLI 可能更新失败（文件被占用），下次启动会再试。":
    "Runs in the background. A CLI that's in use may fail (file locked); it will retry next launch.",
  "AllAi 把聊天、本地 Agent（Claude Code、Codex、Grok Build）和生图 / 生视频放在同一个窗口里。对话、配置和上传的文件都保存在这台电脑的 ~/.allai 目录。":
    "AllAi puts chat, local agents (Claude Code, Codex, Grok Build), and image/video generation in one window. Chats, settings, and uploads stay in ~/.allai on this PC.",
  "AllAi 是个人使用的桌面工具，不收集、不上传你的对话和使用数据。":
    "AllAi is a personal desktop tool. It doesn't collect or upload your chats or usage data.",
  "API Key 和登录凭据只保存在本机。你发给模型的内容会直接发到你配置的服务商或本机 CLI，请遵守对应服务的使用条款。":
    "API keys and login credentials stay on this PC. What you send to a model goes to the provider you configured or to a local CLI. Follow that service's terms.",
  "Claude Code、Codex、Grok Build 等 CLI 及其商标归各自的公司所有，AllAi 只调用你本机已经安装的程序，与这些公司没有关联。":
    "Claude Code, Codex, Grok Build and their trademarks belong to their companies. AllAi only launches programs you already installed, and is not affiliated with them.",
  "AI 生成的内容和 Agent 对文件的改动可能有错，重要的改动请自己确认。":
    "AI output and agent file edits can be wrong. Check important changes yourself.",

  /* 操控电脑横幅 */
  "关键操作：": "Risky action: ",
  "换一个": "Skip",
  "执行": "Run",
  "正在绑定目标窗口并连续执行…你可以随时停止。": "Locking the target window and running… you can stop at any time.",

  /* Agent 执行过程 */
  "思考过程": "Thinking",
  "思考过程 · {n} 步操作": "Thinking · {n} steps",
  "执行过程 · {n} 步操作": "Actions · {n} steps",
  "执行出错 · {n} 步操作": "Failed · {n} steps",
  "进行中…": "In progress…",
  "正在生成": "Generating",
  "运行命令": "Run command",
  "读文件": "Read file",
  "读笔记本": "Read notebook",
  "写文件": "Write file",
  "改文件": "Edit file",
  "改笔记本": "Edit notebook",
  "找文件": "Find files",
  "搜代码": "Search code",
  "打开网页": "Open page",
  "子任务": "Subtask",
  "更新计划": "Update plan",
  "问用户": "Ask user",
  "看目录": "List folder",
  "取命令输出": "Read command output",
  "删文件": "Delete file",
  "出错": "Error",
  "压缩上下文": "Compact context",
  "进程已结束（{code}）": "Process exited ({code})",

  /* Agent 工作区补充 */
  "双击桌面上的 AllAi 打开，就能用聊天界面驱动 Grok Build、Claude Code 和 Codex。":
    "Open AllAi from the desktop shortcut to drive Grok Build, Claude Code, and Codex from chat.",
  "上下文快满了。可以接续到新对话：AI 先把进度写成交接摘要，再开一条新工作接着做。":
    "Context is almost full. Continue in a new chat: the AI writes a handoff summary, then a new task picks up.",
  "在官方终端里接着这条会话": "Resume this session in the official terminal",
  "左侧是各 Agent 的历史工作。点「新工作」选择 Grok Build、Claude Code 或 Codex，以及要用的模型。":
    "Past agent tasks are on the left. New task picks Grok Build, Claude Code, or Codex, and a model.",

  /* 新工作 */
  "模型和接口来自这个 Agent 自己的设置。": "Models and endpoints come from this agent's own settings.",
  "选择项目文件夹": "Choose a project folder",
  "工作目录": "Working folder",

  /* 确认框 */
  "删除这条对话？": "Delete this chat?",
  "对话和里面的消息都会删掉，无法恢复。": "The chat and its messages will be deleted. This can't be undone.",
  "这条会话在 {agent} 自己的历史记录里也会一并删掉，无法恢复。":
    "This session will also be deleted from {agent}'s own history. This can't be undone.",
  "生成的图片和视频也会一起删掉，无法恢复。": "Generated images and videos will be deleted too. This can't be undone.",
  "删除这个服务？": "Delete this provider?",
  "已有聊天记录会保留，但不能再用它继续发消息。":
    "Existing chats stay, but you won't be able to send with this provider anymore.",
  "清空全部 {n} 条用量记录？": "Clear all {n} usage records?",
  "统计数据会归零，无法恢复。": "Stats will reset to zero. This can't be undone.",
  "清空": "Clear",
  "删除这个导入的 Skill？": "Delete this imported skill?",
  "只删除 AllAi 导入的那一份，原始文件夹不动。": "Only the copy AllAi imported is removed. The original folder stays.",

  /* 设置 / 模型接口 */
  "聊天模型": "Chat models",
  "Agent 接口": "Agent endpoints",
  "生图视频": "Image & video",
  "{n} 个接口": "{n} endpoints",
  "{n} 个模型": "{n} models",
  "已登录 · {n} 个模型": "Signed in · {n} models",
  "第三方接口": "API endpoint",
  "官方登录": "Official login",
  "例如 SpaceXAI": "e.g. SpaceXAI",
  "请在打开的浏览器里完成授权，成功后这里会变成已登录":
    "Finish signing in in the browser that opened. This will change to Signed in.",
  "已登录{name}": "Signed in to {name}",
  "未检测到 {name}，请先安装对应的命令行": "{name} wasn't found. Install its CLI first.",
  "正在登录…": "Signing in…",
  "登录{name}": "Sign in to {name}",
  "登录 {name}": "Sign in to {name}",
  "保存后清空": "Cleared after save",
  "已保存 {masked}": "Saved {masked}",
  "点保存后这个服务就没有 Key 了，可以直接填新的覆盖。":
    "After you save, this provider has no key. You can paste a new one over it.",
  "密钥只保存在本机，不会发到浏览器页面里。": "The key stays on this PC. It is never sent to the web UI.",
  "同步中…": "Syncing…",
  "从官方同步": "Sync from official",
  "从接口同步": "Sync from API",
  "输入模型 ID，例如 grok-4.6": "Type a model id, e.g. grok-4.6",
  "留空=自动识别": "Empty = auto-detect",
  "请用桌面版 AllAi 打开": "Open this in the desktop AllAi app",
  "新接入的服务需要填写 API Key": "A newly added provider needs an API key",
  "已同步 {n} 个模型": "Synced {n} models",
  "请先保存服务，再从接口同步模型": "Save the provider first, then sync models",
  "已同步 {n} 个模型，确认后点保存": "Synced {n} models. Save when it looks right.",
  "同步失败": "Sync failed",
  "显示名称": "Display name",
  "可执行文件": "Executable",
  "留空则自动检测 {bin}": "Leave empty to auto-detect {bin}",
  "接口": "Endpoints",
  "用备注区分多个第三方接口。当前选中的接口会用于新工作。":
    "Use the note to tell API endpoints apart. The selected one is used for new tasks.",
  "备注": "Note",
  "当前使用": "In use",
  "设为当前": "Use this",
  "删除接口": "Delete endpoint",
  "默认接口": "Default endpoint",
  "官方账号": "Official account",
  "未检测到 {name}，请先安装命令行": "{name} wasn't found. Install the CLI first.",
  "已登录": "Signed in",
  "退出登录": "Sign out",
  "打开官方登录": "Open official login",
  "还没填 Key": "No key yet",
  "还没填地址": "No URL yet",
  "来自全局提供商，改它去「Agent 接口 → 全局提供商」，改一次三个 Agent 都变。":
    "From the global pool. Edit it under Agent endpoints → Global providers; one change applies to all three agents.",
  "模型": "Model",
  "还没有模型，同步或手动添加。删掉后点保存。": "No models yet. Sync or add them. Delete, then save.",
  "输入模型 ID 后回车添加": "Type a model id and press Enter",
  "思考强度按模型名自动识别。识别不到可自己填档位，逗号分隔。":
    "Reasoning levels are inferred from the model name. If that fails, type levels yourself, comma-separated.",
  "留空则自动识别": "Leave empty to auto-detect",
  "至少保留一个接口": "Keep at least one endpoint",
  "{keep}，已同步 {n} 个模型": "{keep}, synced {n} models",
  "请在浏览器里完成授权": "Finish signing in in the browser",
  "{name} 已登录": "{name} signed in",
  "没有检测到登录成功，请再点一次登录": "Sign-in wasn't detected. Try Sign in again.",
  "已退出登录": "Signed out",
  "已退出 {name}": "Signed out of {name}",
  "全局": "Global",
  "API / 第三方": "API",
  "请用桌面版 AllAi": "Use the desktop AllAi app",
  "没有检测到登录，请再试一次": "Sign-in wasn't detected. Try again.",
  "登录窗口已关闭": "Sign-in window closed",
  "同步模型失败": "Couldn't sync models",
  "部分本地数据读取失败，原文件已保留": "Some local data couldn't be read. The original files were kept.",

  /* 全局接口 */
  "读取失败": "Couldn't load",
  "全局接口": "Global endpoints",
  "已保存，所有 Agent 都已生效": "Saved. All agents pick this up.",
  "已同步模型": "Models synced",
  "备注，例如「我的中转站」": "Note, e.g. “my gateway”",
  "所有 Agent 的接口列表里都会少掉它。正在用它的 Agent 会回到自己的接口。":
    "It disappears from every agent's endpoint list. Agents using it fall back to their own.",

  /* 上下文设置 */
  "自动压缩": "Auto-compact",
  "开启": "On",
  "默认。到量自动压，对话里会说明": "Default. Compacts at the threshold; the chat explains it",
  "只显示进度，撑爆了模型自己会报错": "Only show progress; the model errors if it overflows",
  "恢复 {id} 的自动识别": "Restore auto-detected limit for {id}",
  "模型 ID": "Model id",
  "上限 token": "Limit (tokens)",

  /* 图标 */
  "溯源": "Trace",
  "模型溯源": "Model trace",
  "用数字指纹探测 OpenAI / Claude 是不是被路由到别的型号。HTTP 接口走 Key；官方登录的 Claude / ChatGPT 走本机 CLI，会用一点订阅额度。方法来自 ModelTrace。":
    "Fingerprint OpenAI / Claude to see if replies are routed to another model. HTTP endpoints use an API key; official Claude / ChatGPT logins use the local CLI and a bit of subscription quota. Method from ModelTrace.",
  "自动探测": "Auto probe",
  "还没有探测记录": "No probes yet",
  "最近探测路由占比 {n}%": "Recent routing rate {n}%",
  "没有发现被路由到别的型号。": "No routing to another model was found.",
  "有一部分回复对不上你选的型号。": "Some replies do not match the model you picked.",
  "被路由的比例偏高，建议换接口或核对账号。": "Routing rate is high. Check the endpoint or account.",
  "没有可探测的 OpenAI / Claude 接口": "No OpenAI / Claude endpoint to probe",
  "探测中…": "Probing…",
  "手动探测": "Probe now",
  "探测完成": "Probe finished",
  "探测失败": "Probe failed",
  "历史检测记录": "Probe history",
  "发一条 OpenAI 或 Claude 的聊天后，这里会出现记录。": "Send an OpenAI or Claude chat message and records will show up here.",
  "对不上：选的 {expected}，指纹更像 {name}": "Mismatch: you picked {expected}, fingerprint looks like {name}",
  "相符：{expected} ≈ {name}": "Match: {expected} ≈ {name}",
  "手动": "Manual",
  "模型被路由": "Model routed",
  "只支持 OpenAI 和 Claude 型号": "Only OpenAI and Claude models are supported",
  "官方登录请走本机 CLI 探测": "Official logins are probed through the local CLI",
  "找不到这个接口": "Endpoint not found",
  "探测请求失败": "Probe request failed",
  "没有可用回答：数字序列太短或被拒答。": "No usable reply: the number sequence was too short or refused.",
  "选的是 {expected}，指纹更像 {name}": "You picked {expected}; fingerprint looks like {name}",
  "这次回复的指纹不像 {expected}，更接近 {name}。": "This reply’s fingerprint does not look like {expected}; it is closer to {name}.",
  "预设图标": "Preset icons",
  "已收起 {n} 个模型": "{n} models collapsed",
  "模型名前面的厂商图标。点下面一行再选预设，或自己填网址、上传。某一条服务自己的图标去「聊天模型 / Agent 接口」里那条服务上配。":
    "Vendor icons in front of model names. Click a row, then pick a preset, or paste a URL / upload. A service’s own icon is set on that service under Chat models / Agent endpoints.",
  "图标": "Icon",
  "正在抓取图标…": "Fetching icon…",
  "填接口地址后会自动抓网站图标，也可以自己上传或填网址。":
    "The site icon is fetched from the endpoint URL. You can also upload an image or paste a link.",
  "抓不到图标": "Couldn't fetch the icon",
  "图标已保存": "Icon saved",
  "图标不能超过 360KB": "Icon must be under 360KB",
  "读取图片失败": "Couldn't read the image",
  "自定义图标": "Custom icon",
  "内置图标": "Built-in icon",
  "没有图标": "No icon",
  "图片网址或网站域名": "Image URL or site domain",
  "从网上抓取": "Fetch from the web",
  "从本地选图片": "Choose a local image",
  "恢复默认": "Reset to default",
  "模型名前面的厂商图标。Anthropic / xAI / OpenAI 自带矢量图，其余认出了牌子但没有图，可以自己配：填图片网址就直接用那张图，填网站域名会去抓它的站点图标，也可以从本地选一张。图标存在本机，不会每次渲染都去打别人的服务器。":
    "Vendor icons in front of model names. Anthropic, xAI, and OpenAI ship with vector marks. For others you can set your own: paste an image URL, a site domain to fetch its favicon, or pick a local file. Icons stay on this PC.",
  "认出来的厂商": "Recognized vendors",
  "认不出牌子的模型（{n}）": "Unrecognized models ({n})",
  "还有 {n} 个没列出来": "{n} more not listed",
  "所有模型都认出牌子了": "Every model has a recognized vendor",

  /* 生图设置 */
  "聊天生图模型": "Chat image model",
  "聊天输入框的生图按钮使用": "Used by the image button in chat",
  "Agent 生图模型": "Agent image model",
  "Agent 输入框的生图按钮使用，图片会写进工作目录":
    "Used by the image button in the agent composer; images are written into the working folder",

  /* 远程 */
  "从未": "Never",
  "「{name}」已配对": "“{name}” is paired",
  "已连上中继": "Connected to the relay",
  "正在连接中继…": "Connecting to the relay…",
  "连接出错": "Connection error",
  "未开启": "Off",
  "远程控制": "Remote control",
  "开启远程控制": "Turn on remote control",
  "开着时 AllAi 会一直连着中继。电脑要保持开机、AllAi 不能退出。":
    "While on, AllAi stays connected to the relay. Keep this PC awake and AllAi running.",
  "中继服务器": "Relay server",
  "填部署好的中继地址（https 开头）和启动中继时设置的 RELAY_TOKEN。":
    "The deployed relay URL (https) and the RELAY_TOKEN you set when starting it.",
  "已保存（不改就留空）": "Saved (leave blank to keep)",
  "配对新设备": "Pair a new device",
  "用手机相机扫码，在打开的网页里点「配对」。二维码 10 分钟内有效、只能用一次。别把它截图发给别人。":
    "Scan with your phone camera and tap Pair on the page. The QR code lasts 10 minutes and works once. Don't send a screenshot of it.",
  "配对二维码": "Pairing QR code",
  "已复制": "Copied",
  "复制链接": "Copy link",
  "已配对的设备": "Paired devices",
  "移除后那台设备立刻断开，它存的密钥也就作废了，要用得重新扫码。":
    "That device disconnects immediately and its stored key stops working. Pair again to reuse it.",
  "离线": "Offline",
  "设备名字": "Device name",
  "移除设备": "Remove device",
  "它会立刻断开，以后要用得重新扫码配对。": "It disconnects immediately. Scan again to pair later.",
  "移除": "Remove",
  "远程权限": "Remote permissions",
  "只影响从手机发起的请求，电脑上自己操作不受影响。「操控电脑」不开放给远程。":
    "Only requests from the phone. What you do on this PC is unchanged. Computer use is not available remotely.",
  "Agent 沿用电脑上的权限模式": "Agents follow this PC's permission mode",
  "关掉后，远程发起的 Agent 任务里「全部放行」会降成「接受编辑」（Codex 降成「自动」）。":
    "When off, remote agent tasks drop Allow all to Accept edits (Codex drops to Auto).",
  "允许远程用管理员身份运行": "Allow remote administrator runs",
  "默认关。打开后，电脑上开着管理员模式时，远程的请求也会以管理员身份跑本机 CLI。":
    "Off by default. When on, if administrator mode is on here, remote requests run local CLIs elevated too.",
  "最近的远程操作": "Recent remote activity",
  "只记哪台设备在什么时候做了哪类操作，不记内容。":
    "Records which device did which kind of action, not the contents.",
  "远程控制：{names} 正连着": "Remote: {names} connected",
  "远程控制已开启，没有设备连着": "Remote is on; no device connected",
  "远程控制正在连接中继": "Remote is connecting to the relay",
  "最小化": "Minimize",
  "还原": "Restore",
  "最大化": "Maximize",

  /* 搜索 */
  "未命名": "Untitled",
  "搜索聊天、Agent、创作…": "Search chats, agents, studio…",

  /* Skills */
  "保存失败，请重试": "Couldn't save; try again",
  "Skills 文件夹路径": "Skills folder path",
  "导入失败": "Import failed",
  "已导入 Skill": "Skill imported",
  "{name} 的 Agent 开关": "Agent toggle for {name}",
  "已启用，点击停用": "Enabled; click to disable",
  "已停用，点击启用": "Disabled; click to enable",

  /* 统计行 */
  "速度": "Speed",
  "上下文": "Context",
  "本对话 Token": "Chat tokens",
  "输入 / 输出": "In / out",
  "缓存命中率": "Cache hit",
  "模型来源": "Model source",
  "花费": "Cost",
  "已用/上限 · 百分比": "used / limit · percent",
  "额度 {n}": "credits {n}",
  "重置 {n}": "resets {n}",
  "本轮输出速度，只在生成时有值": "Output speed this turn; only while generating",
  "此刻窗口占用 / 上限（{note}）。到设定比例会自动压缩早期内容。":
    "Window used / limit ({note}). Early turns compact when the threshold is hit.",
  "这条对话现有内容的估算长度（按字符折算，不是精确值）":
    "Estimated length of this chat (from characters, not exact tokens)",
  "本对话": "This chat",
  "· {n} 轮": " · {n} turns",
  "这条对话累计消耗的 token（输入 + 输出）：{n}": "Tokens used in this chat (input + output): {n}",
  "输入/输出": "In/out",
  "这条对话累计的输入 token / 输出 token": "Input tokens / output tokens for this chat",
  "缓存命中": "Cache hit",
  "这条对话送进模型的输入里，有 {n} 个 token 命中了缓存。命中越多越省钱、越快。":
    "{n} input tokens in this chat hit the cache. More hits means cheaper and faster.",
  "还没有用量记录，或者这个接口不报缓存": "No usage yet, or this API doesn't report cache",
  "当前选的模型，和它来自哪个服务 / 账号": "The selected model and which provider / account it comes from",
  "CLI 上报的实际花费，第三方接口一般没有": "Actual spend reported by the CLI; third-party APIs usually omit this",
  "{name} 官方额度已用": "{name} official usage",
  "{name} 重置 {n} 次": "{name} · {n} resets",
  "{name} 通过 AllAi 记下的已用 token": "{name} tokens recorded by AllAi",
  "CLI 自己报的窗口大小": "Window size reported by the CLI",
  "{note}（估算）": "{note} (estimate)",
  "{note}，占用取自接口回报": "{note}; usage from the API",

  /* 用量页 */
  "7 天": "7 days",
  "30 天": "30 days",
  "90 天": "90 days",
  "全部": "All",
  "用量趋势": "Usage trend",
  "读不到用量数据": "Couldn't read usage data",
  "未记录型号": "Unknown model",
  "已清空用量记录": "Usage records cleared",
  "总 Token": "Total tokens",
  "输入 + 输出": "Input + output",
  "输入": "Input",
  "输出": "Output",
  "命中缓存": "Cache read",
  "占输入 {n}%": "{n}% of input",
  "写入缓存": "Cache write",
  "思考": "Thinking",
  "请求数": "Requests",
  "仅 CLI 上报": "CLI-reported only",
  "接口没有上报": "Not reported by the API",
  "数字写法": "Number format",
  "简略": "Compact",
  "显示简略数字，例如 2.6K": "Short numbers, e.g. 2.6K",
  "精确": "Exact",
  "显示完整数字，例如 2,614": "Full numbers, e.g. 2,614",
  "刷新": "Refresh",
  "导出 CSV": "Export CSV",
  "产出": "Output",
  "请求": "Requests",
  "已统计 {days} 天 · {n} 次请求 · {from} 起": "{days} days · {n} requests · since {from}",
  "还没扫到本机的 CLI 会话": "No local CLI sessions scanned yet",
  "扫完了：{n} 个会话文件": "Scanned {n} session files",
  "这个功能要桌面版": "This needs the desktop app",
  "扫描失败": "Scan failed",
  "扫描中…": "Scanning…",
  "立即扫描": "Scan now",
  "它那边没有可导的记录": "Nothing there to import",
  "已导入 {days} 天、{n} 次请求": "Imported {days} days, {n} requests",
  "导入中…": "Importing…",
  "重新导入": "Import again",
  "导入": "Import",
  "周一": "Mon",
  "周三": "Wed",
  "周五": "Fri",
  "周日": "Sun",
  "这段时间共计": "Total in this range",
  "活跃天数": "Active days",
  "{active} / {total} 天": "{active} / {total} days",
  "活跃日均": "Avg on active days",
  "单日最高": "Busiest day",
  "连续使用": "Streak",
  "{n} 天": "{n} days",
  "最长 {n} 天": "Longest {n} days",

  /* 创作 */
  "自适应": "Auto",
  "由模型决定构图": "Let the model pick the framing",
  "方形": "Square",
  "横屏": "Landscape",
  "竖屏": "Portrait",
  "传统横图": "Classic landscape",
  "传统竖图": "Classic portrait",
  "照片横图": "Photo landscape",
  "照片竖图": "Photo portrait",
  "视频": "Video",
  "图片": "Image",
  "放大查看": "View larger",
  "下载": "Download",
  "请用图片作参考": "Use an image as reference",
  "生图": "Image",
  "接着上一张改": "Edit from the last image",
  "（没有提示词）": "(no prompt)",
  "已取消": "Canceled",
  "生成失败：{error}": "Generation failed: {error}",
  "请上传人物参考照片": "Upload a character reference photo",
  "人物": "Characters",
  "保存人物失败": "Couldn't save the character",
  "删除人物": "Delete character",
  "已加到参考图": "Added as reference",
  "请先在设置里指定视频模型": "Pick a video model in Settings first",
  "请先在设置里指定生图模型": "Pick an image model in Settings first",
  "生成失败": "Generation failed",
  "已压缩上下文": "Context compacted",
  "描述要生成的视频…": "Describe the video…",
  "描述画面，可粘贴参考图…": "Describe the image; you can paste a reference…",
  "类型": "Type",
  "生成静态画面": "Still image",
  "生成短视频": "Short video",
  "比例": "Aspect",
  "选择模型": "Choose a model",
  "还没有模型": "No models yet",
  "搜索模型或服务": "Search models or providers",

  /* 媒体 / markdown */
  "缩小": "Zoom out",
  "放大": "Zoom in",
  "复制图片": "Copy image",
  "用作参考": "Use as reference",
  "下载失败": "Download failed",
  "复制失败": "Copy failed",
  "已复制图片": "Image copied",
  "复制": "Copy",
  "编辑这条消息": "Edit this message",
  "收起截图": "Hide screenshot",
  "放大截图": "Enlarge screenshot",
  "这一步 AI 看到的画面": "What the AI saw this step",
  "收起": "Collapse",
  "展开全部（{n} 字）": "Expand all ({n} characters)",
  "播放": "Play",
  "进度": "Progress",
  "暂停": "Pause",
  "取消静音": "Unmute",
  "静音": "Mute",
  "播放速度": "Playback speed",
  "下载视频": "Download video",
  "退出全屏": "Exit fullscreen",
  "全屏": "Fullscreen",
  "跳转到对话里的某一轮": "Jump to a turn",
  "第 {n} 轮：{label}": "Turn {n}: {label}",
  "（图片或附件）": "(image or attachment)",
  "这是比较早的改动，为了不拖慢界面只保留了统计，没有加载具体内容。":
    "An earlier change. Only the counts are kept so the UI stays fast.",
  "会话记录里没有这次改动的具体内容。": "The session record has no patch for this change.",
  "第 {n} 行起": "From line {n}",

  /* 交接面板 */
  "准备": "Getting ready",
  "生成摘要": "Writing summary",
  "{n} 秒": "{n}s",
  "{m} 分 {s} 秒": "{m}m {s}s",
  "接续到新对话的进度": "Continue-in-new-chat progress",
  "接续完成": "Handoff finished",
  "正在接续到新对话": "Continuing in a new chat",
  "后台运行中，关掉这个面板不会停": "Keeps running in the background if you close this panel",
  "来自《{title}》": "From “{title}”",
  "默认型号": "Default model",
  "{n} 字": "{n} characters",
  "还没开始写": "Hasn't started writing",
  "已经发给模型，等它开口…": "Sent to the model; waiting for it to speak…",
  "这一轮没有留下步骤": "This turn left no steps",
  "已停止": "Stopped",
  "已完成": "Done",
  "接续失败": "Handoff failed",

  /* ChatGPT 网页 */
  "ChatGPT 网页版": "ChatGPT web",
  "内嵌网页": "Embedded page",
  "ChatGPT 网页额度": "ChatGPT web usage",
  "生成中": "Generating",
  "加载中": "Loading",

  /* 官方登录名 */
  "Claude 账号": "Claude account",
  "Grok 账号": "Grok account",
  "ChatGPT 账号": "ChatGPT account",

  /* 通知 / 错误（界面展示） */
  "「{title}」做完了": "“{title}” finished",
  "打不开这条对话": "Couldn't open this chat",
  "重命名失败": "Couldn't rename",
  "这条工作不存在了": "This task no longer exists",
  "已删除": "Deleted",
  "请选择工作目录": "Choose a working folder",
  "找不到这条工作对应的 Agent": "No agent matches this task",
  "Agent 还在跑": "The agent is still running",
  "复制附件失败": "Couldn't copy attachments",
  "发送失败": "Couldn't send",
  "先打开一条有回复的 Agent 工作": "Open an agent task that already has a reply",
  "这条工作还在跑，等它停下来再接续": "This task is still running. Wait until it stops, then continue.",
  "你在摘要写完之前停止了这一轮，新对话还没有开。":
    "You stopped before the summary finished, so no new chat was opened.",
  "这一轮结束了，但没拿到交接摘要。回到原来那条工作看看它最后说了什么。":
    "This turn ended without a handoff summary. Check what the original task said last.",
  "摘要写好了，但没能开出新工作。检查一下 Agent 和工作目录。":
    "The summary is ready, but a new task couldn't be opened. Check the agent and working folder.",
  "请在系统弹出的窗口里确认管理员权限…": "Confirm administrator access in the Windows prompt…",
  "AllAi 本身就是管理员身份，本机 CLI 会直接以管理员运行":
    "AllAi is already elevated, so local CLIs run as administrator",
  "管理员权限已就绪，本机 CLI 会以管理员身份运行":
    "Administrator access is ready; local CLIs will run elevated",
  "桌面截图能力不可用": "Desktop screenshots aren't available",
  "调用桌面截图能力失败": "Couldn't capture the desktop",
  "已截到目标窗口，但保存截图失败": "Captured the target window, but saving the screenshot failed",
  "官方登录的模型看不到截图，请换成第三方接口里的视觉模型（如 gpt-5.6 / grok-4.6）":
    "Official-login models can't see screenshots. Switch to a vision model on an API endpoint.",
  "官方登录的模型走 CLI 单轮模式，收不到截图。换成第三方接口里的视觉模型才能用。":
    "Official-login models run one CLI turn and can't receive screenshots. Use a vision model on an API endpoint.",
  "电脑端界面还没准备好": "The desktop UI isn't ready yet",
  "缺少对话编号": "Missing chat id",
  "消息是空的": "The message is empty",
  "上一条还在生成，先停止它": "The last reply is still generating; stop it first",
  "缺少模型": "No model selected",
  "生成中不能换模型": "Can't switch models while generating",
  "新建失败：检查 Agent 和工作目录": "Couldn't create the task; check the agent and folder",
  "先选一条工作": "Pick a task first",
  "Agent 还在跑，先停止它": "The agent is still running; stop it first",
  "运行中不能换模型": "Can't switch models while it's running",
  "没有要改的设置": "Nothing to change",
  "请填写名称": "Enter a name",
  "缺少工作编号": "Missing task id",
  "不支持的操作：{op}": "Unsupported action: {op}",
  "请输入内容或添加文件": "Type a message or attach a file",
  "请先选择一个模型": "Choose a model first",
  "连不上这个接口，请检查地址、密钥或网络": "Can't reach this API. Check the URL, key, or network.",
  "请求失败": "Request failed",
  "对话不存在": "Chat not found",
  "压缩失败": "Couldn't compact",
  "文件不存在": "File not found",
  "文件不能超过 40MB": "Files must be under 40MB",

  /* 手机网页 */
  "Android 手机": "Android phone",
  "Android 平板": "Android tablet",
  "Windows 电脑": "Windows PC",
  "我的设备": "My device",
  "这不是 AllAi 的配对二维码": "This isn't an AllAi pairing QR code",
  "这个二维码属于另一个中继地址（{host}），请在那个地址打开":
    "This QR code belongs to another relay ({host}). Open that address.",
  "已和「{name}」配对": "Paired with “{name}”",
  "然后点下面的「扫码配对」。": "Then tap Scan to pair below.",
  "然后用手机相机扫码。": "Then scan with your phone camera.",
  "配对中…": "Pairing…",
  "配对": "Pair",
  "创作失败：{error}": "Studio failed: {error}",
  "「{name}」不在线：电脑要开着、AllAi 要开着远程控制":
    "“{name}” is offline. Keep the PC on and remote control enabled in AllAi.",
  "正在连接…": "Connecting…",
  "已配对的电脑": "Paired computers",
  "点下面扫码。": "Scan below.",
  "用手机扫。": "Scan with your phone.",
  "删除「{name}」的配对？": "Remove pairing with “{name}”?",
  "电脑那边也记得移除这台设备。": "Remove this device on the computer too.",
  "Agent 想问你": "The agent wants to ask you",
  "其它…（自己写）": "Other… (type your own)",
  "已发送": "Sent",
  "发送中…": "Sending…",
  "没有相机权限。到 iPhone「设置」里给 Safari（或这个 App）打开相机，或者点下面「从相册选图」。":
    "No camera access. Enable Camera for Safari (or this app) in iPhone Settings, or pick a photo below.",
  "没找到相机。可以点下面「从相册选图」。": "No camera found. You can pick a photo below.",
  "打不开相机。可以点下面「从相册选图」。": "Couldn't open the camera. You can pick a photo below.",
  "这张图里没找到二维码，换一张清楚点的试试。": "No QR code in this photo. Try a clearer one.",
  "读不了这张图片。": "Couldn't read this image.",
  "这个浏览器不能用相机。可以点下面「从相册选图」，选一张二维码截图。":
    "This browser can't use the camera. Pick a QR screenshot below.",
  "关闭扫码": "Close scanner",
  "刚刚": "Just now",
  "{n} 分钟前": "{n} min ago",
  "{n} 小时前": "{n} hr ago",
  "返回": "Back",
  "没有可用模型": "No models available",
  "添加图片": "Add image",
  "正在连接「{name}」…": "Connecting to “{name}”…",
  "与目标电脑上 AllAi 的连接已断开": "Connection to AllAi on the target PC was lost",
  "Remote Control 会不断尝试重连。": "Remote Control will keep trying to reconnect.",
  "「{name}」上的 AllAi 没有开着，或者它没连上中继。Remote Control 会不断尝试重连，一旦它回来就自动恢复。":
    "AllAi on “{name}” isn't running, or it isn't on the relay. Remote Control will keep trying and resume when it's back.",
  "上下文占用": "Context used",
  "还没有对话": "No chats yet",
  "点右上角「新对话」开始。": "Tap New chat at the top right to start.",
  "对话": "Chat",
  "重命名对话": "Rename chat",
  "电脑屏幕上会同步显示。": "It also shows on the computer screen.",
  "发消息…": "Message…",
  "联网": "Web",
  "联网搜索已开": "Web search on",
  "联网搜索已关": "Web search off",
  "{n} 个操作": "{n} actions",
  "{n} 步": "{n} steps",
  "新建 Agent 工作": "New agent task",
  "创建中…": "Creating…",
  "创建": "Create",
  "还没有工作": "No tasks yet",
  "点右上角「新工作」开始。": "Tap New task at the top right to start.",
  "工作": "Task",
  "重命名工作": "Rename task",
  "这条会话在 {agent} 自己的历史记录里也会一并删掉。":
    "This session will also be deleted from {agent}'s own history.",
  "让 Agent 做点什么…": "Ask the agent to do something…",
  "点右上角「新创作」开始。": "Tap New creation at the top right to start.",
  "重命名创作": "Rename creation",
  "生成的图片和视频也会一起删掉。": "Generated images and videos will be deleted too.",
  "描述画面就能出图。可以附参考图。": "Describe a scene to generate. You can attach a reference.",
  "描述视频画面…": "Describe the video…",
  "描述画面…": "Describe the image…",
  "生成": "Generate",
  "请填写提示词": "Enter a prompt",
  "电脑没有回应。确认电脑上的 AllAi 开着远程控制，并且已经连上中继。":
    "The computer didn't respond. Make sure AllAi has remote control on and is connected to the relay.",
  "连不上中继服务器": "Can't reach the relay",
  "和中继的连接断了": "Disconnected from the relay",
  "电脑现在不在线。确认电脑上的 AllAi 开着远程控制。":
    "The computer is offline. Make sure AllAi has remote control on.",
  "电脑离线了": "The computer went offline",
  "配对失败": "Pairing failed",
  "电脑身份对不上": "Computer identity doesn't match",
  "已断开": "Disconnected",
  "连接断了": "Connection lost",
  "电脑端出错了": "The computer reported an error",
  "会话重置了，请重试": "The session reset; try again",
  "电脑不在线": "Computer offline",
  "还没连上电脑": "Not connected to the computer yet",
  "连接刚刚重置了，请重试": "The connection just reset; try again",
  "电脑没有响应": "The computer didn't respond",
  "这个浏览器不支持本地存储（无痕模式？），没法保存配对":
    "This browser can't use local storage (private mode?), so pairing can't be saved",
  "打不开本地存储": "Couldn't open local storage",
  "本地存储出错": "Local storage error",
  "这个浏览器存不下配对信息（无痕模式？）": "This browser can't store pairing info (private mode?)",
  "换成了 {model}": "Switched to {model}",
  "读取中…": "Loading…",
  "上传失败：{error}": "Upload failed: {error}",

  /* Agent 种类说明 */
  "xAI 官方编程 Agent": "xAI's official coding agent",
  "Anthropic 官方编程 Agent": "Anthropic's official coding agent",
  "OpenAI 官方编程 Agent": "OpenAI's official coding agent",
  "任意本地 CLI": "Any local CLI",
  "不用的模型在 Agent 设置里删。": "Remove unused models in agent settings.",
  "开始工作": "Start",
  "输入标题或正文里的字": "Type a title or words from the body",
  "没有找到「{query}」": "No results for “{query}”",
  "没有匹配的模型": "No matching models",
  "当前工作": "Current task",
  "当前模型": "Current model",
  "当前阶段": "Stage",
  "已写摘要": "Summary so far",
  "执行到哪一步": "Progress",
  "已运行 {time}": "Running {time}",
  "停止接续": "Stop handoff",
  "打开新对话": "Open new chat",
  "知道了": "Got it",
  "生图和视频模型单独管理，不会出现在普通聊天的模型列表里。聊天和 Agent 里的生图按钮会用这里指定的模型。":
    "Image and video models are managed here, not in the chat model list. The image buttons in chat and Agent use these.",
  "还没有生图模型。在「聊天模型」里给接口加上例如 grok-imagine-image-2.0，保存后会自动识别。":
    "No image models yet. Add one like grok-imagine-image-2.0 under Chat models; it will be recognized after you save.",
  "当前聊天生图模型 ID：{id}": "Current chat image model id: {id}",
  "改了 {n} 个文件": "Changed {n} files",
  "新建": "New",
  "…太长了，后面的没有显示": "…too long; the rest isn’t shown",
  "改完会重新发一次，后面的回复会被替换": "Sending again replaces the replies after this message",
  " —— 屏幕上有什么它就看到什么，密码管理器、聊天窗口、银行页面都算在内。执行期间输入框上方有一条横幅，随时可以停。":
    " — whatever is on screen is sent, including password managers, chats, and banking pages. A banner above the composer lets you stop at any time.",
  " 参数，网关不认的话会自动去掉重试，不会把聊天弄挂。创作台是生图，没有联网这回事。":
    " parameter; if the gateway rejects it, AllAi retries without it so chat doesn’t hang. Studio generates images, so it has no web search.",
  "5 小时已用": "5-hour used",
  "7 天已用": "7-day used",
  "AllAi 自己这边（聊天、创作）的记录存在": "Chat and Studio records live in",
  "AllAi 远程": "AllAi Remote",
  "{from} → {to} · {n} 次请求 · ${cost}": "{from} → {to} · {n} requests · ${cost}",
  "{m}月{d}日": "{m}/{d}",
  "{n} 台设备在线": "{n} devices online",
  "{n} 天有记录": "{n} days with data",
  "、用摘要开一条新会话。三个专区都生效。": ", then start a new session with the summary. This applies to all three areas.",
  "。缓存读的 token 本身算在输入里，所以合计 = 输入 + 输出，没有重复计。":
    ". Cache-read tokens are already part of input, so total = input + output with no double counting.",
  "「{name}」已经移除了这台设备": "“{name}” already removed this device",
  "上传参考照片": "Upload reference photos",
  "上传照片即可，不必自己描述长相。": "Photos are enough; you don’t have to describe appearance.",
  "下面是自动识别的结果。中转站把窗口限小了的话，在这儿手填一个覆盖它。认不出的型号一律按 128K 保守处理。":
    "Auto-detected limits are below. If a gateway shrinks the window, type an override here. Unrecognized models use a conservative 128K.",
  "不管那一轮是 AllAi 发的、你在终端里自己跑的、还是别的壳子跑的，只要 Claude Code / Codex / Grok Build 在这台电脑上留下了会话文件，用量就算进来。每 5 分钟增量补扫一次。":
    "Whether AllAi sent the turn, you ran it in a terminal, or another shell did, usage is counted if Claude Code / Codex / Grok Build left a session file on this PC. Incremental rescan every 5 minutes.",
  "中继口令": "Relay token",
  "中继地址": "Relay URL",
  "人物参考": "Character refs",
  "从 CC Switch 导入历史": "Import history from CC Switch",
  "从相册选图": "Choose from photos",
  "作废": "Revoke",
  "全局提供商": "Global providers",
  "删除「{name}」的配对": "Delete pairing with “{name}”",
  "删除服务": "Delete provider",
  "删除这台电脑的记录": "Delete this computer",
  "加载失败": "Couldn't load",
  "压缩阈值": "Compact threshold",
  "只读它的": "Reads only",
  "合计": "Total",
  "名称": "Name",
  "命令": "Command",
  "和「{name}」配对": "Pair with “{name}”",
  "在下面描述画面就能出图。同一条创作里可以连续问，点「新创作」再开一条。":
    "Describe a scene below to generate. Keep going in the same creation, or tap New creation for another.",
  "在手机浏览器里操控这台电脑上的 AllAi：聊天、Agent、创作都能用，电脑屏幕上会同步显示。消息经过你自己服务器上的中继转发，":
    "Control AllAi on this PC from a phone browser: chat, Agent, and Studio, mirrored on the computer screen. Messages go through a relay on your own server,",
  "在电脑上的 AllAi 里打开「设置 → 远程」，点「生成配对二维码」，":
    "On the computer, open AllAi → Settings → Remote, tap Generate pairing QR code,",
  "多": "more",
  "官方登录账号已用": "Official account used",
  "对准电脑上「设置 → 远程」里的配对二维码": "Point at the pairing QR code in Settings → Remote on the computer",
  "导入文件夹": "Import folder",
  "少": "less",
  "工作目录（只能选电脑上用过的目录）": "Working folder (only folders this PC has used)",
  "已发送，等待电脑开始生成…": "Sent. Waiting for the computer to start generating…",
  "已导入：{from} → {to}，{days} 天 · {n} 次请求": "Imported: {from} → {to}, {days} days · {n} requests",
  "已选": "Selected",
  "截图会发到你为这个模型配置的接口": "Screenshots go to the endpoint configured for this model",
  "所有 Agent 共用": "Shared by all agents",
  "手机和电脑之间端到端加密": "End-to-end encrypted between phone and computer",
  "手机和电脑之间端到端加密，中继服务器看不到内容。":
    "End-to-end encrypted between phone and computer. The relay can’t read the contents.",
  "执行过程": "Actions",
  "扫码添加电脑": "Scan to add a computer",
  "扫码配对": "Scan to pair",
  "扫码配对其他电脑": "Scan to pair another computer",
  "按模型": "By model",
  "换一台已配对的电脑": "Switch paired computer",
  "接口地址": "Endpoint URL",
  "操控电脑 · 执行过程（{n} 步）": "Computer use · {n} steps",
  "数据只存在本机": "Data stays on this PC",
  "新增": "Add",
  "无": "None",
  "暂无。": "None yet.",
  "最近连接": "Last seen",
  "未知原因": "Unknown reason",
  "本周额度": "Weekly usage",
  "本机 CLI 用量": "Local CLI usage",
  "模型上限": "Model limits",
  "模型与接口、Agent 官方登录、远程控制都在这里；本机 CLI 的版本和更新在「关于」。":
    "Models, endpoints, official agent login, and remote control are here. Local CLI versions and updates are under About.",
  "每个模型能装的上下文不一样（Claude 5 系 1M、Grok 4.6 500K、grok-build 256K、Codex 可输入约 272K）。聊到接近上限时，AllAi 会把更早的内容压成一段摘要、保留最近几轮原文 —— 和三家 CLI 自己在 83%–85% 做的事一样。走官方登录时，压缩意味着放弃":
    "Context windows differ (Claude 5 family 1M, Grok 4.6 500K, grok-build 256K, Codex ~272K input). Near the limit, AllAi folds earlier turns into a summary and keeps recent ones — like the CLIs at 83–85%. On official login, compacting drops",
  "每日 Token": "Daily tokens",
  "每日用量热力图": "Daily usage heatmap",
  "没有产出": "No output",
  "没有可配置的 Agent。": "No agents to configure.",
  "添加": "Add",
  "添加服务": "Add provider",
  "清除已保存的 Key": "Clear saved key",
  "点击图标切换 Agent：彩色亮起表示启用，灰色表示停用。":
    "Tap an icon to toggle an agent: color means on, gray means off.",
  "现在还没连上中继，手机扫了也配不上。": "Not connected to the relay yet, so scanning from a phone won’t pair.",
  "生成配对二维码": "Generate pairing QR code",
  "用到 {n}% 时压缩": "Compact at {n}%",
  "用手机摄像头扫电脑上「设置 → 远程」里的二维码即可配对。":
    "Scan the QR code in Settings → Remote on the computer with your phone camera.",
  "电脑上还没有可用的 Agent。": "No agents available on this computer.",
  "电脑上还没用过任何工作目录，先在电脑上建一条工作。":
    "This computer hasn’t used a working folder yet. Create a task on the computer first.",
  "百分比和重置次数来自官方接口；token 是 AllAi 记下的消耗":
    "Percents and reset counts come from the official API; tokens are what AllAi recorded",
  "约 {n}": "≈ {n}",
  "缓存": "Cache",
  "聊天、Agent、创作跑起来之后这里会自动累积。": "Totals accumulate as you use Chat, Agent, and Studio.",
  "聊天和 Agent 各自一个开关，输入框里推理强度左边那个「联网」按钮改的就是这里。官方登录的三家走各自 CLI 的搜索工具；第三方接口会带上":
    "Chat and Agent each have a switch — the Web button left of reasoning in the composer. Official logins use each CLI’s search tool; third-party APIs send the",
  "聊天输入框下面显示一行小字：输出速度、上下文长度、这条对话累计消耗、缓存命中率、当前模型来源等，显示哪几项可以自己选。用官方登录账号时还会显示该账号近 5 小时 / 近 7 天的用量。":
    "A small row under the composer can show speed, context length, this chat’s usage, cache hit rate, and model source. Official accounts also show 5-hour / 7-day usage.",
  "聊天输入框里那个「操控电脑」开关打开后，AI 会截屏、看图、然后操作你的鼠标键盘，发送任务后 AllAi 会暂时最小化并锁定它后面的应用窗口，一步一截图直到做完。普通点击、输入和按键会连续执行，不需要你中途切回来点确认。":
    "Turn on Computer use in the composer and the AI screenshots, looks, then drives mouse and keyboard. After you send, AllAi minimizes and locks the app behind it, one screenshot per step until done. Ordinary clicks, typing, and keys run continuously — you don’t have to come back to confirm.",
  "自动压缩上下文": "Auto-compact context",
  "花费里只有 Grok 和 CC Switch 导入的那部分是真实上报的":
    "Only Grok and CC Switch imports report real spend",
  "若您想配对其他电脑，请扫描二维码进行配对。": "To pair another computer, scan its QR code.",
  "要加一台电脑：在那台电脑的 AllAi「设置 → 远程」里生成二维码，":
    "To add a computer: generate a QR code in AllAi → Settings → Remote on that PC,",
  "要继续用，请在电脑上重新生成二维码配对。": "To keep using it, generate a new QR code on the computer and pair again.",
  "识别不到的模型可在下面填写推理档位，逗号分隔，例如 none,low,medium,high。留空则自动识别，默认均衡 medium。":
    "If a model isn’t recognized, type reasoning levels below, comma-separated, e.g. none,low,medium,high. Empty means auto-detect (default medium).",
  "请求 / 花费": "Requests / cost",
  "调低会更早压缩：省钱、少幻觉，但细节丢得早。调高更省事，但越接近上限模型的表现越差（业界经验是过 70–80% 就开始明显下滑）。":
    "Lower compact earlier: cheaper, fewer hallucinations, but details drop sooner. Higher is easier, but quality falls as you near the limit (often after 70–80%).",
  "近 5 小时": "Last 5 hours",
  "近 7 天": "Last 7 days",
  "还剩 {n} 分钟。扫不了码也可以把链接发到手机上打开。":
    "{n} minutes left. If you can’t scan, send the link to your phone.",
  "还没有 Agent": "No agents yet",
  "还没有人物": "No characters yet",
  "还没有全局提供商。点「新增」填一个中转站，三个 Agent 就都能选它了。":
    "No global providers yet. Tap Add, fill in a gateway, and all three agents can use it.",
  "还没有发现 Skills": "No skills found",
  "还没有接入模型": "No models added",
  "还没有模型，同步或手动添加。": "No models yet. Sync or add them.",
  "还没有模型，手动添加或同步。": "No models yet. Add them or sync.",
  "还没有用量记录": "No usage yet",
  "还没有配对的设备。": "No paired devices yet.",
  "这个范围内没有数据": "No data in this range",
  "这台电脑在手机上显示的名字": "This computer’s name on the phone",
  "这台设备的名字（电脑上会显示）": "This device’s name (shown on the computer)",
  "这里配一次，所有 Agent 的接口列表里都会出现，不用每个 Agent 各填一遍。去对应 Agent 里点「设为当前」就能用。":
    "Configure once here and it appears in every agent’s endpoint list. In that agent, tap Use this.",
  "远程控制只能在桌面版 AllAi 里设置。": "Remote control is configured in the desktop AllAi app.",
  "配对于": "Paired with",
  "配对后这台设备可以操控那台电脑上的 AllAi。只在你自己的设备上配对。":
    "After pairing, this device can control AllAi on that computer. Only pair your own devices.",
  "重复导入不会翻倍（整份替换）。同一天同一来源本机已经扫到的，以本机为准，不会重复计。":
    "Importing again replaces the whole set; it doesn’t double. Same day and source already scanned locally wins.",
  "重新生成": "Regenerate",
  "重置次数": "Resets",
  "防止它原地打转烧 token。到上限会自动停下，你可以再发一句让它继续。":
    "Stops runaway loops. At the cap it stops; send another message to continue.",
  "需要包含版本路径，例如 /v1。兼容 OpenAI Chat Completions 的服务都可以接。":
    "Include the version path, e.g. /v1. Any OpenAI Chat Completions-compatible API works.",
  "，不会自动清除。": ", and isn’t cleared automatically.",
  "，不改它任何东西。": " and doesn’t change anything in it.",
  "，周窗口至 {date}": ", week window until {date}",
  "，服务器只看得到密文。部署方法见项目里的 docs/REMOTE.md。":
    " the server only sees ciphertext. Deployment is in docs/REMOTE.md.",
  "，重置 {n} 次": ", {n} resets",
  "；Claude Code / Codex 的会话文件里没有钱，按型号单价估算（第三方中转站的价和官方也不一样），只能看个量级，别当账单。":
    "; Claude Code / Codex session files have no dollars, so spend is estimated from list prices (gateways differ from official). Treat it as order-of-magnitude, not a bill.",
  "；本机 CLI 的用量和导入的历史按天汇总存在": "; local CLI usage and imported history are rolled up by day in",

  /* ---------- 数据里的中文：模型上限 / 单价 / 厂商名 / 预设 / 推理档位 ----------
   * 这些字符串长在 lib/ 的数据表和用户数据里，翻之前界面上一律是中文。
   * 翻的是**显示**，不是数据本身 —— 表里存的还是中文，界面读的时候过一遍 t()。
   */

  /* 上下文上限（lib/context-window.ts） */
  "Claude 5 系": "Claude 5 series",
  "Claude 4 及更早": "Claude 4 and earlier",
  "GPT-5 / Codex（可输入部分）": "GPT-5 / Codex (input side)",
  "国产长文模型": "Chinese long-context models",
  "开源模型": "Open-source models",
  "你手动设定的": "Set by you",
  "认不出型号，按保守值算": "Model not recognized — using a safe estimate",
  "上下文已到 {pct}%（约 {before}/{limit}），已把更早的内容压成摘要，省下约 {saved} token。最近几轮保留原文。":
    "Context hit {pct}% (about {before}/{limit}), so the earlier messages were folded into a summary, saving about {saved} tokens. The latest turns are kept verbatim.",

  /* 型号单价（lib/model-pricing.ts） */
  "Claude Opus 4.5 及之后": "Claude Opus 4.5 and later",
  "Claude（按 Sonnet 估）": "Claude (priced as Sonnet)",
  "GPT-5.5 及之后": "GPT-5.5 and later",
  "o 系列": "o-series",

  /* 厂商名（lib/brand.ts 的 BRAND_LABEL） */
  "通义千问": "Qwen",
  "阿里巴巴": "Alibaba",
  "阿里云": "Alibaba Cloud",
  "阿里云百炼": "Alibaba Cloud Model Studio",
  "字节跳动": "ByteDance",
  "腾讯云": "Tencent Cloud",
  "百度智能云": "Baidu AI Cloud",
  "华为云": "Huawei Cloud",
  "智谱 GLM": "Zhipu GLM",
  "豆包": "Doubao",
  "腾讯混元": "Tencent Hunyuan",
  "文心一言": "Ernie",
  "讯飞星火": "iFlytek Spark",
  "阶跃星辰": "StepFun",
  "零一万物": "01.AI",
  "百川智能": "Baichuan",
  "书生·浦语": "InternLM",
  "商汤日日新": "SenseNova",
  "昆仑万维": "Skywork",
  "美团 LongCat": "Meituan LongCat",
  "硅基流动": "SiliconFlow",

  /* 预设接口（lib/templates.ts / lib/official-chat.ts） */
  "DashScope 兼容模式": "DashScope compatible mode",
  "保存后可从接口同步模型": "Save it, then sync models from the endpoint",
  "一个密钥聚合多家模型": "One key, models from many vendors",
  "用本机 Claude Code 登录 Anthropic 账号，聊天走订阅额度":
    "Uses the Anthropic account signed in on this machine; chat draws on your subscription",
  "用本机 Grok 登录 xAI 账号，聊天走订阅额度":
    "Uses the xAI account signed in on this machine; chat draws on your subscription",
  "用本机 Codex 登录的 ChatGPT 账号，聊天走订阅额度，界面还是 AllAi 自己的":
    "Uses the ChatGPT account signed in via Codex on this machine; chat draws on your subscription, the interface is still AllAi’s",
  "登录后聊天里会出现 Sonnet 5 / Opus 5 等型号":
    "After signing in, Sonnet 5 / Opus 5 and more appear in chat",
  "登录后聊天里会出现 Grok 4.6 等型号": "After signing in, Grok 4.6 and more appear in chat",
  "登录后聊天里会出现 GPT-5.6 / GPT-6 等型号":
    "After signing in, GPT-5.6 / GPT-6 and more appear in chat",

  /* 推理档位（lib/reasoning.ts）—— 大部分档位名上面已经翻过了，这里只补缺的 */
  "自定义": "Custom",
  "未识别": "Unrecognized",
  "通用思考模型": "Generic reasoning model",
  "Qwen 思考": "Qwen thinking",
  "Claude 扩展思考": "Claude extended thinking",

  /* 模型图标设置（components/BrandIconSettings.tsx） */
  "品牌色块": "Brand tile",
  "模型名前面的厂商图标。Anthropic / xAI / OpenAI 是自带的矢量图，其余认得出牌子的画品牌色块（DeepSeek、通义、Kimi、智谱这些都有）。想换成真图标：填网站域名会去它页面上找图标，填图片网址就直接用那张图，也可以从本地选一张。给「接口」配的图标会盖住它下面所有模型的厂商图标 —— 比逐个厂商配省事，又比按单个模型配省得重复。图标存在本机，不会每次渲染都去打别人的服务器。":
    "The vendor icon in front of each model name. Anthropic / xAI / OpenAI ship as vector art; other recognized vendors get a color tile with their initials (DeepSeek, Qwen, Kimi, Zhipu and more). To use a real icon: type a site domain and we pull the icon off that page, paste an image URL to use it directly, or choose a file from disk. Icons are stored locally.",
  "模型名前面的厂商图标。Anthropic / xAI / OpenAI 是自带的矢量图，其余认得出牌子的画品牌色块（DeepSeek、通义、Kimi、智谱这些都有）。想换成真图标：填网站域名会去它页面上找图标，填图片网址就直接用那张图，也可以从本地选一张。某一条服务自己的图标去「聊天模型 / Agent 接口」里那条服务上配。图标存在本机，不会每次渲染都去打别人的服务器。":
    "The vendor icon in front of each model name. Anthropic / xAI / OpenAI ship as vector art; other recognized vendors get a color tile (DeepSeek, Qwen, Kimi, Zhipu and more). To use a real icon: type a site domain, paste an image URL, or choose a file. A provider’s own icon is set on that service under Chat models / Agent endpoints. Icons stay on this PC.",
  "接口（配了这个，它下面的模型都跟着换）": "Endpoints (this overrides every model under it)",
  "接口默认": "Endpoint default",

  /* 统计热力图（components/UsageHeatmap.tsx） */
  "年": "Year",
  "季": "Quarter",
  "月": "Month",
  "一": "Mo",
  "二": "Tu",
  "三": "We",
  "四": "Th",
  "五": "Fr",
  "六": "Sa",
  "日": "Su",

  /* 创作 / 聊天里零散的中文 */
  "正在生成视频…": "Generating video…",
  "正在生成图片…": "Generating image…",
  "参考图.png": "reference.png",
  "参考视频.mp4": "reference.mp4",
  "自动识别": "Auto-detect",
  "未命名视频": "Untitled video",
  "未命名作品": "Untitled creation",
  "自定义命令": "Custom command",
  "（附件）": "(attachment)",
  "AllAi 额度": "AllAi quota",
  "近 5 小时已用到 {n}%": "Last 5 hours: {n}% used",
  "近 7 天已用到 {n}%": "Last 7 days: {n}% used",
  "正在绑定目标窗口…": "Binding the target window…",
  "上下文到量了，正在整理前文…": "Context is full — summarizing the earlier messages…",
  "正在整理前文…": "Summarizing the earlier messages…",
  "正在生成摘要… 已写 {n} 字": "Writing the summary… {n} characters so far",
  "上下文重置": "Context reset",
  "{reason}，这一轮从头开始": "{reason} — this turn starts over",
  "CLI 正在压缩… {detail}": "CLI is compacting… {detail}",
  "上下文到量了，正在用 {name} 的压缩指令…": "Context is full — running {name}’s compact command…",
  "{name} 已压缩当前会话，接着处理你的问题": "{name} compacted this session and is now on your question",
  "压缩没跑完，仍把你的问题发过去": "Compaction didn’t finish — sending your question anyway",
  "已切换到": "Switched to",
  "使用": "Started with",
  "开始对话": "for this chat",

  /* 提示 / 确认框 / 通知里漏掉的零散文案 */
  "{reason}，这一轮从头开始，之前的上下文没带上":
    "{reason} — this turn starts over and the earlier context didn’t carry across",
  "出错：{message}": "Error: {message}",
  "{name}已登录": "Signed in to {name}",
  "已退出{name}": "Signed out of {name}",
  "（{n} 个附件）": "({n} attachments)",
  "请先安装 {name}": "Install {name} first",
  "请先在设置里登录{name}": "Sign in to {name} in Settings first",
  "没能把之前的对话交给新模型，它可能不记得前面聊过什么":
    "Couldn’t hand the earlier chat to the new model — it may not remember what you discussed",
  "没能带上之前的进展，新模型可能不记得前面做过什么":
    "Couldn’t carry the earlier progress over — the new model may not remember what was done",
  "已把之前的进展交给模型（{n} 条）": "Handed the earlier progress to the model ({n} messages)",
  "{error}，已从列表隐藏": "{error} — hidden from the list",
  "删除「{name}」？": "Delete “{name}”?",
  "移除「{name}」？": "Remove “{name}”?",
  "这条创作": "this creation",
  "这个接口": "this endpoint",
  "电脑控制已停止：模型没有回复": "Computer control stopped: the model didn’t reply",
  "电脑控制已停止：模型没有给出可执行动作（{said}）":
    "Computer control stopped: no runnable action from the model ({said})",
  "模型没有任何回复，已停下": "No reply from the model — stopped",
  "接续 {n} · ": "Continued {n} · ",
  "接口 {n}": "Endpoint {n}",
  "全局接口 {n}": "Global endpoint {n}",
  "缓存读": "Cache read",
  "缓存写": "Cache write",
  "花费USD": "Cost USD",
  "专区": "Area",
  "服务": "Service",

  /* 额度监控（0.17.0） */
  "额度监控": "Quota monitor",
  "读不到额度监控数据": "Could not load quota monitor data",
  "额度监控需要桌面版": "Quota monitor needs the desktop app",
  "要读本机的官方登录文件和 CLI 会话记录，网页版拿不到。": "It reads the local sign-in files and CLI session logs, which the web version cannot access.",
  "{time}前采样 · AllAi 开着时每 5 分钟一次": "Sampled {time} ago · every 5 min while AllAi is open",
  "正在读取…": "Loading…",
  "还没有额度记录": "No quota history yet",
  "登录 Claude / ChatGPT / Grok 官方账号后，AllAi 开着时每 5 分钟记一次额度。攒上一两个小时，这里就能算出消耗速度和预计用完的时间。": "Sign in to an official Claude / ChatGPT / Grok account and AllAi records its quota every 5 minutes while open. After an hour or two this page can work out burn rate and when the quota runs out.",
  "数据还不够": "Not enough data yet",
  "额度已用完": "Quota used up",
  "马上就要用完": "About to run out",
  "会提前用完": "Will run out before reset",
  "有点紧": "Getting tight",
  "5 小时窗口快满了": "5-hour window almost full",
  "额度充裕": "Plenty of quota",
  "低": "low",
  "{n} 分钟": "{n} min",
  "{n} 小时": "{n} h",
  "周额度已用走势": "Weekly quota used over time",
  "{time} 重置": "Resets {time}",
  "近 24 小时每小时消耗": "Hourly usage, last 24 hours",
  "本机记录的这个账号的 token": "Tokens recorded on this computer for this account",
  "型号占比": "Share by model",
  "按 API 价折算的花费计算": "By cost at API prices",
  "按 token 计算": "By tokens",
  "官方接口暂时没有返回这个账号的额度。": "The official endpoint has not returned quota for this account yet.",
  "已经用完，{time} 重置。": "Used up. Resets {time}.",
  "按这周的节奏（含休息），大约 {time}（{left}后）用完，比重置早 {early}。":
    "At this week’s pace (including rest) it runs out around {time} (in {left}), {early} before reset.",
  "按这周的节奏，重置时会用到 {p}，接近上限。": "At this week’s pace you will reach {p} by reset, close to the limit.",
  "5 小时窗口已用 {p}，短时间内再大量使用可能会被限速。": "The 5-hour window is at {p}. Heavy use in the next few hours may get rate limited.",
  "按这周的节奏，重置时大约用到 {p}。": "At this week’s pace you will be at about {p} by reset.",
  "再采样一段时间就能给出预测。": "A forecast appears after a little more sampling.",
  "{n}%/小时": "{n}%/h",
  "周额度已用": "Weekly used",
  "消耗速度": "Burn rate",
  "含休息的平均 · 最近 {a}": "Average including rest · recent {a}",
  "含休息 · 大约每天用 {n} 小时 · 最近 {a}": "Including rest · about {n} h/day · recent {a}",
  "预计用完": "Runs out",
  "已用完": "Used up",
  "重置前用不完": "Not before reset",
  "约 {d}后": "in about {d}",
  "重置时约 {p}": "About {p} at reset",
  "采样跨度还不够": "Sampling span too short",
  "周额度折合": "Weekly quota worth",
  "5 小时额度折合": "5-hour quota worth",
  "≈ {n} token · 可信度{c}": "≈ {n} tokens · confidence {c}",
  "可信度{c}": "Confidence {c}",
  "每 1% 约": "Each 1% is about",
  "约 {m}": "about {m}",
  "已用 2% 以上、且本机有这个账号的用量后才能估": "Needs at least 2% used and local usage for this account",
  "本周已消耗": "Used this week",
  "这 5 小时已消耗": "Used this 5-hour window",
  "按 API 价约 {m}": "About {m} at API prices",
  "可用重置次数": "Resets available",
  "至少要两次采样才能画出曲线。AllAi 开着时每 5 分钟采一次。": "The line needs at least two samples. AllAi samples every 5 minutes while open.",
  "已用": "Used",
  "按这周节奏推算": "Projected at this week’s pace",
  "查看表格": "Show table",
  "时间": "Time",
  "近 24 小时本机没有这个账号的用量记录。": "No usage for this account on this computer in the last 24 hours.",
  "{n} 次请求": "{n} requests",
  "周额度 +{p}": "Weekly quota +{p}",
  "花费（估）": "Cost (est.)",
  "周额度变化": "Weekly change",
  "这个窗口里本机还没有这个账号的用量记录。": "No usage for this account on this computer in this window yet.",
  "其他 {n} 个型号": "{n} other models",
  "型号": "Model",
  "占比": "Share",
  "Claude Code 会话：~/.claude/settings.json 里没配中转地址就算官方账号（AllAi 里用 API 接口跑的 Claude Code 也会被算进来）。已计入 {n} 个会话。": "Claude Code sessions count as the official account when ~/.claude/settings.json has no relay address (Claude Code runs that AllAi starts with an API endpoint are counted too). {n} sessions included.",
  "Codex 会话：看每个会话自己记录的 model_provider，只算 openai 的。已计入 {a} 个，排除走中转的 {b} 个。": "Codex sessions are matched by the model_provider each session records; only openai counts. {a} included, {b} relay sessions excluded.",
  "Grok 会话文件不记录走的是哪个接口，而本机 Grok 配置了中转地址，所以 {n} 个 Grok Build 会话都没有计入，只算 AllAi 里官方登录聊天的用量 —— Grok 的折算可能偏低或算不出来。": "Grok session files do not record which endpoint they used, and the local Grok config points at a relay, so {n} Grok Build sessions are left out. Only official sign-in chats in AllAi count, which means the Grok estimate may be low or missing.",
  "Grok 会话：~/.grok/config.toml 里没配中转地址就算官方账号。已计入 {n} 个会话。": "Grok sessions count as the official account when ~/.grok/config.toml has no relay address. {n} sessions included.",
  "百分比来自官方接口，AllAi 开着时每 5 分钟记一次（~/.allai/quota-history.json）；token 和花费来自本机 CLI 会话和 AllAi 的聊天记录。": "Percentages come from the official endpoints and are recorded every 5 minutes while AllAi is open (~/.allai/quota-history.json). Tokens and cost come from local CLI sessions and AllAi chat records.",
  "额度折合 = 这个窗口里用掉的量 ÷ 官方显示的已用百分比。已用越多越准；花费按各家 API 公开价估算，不是账单。": "Quota worth = usage in this window ÷ the used percentage shown by the provider. The more you have used, the more accurate it is. Cost is estimated from public API prices and is not a bill.",
  "预测按这周实际节奏（已用百分比 ÷ 已经过的时间），把休息算进去，不会假设你 24 小时不停用。":
    "The forecast uses this week’s actual pace (used % ÷ elapsed time), so rest is included. It does not assume you run 24 hours a day.",
};


const TABLES: Record<Lang, Record<string, string>> = { zh: {}, en: EN };

/**
 * 取译文。没有对应词条就原样返回中文 —— 宁可显示中文，也别显示空白或 key。
 * `vars` 里的键对应文案里的 `{名字}`。
 */
export function translate(text: string, lang: Lang, vars?: Record<string, string | number>) {
  const table = TABLES[lang];
  let out = (table && table[text]) || text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
}

/** 词典覆盖了多少条（设置页里显示，方便看进度）。 */
export function translatedCount() {
  return Object.keys(EN).length;
}
