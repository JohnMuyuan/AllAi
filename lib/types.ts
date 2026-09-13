import { DEFAULT_COMPACT_PERCENT } from "./context-window";
import type { Compaction } from "./context-window";

export type { Compaction };

export type ModelKind = "chat" | "image" | "video";

export type ModelRef = {
  id: string;
  label: string;
  kind?: ModelKind;
  reasoningLevels?: string[];
};

export type ReasoningEffort = string;

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "audio" | "file";
  localPath?: string;
};



export type AppPrefs = {
  /** 语音识别用哪个服务的哪个模型，`providerId::modelId`。空 = 自动挑。 */
  speechModelKey: string;
  /** 麦克风按钮：auto = 没有可用的识别服务就不显示。 */
  voiceInput: "auto" | "on" | "off";
  /** 输入框下面那行调试信息（速度、上下文、本轮 token）。 */
  showStats: boolean;
  /** 统计行显示哪几项，取值见 components/StatsBar.tsx 的 STATS_FIELDS。 */
  statsFields: string[];
  /** 用户自己配的厂商图标：brandId 或 modelId -> data URI / 图片地址。 */
  brandIcons: Record<string, string>;
  /** 联网搜索开关，聊天和 Agent 分开管。创作台是生图，没有联网这回事。 */
  webSearchChat: boolean;
  webSearchAgent: boolean;
  /** 本机 CLI 是否经管理员宿主执行，聊天和 Agent 分开。 */
  cliAdminChat: boolean;
  cliAdminAgent: boolean;
  /** Agent 权限模式，按种类分开记：grok-build / claude-code / codex。 */
  agentPermissionMode: Record<string, string>;
  chatImageModelKey: string;
  agentImageModelKey: string;
  studioImageModelKey: string;
  studioVideoModelKey: string;
  reasoningEffort: ReasoningEffort;
  /** 到上限的百分之多少就自动压缩上下文。默认 80，见 lib/context-window.ts。 */
  compactPercent: number;
  /** 关掉就只显示进度、不自动压。到量后模型自己会报超长错误，用户自负。 */
  autoCompact: boolean;
  /** 手填的模型上下文上限，按模型 id 精确匹配，优先于内置识别表。 */
  contextLimits: Record<string, number>;
  /** 操控电脑的安全档位：逐步审核 / 仅关键提交确认 / 完全自动。 */
  computerSafety: "confirm-all" | "confirm-risky" | "auto";
  /** 一次任务最多走多少步，防止它原地打转烧 token。 */
  computerMaxSteps: number;
  /** Agent 一轮结束时发 Windows 通知。 */
  notifyAgentDone: boolean;
  /** 官方额度到 80% / 90% 时提醒。 */
  notifyQuota: boolean;
};

export const DEFAULT_REASONING = "medium";

export type StudioCharacter = {
  id: string;
  name: string;
  description: string;
  imageIds: string[];
  createdAt: number;
};

export type StudioConversation = {
  id: string;
  title: string;
  /** 创作也会攒上下文（前几轮的提示词），到量一样要压。 */
  compaction?: Compaction;
  createdAt: number;
  updatedAt: number;
};

export type StudioJob = {
  id: string;
  conversationId: string;
  mode: "image" | "video";
  prompt: string;
  /** 侧栏显示的标题。没有就退回提示词首行。 */
  title?: string;
  aspectRatio: string;
  characterIds: string[];
  modelKey: string;
  /** 这次是在上一张成品的基础上改的（自动带了参考图）。 */
  basedOnPrevious?: boolean;
  /** 模型切换提示：从哪个模型换过来。有这个字段就只显示切换条，不是一次创作。 */
  fromModelKey?: string;
  kind?: "model-switch" | "compact";
  /** kind 为 compact 时，那句说明文字。 */
  notice?: string;
  status: "running" | "done" | "error";
  error?: string;
  outputs: { id: string; mime: string }[];
  createdAt: number;
};

export type ProviderAuth = "api" | "claude-official" | "grok-official" | "chatgpt-official";

export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  auth?: ProviderAuth;
  extraHeaders?: Record<string, string>;
  models: ModelRef[];
  /** 用户在设置里保存过这个服务的模型列表，启动扫描不得再自动回填。 */
  modelsPinned?: boolean;
  /**
   * 拒绝过联网参数的模型 id。同一个中转地址上，GPT 可能支持而 Grok 不支持，
   * 所以按模型记，不按服务记。
   */
  webSearchUnsupported?: string[];
  createdAt: number;
};

export type PublicProvider = Omit<Provider, "apiKey"> & {
  hasKey: boolean;
  apiKeyMasked: string;
};

export type ChatRole = "system" | "user" | "assistant" | "notice";

/**
 * 这一轮里 AI 干的事：联网搜索、接口拒绝、出错……
 * 都显示在对话里，不用弹窗 —— 它们是回答的一部分，不是应用通知。
 */
export type ChatStep = {
  kind: "search" | "notice" | "error";
  text: string;
  at: number;
  /** 这一步对应的截图（上传件 id）。只在界面把一轮操控电脑合并显示时临时填，不落库。 */
  image?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  steps?: ChatStep[];
  modelKey?: string;
  /** 模型切换提示：从哪个模型换过来。 */
  fromModelKey?: string;
  attachments?: ChatAttachment[];
  /**
   * 操控电脑的一轮任务编号。同一轮里的消息在界面上合并成「一条用户目标 + 一条回复」：
   * 循环每一步都会替用户给模型发一句「已执行…这是新截图」，那是给模型的上下文，
   * 不是用户说的话，不能显示成用户气泡（0.15.5 改的）。
   */
  computerRun?: string;
  /** 这一轮里用户真正打的那句话。只在该轮第一条用户消息上有。 */
  computerGoal?: string;
  createdAt: number;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  modelKey: string;
  reasoningEffort?: ReasoningEffort;
  cliSessionId?: string;
  /** 上面那个 session 属于哪个官方账号（claude / grok / chatgpt）。换了就不能续。 */
  cliKind?: string;
  /** 已经交给该 session 的消息条数。对不上说明中间改过，得重放。 */
  cliDelivered?: number;
  /** 上下文压缩结果。前 `folded` 条已折成 `summary`，发出去时用摘要替代它们。 */
  compaction?: Compaction;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = {
  id: string;
  title: string;
  modelKey: string;
  updatedAt: number;
  createdAt: number;
  preview: string;
};

export type AgentKind = "grok-build" | "claude-code" | "codex" | "custom";
export type AgentAuthMode = "official" | "api";

export type ManagedSkill = {
  id: string;
  name: string;
  description: string;
  source: "grok" | "claude" | "codex" | "allai" | "project";
  path: string;
  sourcePath?: string;
  managed: boolean;
  disabledFor: AgentKind[];
};

export type AgentEndpoint = {
  id: string;
  label: string;
  mode: AgentAuthMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  models?: ModelRef[];
  /** 来自全局提供商池的接口，所有 Agent 共用；界面上只读，要改去全局那边改。
   *  只在发给界面/运行器的合并结果上出现，不会写进 agents[].endpoints。 */
  global?: boolean;
};

export type PublicEndpoint = Omit<AgentEndpoint, "apiKey"> & {
  hasKey: boolean;
  apiKeyMasked: string;
};

export type AgentProfile = {
  id: string;
  name: string;
  kind: AgentKind;
  command: string;
  args: string[];
  cwd: string;
  authMode: AgentAuthMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  extraEnv: Record<string, string>;
  endpoints: AgentEndpoint[];
  activeEndpointId: string;
  createdAt: number;
};

export type PublicAgent = Omit<AgentProfile, "apiKey" | "endpoints"> & {
  hasKey: boolean;
  apiKeyMasked: string;
  endpoints: PublicEndpoint[];
};

/**
 * Agent 改一个文件的差异，主进程从各家会话文件里解析（electron/diff.ts，那边有同样的类型）。
 * lines 每行第一个字符：+ 加、- 删、空格 上下文、@ 省略了一段（后面可以跟 hunk 头）。
 */
export type FileDiff = {
  path: string;
  kind: "add" | "update" | "delete" | "write";
  lines: string[];
  added: number;
  removed: number;
  truncated?: boolean;
  /** 较早的改动只留了统计（为了不拖慢界面），没有具体内容。 */
  elided?: boolean;
};

/** Agent 向用户提的问题（Claude Code 的 AskUserQuestion），在回复下面画成提问卡片。 */
export type AgentAsk = {
  questions: {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: { label: string; description?: string }[];
  }[];
};

export type AgentTraceItem =
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; detail?: string; diff?: FileDiff[]; ask?: AgentAsk };

/**
 * Agent 的「工作」来自各家 CLI 自己的 session 文件，我们改不了那些文件的标题。
 * 用户改的名字和隐藏状态存在这里，按 work id 覆盖上去。
 */
export type AgentWorkOverride = {
  title?: string;
  hidden?: boolean;
  /** 换模型的时间线。CLI 会话文件改不了，只能叠在这里。 */
  modelSwitches?: { id: string; createdAt: number; fromModelKey: string; modelKey: string }[];
  /**
   * 用户给这条工作选的模型（`接口id::模型id`）。
   * 不存的话，重启后 works 是重新扫 CLI 会话文件得来的，选择就没了 ——
   * 只在「选完又发过一轮」时才碰巧能从会话文件里读回来（0.16.19 修的）。
   */
  modelKey?: string;
  /**
   * 这条 CLI 会话实际在用的型号。换模型时拿它和界面选择对比，
   * 不一样就开新会话 —— Claude Code 的 `--resume` 不会换模型。
   */
  sessionModel?: string;
  /** 上下文压缩结果。会话文件是各家 CLI 的，改不了，只能叠在这里。 */
  compaction?: Compaction;
  /**
   * 「接续到新对话」：这条是从哪条工作接过来的 / 接到了哪条。
   * 值是工作 id 或 `种类:会话编号`（新工作开始是临时编号，拿到真实会话编号后会补存一份）。
   */
  continuedFrom?: string;
  continuedTo?: string;
};

export type Database = {
  providers: Provider[];
  /** 遗留字段：对话已经搬到 ~/.allai/conversations/，见 lib/conversations.ts。
   *  这里只在首次启动时用来做一次搬迁，之后一直是空数组。 */
  conversations: Conversation[];
  agents: AgentProfile[];
  /** 全局提供商池：在这里配一次，所有 Agent 自动都有，不用每个 Agent 重复填。 */
  agentEndpoints?: AgentEndpoint[];
  prefs: AppPrefs;
  skills: ManagedSkill[];
  characters: StudioCharacter[];
  studioConversations: StudioConversation[];
  studioJobs: StudioJob[];
  agentWorks?: Record<string, AgentWorkOverride>;
  seeded?: { xai?: boolean; webSearchReset?: boolean };
};

export const emptyPrefs = (): AppPrefs => ({
  speechModelKey: "",
  voiceInput: "auto",
  showStats: false,
  statsFields: ["speed", "context", "tokens", "cache", "model", "cost", "official"],
  compactPercent: DEFAULT_COMPACT_PERCENT,
  autoCompact: true,
  contextLimits: {},
  computerSafety: "confirm-risky",
  computerMaxSteps: 15,
  notifyAgentDone: true,
  notifyQuota: true,
  brandIcons: {},
  webSearchChat: false,
  webSearchAgent: true,
  cliAdminChat: false,
  cliAdminAgent: false,
  agentPermissionMode: {
    "grok-build": "bypassPermissions",
    "claude-code": "bypassPermissions",
    codex: "auto",
  },
  chatImageModelKey: "",
  agentImageModelKey: "",
  studioImageModelKey: "",
  studioVideoModelKey: "",
  reasoningEffort: "medium",
});

export type ChatSseEvent =
  | {
      type: "meta";
      conversationId: string;
      title: string;
      userMessageId: string;
      assistantMessageId: string;
      /** 这一轮压缩了上下文。界面据此更新进度条，否则会一直显示压缩前的数字。 */
      compaction?: Compaction;
    }
  | { type: "delta"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "error"; message: string }
  /** 不影响这轮回答，但用户该知道的事（比如联网没生效）。显示在对话里。 */
  | { type: "notice"; message: string; kind?: "search" | "notice" }
  | { type: "done"; aborted?: boolean };
