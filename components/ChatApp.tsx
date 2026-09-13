"use client";

import { Menu, PanelLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentModelProviders,
  findAgentModel,
  modelKeyFromWork,
  preferredAgentEndpointId,
} from "@/lib/agent-models";
import { appendThinkingTrace, appendToolTrace, upsertToolTrace } from "@/lib/agent-trace";
import { HANDOFF_MARK, stripHandoffTurns } from "@/lib/agent-handoff";
import { CHATGPT_WEB_KEY, isChatGptWeb } from "@/lib/chatgpt";
import {
  findOfficialProvider,
  officialChatSessionId,
  officialModelId,
  officialReasoningId,
  officialSpec,
  officialSpecForModelKey,
  OFFICIAL_CHATS,
  type OfficialChatKind,
} from "@/lib/official-chat";
import {
  compactNotice,
  contextLimit,
  contextStatus,
  estimateMessagesTokens,
  estimateTokens,
} from "@/lib/context-window";
import {
  describeAction,
  extractActions,
  needsConfirm,
  stripActions,
  type ComputerOp,
  type SafetyLevel,
} from "@/lib/computer-use";
import { getDesktop } from "@/lib/desktop";
import { applyTheme, readThemeMode, saveThemeMode, watchSystemTheme, type ThemeMode } from "@/lib/theme";
import { type LangMode } from "@/lib/i18n";
import { useLangState, useT } from "./I18n";
import { firstModelKey, parseModelKey, titleFrom } from "@/lib/public";
import { readSse } from "@/lib/sse-client";
import { permissionOptions, resolvePermission } from "@/lib/permission-mode";
import { agentContinueSession, agentModelSwitched, PENDING_SESSION_MODEL } from "@/lib/agent-session";
import { adaptCliCommand, nativeCompactPrompt, supportsNativeCompact } from "@/lib/cli-commands";
import { detectReasoning, resolveReasoningLevel } from "@/lib/reasoning";
import { officialModelsNeedRefresh, syncAgentEndpointModels } from "@/lib/sync-agent-models";
import { emptyPrefs } from "@/lib/types";
import { conversationUsage, liveContextTokens, windowUsage, type UsageEvent } from "@/lib/usage";
import type {
  AppPrefs,
  ChatAttachment,
  ChatMessage,
  Compaction,
  Conversation,
  ConversationSummary,
  AgentWorkOverride,
  ManagedSkill,
  PublicAgent,
  PublicProvider,
  StudioJob,
} from "@/lib/types";
import type {
  AgentMessage,
  AgentWork,
  ChatEvent,
  CliAuthStatus,
  DetectedCli,
  OfficialQuotaMap,
} from "@/types/desktop";
import { ActionBar } from "./ActionBar";
import { AgentWorkspace } from "./AgentWorkspace";
import { ChatGptPane } from "./ChatGptPane";
import { HandoffPanel, emptyHandoff, type HandoffState } from "./HandoffPanel";
import { NewWorkDialog } from "./NewWorkDialog";
import { Composer } from "./Composer";
import { Logo } from "./Logo";
import { MessageList } from "./MessageList";
import { ModelSelect } from "./ModelSelect";
import { SearchPalette } from "./SearchPalette";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar, type AppView } from "./Sidebar";
import { modelInfo } from "./ModelSwitch";
import {
  buildRemoteSnapshot,
  useRemoteBridge,
  useRemoteStatus,
  type RemoteApi,
  type RemoteView,
} from "./useRemoteControl";
import { useConfirm } from "./ConfirmDialog";
import { StatsBar } from "./StatsBar";
import { Studio } from "./Studio";

// 网页版留着当后备（要用画布、图片这些网页独有的功能时）。
// 想要 AllAi 自己的界面就用「ChatGPT 账号」，那条走本机 Codex 的订阅额度。
const CHATGPT_OPTION = [
  { key: CHATGPT_WEB_KEY, label: "ChatGPT 网页版", provider: "内嵌网页" },
];

function mergeAgentSwitches(
  messages: AgentMessage[],
  switches?: AgentWorkOverride["modelSwitches"],
): AgentMessage[] {
  if (!switches?.length) return messages;
  const seen = new Set(messages.map((item) => item.id));
  const extra: AgentMessage[] = [];
  for (const item of switches) {
    if (seen.has(item.id)) continue;
    extra.push({
      id: item.id,
      role: "notice",
      content: "",
      fromModelKey: item.fromModelKey,
      modelKey: item.modelKey,
      createdAt: item.createdAt,
    });
  }
  if (!extra.length) return messages;
  return [...messages, ...extra].sort((a, b) => a.createdAt - b.createdAt);
}

function workStamp(item: AgentWork) {
  return `${item.id}\0${item.cliSessionId}\0${item.running ? 1 : 0}\0${item.updatedAt}\0${item.title}\0${item.preview}\0${item.messagesFile ?? ""}\0${item.pid ?? ""}`;
}

/**
 * 把定时扫描的结果并进当前列表。单独导出是为了能测（见 scripts/test-work-merge.cjs）。
 */
export function mergeAgentWorkLists(current: AgentWork[], scanned: AgentWork[]) {
  const byId = new Map(scanned.map((item) => [item.id, item]));
  const byCli = new Map(scanned.map((item) => [item.cliSessionId, item]));
  const used = new Set<string>();
  const merged = current.map((item) => {
    const hit = byCli.get(item.cliSessionId) || byId.get(item.id);
    if (!hit) return item;
    used.add(item.id);
    used.add(hit.id);
    const newer = hit.updatedAt >= item.updatedAt ? hit : item;
    return {
      ...item,
      title: hit.title && hit.title !== "新工作" ? hit.title : item.title,
      preview: hit.preview || item.preview,
      running: hit.running,
      pid: hit.pid,
      updatedAt: Math.max(item.updatedAt, hit.updatedAt),
      messagesFile: newer.messagesFile || hit.messagesFile || item.messagesFile,
      messagesFiles: newer.messagesFiles || hit.messagesFiles || item.messagesFiles,
      /*
       * 扫到了就说明 CLI 已经把这条会话写出来了，它不再是「新的」。
       * 不接这一行的话 `source` 会永远停在 sendAgent 设的 "new" 上 ——
       * `canResume()` 一直为假，顶栏那个「复制恢复命令」按钮开了新会话就再也不回来
       * （0.16.21 修的）。
       */
      source: hit.source || item.source,
    };
  });
  for (const item of scanned) {
    if (used.has(item.id)) continue;
    if (merged.some((row) => row.id === item.id || row.cliSessionId === item.cliSessionId)) continue;
    merged.push(item);
  }
  merged.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  if (
    merged.length === current.length &&
    merged.every((item, index) => workStamp(item) === workStamp(current[index]))
  ) {
    return current;
  }
  return merged;
}

function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了，还在忙？";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function conversationTurnCount(messages: ChatMessage[]) {
  return messages.filter(
    (item) =>
      (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
  ).length;
}

function withChatError(conversation: Conversation, assistantId: string, message: string) {
  return {
    ...conversation,
    messages: conversation.messages.map((item) =>
      item.id === assistantId
        ? {
            ...item,
            steps: [
              ...(item.steps ?? []),
              { kind: "error" as const, text: message, at: Date.now() },
            ],
          }
        : item,
    ),
    updatedAt: Date.now(),
  };
}

/** 远程发起的 Agent 任务：没开「沿用电脑上的权限模式」时，把全部放行降一档。 */
function remotePermission(mode: string, remote?: { caps: { followPermission: boolean } }) {
  if (!remote || remote.caps.followPermission) return mode;
  if (mode === "bypassPermissions") return "acceptEdits";
  if (mode === "full") return "auto";
  return mode;
}

function quotaMark(pct?: number) {
  if (pct == null || !Number.isFinite(pct)) return 0;
  if (pct >= 90) return 90;
  if (pct >= 80) return 80;
  return 0;
}

/**
 * 「接续到新对话」时发给当前 Agent 的请求：让它自己把进度写成交接摘要。
 * 由这条工作正在用的模型来写 —— 它最清楚自己做过什么、改过哪些文件。
 */
const HANDOFF_PROMPT = `${HANDOFF_MARK}
请写一份「交接摘要」：我要开一个新对话接着做这件事，新对话里的你看不到现在这段历史，只能靠这份摘要接上。
要求：只输出摘要本身，不要调用任何工具、不要改任何文件；写具体（文件路径、命令、数字、名字都照实写），用中文，按下面几节写：
## 任务目标
## 已经完成
## 改过的文件（路径 + 改了什么）
## 还没做完 / 下一步
## 用户提过的要求和约束
## 需要注意的地方`;

export function ChatApp() {
  const confirm = useConfirm();
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [modelKey, setModelKey] = useState("");
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "chat" | "agents" | "imagine" | "skills" | "usage" | "general" | "remote" | "about"
  >("chat");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  /** 「操控电脑」开关。开着的时候，发一句话会进入截图→动作→再截图的循环。 */
  const [computerUse, setComputerUse] = useState(false);
  const [computerUseAgent, setComputerUseAgent] = useState(false);
  const [computerBusy, setComputerBusy] = useState(false);
  /** 只有真正不可逆的提交点才会到这里；普通控制步骤连续自动执行。 */
  const [pendingAction, setPendingAction] = useState<{
    action: ComputerOp;
    resolve: (ok: boolean) => void;
  } | null>(null);
  // send() 里要读这两个，用 ref 避免把它们塞进 send 的依赖。
  const computerUseRef = useRef(false);
  const shotSizeRef = useRef<{
    width: number;
    height: number;
    changedRatio?: number;
    controls?: { id: number; type: string; name: string; x: number; y: number; width: number; height: number }[];
    windows?: { id: string; title: string }[];
    target?: { id: string; pid: number; title: string; x: number; y: number; width: number; height: number };
  }>({ width: 0, height: 0 });
  const computerStopRef = useRef(false);
  const [agentAttachments, setAgentAttachments] = useState<ChatAttachment[]>([]);
  const [prefs, setPrefs] = useState<AppPrefs>(emptyPrefs);
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [reasoning, setReasoning] = useState("medium");
  const [studioConversations, setStudioConversations] = useState<ConversationSummary[]>([]);
  const [activeStudioId, setActiveStudioId] = useState<string | null>(null);
  const [studioJobs, setStudioJobs] = useState<StudioJob[]>([]);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  /** 外观模式（日间 / 夜间 / 跟随系统）。真正的深浅由 lib/theme.ts 现算。 */
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const { langMode, setLangMode } = useLangState();
  const t = useT();
  const [toast, setToast] = useState("");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<AppView>("chat");
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [, setDetected] = useState<DetectedCli[]>([]);
  const [works, setWorks] = useState<AgentWork[]>([]);
  const worksRef = useRef<AgentWork[]>(works);
  worksRef.current = works;
  /*
   * AllAi 自己正在跑的那几条工作。
   *
   * 各家 CLI 的「在跑没在跑」要么靠登记表、要么靠会话文件的时间，都得等下一轮扫描（4 秒）
   * 才反映出来。可这一轮是**我们自己 spawn 的**，按下发送的那一刻就知道 —— 直接标上，
   * 侧栏的绿点立刻就亮，不用等扫描（0.16.23）。
   */
  const [localRunning, setLocalRunning] = useState<string[]>([]);
  const markRunning = useCallback((id: string, running: boolean) => {
    setLocalRunning((current) => {
      if (running) return current.includes(id) ? current : [...current, id];
      return current.includes(id) ? current.filter((item) => item !== id) : current;
    });
  }, []);
  // 用户给工作起的名字 / 删掉的工作。会话本体在各家 CLI 目录里，这只是一层覆盖。
  const [workOverrides, setWorkOverrides] = useState<Record<string, AgentWorkOverride>>({});
  const workOverridesRef = useRef(workOverrides);
  useEffect(() => {
    workOverridesRef.current = workOverrides;
  }, [workOverrides]);
  /** 「接续到新对话」：两条工作互相记住对方（存在覆盖层里，CLI 的会话文件改不了）。 */
  const linkHandoff = useCallback((fromId: string, toId: string) => {
    setWorkOverrides((current) => ({
      ...current,
      [toId]: { ...current[toId], continuedFrom: fromId },
      [fromId]: { ...current[fromId], continuedTo: toId },
    }));
    const save = (body: Record<string, string>) =>
      fetch("/api/agent-works", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    void save({ id: toId, continuedFrom: fromId });
    void save({ id: fromId, continuedTo: toId });
  }, []);
  /**
   * 新建的工作一开始是临时编号；发第一条（或 Codex 报出自己的会话编号）后，重启时列表按
   * `种类:真实会话编号` 认它。那一刻把接续关系补存到真实编号上，不然重启后两头就断了。
   */
  const followHandoff = useCallback(
    (workId: string, kind: string, cliSessionId: string) => {
      const from = workOverridesRef.current[workId]?.continuedFrom;
      const key = `${kind}:${cliSessionId}`;
      if (!from || key === workId || workOverridesRef.current[key]?.continuedFrom === from) return;
      linkHandoff(from, key);
    },
    [linkHandoff],
  );
  /** 正在等哪条工作把交接摘要写完。这一轮结束（done）时兑现。 */
  const handoffWaiter = useRef<{ sessionId: string; resolve: (ok: boolean) => void } | null>(null);
  /** 正在等 CLI 自己的 /compact 跑完，再发用户那一句。 */
  const compactWaiter = useRef<{ sessionId: string; resolve: (ok: boolean) => void } | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoff, setHandoff] = useState<HandoffState>(emptyHandoff);
  /*
   * 事件回调是靠 deps 重建的，直接读 state 会拿到过期值（和约定 20 一个道理）。
   * 「这条事件属不属于那轮交接」必须读最新的，走 ref。
   */
  const handoffRef = useRef<HandoffState>(handoff);
  handoffRef.current = handoff;
  const handoffStep = useRef(0);
  /**
   * 这一轮交接自己吐出来的正文。
   *
   * **不能靠「会话文件里最后一条 assistant」当摘要。** 交接常常要开一条新的 CLI 会话
   * （上下文满了、换了模型），而这条工作本地记的 `messagesFile` 要等下一次扫描才更新 ——
   * 那几秒里读到的是**上一条会话**，最后一条 assistant 就是上一轮的普通回复。
   * 用户拿到的「摘要」于是变成一段「晚安，辛苦啦～」（0.16.21 修的）。
   */
  const handoffReply = useRef("");
  /** 用户在面板里按了「停止接续」，用来区分「停了」和「跑完了但没拿到摘要」。 */
  const handoffStoppedRef = useRef(false);
  /** 把模型这一步在干什么记进面板。只留最近 40 条，够看又不会越堆越长。 */
  const pushHandoffStep = useCallback((text: string) => {
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!clean) return;
    setHandoff((current) => {
      if (!current.running) return current;
      if (current.steps.at(-1)?.text === clean) return current;
      const id = (handoffStep.current += 1);
      return { ...current, steps: [...current.steps, { id, text: clean }].slice(-40) };
    });
  }, []);
  /**
   * CLI 自己报的窗口占用，按工作 id 存。**优先于我们按字符估的数**：
   * 估算看不见 CLI 内部已经 compact 过、也看不见工具输出占的量，
   * 实测能差 4.5 倍（0.12.1 的 BUG）。见 electron/history.ts 的 readContextUsage。
   */
  const [cliContext, setCliContext] = useState<
    Record<string, { tokens: number; window?: number }>
  >({});
  /**
   * 官方登录聊天里 Grok 的窗口占用。它一轮可能调多次模型，而记下来的 usage
   * 是这几次的**总和**，当窗口占用会虚高好几倍 —— 得单独去 CLI 日志里取。
   */
  const [grokChatContext, setGrokChatContext] = useState(0);
  // 输入框下面那行统计用的数据
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  /** 读到用量的时刻。渲染里不能直接 Date.now()，滚动窗口按这个算。 */
  const [usageNow, setUsageNow] = useState(0);
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [officialQuota, setOfficialQuota] = useState<OfficialQuotaMap>({});
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentDraft, setAgentDraft] = useState("");
  const agentDraftRef = useRef("");
  const [agentStreaming, setAgentStreaming] = useState(false);
  const [newWorkOpen, setNewWorkOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  // 官方登录聊天（Claude 账号 / Grok 账号）的登录状态，按 kind 存。
  const [officialStatus, setOfficialStatus] = useState<
    Partial<Record<OfficialChatKind, CliAuthStatus>>
  >({});
  const [officialBusy, setOfficialBusy] = useState<OfficialChatKind | null>(null);

  function openSettings(
    tab: "chat" | "agents" | "imagine" | "skills" | "usage" | "general" = "chat",
    agentId?: string,
  ) {
    setSettingsTab(tab);
    setSettingsAgentId(agentId ?? null);
    setSettingsOpen(true);
    setMobileOpen(false);
  }

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const agentMessageCache = useRef<Record<string, AgentMessage[]>>({});
  const officialTurnRef = useRef<{
    kind: OfficialChatKind;
    sessionId: string;
    conversationId: string;
    assistantId: string;
    cliSessionId?: string;
    firstTurn: boolean;
    delivered: number;
    modelId: string;
  } | null>(null);
  const agentSyncTried = useRef(new Set<string>());
  /** 每个 CLI 会话最近一次回复用的型号（从 assistant 事件里读）。用量记录缺型号时拿它兜底。 */
  const sessionModels = useRef(new Map<string, string>());
  const quotaMarkRef = useRef<Record<string, { five: number; week: number }>>({});
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const loadUsage = useCallback(async () => {
    const response = await fetch("/api/usage");
    const data = (await response.json()) as { events: UsageEvent[] };
    setUsageEvents(data.events ?? []);
    setUsageNow(Date.now());
    return data.events ?? [];
  }, []);

  /** 把一轮的 token 用量记到 ~/.allai/usage.json，设置里的「使用统计」读它。 */
  const recordUsage = useCallback(
    (
      area: "chat" | "agent" | "studio",
      source: string,
      event: Extract<ChatEvent, { type: "usage" }>,
      fallbackModel?: string,
      conversationId?: string,
    ) =>
      fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area,
          source,
          conversationId,
          modelId: event.modelId || fallbackModel || "",
          input: event.input,
          output: event.output,
          cacheRead: event.cacheRead,
          cacheWrite: event.cacheWrite,
          reasoning: event.reasoning,
          contextTokens: event.contextTokens ?? 0,
          costUsd: event.costUsd ?? 0,
          durationMs: event.durationMs ?? 0,
        }),
      })
        .then(() => loadUsage())
        .catch(() => undefined),
    [loadUsage],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  const refreshOfficialStatus = useCallback(async (alive: () => boolean = () => true) => {
    const desktop = getDesktop();
    if (!desktop?.cliAuthStatus) return;
    const rows = await Promise.all(
      OFFICIAL_CHATS.map(async (spec) => {
        const status = await desktop.cliAuthStatus(spec.cliKind).catch(() => null);
        return [spec.kind, status] as const;
      }),
    );
    if (!alive()) return;
    setOfficialStatus((current) => {
      const next = { ...current };
      for (const [kind, status] of rows) {
        if (status) next[kind] = status;
      }
      return next;
    });
  }, []);

  const loadProviders = useCallback(async () => {
    const response = await fetch("/api/providers");
    const data = (await response.json()) as { providers: PublicProvider[] };
    setProviders(data.providers);
    setModelKey((current) => {
      if (isChatGptWeb(current)) return current;
      const exists = data.providers.some((provider) =>
        provider.models.some((model) => `${provider.id}::${model.id}` === current),
      );
      if (exists) return current;
      return firstModelKey(data.providers) || current;
    });
    return data.providers;
  }, []);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    const data = (await response.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  const loadAgents = useCallback(async () => {
    const response = await fetch("/api/agents");
    const data = (await response.json()) as { agents: PublicAgent[] };
    setAgents(data.agents);
    return data.agents;
  }, []);

  const loadPrefs = useCallback(async () => {
    const response = await fetch("/api/prefs");
    const data = (await response.json()) as { prefs: AppPrefs };
    setPrefs(data.prefs);
    setReasoning(data.prefs.reasoningEffort || "medium");
    return data.prefs;
  }, []);

  const loadStudioConversations = useCallback(async () => {
    const response = await fetch("/api/studio/conversations");
    const data = (await response.json()) as { conversations: ConversationSummary[] };
    setStudioConversations(data.conversations ?? []);
    return data.conversations ?? [];
  }, []);

  const loadStudioThread = useCallback(async (id: string | null) => {
    if (!id) {
      setStudioJobs([]);
      return [];
    }
    const response = await fetch(`/api/studio/conversations/${id}`);
    if (!response.ok) {
      setStudioJobs([]);
      return [];
    }
    const data = (await response.json()) as { jobs: StudioJob[] };
    setStudioJobs(data.jobs ?? []);
    return data.jobs ?? [];
  }, []);

  /**
   * 官方登录聊天不经过 /api/chat，落库要自己来。
   * 第一轮结束后顺便让别的服务给这条对话起个标题 —— 侧栏里不好只显示前 28 个字。
   */
  const saveOfficialConversation = useCallback(
    async (conversation: Conversation, firstTurn: boolean) => {
      try {
        await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation }),
        });
        if (firstTurn) {
          const response = await fetch(`/api/conversations/${conversation.id}/title`, {
            method: "POST",
          });
          if (response.ok) {
            const data = (await response.json()) as { title?: string };
            if (data.title) {
              setActive((prev) =>
                prev && prev.id === conversation.id ? { ...prev, title: data.title! } : prev,
              );
            }
          }
        }
      } finally {
        await loadConversations().catch(() => undefined);
      }
    },
    [loadConversations],
  );

  const loadWorkOverrides = useCallback(async () => {
    const response = await fetch("/api/agent-works");
    const data = (await response.json()) as { works: Record<string, AgentWorkOverride> };
    setWorkOverrides(data.works ?? {});
    return data.works ?? {};
  }, []);

  const loadSkills = useCallback(async () => {
    const response = await fetch("/api/skills");
    const data = (await response.json()) as { skills: ManagedSkill[] };
    setSkills(data.skills);
    return data.skills;
  }, []);

  const syncAgentModels = useCallback(
    async (agentId: string, endpointId: string, silent = false) => {
      const agent = agents.find((item) => item.id === agentId);
      if (!agent) return;
      try {
        await syncAgentEndpointModels(agent, endpointId);
        await loadAgents();
      } catch (err) {
        if (!silent) showToast(err instanceof Error ? err.message : "同步模型失败");
      }
    },
    [agents, loadAgents, showToast],
  );

  useEffect(() => {
    const mode = readThemeMode();
    applyTheme(mode);
    const storedSidebar = localStorage.getItem("allai-sidebar");
    const storedCwd = localStorage.getItem("allai-agent-cwd") || "";

    /* eslint-disable react-hooks/set-state-in-effect -- 挂载时的首次加载 */
    Promise.allSettled([
      loadProviders(),
      loadConversations(),
      loadAgents(),
      loadPrefs(),
      loadSkills(),
      loadStudioConversations(),
      loadWorkOverrides(),
      loadUsage(),
    ])
      .then((results) => {
        const loaded = results[0].status === "fulfilled" ? results[0].value : [];
        setThemeMode(mode);
        if (storedSidebar === "0") setSidebarOpen(false);
        if (storedCwd) setCwd(storedCwd);
        const desktop = getDesktop();
        if (loaded.length === 0 && !desktop) setSettingsOpen(true);
        if (desktop) {
          setIsDesktop(true);
          desktop.detect().then(setDetected).catch(() => undefined);
          desktop.scanWorks().then(setWorks).catch(() => undefined);
          void refreshOfficialStatus();
        }
        if (results.some((result) => result.status === "rejected")) {
          showToast("部分本地数据读取失败，原文件已保留");
        }
      })
      .finally(() => {
        setReady(true);
        void fetch("/api/providers/scan", { method: "POST" })
          .then(() => loadProviders())
          .catch(() => undefined);
      });
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时跑一次
  }, [loadAgents, loadConversations, loadStudioConversations, loadPrefs, loadProviders, loadSkills, loadUsage, loadWorkOverrides, showToast]);

  useEffect(() => {
    if (!isDesktop) return;
    for (const agent of agents) {
      for (const endpoint of agent.endpoints) {
        if (endpoint.mode !== "official") continue;
        if (!officialModelsNeedRefresh(agent.kind, endpoint.models)) continue;
        const key = `${agent.id}:${endpoint.id}`;
        if (agentSyncTried.current.has(key)) continue;
        agentSyncTried.current.add(key);
        void syncAgentModels(agent.id, endpoint.id, true);
      }
    }
  }, [agents, isDesktop, syncAgentModels]);

  useEffect(() => {
    if (!isDesktop || (!prefs.showStats && prefs.notifyQuota === false)) return;
    const desktop = getDesktop();
    if (!desktop?.officialQuota) return;
    const tick = () => {
      void desktop.officialQuota().then(setOfficialQuota).catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 120000);
    return () => window.clearInterval(timer);
  }, [isDesktop, prefs.showStats, prefs.notifyQuota]);

  useEffect(() => {
    if (!isDesktop || prefs.notifyQuota === false) return;
    const desktop = getDesktop();
    if (!desktop?.notify) return;
    for (const spec of OFFICIAL_CHATS) {
      const quota = officialQuota[spec.kind];
      if (!quota) continue;
      const prev = quotaMarkRef.current[spec.kind] ?? { five: 0, week: 0 };
      const five = quotaMark(quota.fiveHourPct);
      const week = quotaMark(quota.weekPct);
      quotaMarkRef.current[spec.kind] = { five, week };
      const parts: string[] = [];
      if (five > prev.five) parts.push(`近 5 小时已用到 ${five}%`);
      if (week > prev.week) parts.push(`近 7 天已用到 ${week}%`);
      if (!parts.length) continue;
      void desktop.notify({
        title: "AllAi 额度",
        body: `${spec.name} ${parts.join("，")}`,
      });
    }
  }, [isDesktop, prefs.notifyQuota, officialQuota]);

  useEffect(() => {
    if (!isDesktop || view !== "agents") return;
    const desktop = getDesktop();
    if (!desktop) return;
    const tick = () => {
      void desktop.scanWorks().then((scanned) => {
        setWorks((current) => mergeAgentWorkLists(current, scanned));
      });
    };
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, [isDesktop, view]);

  useEffect(() => {
    // 登录状态只在设置页操作期间需要高频刷新。只要添加过官方服务就每 2.5 秒
    // 扫三套 CLI，会让应用闲置时也持续做磁盘/进程探测；挂载时已经主动读过一次。
    if (!settingsOpen && !officialBusy) return;
    if (!getDesktop()?.cliAuthStatus) return;
    let alive = true;
    const tick = () => {
      void refreshOfficialStatus(() => alive);
    };
    tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [officialBusy, providers, refreshOfficialStatus, settingsOpen]);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;
    return desktop.onChat((sessionId, event: ChatEvent) => {
      if (event.type === "model") {
        sessionModels.current.set(sessionId, event.modelId);
        return;
      }
      const officialTurn = officialTurnRef.current;
      if (officialTurn && sessionId === officialTurn.sessionId) {
        if (event.type === "delta") {
          setActive((prev) => {
            if (!prev || prev.id !== officialTurn.conversationId) return prev;
            return {
              ...prev,
              messages: prev.messages.map((item) =>
                item.id === officialTurn.assistantId
                  ? { ...item, content: item.content + event.text }
                  : item,
              ),
            };
          });
        }
        if (event.type === "replace") {
          setActive((prev) => {
            if (!prev || prev.id !== officialTurn.conversationId) return prev;
            return {
              ...prev,
              messages: prev.messages.map((item) =>
                item.id === officialTurn.assistantId ? { ...item, content: event.text } : item,
              ),
            };
          });
        }
        if (event.type === "thinking") {
          setActive((prev) => {
            if (!prev || prev.id !== officialTurn.conversationId) return prev;
            return {
              ...prev,
              messages: prev.messages.map((item) =>
                item.id === officialTurn.assistantId
                  ? { ...item, reasoning: (item.reasoning || "") + event.text }
                  : item,
              ),
            };
          });
        }
        if (event.type === "session") {
          officialTurn.cliSessionId = event.cliSessionId;
          setActive((prev) =>
            prev && prev.id === officialTurn.conversationId
              ? { ...prev, cliSessionId: event.cliSessionId }
              : prev,
          );
        }
        if (event.type === "usage") {
          void recordUsage(
            "chat",
            officialSpec(officialTurn.kind).name,
            event,
            // CLI 不一定在事件里报型号，我们自己知道这轮用的是哪个，兜底传进去，
            // 否则统计页会显示成「未知模型」。
            // 选的是「默认型号」时 modelId 是空的；回复里带的真实型号优先（0.16.9 起，之前会记成「未知模型」）。
            sessionModels.current.get(sessionId) || officialTurn.modelId,
            officialTurn.conversationId,
          );
        }
        if (event.type === "reset") {
          // 续不上就是续不上，别让用户以为模型还记得前面说过什么。
          addStep(
            officialTurn.assistantId,
            "notice",
            `${event.reason}，这一轮从头开始，之前的上下文没带上`,
          );
          setActive((prev) => {
            if (!prev || prev.id !== officialTurn.conversationId) return prev;
            // 会话没了，标记作废，下一轮一定会重放上下文而不是再赌一次 resume。
            return {
              ...prev,
              cliSessionId: undefined,
              cliKind: undefined,
              cliDelivered: undefined,
            };
          });
        }
        if (event.type === "error") {
          addStep(officialTurn.assistantId, "error", event.message);
        }
        if (event.type === "done") {
          const finished = officialTurn;
          officialTurnRef.current = null;
          streamingRef.current = false;
          setStreaming(false);
          setActive((prev) => {
            if (!prev || prev.id !== finished.conversationId) return prev;
            const next = {
              ...prev,
              cliSessionId: finished.cliSessionId || prev.cliSessionId,
              // 记下这个 session 属于哪个账号、已经见过多少条 ——
              // 下一轮据此判断能不能 resume，对不上就重放。
              cliKind: finished.cliSessionId ? finished.kind : prev.cliKind,
              cliDelivered: finished.cliSessionId
                ? conversationTurnCount(prev.messages)
                : prev.cliDelivered,
              updatedAt: Date.now(),
            };
            void saveOfficialConversation(next, finished.firstTurn);
            return next;
          });
        }
        return;
      }
      /*
       * 「接续到新对话」那一轮是静默跑的（约定 63：不许伪装成用户消息），
       * 所以它既不能往 agentMessages 里写，也就没有任何东西能让用户看出它在动。
       * 进度全靠这里把事件喂给面板 —— 而且必须放在下面那个
       * `sessionId !== activeWorkId` 之前：用户很可能已经切到别的工作去了。
       */
      const live = handoffRef.current;
      if (live.running && live.sessionId === sessionId) {
        if (event.type === "tool") pushHandoffStep(event.detail ? `${event.name}：${event.detail}` : event.name);
        if (event.type === "thinking") pushHandoffStep(event.text);
        if (event.type === "delta" || event.type === "replace") {
          if (event.type === "replace") handoffReply.current = event.text;
          else handoffReply.current += event.text;
          const chars = handoffReply.current.length;
          setHandoff((current) => (current.running ? { ...current, phase: "生成摘要", chars } : current));
        }
        if (event.type === "error") {
          pushHandoffStep(`出错：${event.message}`);
        }
        // 这一轮没有属于自己的助手气泡，落下去只会接到**上一轮**那条回复后面，
        // 把旧工作最后一条弄脏（文件监视器随后会覆盖回来，中间那几秒用户看得见）。
        if (event.type !== "session" && event.type !== "usage" && event.type !== "done") return;
      }
      if (compactWaiter.current?.sessionId === sessionId) {
        if (event.type === "delta" || event.type === "thinking" || event.type === "tool") {
          const detail =
            event.type === "tool"
              ? event.detail
                ? `${event.name}：${event.detail}`
                : event.name
              : event.type === "thinking"
                ? event.text
                : event.text;
          if (detail.trim()) {
            setAgentMessages((current) => {
              const last = current.at(-1);
              if (!last || last.role !== "assistant") return current;
              return current.map((item) =>
                item.id === last.id
                  ? { ...item, trace: upsertToolTrace(item.trace, "压缩上下文", `CLI 正在压缩… ${detail.slice(0, 80)}`) }
                  : item,
              );
            });
          }
        }
        if (event.type !== "session" && event.type !== "usage" && event.type !== "done") return;
      }
      if (sessionId !== activeWorkId) return;
      if (event.type === "delta") {
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id ? { ...item, content: item.content + event.text } : item,
          );
        });
      }
      if (event.type === "replace") {
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id ? { ...item, content: event.text } : item,
          );
        });
      }
      if (event.type === "thinking") {
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id
              ? {
                  ...item,
                  thinking: (item.thinking || "") + event.text,
                  trace: appendThinkingTrace(item.trace, event.text),
                }
              : item,
          );
        });
      }
      if (event.type === "tool") {
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id
              ? {
                  ...item,
                  tools: [...(item.tools || []), { name: event.name, detail: event.detail }],
                  trace: appendToolTrace(item.trace, event.name, event.detail, event.diff, event.ask),
                }
              : item,
          );
        });
      }
      if (event.type === "session") {
        setWorks((current) =>
          current.map((item) =>
            item.id === sessionId ? { ...item, cliSessionId: event.cliSessionId } : item,
          ),
        );
        const sessionWork = works.find((item) => item.id === sessionId);
        if (sessionWork) followHandoff(sessionId, sessionWork.kind, event.cliSessionId);
      }
      if (event.type === "usage") {
        /*
         * Agent 的用量**不在这里记**（0.16.35 起）。
         *
         * 各家 CLI 每次 API 请求都会把 usage 写进自己的会话文件，主进程增量扫那些文件
         * （electron/usage-scan.ts）—— 那份账把你在终端里、在别的壳子里跑的也一起算上，更全。
         * 两边都记就会**翻倍**：这里拿到的是一轮的合计，会话文件里是同一轮每次请求的明细。
         * 所以这条路只留给聊天和创作；这一轮刚写完，顺手叫扫描器补一次，统计页立刻就有。
         */
        void getDesktop()?.scanUsage?.().catch(() => undefined);
      }
      if (event.type === "reset") {
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id
              ? {
                  ...item,
                  trace: appendToolTrace(item.trace, "上下文重置", `${event.reason}，这一轮从头开始`),
                }
              : item,
          );
        });
      }
      if (event.type === "error") {
        // 错误也长在对话里，跟工具调用排在一起。
        setAgentMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return current.map((item) =>
            item.id === last.id
              ? { ...item, trace: appendToolTrace(item.trace, "出错", event.message) }
              : item,
          );
        });
      }
      if (event.type === "done") {
        if (compactWaiter.current?.sessionId === sessionId) {
          const waiter = compactWaiter.current;
          compactWaiter.current = null;
          waiter.resolve(true);
          return;
        }
        setAgentStreaming(false);
        markRunning(sessionId, false);
        if (handoffWaiter.current?.sessionId === sessionId) {
          const waiter = handoffWaiter.current;
          handoffWaiter.current = null;
          // 等最后一段文字渲染进 agentMessages 再去取摘要。
          window.setTimeout(() => waiter.resolve(true), 120);
        }
        const desktopNow = getDesktop();
        const refresh = () => {
          void desktopNow?.scanWorks().then((scanned) => {
            setWorks((current) => mergeAgentWorkLists(current, scanned));
          });
        };
        refresh();
        window.setTimeout(refresh, 2000);
        if (prefsRef.current.notifyAgentDone !== false) {
          const work = works.find((item) => item.id === sessionId);
          const title = workOverrides[sessionId]?.title || work?.title || "Agent";
          void desktopNow?.notify?.({ title: "AllAi", body: `「${title}」做完了` });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveOfficialConversation 只用 loadConversations
  }, [activeWorkId, loadConversations, recordUsage, showToast, works]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyO") {
        event.preventDefault();
        interruptChat();
        setActive(null);
        setDraft("");
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 标题栏上的「远程」小标记点一下直接打开设置里的远程页。
  useEffect(() => {
    function onOpen(event: Event) {
      const tab = (event as CustomEvent<string>).detail;
      if (tab === "remote") setSettingsTab("remote");
      setSettingsOpen(true);
    }
    window.addEventListener("allai:open-settings", onOpen);
    return () => window.removeEventListener("allai:open-settings", onOpen);
  }, []);

  const pickLang = useCallback((mode: LangMode) => {
    setLangMode(mode);
  }, [setLangMode]);

  const pickTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
    applyTheme(mode);
  }, []);

  /*
   * 选了「跟随系统」就得真的跟着走：用户在 Windows 里改深浅色，这里要当场变。
   * 别的模式不订阅，省得白跑。
   */
  useEffect(() => {
    if (themeMode !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [themeMode]);

  function toggleSidebar() {
    setSidebarOpen((current) => {
      const next = !current;
      localStorage.setItem("allai-sidebar", next ? "1" : "0");
      return next;
    });
  }

  function interruptChat() {
    abortRef.current?.abort();
    const desktop = getDesktop();
    const sessionId = officialTurnRef.current?.sessionId;
    if (desktop && sessionId) void desktop.kill(sessionId);
    officialTurnRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
  }

  function newChat() {
    interruptChat();
    setActive(null);
    setDraft("");
    setMobileOpen(false);
  }

  async function selectConversation(id: string) {
    interruptChat();
    const response = await fetch(`/api/conversations/${id}`);
    if (!response.ok) {
      showToast("打不开这条对话");
      return;
    }
    const data = (await response.json()) as { conversation: Conversation };
    setActive(data.conversation);
    if (data.conversation.modelKey) {
      setModelKey(data.conversation.modelKey);
      if (data.conversation.reasoningEffort) setReasoning(data.conversation.reasoningEffort);
    }
    setMobileOpen(false);
  }

  async function renameConversation(id: string, title: string) {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      showToast("重命名失败");
      throw new Error("重命名失败");
    }
    const data = (await response.json()) as { conversation?: ConversationSummary };
    const savedTitle = data.conversation?.title || title.trim() || "新对话";
    setConversations((current) =>
      current.map((item) => (item.id === id ? { ...item, title: savedTitle } : item)),
    );
    setActive((current) =>
      current?.id === id ? { ...current, title: savedTitle } : current,
    );
  }

  async function removeConversation(id: string) {
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("删除失败");
    setConversations((current) => current.filter((item) => item.id !== id));
    setActive((current) => (current?.id === id ? null : current));
  }

  async function deleteConversation(id: string) {
    const ok = await confirm({
      title: "删除这条对话？",
      detail: "对话和里面的消息都会删掉，无法恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeConversation(id);
    } catch {
      showToast("删除失败");
    }
  }

  async function changeModel(key: string) {
    if (key === modelKey) return;
    const from = modelKey;
    setModelKey(key);
    const { modelId } = parseModelKey(key);
    const reasoningId = officialReasoningId(key) || modelId;
    const model = providers.flatMap((item) => item.models).find((item) => item.id === modelId);
    const profile = detectReasoning(reasoningId, model?.reasoningLevels);
    setReasoning(resolveReasoningLevel(profile, reasoning));
    if (isChatGptWeb(key)) return;
    const current = active;
    if (!current || current.id === "pending") return;
    const notice =
      from && from !== key && current.messages.length > 0
        ? {
            id: crypto.randomUUID(),
            role: "notice" as const,
            content: "",
            fromModelKey: from,
            modelKey: key,
            createdAt: Date.now(),
          }
        : null;
    setActive((item) =>
      item
        ? {
            ...item,
            modelKey: key,
            messages: notice ? [...item.messages, notice] : item.messages,
          }
        : item,
    );
    await fetch(`/api/conversations/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelKey: key,
        ...(notice ? { notice: { id: notice.id, fromModelKey: from, modelKey: key } } : {}),
      }),
    });
  }

  /** 官方登录：Claude 账号和 Grok 账号走同一套，只是 CLI 不同。 */
  async function loginOfficial(kind: OfficialChatKind) {
    const spec = officialSpec(kind);
    const desktop = getDesktop();
    if (!desktop?.cliAuthLogin) {
      showToast("请用桌面版 AllAi 打开");
      return;
    }
    setOfficialBusy(kind);
    showToast("请在浏览器里完成授权");
    try {
      const result = await desktop.cliAuthLogin(spec.cliKind);
      await refreshOfficialStatus();
      const status = await desktop.cliAuthStatus(spec.cliKind).catch(() => null);
      if (!result.ok || !status?.loggedIn) {
        showToast(result.ok ? "没有检测到登录，请再试一次" : result.error);
        return;
      }
      showToast(`${spec.name}已登录`);
      // 登录成功后把真正可用的型号拉下来，别停在写死的兜底列表上。
      const provider = findOfficialProvider(providers, kind);
      if (provider && desktop.cliListModels) {
        const listed = await desktop.cliListModels(spec.cliKind).catch(() => null);
        if (listed?.ok && listed.models.length) {
          await fetch(`/api/providers/${provider.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ models: listed.models }),
          });
          await loadProviders();
        }
      }
    } finally {
      setOfficialBusy(null);
    }
  }

  async function logoutOfficial(kind: OfficialChatKind) {
    const spec = officialSpec(kind);
    const desktop = getDesktop();
    if (!desktop?.cliAuthLogout) {
      showToast("请用桌面版 AllAi 打开");
      return;
    }
    setOfficialBusy(kind);
    try {
      const result = await desktop.cliAuthLogout(spec.cliKind);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      await refreshOfficialStatus();
      setModelKey((current) =>
        officialSpecForModelKey(current)?.kind === kind ? firstModelKey(providers) : current,
      );
      showToast(`已退出${spec.name}`);
    } finally {
      setOfficialBusy(null);
    }
  }

  /**
   * 改掉最后一条用户消息并重发。
   * 先把本地和服务端的对话截断到这条之前，再当成一次新的发送 ——
   * 这样官方登录聊天那边也会因为内容变了而重开一轮，不会和 CLI 的会话对不上。
   */
  async function editUserMessage(messageId: string, content: string) {
    if (streaming || !active) return;
    const index = active.messages.findIndex((item) => item.id === messageId);
    if (index === -1) return;
    const trimmed = { ...active, messages: active.messages.slice(0, index), updatedAt: Date.now() };
    setActive(trimmed);
    if (active.id !== "pending") {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation: trimmed }),
      }).catch(() => undefined);
    }
    await send("send", { content, base: trimmed });
  }

  /**
   * 把一条「过程」记到助手消息上。这些东西显示在对话里，不弹窗。
   * 只按 messageId 匹配：id 是 UUID，用户中途切走了就自然落空，正好。
   */
  function addStep(messageId: string, kind: "search" | "notice" | "error", text: string) {
    setActive((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((item) =>
          item.id === messageId
            ? { ...item, steps: [...(item.steps ?? []), { kind, text, at: Date.now() }] }
            : item,
        ),
      };
    });
  }

  async function send(
    mode: "send" | "regenerate" = "send",
    override?: {
      content: string;
      base?: Conversation | null;
      attachments?: ChatAttachment[];
      /** 操控电脑：同一轮的编号，和用户原话（只在第一条上带）。 */
      computerRun?: string;
      computerGoal?: string;
    },
  ) {
    if (streamingRef.current) return;
    const key = modelKeyRef.current || modelKey;
    if (isChatGptWeb(key)) return;
    if (!key) {
      setSettingsOpen(true);
      showToast("先接入一个模型");
      return;
    }

    // 这一轮助手的正文。操控电脑的循环要靠它拿动作，不能等 React 渲染。
    let replyText = "";
    const content = override ? override.content : draftRef.current.trim();
    // Computer Use 的每一轮由循环喂截图进来，不走输入框的附件。
    const outgoing = override?.attachments ?? attachments;
    if (mode === "send" && !content && !outgoing.length) return;

    const now = Date.now();
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const previous = override ? (override.base ?? active) : active;
    const official = officialSpecForModelKey(key);
    const conversationId =
      previous && previous.id !== "pending"
        ? previous.id
        : crypto.randomUUID();

    setActive((prev) => {
      const base =
        (override ? (override.base ?? prev) : prev) ??
        ({
          id: conversationId,
          title: titleFrom(content),
          messages: [],
          modelKey: key,
          createdAt: now,
          updatedAt: now,
        } satisfies Conversation);
      let messages = [...base.messages];
      if (mode === "regenerate") {
        if (messages.at(-1)?.role === "assistant") messages = messages.slice(0, -1);
      } else {
        messages.push({
          id: userMessageId,
          role: "user",
          content: content || (outgoing.length ? `（${outgoing.length} 个附件）` : ""),
          attachments: outgoing.length ? outgoing : undefined,
          computerRun: override?.computerRun,
          computerGoal: override?.computerGoal,
          createdAt: now,
        });
      }
      messages.push({
        id: assistantMessageId,
        role: "assistant",
        content: "",
        modelKey: key,
        computerRun: override?.computerRun,
        createdAt: now,
      });
      return { ...base, modelKey: key, messages, updatedAt: now };
    });
    if (mode === "send" && !override) {
      setDraft("");
      setAttachments([]);
    }
    streamingRef.current = true;
    setStreaming(true);

    // 请求连流都没建立起来时也要把错误留在这轮对话里。模型调用失败属于回答的一部分，
    // 不能用白色 toast 一闪而过，更不能把刚才的用户消息整个回滚掉。
    const failChat = (message: string) => {
      const current =
        activeRef.current?.id === conversationId ? activeRef.current : null;
      const fallbackBase =
        current ??
        ({
          id: conversationId,
          title: titleFrom(content),
          messages: [
            ...(previous?.messages ?? []),
            ...(mode === "send"
              ? [
                  {
                    id: userMessageId,
                    role: "user" as const,
                    content,
                    attachments: outgoing.length ? outgoing : undefined,
                    computerRun: override?.computerRun,
                    computerGoal: override?.computerGoal,
                    createdAt: now,
                  },
                ]
              : []),
            {
              id: assistantMessageId,
              role: "assistant" as const,
              content: "",
              modelKey: key,
              computerRun: override?.computerRun,
              createdAt: now,
            },
          ],
          modelKey: key,
          reasoningEffort: reasoning,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        } satisfies Conversation);
      const next = withChatError(fallbackBase, assistantMessageId, message);
      setActive(next);
      void fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation: next }),
      }).finally(() => void loadConversations().catch(() => undefined));
      streamingRef.current = false;
      setStreaming(false);
    };

    if (official) {
      const bail = (message: string) => {
        failChat(message);
      };
      const desktop = getDesktop();
      if (!desktop?.officialChat) {
        bail("请用桌面版 AllAi 打开");
        return;
      }
      const status = officialStatus[official.kind];
      if (status && !status.installed) {
        bail(`请先安装 ${official.cliName}`);
        return;
      }
      if (status && !status.loggedIn) {
        bail(`请先在设置里登录${official.name}`);
        return;
      }
      // 重新生成等于 AllAi 删除旧回答后从最后一条用户消息重新分叉。
      // 原来的 CLI session 里已经有旧回答，继续 resume 会让隐藏掉的旧回答仍参与推理。
      const officialBase =
        mode === "regenerate" && previous?.messages.at(-1)?.role === "assistant"
          ? { ...previous, messages: previous.messages.slice(0, -1) }
          : previous;
      const prompt =
        mode === "regenerate"
          ? [...(officialBase?.messages ?? [])]
              .reverse()
              .find((item) => item.role === "user")?.content || content
          : content;
      /*
       * 上下文的规矩：AllAi 自己的对话记录是唯一事实来源。
       * `--resume` 只是省 token 的优化，不承担正确性 —— 三个条件全中才续：
       *   1. 上一轮就是同一个官方账号（换账号 = 换 CLI，那个 session 根本不存在）
       *   2. 手上确实有它返回的 cliSessionId
       *   3. 我们记下的「已投喂条数」和现在的历史对得上（中间改过消息就对不上）
       * 任一条不中，就开新会话并把「摘要 + 最近几轮」重放给新模型。
       */
      const priorMessages = conversationTurnCount(officialBase?.messages ?? []);
      /*
       * 上下文到量了就不能再 resume：那条 CLI 会话里装的还是没压过的全量，
       * 续下去只会更满。压缩对 CLI 来说就是「丢掉旧会话，用摘要开一条新的」——
       * 这正是各家 `/compact` 在做的事。
       */
      const officialModel = officialModelId(key);
      const officialLimit = contextLimit(officialModel, prefs.contextLimits);
      const officialTurns = (officialBase?.messages ?? []).filter(
        (item) =>
          (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
      );
      const ctxStatus = contextStatus(
        estimateMessagesTokens(officialTurns.slice(officialBase?.compaction?.folded ?? 0)) +
          estimateTokens(officialBase?.compaction?.summary || ""),
        officialLimit.tokens,
        prefs.compactPercent,
      );
      const mustCompact = prefs.autoCompact !== false && ctxStatus.shouldCompact;
      const canResume =
        !override &&
        mode !== "regenerate" &&
        !mustCompact &&
        Boolean(officialBase?.cliSessionId) &&
        officialBase?.cliKind === official.kind &&
        officialBase?.cliDelivered === priorMessages;
      const resumeId = canResume ? officialBase?.cliSessionId : undefined;

      // 要开新会话，而且之前确实聊过 —— 把上下文捞出来带过去。
      let history: { role: "user" | "assistant"; content: string }[] = [];
      // 重新生成时最后一条 user 就是下面单独传的 prompt，不能再塞进 history 一次。
      const historyMessages =
        mode === "regenerate"
          ? (officialBase?.messages ?? []).slice(
              0,
              [...(officialBase?.messages ?? [])]
                .map((item) => item.role)
                .lastIndexOf("user"),
            )
          : (officialBase?.messages ?? []);
      const hasHistory = conversationTurnCount(historyMessages) > 0;
      if (!resumeId && officialBase && officialBase.id !== "pending" && hasHistory) {
        try {
          const response = await fetch(
            mode === "regenerate"
              ? "/api/context"
              : `/api/conversations/${officialBase.id}/context`,
            {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              mode === "regenerate"
                ? {
                    messages: historyMessages,
                    modelId: officialModel,
                    previous: officialBase.compaction,
                  }
                : { modelId: officialModel },
            ),
          });
          if (response.ok) {
            const built = (await response.json()) as {
              summary?: string;
              recent?: { role: "user" | "assistant"; content: string }[];
              summarized?: number;
              compaction?: Compaction;
            };
            if (built.compaction) {
              setActive((current) =>
                current?.id === conversationId
                  ? { ...current, compaction: built.compaction }
                  : current,
              );
              addStep(
                assistantMessageId,
                "notice",
                compactNotice(built.compaction, officialLimit.tokens),
              );
            }
            if (built.summary) {
              history.push({
                role: "user",
                content: `【此前对话的要点（由 AllAi 整理，供你了解背景）】
${built.summary}`,
              });
              history.push({ role: "assistant", content: "好的，我了解了之前的进展。" });
            }
            history = history.concat(built.recent ?? []);
            if (history.length) {
              addStep(
                assistantMessageId,
                "notice",
                built.summarized
                  ? `已把之前 ${built.summarized} 条消息的要点和最近 ${built.recent?.length ?? 0} 条原文交给${official.name}`
                  : `已把最近 ${built.recent?.length ?? 0} 条对话交给${official.name}`,
              );
            }
          }
        } catch {
          // 捞不到上下文也要让这轮发出去，但得说一声
          addStep(assistantMessageId, "notice", "没能把之前的对话交给新模型，它可能不记得前面聊过什么");
        }
      }

      const sessionId = officialChatSessionId(official.kind, conversationId);
      officialTurnRef.current = {
        kind: official.kind,
        sessionId,
        conversationId,
        assistantId: assistantMessageId,
        cliSessionId: resumeId,
        firstTurn:
          mode === "send" &&
          (!previous || !previous.messages.some((item) => item.role === "user")),
        // 这一轮结束后，这个 session 就见过这么多条消息了（含刚发的这条和它的回复）。
        delivered: priorMessages + (mode === "regenerate" ? 1 : 2),
        modelId: officialModelId(key),
      };
      const result = await desktop.officialChat({
        kind: official.kind,
        sessionId,
        prompt,
        resumeId,
        model: officialModelId(key),
        effort: reasoning,
        webSearch: prefs.webSearchChat,
        history: history.length ? history : undefined,
        elevated: prefs.cliAdminChat,
      });
      if (!result.ok) {
        officialTurnRef.current = null;
        bail(result.error);
      }
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: previous && previous.id !== "pending" ? previous.id : null,
          modelKey: key,
          message: mode === "send" ? content : undefined,
          userMessageId,
          assistantMessageId,
          mode,
          attachments: mode === "send" ? outgoing : undefined,
          reasoningEffort: reasoning,
          webSearch: prefs.webSearchChat,
          computerRun: override?.computerRun,
          computerGoal: mode === "send" ? override?.computerGoal : undefined,
          computerUse: computerUseRef.current
            ? {
                width: shotSizeRef.current.width,
                height: shotSizeRef.current.height,
                targetTitle: shotSizeRef.current.target?.title,
                changedRatio: shotSizeRef.current.changedRatio,
                controls: shotSizeRef.current.controls,
                windows: shotSizeRef.current.windows,
              }
            : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        failChat(data.error || "发送失败");
        return;
      }

      await readSse(response, (event) => {
        if (event.type === "meta") {
          setActive((prev) =>
            prev
              ? {
                  ...prev,
                  id: event.conversationId,
                  title: event.title,
                  // 服务端这一轮压过的话要收下来，不然进度条一直显示压缩前的数字。
                  compaction: event.compaction ?? prev.compaction,
                }
              : prev,
          );
          setConversations((current) => {
            const exists = current.some((item) => item.id === event.conversationId);
            if (exists) {
              return current.map((item) =>
                item.id === event.conversationId
                  ? { ...item, title: event.title, updatedAt: Date.now() }
                  : item,
              );
            }
            return [
              {
                id: event.conversationId,
                title: event.title,
                modelKey: key,
                updatedAt: Date.now(),
                createdAt: Date.now(),
                preview: "",
              },
              ...current,
            ];
          });
        }
        if (event.type === "delta") {
          // 也在本地累一份：await send() 之后 React 不一定已经渲染完，
          // 这时去读 state 会读到空的（操控电脑的循环就是这么坏掉的）。
          replyText += event.content;
          setActive((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((item) =>
                item.id === assistantMessageId
                  ? { ...item, content: item.content + event.content }
                  : item,
              ),
            };
          });
        }
        if (event.type === "reasoning") {
          setActive((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              messages: prev.messages.map((item) =>
                item.id === assistantMessageId
                  ? { ...item, reasoning: (item.reasoning || "") + event.content }
                  : item,
              ),
            };
          });
        }
        if (event.type === "notice") {
          addStep(
            assistantMessageId,
            event.kind === "search" ? "search" : "notice",
            event.message,
          );
        }
        if (event.type === "error") {
          addStep(assistantMessageId, "error", event.message);
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        failChat(error instanceof Error ? error.message : "发送失败");
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      await loadConversations().catch(() => undefined);
    }
    return { text: replyText, assistantMessageId, conversationId };
  }

  function stop() {
    interruptChat();
  }

  // 生成时按「本轮已输出的字符」估速度。中文一个字约 0.6 token，
  // 这只是给个手感，不是计费口径。
  //
  // 注意 deps 里不能放 active：流式时它每来一个 token 就变一次，
  // 定时器会被反复重建，快的流（HTTP 那条，几十毫秒一个 token）
  // 永远等不到 400ms 触发，速度就一直是 0。用 ref 读最新值。
  const streamStartRef = useRef(0);
  const activeRef = useRef<Conversation | null>(null);
  const agentMessagesRef = useRef(agentMessages);
  activeRef.current = active;
  agentMessagesRef.current = agentMessages;
  useEffect(() => {
    const live = view === "agents" ? agentStreaming : streaming;
    if (!live) {
      streamStartRef.current = 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 停了要清零
      setTokensPerSecond(0);
      return;
    }
    streamStartRef.current = Date.now();
    const timer = window.setInterval(() => {
      const last =
        view === "agents"
          ? agentMessagesRef.current.at(-1)
          : activeRef.current?.messages.at(-1);
      if (!last || last.role !== "assistant") return;
      const seconds = (Date.now() - streamStartRef.current) / 1000;
      if (seconds < 0.3) return;
      const extra = "reasoning" in last ? String(last.reasoning || "") : "";
      const tokens = estimateTokens(last.content) + estimateTokens(extra);
      setTokensPerSecond(tokens / seconds);
    }, 300);
    return () => window.clearInterval(timer);
  }, [streaming, agentStreaming, view]);

  // 侧栏和工作区看到的都是叠加过用户改名/删除/选模型之后的列表。
  const visibleWorks = useMemo(
    () =>
      works
        .filter((item) => !workOverrides[item.id]?.hidden)
        .map((item) => {
          const over = workOverrides[item.id];
          const mine = localRunning.includes(item.id);
          if (!over?.title && !over?.modelKey) return mine && !item.running ? { ...item, running: true } : item;
          const next = { ...item };
          if (mine) next.running = true;
          if (over.title) next.title = over.title;
          /*
           * 用户自己选的模型优先于会话文件里记的那个。works 每次启动都是重新扫出来的，
           * 不叠这一层的话，选完没发就重启，选择会退回上一轮 CLI 实际用的型号。
           */
          if (over.modelKey) {
            const { providerId, modelId } = parseModelKey(over.modelKey);
            next.modelKey = over.modelKey;
            if (modelId) next.model = modelId;
            if (providerId) next.endpointId = providerId;
          }
          if (!next.sessionModel && over.sessionModel) next.sessionModel = over.sessionModel;
          return next;
        }),
    [works, workOverrides, localRunning],
  );
  const activeWork = visibleWorks.find((item) => item.id === activeWorkId) ?? null;
  const workAgent =
    agents.find((item) => item.kind === activeWork?.kind) ??
    agents.find((item) => item.id === settingsAgentId) ??
    null;
  const chatgptWeb = isChatGptWeb(modelKey);
  const chatModelId = parseModelKey(modelKey).modelId;
  const chatModel = providers
    .flatMap((provider) => provider.models)
    .find((item) => item.id === chatModelId);
  const agentModelKey = modelKeyFromWork(activeWork, workAgent);
  const agentParsed = parseModelKey(agentModelKey);
  const agentModelId = agentParsed.modelId;
  const agentPicked = workAgent ? findAgentModel(workAgent, agentModelKey) : undefined;
  const reasoningId = officialReasoningId(modelKey) || chatModelId;
  const reasoningProfile = detectReasoning(
    view === "agents" ? agentModelId : reasoningId,
    view === "agents" ? agentPicked?.reasoningLevels : chatModel?.reasoningLevels,
  );
  /*
   * 上下文占用。按当前模型的上限算，压缩过的那部分只算摘要的长度 ——
   * 折进摘要的原文已经不会再发出去了。
   */
  const grokChatSession =
    officialSpecForModelKey(modelKey)?.kind === "grok" ? active?.cliSessionId || "" : "";
  useEffect(() => {
    const desktop = getDesktop();
    if (!grokChatSession || !desktop?.workContext) {
      return;
    }
    let alive = true;
    void desktop
      .workContext({ kind: "grok-build", cliSessionId: grokChatSession })
      .then((row) => {
        if (alive) setGrokChatContext(row?.tokens || 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [grokChatSession, active?.messages.length]);

  const chatContext = useMemo(() => {
    const id = officialModelId(modelKey) || chatModelId;
    const limit = contextLimit(id, prefs.contextLimits);
    const compaction = active?.compaction;
    const conversational = (active?.messages ?? []).filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
    );
    // 接口上一轮回报的输入量就是此刻的窗口占用，比按字符估准得多。
    // Grok 那条得用 CLI 日志里的数，记下来的 usage 是一轮里多次调用的总和。
    const reported = grokChatSession
      ? grokChatContext
      : liveContextTokens(usageEvents, active?.id ?? "");
    const used =
      reported ||
      estimateMessagesTokens(conversational.slice(compaction?.folded ?? 0)) +
        estimateTokens(compaction?.summary || "");
    const status = contextStatus(used, limit.tokens, prefs.compactPercent);
    return {
      used,
      limit: limit.tokens,
      level: status.level,
      note: reported ? `${limit.note}，占用取自接口回报` : `${limit.note}（估算）`,
    };
  }, [
    active?.compaction,
    active?.id,
    active?.messages,
    chatModelId,
    grokChatContext,
    grokChatSession,
    modelKey,
    prefs.compactPercent,
    prefs.contextLimits,
    usageEvents,
  ]);
  const agentContext = useMemo(() => {
    const table = contextLimit(agentModelId, prefs.contextLimits);
    const reported = activeWork ? cliContext[activeWork.id] : undefined;
    const compaction = activeWork ? workOverrides[activeWork.id]?.compaction : undefined;
    // CLI 自己报的最准 —— 它知道自己 compact 过没有、工具输出占了多少。
    // 手填的覆盖值仍然优先（用户比谁都清楚中转站给了多大窗口）。
    const limit =
      table.source === "override" ? table.tokens : reported?.window || table.tokens;
    const note =
      table.source === "override"
        ? table.note
        : reported?.window
          ? "CLI 自己报的窗口大小"
          : table.note;
    if (reported) {
      const status = contextStatus(reported.tokens, limit, prefs.compactPercent);
      return { used: reported.tokens, limit, level: status.level, note };
    }
    // 还没跑过一轮（新会话），CLI 还没报过 —— 只能先按字符估。
    const conversational = agentMessages.filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
    );
    const used =
      estimateMessagesTokens(conversational.slice(compaction?.folded ?? 0)) +
      estimateTokens(compaction?.summary || "");
    const status = contextStatus(used, limit, prefs.compactPercent);
    return { used, limit, level: status.level, note: `${note}（估算）` };
  }, [
    activeWork,
    agentMessages,
    agentModelId,
    cliContext,
    prefs.compactPercent,
    prefs.contextLimits,
    workOverrides,
  ]);
  // 用量记录只增不删（产品约定 25），别每次渲染都从头遍历一遍。
  const convUsage = useMemo(
    () => conversationUsage(usageEvents, active?.id ?? ""),
    [usageEvents, active?.id],
  );
  /** 当前聊天模型和它来自哪个服务：统计行和空状态的「XX 愿意为您提供帮助」都用它。 */
  const chatModelSource = useMemo(() => {
    const info = modelInfo(modelKey, providers);
    return info ? { label: info.label, source: info.provider } : undefined;
  }, [modelKey, providers]);
  const officialSpecNow = officialSpecForModelKey(modelKey);
  const officialWindow = officialSpecNow
    ? (() => {
        const w = windowUsage(usageEvents, officialSpecNow.name, usageNow || 0);
        const quota = officialQuota[officialSpecNow.kind];
        return {
          name: officialSpecNow.name,
          fiveHour: w.fiveHour,
          week: w.week,
          fiveHourPct: quota?.fiveHourPct,
          weekPct: quota?.weekPct,
          weekReset: quota?.weekReset,
          credits: quota?.credits,
          resetCredits: quota?.resetCredits,
        };
      })()
    : undefined;
  const agentOfficialName =
    workAgent?.kind === "claude-code"
      ? "Claude 账号"
      : workAgent?.kind === "grok-build"
        ? "Grok 账号"
        : workAgent?.kind === "codex"
          ? "ChatGPT 账号"
          : "";
  const agentConvUsage = useMemo(
    () => conversationUsage(usageEvents, activeWork?.id ?? ""),
    [usageEvents, activeWork?.id],
  );
  const agentOfficial = agentOfficialName
    ? (() => {
        const w = windowUsage(usageEvents, agentOfficialName, usageNow || 0);
        const quota =
          workAgent?.kind === "claude-code"
            ? officialQuota.claude
            : workAgent?.kind === "grok-build"
              ? officialQuota.grok
              : workAgent?.kind === "codex"
                ? officialQuota.chatgpt
                : undefined;
        return {
          name: agentOfficialName,
          fiveHour: w.fiveHour,
          week: w.week,
          fiveHourPct: quota?.fiveHourPct,
          weekPct: quota?.weekPct,
          weekReset: quota?.weekReset,
          credits: quota?.credits,
          resetCredits: quota?.resetCredits,
        };
      })()
    : undefined;
  const agentModelSource = useMemo(() => {
    const info = modelInfo(agentModelKey, workAgent ? agentModelProviders(workAgent) : []);
    return info ? { label: info.label, source: info.provider || workAgent?.name || "" } : undefined;
  }, [agentModelKey, workAgent]);
  /** 当前工作的接续关系（覆盖层按工作 id 或 `种类:会话编号` 找）。 */
  const workByKey = (key?: string) =>
    key ? visibleWorks.find((item) => item.id === key || `${item.kind}:${item.cliSessionId}` === key) : undefined;
  const activeLinks = activeWork
    ? workOverrides[activeWork.id] ?? workOverrides[`${activeWork.kind}:${activeWork.cliSessionId}`]
    : undefined;
  const handoffFrom = workByKey(activeLinks?.continuedFrom);
  const handoffTo = workByKey(activeLinks?.continuedTo);
  /**
   * 左边列表把接续链画成一组：工作 id → 它所在链的链头（最早那条）。不在链里的不出现。
   * 覆盖层里的键可能是工作 id，也可能是 `种类:会话编号`（见约定 63），两种都认。
   */
  const workChains = useMemo(() => {
    const byKey = new Map<string, AgentWork>();
    for (const item of visibleWorks) {
      byKey.set(item.id, item);
      byKey.set(`${item.kind}:${item.cliSessionId}`, item);
    }
    const parentOf = (item: AgentWork) => {
      const links = workOverrides[item.id] ?? workOverrides[`${item.kind}:${item.cliSessionId}`];
      return links?.continuedFrom ? byKey.get(links.continuedFrom) : undefined;
    };
    const out: Record<string, string> = {};
    for (const item of visibleWorks) {
      let root = item;
      const seen = new Set([item.id]);
      for (let parent = parentOf(root); parent && !seen.has(parent.id); parent = parentOf(root)) {
        seen.add(parent.id);
        root = parent;
      }
      if (root.id !== item.id) out[item.id] = root.id;
    }
    return out;
  }, [visibleWorks, workOverrides]);
  const agentStats = useMemo(
    () => ({
      tokensPerSecond: view === "agents" ? tokensPerSecond : 0,
      contextTokens: agentContext.used,
      contextLimit: agentContext.limit,
      contextLevel: agentContext.level,
      contextNote: agentContext.note,
      conversationTokens: agentConvUsage.tokens,
      conversationRequests: agentConvUsage.requests,
      conversationInput: agentConvUsage.input,
      conversationOutput: agentConvUsage.output,
      conversationCacheRead: agentConvUsage.cacheRead,
      conversationPrompt: agentConvUsage.prompt,
      costUsd: agentConvUsage.costUsd,
      model: agentModelSource,
      fields: prefs.statsFields,
      official: agentOfficial,
    }),
    [view, tokensPerSecond, agentContext, agentConvUsage, agentOfficial, agentModelSource, prefs.statsFields],
  );
  const agentModels = useMemo(
    () => (workAgent ? agentModelProviders(workAgent) : []),
    [workAgent],
  );
  const onAgentSend = useLatestCallback(() => {
    if (computerUseAgent) {
      const goal = agentDraftRef.current.trim();
      if (!goal || computerBusy) return;
      setAgentDraft("");
      void runComputerLoop(goal);
      return;
    }
    void sendAgent();
  });
  const onAgentStop = useLatestCallback(() => {
    if (computerBusy) {
      computerStopRef.current = true;
      pendingAction?.resolve(false);
      return;
    }
    stopAgent();
  });
  const onAgentReasoning = useLatestCallback((value: string) => {
    setReasoning(value);
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: value }),
    });
  });
  const onAgentPermission = useLatestCallback((value: string) => {
    if (!workAgent) return;
    const agentPermissionMode = {
      ...prefs.agentPermissionMode,
      [workAgent.kind]: value,
    };
    setPrefs((current) => ({ ...current, agentPermissionMode }));
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentPermissionMode }),
    });
  });
  const onAgentWebSearch = useLatestCallback((value: boolean) => {
    setPrefs((current) => ({ ...current, webSearchAgent: value }));
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webSearchAgent: value }),
    });
  });
  const onAgentCliAdmin = useLatestCallback((value: boolean) => {
    void toggleCliAdmin("agent", value);
  });
  const onAgentComputerUse = useLatestCallback((value: boolean) => {
    setComputerUseAgent(value);
    if (!value) computerStopRef.current = true;
  });
  const onAgentConfirmAction = useLatestCallback(() => pendingAction?.resolve(true));
  const onAgentRejectAction = useLatestCallback(() => pendingAction?.resolve(false));
  const onAgentStopComputer = useLatestCallback(() => {
    computerStopRef.current = true;
    pendingAction?.resolve(false);
  });
  const onOpenNewWork = useLatestCallback(() => setNewWorkOpen(true));
  const reasoningOptions = reasoningProfile.levels.map((item) => ({
    value: item.id,
    label: item.label,
    description: item.description,
  }));
  const agentPermissionOptions = permissionOptions(workAgent?.kind);
  const agentPermission = resolvePermission(
    workAgent?.kind,
    workAgent ? prefs.agentPermissionMode[workAgent.kind] : undefined,
  );

  /**
   * 换这条工作的模型。
   *
   * `workId` 是给远程用的：手机看的是**它自己**打开的那条工作（约定 51），
   * 不带的话就会改到电脑当前选中的那条上去（0.16.34 修的）。
   */
  function changeAgentModel(key: string, workId?: string) {
    const target = workId ? worksRef.current.find((item) => item.id === workId) : activeWork;
    if (!target) return;
    const agentFor = agents.find((item) => item.kind === target.kind) ?? workAgent;
    if (!agentFor) return;
    const from = modelKeyFromWork(target, agentFor);
    if (from === key) return;
    const { providerId, modelId } = parseModelKey(key);
    const picked = findAgentModel(agentFor, key);
    setWorks((current) =>
      current.map((item) => {
        if (item.id !== target.id) return item;
        const previous = item.sessionModel || item.model || PENDING_SESSION_MODEL;
        return {
          ...item,
          model: modelId,
          modelKey: key,
          endpointId: providerId || item.endpointId,
          sessionModel: previous,
        };
      }),
    );
    // 推理强度是「当前这条」的界面状态，改别人那条时不要动它。
    if (target.id === activeWork?.id) {
      const profile = detectReasoning(modelId, picked?.reasoningLevels);
      setReasoning(resolveReasoningLevel(profile, reasoning));
    }
    // 选择本身先存下来 —— 下面那条时间线提示要有「从哪个换过来」才写，
    // 不能让「第一次选」这种情况顺着 early return 一起把选择丢了。
    setWorkOverrides((current) => ({
      ...current,
      [target.id]: { ...current[target.id], modelKey: key },
    }));
    void fetch("/api/agent-works", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: target.id, modelKey: key }),
    }).catch(() => undefined);
    if (!from) return;
    const notice: AgentMessage = {
      id: crypto.randomUUID(),
      role: "notice",
      content: "",
      fromModelKey: from,
      modelKey: key,
      createdAt: Date.now(),
    };
    // 时间线那条提示只属于这条工作，别插到别人正在看的消息里。
    if (target.id === activeWork?.id) setAgentMessages((current) => [...current, notice]);
    setWorkOverrides((current) => ({
      ...current,
      [target.id]: {
        ...current[target.id],
        modelSwitches: [
          ...(current[target.id]?.modelSwitches ?? []),
          {
            id: notice.id,
            createdAt: notice.createdAt,
            fromModelKey: from,
            modelKey: key,
          },
        ],
      },
    }));
    void fetch("/api/agent-works", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: target.id,
        modelSwitch: { id: notice.id, fromModelKey: from, modelKey: key },
      }),
    }).catch(() => undefined);
  }

  async function renameWork(id: string, title: string) {
    const response = await fetch("/api/agent-works", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    }).catch(() => null);
    if (!response?.ok) {
      showToast("重命名失败");
      throw new Error("重命名失败");
    }
    const data = (await response.json()) as { works?: Record<string, AgentWorkOverride> };
    if (data.works) setWorkOverrides(data.works);
  }

  async function removeWork(id: string) {
    const work = works.find((item) => item.id === id);
    if (!work) throw new Error("这条工作不存在了");
    const desktop = getDesktop();
    let removed = false;
    if (desktop?.deleteWork) {
      const result = await desktop.deleteWork(work).catch(() => null);
      removed = Boolean(result?.ok);
      if (result && !result.ok) showToast(`${result.error}，已从列表隐藏`);
    }
    // 文件删掉了就不用留记录；删不掉（正在跑 / 权限）就记一条隐藏，别让它又冒出来。
    if (removed) {
      setWorks((current) => current.filter((item) => item.id !== id));
      await fetch("/api/agent-works", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: null, hidden: false }),
      }).catch(() => undefined);
      setWorkOverrides((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      showToast("已删除");
    } else {
      setWorkOverrides((current) => ({ ...current, [id]: { ...current[id], hidden: true } }));
      await fetch("/api/agent-works", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hidden: true }),
      }).catch(() => undefined);
    }
    if (activeWorkId === id) {
      setActiveWorkId(null);
      setAgentMessages([]);
    }
    delete agentMessageCache.current[id];
  }

  async function deleteWork(id: string) {
    const work = works.find((item) => item.id === id);
    if (!work) return;
    const label = workOverrides[id]?.title || work.title;
    const ok = await confirm({
      title: `删除「${label}」？`,
      detail: `这条会话在 ${work.agentName} 自己的历史记录里也会一并删掉，无法恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWork(id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function selectWork(id: string) {
    if (activeWorkId) agentMessageCache.current[activeWorkId] = agentMessages;
    const work = visibleWorks.find((item) => item.id === id);
    setActiveWorkId(id);
    setMobileOpen(false);
    if (work) {
      const agent = agents.find((item) => item.kind === work.kind) ?? workAgent;
      const key = modelKeyFromWork(work, agent ?? null);
      const modelId = parseModelKey(key).modelId;
      const picked = agent ? findAgentModel(agent, key) : undefined;
      setReasoning(
        resolveReasoningLevel(detectReasoning(modelId, picked?.reasoningLevels), reasoning),
      );
    }
    const switches = workOverrides[id]?.modelSwitches;
    if (agentMessageCache.current[id]) {
      setAgentMessages(mergeAgentSwitches(agentMessageCache.current[id], switches));
      return;
    }
    const desktop = getDesktop();
    if (!desktop || !work || work.source === "new") {
      setAgentMessages(mergeAgentSwitches([], switches));
      return;
    }
    try {
      const loaded = await desktop.loadMessages(work);
      setAgentMessages(mergeAgentSwitches(loaded, switches));
      // CLI 自报的窗口占用，进度条和「该不该压」都靠它。
      const reported = await desktop.workContext?.(work).catch(() => null);
      if (reported) setCliContext((current) => ({ ...current, [work.id]: reported }));
    } catch {
      setAgentMessages(mergeAgentSwitches([], switches));
    }
  }

  async function pickFolder() {
    const desktop = getDesktop();
    if (!desktop) return;
    const folder = await desktop.pickFolder();
    if (!folder) return;
    setCwd(folder);
    localStorage.setItem("allai-agent-cwd", folder);
  }

  function startNewWork(draft: {
    agentId: string;
    modelKey: string;
    cwd: string;
  }) {
    const agent = agents.find((item) => item.id === draft.agentId);
    if (!agent) return null;
    const folder = draft.cwd || cwd;
    if (!folder) {
      showToast("请选择工作目录");
      return null;
    }
    const key = draft.modelKey || modelKeyFromWork(null, agent);
    const parsed = parseModelKey(key);
    const cliSessionId = crypto.randomUUID();
    const work: AgentWork = {
      id: `${agent.kind}:${cliSessionId}`,
      kind: agent.kind,
      agentName: agent.name,
      title: "新工作",
      cwd: folder,
      cliSessionId,
      model: parsed.modelId,
      modelKey: key,
      endpointId: parsed.providerId,
      running: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: "",
      source: "new",
    };
    setWorks((current) => [work, ...current.filter((item) => item.id !== work.id)]);
    setActiveWorkId(work.id);
    setAgentMessages([]);
    setNewWorkOpen(false);
    setView("agents");
    setMobileOpen(false);
    return work.id;
  }

  function hideWork(id: string) {
    setWorkOverrides((current) => ({ ...current, [id]: { ...current[id], hidden: true } }));
    void fetch("/api/agent-works", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, hidden: true }),
    }).catch(() => undefined);
  }

  /** 换 CLI / 压缩后会话编号变了：还是这一条工作，不要在侧栏另开一条。 */
  function retargetWorkInPlace(
    from: AgentWork,
    patch: {
      kind: PublicAgent["kind"];
      agentName: string;
      cliSessionId: string;
      model: string;
      modelKey: string;
      endpointId: string;
    },
  ): AgentWork {
    const nextId = `${patch.kind}:${patch.cliSessionId}`;
    const work: AgentWork = {
      ...from,
      id: nextId,
      kind: patch.kind,
      agentName: patch.agentName,
      cliSessionId: patch.cliSessionId,
      model: patch.model,
      modelKey: patch.modelKey,
      endpointId: patch.endpointId,
      source: "new",
      updatedAt: Date.now(),
    };
    agentMessageCache.current[work.id] = agentMessageCache.current[from.id] || agentMessages;
    setWorks((current) => current.map((item) => (item.id === from.id ? work : item)));
    setActiveWorkId(work.id);
    if (from.id !== work.id) {
      const fromOver = workOverrides[from.id];
      setWorkOverrides((current) => ({
        ...current,
        [work.id]: {
          ...current[from.id],
          ...current[work.id],
          title: fromOver?.title || from.title,
          modelKey: patch.modelKey,
          hidden: false,
        },
        [from.id]: { ...current[from.id], hidden: true },
      }));
      void fetch("/api/agent-works", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: work.id,
          title: fromOver?.title || from.title,
          modelKey: patch.modelKey,
        }),
      }).catch(() => undefined);
      hideWork(from.id);
      followHandoff(from.id, patch.kind, patch.cliSessionId);
    }
    return work;
  }

  /**
   * `remote` 有值时是手机发来的：内容不从输入框拿、也不清空电脑上的输入框，
   * 权限和管理员身份按远程权限设置收紧。出错时返回原因给手机看。
   */
  async function sendAgent(remote?: {
    text: string;
    attachments: ChatAttachment[];
    caps: { followPermission: boolean; allowAdmin: boolean };
    workId?: string;
    silent?: boolean;
    /** 强制续当前这条 CLI 会话，不许另起一条（见下面 continueId 那段）。 */
    keepSession?: boolean;
  }): Promise<string | void> {
    if (remote?.workId && remote.workId !== activeWorkId) {
      await selectWork(remote.workId);
    }
    const desktop = getDesktop();
    if (!desktop) {
      showToast("请用桌面版 AllAi 打开");
      return;
    }
    if (!activeWork || !workAgent) {
      if (remote) return "找不到这条工作对应的 Agent";
      setNewWorkOpen(true);
      return;
    }
    const text = remote ? remote.text : agentDraftRef.current.trim();
    const outgoing = remote ? remote.attachments : agentAttachments;
    if ((!text && !outgoing.length) || agentStreaming) return remote ? "Agent 还在跑" : undefined;
    const folder = activeWork.cwd || cwd;
    if (!folder) {
      showToast("请选择工作目录");
      return "请选择工作目录";
    }
    // 附件要先复制进工作目录：Agent 带沙箱跑，读不到 ~/.allai/uploads。
    let copied: { name: string; path: string; kind: string }[] = [];
    if (outgoing.length) {
      try {
        const response = await fetch("/api/agent-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: folder, attachments: outgoing }),
        });
        const data = (await response.json()) as {
          files?: { name: string; path: string; kind: string }[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "复制附件失败");
        copied = data.files ?? [];
      } catch (error) {
        const message = error instanceof Error ? error.message : "复制附件失败";
        showToast(message);
        return message;
      }
    }
    const images = copied.filter((item) => item.kind === "image");
    const others = copied.filter((item) => item.kind !== "image");
    const fileNote = [
      images.length
        ? `用户发来 ${images.length} 张图片，请直接看图（用你的读图工具打开这些路径）：\n${images
            .map((item) => `- ${item.path}`)
            .join("\n")}`
        : "",
      others.length
        ? `用户上传了这些文件，请读取：\n${others.map((item) => `- ${item.path}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const key = modelKeyFromWork(activeWork, workAgent);
    const parsed = parseModelKey(key);
    const modelId = parsed.modelId || activeWork.model || "";
    const sendAgentProfile = workAgent;
    const denied = skills
      .filter((item) => item.disabledFor.includes(sendAgentProfile.kind))
      .map((item) => item.name);
    const extraSkills = skills
      .filter((item) => item.managed && !item.disabledFor.includes(sendAgentProfile.kind))
      .map((item) => `- ${item.name}: ${item.path}`)
      .join("\n");
    const rawWork = works.find((item) => item.id === activeWork.id);
    const runningOn = activeWork.sessionModel || rawWork?.model || "";
    const switched = agentModelSwitched(modelId, runningOn);
    const endpointChanged = Boolean(
      parsed.providerId && parsed.providerId !== (activeWork.endpointId || workAgent.activeEndpointId),
    );
    const cliCommand = adaptCliCommand(workAgent.kind, text);
    const isCliCommand = cliCommand.command && !outgoing.length;
    const promptText = isCliCommand
      ? cliCommand.prompt
      : [
          text,
          fileNote,
          extraSkills ? `额外 Skills：\n${extraSkills}` : "",
          denied.length ? `不要使用这些 Skills：${denied.join("、")}` : "",
          reasoning !== "none" ? `推理强度：${reasoning}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text || "（附件）",
      createdAt: Date.now(),
    };
    const assistantMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    if (!remote?.silent) setAgentMessages((current) => [...current, userMessage, assistantMessage]);
    if (!remote) {
      setAgentDraft("");
      setAgentAttachments([]);
    }
    setAgentStreaming(true);
    const hasAssistant = agentMessages.some((item) => item.role === "assistant" && item.content);
    /*
     * 和聊天同一条规矩：上下文到量了就不能再续那条 CLI 会话 —— 它里面装的是没压过的
     * 全量，续下去只会更满。压缩对 CLI 来说就是丢掉旧会话、用摘要开一条新的。
     */
    let sendWork = activeWork;
    const workCompaction = workOverrides[activeWork.id]?.compaction;
    const agentTable = contextLimit(modelId, prefs.contextLimits);
    const agentReported = cliContext[activeWork.id];
    /*
     * 用 CLI 自己报的占用来判断该不该压。**不能用我们的字符估算** ——
     * 它看不见 CLI 内部已经 compact 过，实测把一条只用了 39% 的健康 Codex 会话
     * 算成 168%，然后白白丢掉那条会话和它十万 token 的缓存命中（0.12.1 的 BUG）。
     */
    const agentLimitTokens =
      agentTable.source === "override"
        ? agentTable.tokens
        : switched
          ? agentTable.tokens
          : agentReported?.window || agentTable.tokens;
    const agentLimit = { tokens: agentLimitTokens };
    const agentTurns = agentMessages.filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
    );
    const agentStatus = contextStatus(
      agentReported
        ? agentReported.tokens
        : estimateMessagesTokens(agentTurns.slice(workCompaction?.folded ?? 0)) +
            estimateTokens(workCompaction?.summary || ""),
      agentLimitTokens,
      prefs.compactPercent,
    );
    const agentMustCompact = prefs.autoCompact !== false && agentStatus.shouldCompact;
    // live- 开头的是我们临时编的号，CLI 不认。
    const resumable =
      !endpointChanged && Boolean(sendWork.cliSessionId) && !sendWork.cliSessionId.startsWith("live-");
    const canNativeCompact =
      resumable && supportsNativeCompact(sendAgentProfile.kind) && !isCliCommand;
    /*
     * 「接续到新对话」那一轮必须**续当前会话**。
     *
     * 它触发的时机恰恰是上下文快满的时候，也就是 `agentMustCompact` 为真 ——
     * 按常规逻辑会另起一条 CLI 会话，于是：整段历史被重放一遍（又慢又贵），
     * CLI 在磁盘上多出一个会话文件，用户的 Agent 列表里就凭空多一条对话（0.16.22 修的）。
     * 而这一轮要做的事就是「看着现在这段会话写摘要」，本来就该待在原地。
     */
    const continueId = agentContinueSession({
      keepSession: remote?.keepSession,
      resumable,
      mustCompact: agentMustCompact && !canNativeCompact,
      sourceNew: sendWork.source === "new",
      hasAssistant,
    })
      ? sendWork.cliSessionId
      : undefined;
    const nextSessionId = continueId || crypto.randomUUID();
    if (!continueId && endpointChanged) {
      sendWork = retargetWorkInPlace(sendWork, {
        kind: sendAgentProfile.kind,
        agentName: sendAgentProfile.name,
        cliSessionId: nextSessionId,
        model: modelId,
        modelKey: key,
        endpointId: parsed.providerId || sendWork.endpointId || preferredAgentEndpointId(sendAgentProfile),
      });
    } else if (sendWork.source === "new") {
      followHandoff(sendWork.id, sendWork.kind, nextSessionId);
    }

    /*
     * 和聊天同一条规矩：要开新会话（多半是换了模型）就得把上下文重放给新模型，
     * 否则它只看到这一句，前面做过什么、定过什么全不知道 —— 然后开始编。
     * Agent 的历史来自各家 CLI 的会话文件，换 CLI 就读不到了，只能我们自己交接。
     */
    let agentHistory: { role: "user" | "assistant"; content: string }[] = [];
    let compactedNotice = "";
    if (!continueId && hasAssistant) {
      const showCompact = (detail: string) => {
        if (remote?.silent) return;
        setAgentMessages((current) =>
          current.map((item) =>
            item.id === assistantMessage.id
              ? { ...item, trace: upsertToolTrace(item.trace, "压缩上下文", detail) }
              : item,
          ),
        );
      };
      if (agentMustCompact) showCompact("上下文到量了，正在整理前文…");
      try {
        const response = await fetch("/api/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: stripHandoffTurns(
              agentMessages.filter(
                (item) =>
                  (item.role === "user" || item.role === "assistant") && item.content.trim(),
              ),
            ).map((item) => ({ role: item.role, content: item.content })),
            modelId,
            previous: workCompaction,
            handoff: agentMustCompact,
            stream: agentMustCompact,
          }),
        });
        let built: {
          summary?: string;
          recent?: { role: "user" | "assistant"; content: string }[];
          compaction?: Compaction;
        } | null = null;
        if (agentMustCompact && response.ok && response.headers.get("content-type")?.includes("event-stream")) {
          let summaryChars = 0;
          await readSse(response, (event) => {
            const row = event as unknown as {
              type?: string;
              phase?: string;
              chars?: number;
              summary?: string;
              recent?: { role: "user" | "assistant"; content: string }[];
              compaction?: Compaction;
              message?: string;
            };
            if (row.type === "progress") {
              if (row.phase === "整理") showCompact("正在整理前文…");
              if (row.phase === "摘要") {
                summaryChars = row.chars || summaryChars;
                showCompact(`正在生成摘要… 已写 ${summaryChars} 字`);
              }
              return;
            }
            if (row.type === "done") built = row;
          });
        } else if (response.ok) {
          built = (await response.json()) as {
            summary?: string;
            recent?: { role: "user" | "assistant"; content: string }[];
            compaction?: Compaction;
          };
        }
        if (built?.compaction) {
          compactedNotice = compactNotice(built.compaction, agentLimit.tokens);
          const saved = built.compaction;
          setWorkOverrides((current) => ({
            ...current,
            [sendWork.id]: { ...current[sendWork.id], compaction: saved },
          }));
          void fetch("/api/agent-works", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sendWork.id, compaction: saved }),
          });
        }
        if (built?.summary) {
          agentHistory.push({
            role: "user",
            content: `【这条工作此前的进展（由 AllAi 整理）】
${built.summary}`,
          });
          agentHistory.push({ role: "assistant", content: "好的，我了解了之前的进展。" });
        }
        agentHistory = agentHistory.concat(built?.recent ?? []);
      } catch {
        // 捞不到就照常发，下面会在对话里说明
      }
      if (!remote?.silent) {
        showCompact(
          compactedNotice ||
            (agentHistory.length
              ? `已把之前的进展交给模型（${agentHistory.length} 条）`
              : "没能带上之前的进展，新模型可能不记得前面做过什么"),
        );
      }
    }
    setWorks((current) =>
      current.map((item) =>
        item.id === sendWork.id
          ? {
              ...item,
              title: item.title === "新工作" ? text.slice(0, 28) : item.title,
              preview: text.slice(0, 80),
              updatedAt: Date.now(),
              cwd: folder,
              model: modelId,
              modelKey: key,
              endpointId: parsed.providerId || item.endpointId,
              sessionModel: modelId,
              cliSessionId: nextSessionId,
              source: continueId ? item.source : "new",
            }
          : item,
      ),
    );
    setWorkOverrides((current) => ({
      ...current,
      [sendWork.id]: { ...current[sendWork.id], sessionModel: modelId, modelKey: key },
    }));
    void fetch("/api/agent-works", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sendWork.id, sessionModel: modelId, modelKey: key }),
    }).catch(() => undefined);
    markRunning(sendWork.id, true);
    const firePrompt = (
      prompt: string,
      extras?: {
        history?: { role: "user" | "assistant"; content: string }[];
        images?: string[];
        resumeId?: string;
        newSessionId?: string;
      },
    ) =>
      desktop.prompt({
        sessionId: sendWork.id,
        agentId: sendAgentProfile.id,
        prompt,
        cwd: folder,
        resumeId: extras?.resumeId ?? continueId,
        newSessionId: extras?.newSessionId ?? (continueId ? undefined : nextSessionId),
        model: modelId,
        endpointId: parsed.providerId || sendWork.endpointId || sendAgentProfile.activeEndpointId,
        effort: isCliCommand ? undefined : reasoning,
        images: extras?.images ?? (isCliCommand ? [] : images.map((item) => item.path)),
        webSearch: prefs.webSearchAgent,
        history: extras?.history ?? (isCliCommand ? undefined : agentHistory.length ? agentHistory : undefined),
        permissionMode: remotePermission(
          resolvePermission(sendAgentProfile.kind, prefs.agentPermissionMode[sendAgentProfile.kind]),
          remote,
        ),
        elevated: prefs.cliAdminAgent && (!remote || remote.caps.allowAdmin),
      });
    if (agentMustCompact && canNativeCompact && continueId) {
      if (!remote?.silent) {
        setAgentMessages((current) =>
          current.map((item) =>
            item.id === assistantMessage.id
              ? {
                  ...item,
                  trace: upsertToolTrace(
                    item.trace,
                    "压缩上下文",
                    `上下文到量了，正在用 ${sendAgentProfile.name} 的压缩指令…`,
                  ),
                }
              : item,
          ),
        );
      }
      const compactDone = new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => {
          if (compactWaiter.current) {
            compactWaiter.current = null;
            resolve(false);
          }
        }, 180_000);
        compactWaiter.current = {
          sessionId: sendWork.id,
          resolve: (ok) => {
            window.clearTimeout(timer);
            resolve(ok);
          },
        };
      });
      const compacted = await firePrompt(nativeCompactPrompt(sendAgentProfile.kind), {
        history: undefined,
        images: [],
        resumeId: continueId,
        newSessionId: undefined,
      });
      if (!compacted.ok) {
        compactWaiter.current?.resolve(false);
        compactWaiter.current = null;
      } else {
        const ok = await compactDone;
        if (!remote?.silent) {
          setAgentMessages((current) =>
            current.map((item) =>
              item.id === assistantMessage.id
                ? {
                    ...item,
                    trace: upsertToolTrace(
                      item.trace,
                      "压缩上下文",
                      ok
                        ? `${sendAgentProfile.name} 已压缩当前会话，接着处理你的问题`
                        : "压缩没跑完，仍把你的问题发过去",
                    ),
                  }
                : item,
            ),
          );
        }
      }
    }
    const result = await firePrompt(promptText);
    if (!result.ok) {
      markRunning(sendWork.id, false);
      if (!remote?.silent) setAgentMessages((current) =>
        current.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, trace: appendToolTrace(item.trace, "出错", result.error) }
            : item,
        ),
      );
      setAgentStreaming(false);
      return result.error;
    }
  }

  function stopAgent(workId?: string) {
    // 正在等交接摘要时点了停止：别让「接续到新对话」一直转圈。
    handoffWaiter.current?.resolve(false);
    handoffWaiter.current = null;
    compactWaiter.current?.resolve(false);
    compactWaiter.current = null;
    const desktop = getDesktop();
    const id = workId || activeWorkId;
    if (!desktop || !id) return;
    markRunning(id, false);
    void desktop.kill(id);
    if (!workId || workId === activeWorkId) setAgentStreaming(false);
  }

  /**
   * 接续到新对话：
   * 1. 让这条工作正在用的模型把进度写成交接摘要（是这条工作里真实的一轮，你在旧工作里能看到）；
   * 2. 这一轮结束后，同目录、同 Agent、同模型开一条新工作；
   * 3. 「接续自…」加上摘要放进新工作的输入框 —— 不自动发送，你看过、改过再发。
   */
  async function handoffWork() {
    // 已经在跑了：这次点击是「查看进度」，把面板重新打开就行，别再起一轮。
    if (handoffBusy) {
      setHandoff((current) => ({ ...current, open: true }));
      return;
    }
    if (!activeWork || !workAgent) {
      showToast("先打开一条有回复的 Agent 工作");
      return;
    }
    if (agentStreaming) {
      showToast("这条工作还在跑，等它停下来再接续");
      return;
    }
    const from = activeWork;
    const agent = workAgent;
    const key = agentModelKey;
    const modelLabel = parseModelKey(key).modelId || from.model || agent.name;
    handoffStep.current = 0;
    handoffReply.current = "";
    // 这一轮开始之前已经有哪些消息 —— 之后只认新增的那条，别把旧回复当摘要。
    const before = new Set(agentMessagesRef.current.map((item) => item.id));
    setHandoffBusy(true);
    setHandoff({
      open: true,
      running: true,
      sessionId: from.id,
      workTitle: workOverrides[from.id]?.title || from.title || "上一条工作",
      model: modelLabel,
      phase: "准备",
      steps: [],
      chars: 0,
      startedAt: Date.now(),
    });
    let timer = 0;
    // 面板要留着给用户看结果，不能像 0.16.15 那样在 finally 里一律关掉。
    const settle = (phase: HandoffState["phase"], error?: string, newWorkId?: string) =>
      setHandoff((current) =>
        current.sessionId === from.id
          ? { ...current, running: false, phase, error, newWorkId, open: true }
          : current,
      );
    try {
      const finished = new Promise<boolean>((resolve) => {
        handoffWaiter.current = { sessionId: from.id, resolve };
        // 兜底：十五分钟还没写完就当失败，按钮不能一直转圈。
        timer = window.setTimeout(() => resolve(false), 15 * 60 * 1000);
      });
      const error = await sendAgent({
        text: HANDOFF_PROMPT,
        attachments: [],
        caps: { followPermission: true, allowAdmin: true },
        silent: true,
        keepSession: true,
      });
      if (error) {
        handoffWaiter.current = null;
        settle("出错", error);
        return;
      }
      setHandoff((current) =>
        current.sessionId === from.id && current.running ? { ...current, phase: "生成摘要" } : current,
      );
      const ok = await finished;
      /*
       * 摘要只认**这一轮自己产出的东西**，三道来源按可靠程度往下退：
       *   1. 这一轮的事件流（handoffReply）—— 一定是它写的，最可靠；
       *   2. 会话文件里这一轮**新增**的助手消息（按开始前的 id 集合筛）；
       *   3. 都没有就报错。
       * 绝不能退回「最后一条 assistant」：交接常常要开新会话，本地记的 messagesFile
       * 要等下次扫描才更新，那几秒读到的是上一条会话的最后一条普通回复。
       */
      let summary = handoffReply.current.trim();
      if (!summary) {
        const current = worksRef.current.find((item) => item.id === from.id) || from;
        const latest = (await getDesktop()?.loadMessages(current).catch(() => [])) ?? [];
        const fresh = latest.filter((item) => item.role === "assistant" && !before.has(item.id));
        summary = fresh.at(-1)?.content.trim() || "";
      }
      if (!ok || !summary) {
        settle(
          handoffStoppedRef.current ? "已停止" : "出错",
          handoffStoppedRef.current
            ? "你在摘要写完之前停止了这一轮，新对话还没有开。"
            : "这一轮结束了，但没拿到交接摘要。回到原来那条工作看看它最后说了什么。",
        );
        return;
      }
      const newId = startNewWork({ agentId: agent.id, modelKey: key, cwd: from.cwd || cwd });
      if (!newId) {
        settle("出错", "摘要写好了，但没能开出新工作。检查一下 Agent 和工作目录。");
        return;
      }
      const text = `【接续自「${from.title}」】
下面是上一段对话的交接摘要。请先读一遍，确认理解后从「还没做完 / 下一步」接着做。

${summary}`;
      agentDraftRef.current = text;
      setAgentDraft(text);
      linkHandoff(from.id, newId);
      settle("已完成", undefined, newId);
    } catch (error) {
      settle("出错", error instanceof Error ? error.message : "接续失败");
    } finally {
      window.clearTimeout(timer);
      handoffStoppedRef.current = false;
      setHandoffBusy(false);
    }
  }
  const onHandoff = useLatestCallback(() => {
    void handoffWork();
  });
  const onHandoffClose = useLatestCallback(() =>
    setHandoff((current) => ({ ...current, open: false })),
  );
  const onHandoffStop = useLatestCallback(() => {
    // 交接跑在它自己那条旧工作上，用户这会儿可能已经切到别处了，得指名道姓地停。
    const id = handoffRef.current.sessionId;
    handoffStoppedRef.current = true;
    if (id) stopAgent(id);
    setHandoff((current) => ({ ...current, running: false, phase: "已停止", open: true }));
  });
  const onHandoffOpenWork = useLatestCallback((id: string) => {
    setHandoff((current) => ({ ...current, open: false }));
    setView("agents");
    void selectWork(id);
  });
  const onOpenWork = useLatestCallback((id: string) => {
    void selectWork(id);
  });
  /** 回答 Agent 的提问：作为下一条消息发出去，续同一个会话。不碰电脑上输入框里正在写的东西。 */
  const onAgentAnswer = useLatestCallback((text: string) => {
    void sendAgent({ text, attachments: [], caps: { followPermission: true, allowAdmin: true } }).then((error) => {
      if (error) showToast(error);
    });
  });

  /* ---------- 远程控制：手机操控的就是这个界面本身，见 useRemoteControl.ts ---------- */
  const remoteStatus = useRemoteStatus();
  const remoteLive = Boolean(remoteStatus?.sessions.length);
  const snapshotNow = () =>
    buildRemoteSnapshot({
      view: view as RemoteView,
      providers,
      conversations,
      active,
      modelKey,
      streaming,
      works: visibleWorks,
      activeWork,
      agentMessages,
      agentStreaming,
      agents,
      agentModelKey,
      cwd,
      studioConversations,
      activeStudioId,
      prefs,
      reasoning,
      reasoningOptions,
      chatContext,
      agentContext,
    });
  const remoteSnapshot = useMemo(
    () => (remoteLive ? snapshotNow() : null),
    // 输入框的 draft 不进快照。每次按键重算会把整份对话再走一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshotNow 关的是上面这些状态
    [
      remoteLive,
      view,
      providers,
      conversations,
      active,
      modelKey,
      streaming,
      visibleWorks,
      activeWork,
      agentMessages,
      agentStreaming,
      agents,
      agentModelKey,
      cwd,
      studioConversations,
      activeStudioId,
      prefs,
      reasoning,
      reasoningOptions,
    ],
  );
  const remoteApiRef = useRef<RemoteApi | null>(null);
  // 每次渲染换成最新闭包：远程命令拿到的永远是当前状态，不是过期的。
  remoteApiRef.current = {
    state: () => ({
      view: view as RemoteView,
      chatId: active && active.id !== "pending" ? active.id : null,
      workId: activeWorkId,
      chatStreaming: streamingRef.current,
      agentStreaming,
    }),
    setView: (next) => {
      setView(next);
      setMobileOpen(false);
    },
    openChat: (id) => selectConversation(id),
    newChat,
    sendChat: (text, files) => {
      void send("send", { content: text, attachments: files, base: activeRef.current });
    },
    stopChat: stop,
    changeModel,
    openWork: async (id) => {
      if (!visibleWorks.some((item) => item.id === id)) throw new Error("这条工作不存在了");
      await selectWork(id);
    },
    newWork: (draft) => startNewWork(draft),
    sendAgent: (remote) => sendAgent(remote),
    stopAgent: (workId) => stopAgent(workId),
    changeAgentModel,
    refreshStudio: async (conversationId) => {
      await loadStudioConversations();
      if (!conversationId || conversationId === activeStudioId) await loadStudioThread(activeStudioId);
    },
    publish: () => getDesktop()?.remotePublish?.(snapshotNow()),
    patchPrefs: (patch) => {
      const nextMode = {
        ...prefsRef.current.agentPermissionMode,
        ...(patch.agentPermissionMode ?? {}),
      };
      setPrefs((current) => ({
        ...current,
        ...patch,
        agentPermissionMode: nextMode,
      }));
      if (typeof patch.reasoningEffort === "string") setReasoning(patch.reasoningEffort);
      void fetch("/api/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          patch.agentPermissionMode ? { ...patch, agentPermissionMode: nextMode } : patch,
        ),
      });
    },
    renameChat: renameConversation,
    deleteChat: removeConversation,
    renameWork,
    deleteWork: removeWork,
  };
  useRemoteBridge(remoteApiRef, remoteSnapshot);

  async function toggleCliAdmin(which: "chat" | "agent", value: boolean) {
    if (value) {
      const desktop = getDesktop();
      if (!desktop?.ensureAdmin) return;
      /*
       * 打开时要真的拿到管理员宿主。等系统确认的这段时间、以及失败原因都得告诉用户 ——
       * 以前失败了就静默 return，按钮一直是关的，用户只知道「好像启动不了」。
       */
      const status = await desktop.adminStatus?.().catch(() => null);
      if (!status?.elevated && !status?.linked) {
        showToast("请在系统弹出的窗口里确认管理员权限…");
      }
      const result = await desktop.ensureAdmin();
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      showToast(
        result.elevated
          ? "AllAi 本身就是管理员身份，本机 CLI 会直接以管理员运行"
          : "管理员权限已就绪，本机 CLI 会以管理员身份运行",
      );
    }
    const patch = which === "chat" ? { cliAdminChat: value } : { cliAdminAgent: value };
    setPrefs((current) => ({ ...current, ...patch }));
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  /*
   * 打开一条 Agent 工作时盯住它的会话文件：外部终端里跑的 Claude / Codex
   * 也会往同一个文件写，这样它那边说一句，AllAi 这边就跟着出一句。
   * 不盯进程 —— 见产品约定，扫进程名会误报。
   */
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.watchWork || !desktop.onWorkMessages) return;
    const work = visibleWorks.find((item) => item.id === activeWorkId);
    // 远程端可以独立浏览 Agent，不应因为电脑当前停留在聊天/创作页而停止监听。
    // 本地界面不在 Agent 页时也继续监听当前工作，保证手机端切换工作后能拿到完整消息。
    if (!work || work.source === "new") {
      void desktop.unwatchWork?.().catch(() => undefined);
      return;
    }
    const off = desktop.onWorkMessages((payload) => {
      if (payload.workId !== work.id) return;
      // 自己正在发的那轮由流式事件负责，别让文件回读把它盖掉。
      if (agentStreaming) return;
      // 接续摘要是后台内部请求，不把它伪装成用户消息显示在时间线里。
      const filtered: AgentMessage[] = [];
      let skipHandoffReply = false;
      for (const message of payload.messages) {
        if (message.role === "user" && message.content.trim() === HANDOFF_PROMPT.trim()) {
          skipHandoffReply = true;
          continue;
        }
        if (skipHandoffReply && message.role === "assistant") {
          skipHandoffReply = false;
          continue;
        }
        filtered.push(message);
      }
      setAgentMessages(mergeAgentSwitches(filtered, workOverrides[work.id]?.modelSwitches));
      agentMessageCache.current[work.id] = filtered;
      if (payload.context) {
        const next = payload.context;
        setCliContext((current) => ({ ...current, [work.id]: next }));
      }
      setWorks((current) =>
        current.map((item) =>
          item.id === work.id ? { ...item, running: payload.running, online: payload.online ?? item.online } : item,
        ),
      );
    });
    void desktop.watchWork(work).catch(() => undefined);
    return () => {
      off();
      void desktop.unwatchWork?.().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切换工作/视图时重挂
  }, [activeWorkId, view, agentStreaming]);

  useEffect(() => {
    if (view !== "agents") return;
    const desktop = getDesktop();
    if (desktop) {
      void desktop.scanWorks().then((scanned) => {
        setWorks((current) => mergeAgentWorkLists(current, scanned));
      });
    }
  }, [view]);

  useEffect(() => {
    if (view !== "agents" || !workAgent) return;
    for (const endpoint of workAgent.endpoints) {
      const needsOfficial =
        endpoint.mode === "official" && officialModelsNeedRefresh(workAgent.kind, endpoint.models);
      const needsApi = endpoint.mode === "api" && endpoint.hasKey && !endpoint.models?.length;
      if (!needsOfficial && !needsApi) continue;
      const key = `${workAgent.id}:${endpoint.id}`;
      if (agentSyncTried.current.has(key)) continue;
      agentSyncTried.current.add(key);
      void syncAgentModels(workAgent.id, endpoint.id, true);
    }
  }, [syncAgentModels, view, workAgent]);

  const hasModels = providers.some((provider) =>
    provider.models.some((model) => !model.kind || model.kind === "chat")
  );
  const canChat = hasModels || isDesktop;

  /*
   * MessageList 是 memo 的，但 send / editUserMessage 每次渲染都是新函数，
   * 直接传下去 memo 就白做了 —— 敲一个字，上百段 Markdown 全部重新解析。
   * 用 latest-ref 给它们一个稳定身份：identity 不变，调用时永远走最新的闭包。
   */
  const sendRef = useRef(send);
  const modelKeyRef = useRef(modelKey);
  modelKeyRef.current = modelKey;
  const viewRef = useRef(view);
  viewRef.current = view;
  const editRef = useRef(editUserMessage);
  useEffect(() => {
    sendRef.current = send;
    editRef.current = editUserMessage;
  });
  const regenerate = useCallback(() => {
    void sendRef.current("regenerate");
  }, []);
  const onEditUser = useCallback((messageId: string, content: string) => {
    void editRef.current(messageId, content);
  }, []);


  /** 截一张屏并存成附件，交给模型看。 */
  const captureForModel = useCallback(async () => {
    const desktop = getDesktop();
    if (!desktop?.computerScreenshot) return { ok: false as const, error: "桌面截图能力不可用" };
    const result = await desktop.computerScreenshot().catch(() => null);
    if (!result) return { ok: false as const, error: "调用桌面截图能力失败" };
    if (!result.ok) return { ok: false as const, error: result.error };
    const shot = result.shot;
    shotSizeRef.current = {
      width: shot.width,
      height: shot.height,
      target: shot.target,
      changedRatio: shot.changedRatio,
      controls: shot.controls,
      windows: shot.windows,
    };
    // 存成上传件：对话里要看得见 AI 当时看到了什么，不然出了问题没法复盘。
    // 这个接口收的是 JSON + base64，不是 FormData（和 Composer 那边一致）。
    const base64 = shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1);
    const uploaded = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `screen-${Date.now()}.jpg`,
        mime: "image/jpeg",
        data: base64,
      }),
    })
      .then((r) => r.json() as Promise<{ file?: ChatAttachment }>)
      .catch(() => null);
    if (!uploaded?.file) return { ok: false as const, error: "已截到目标窗口，但保存截图失败" };
    return { ok: true as const, shot, attachment: uploaded.file };
  }, []);

  /**
   * Computer Use 的主循环：截图 → 模型给动作 → 执行 → 再截图。
   *
   * 一次只走一个动作 —— 让模型连开一串再一起执行，中间任何一步偏了后面全是乱点。
   */
  const runComputerLoop = useCallback(
    async (goal: string) => {
      const desktop = getDesktop();
      if (!desktop?.computerScreenshot || !desktop.computerAct) {
        showToast("请用桌面版 AllAi");
        return;
      }
      /*
       * 官方登录（Claude/Grok/ChatGPT 账号）走的是本机 CLI 的单轮 print 模式，
       * 那条路根本收不到图片，模型看不见屏幕就只会瞎猜。必须换成能读图的第三方接口。
       */
      if (officialSpecForModelKey(modelKeyRef.current)) {
        showToast("官方登录的模型看不到截图，请换成第三方接口里的视觉模型（如 gpt-5.6 / grok-4.6）");
        return;
      }
      computerStopRef.current = false;
      setComputerBusy(true);
      const previousComputer = computerUseRef.current;
      computerUseRef.current = true;
      let agentAssistantId = "";
      if (viewRef.current === "agents") {
        const userId = crypto.randomUUID();
        agentAssistantId = crypto.randomUUID();
        const at = Date.now();
        setAgentMessages((current) => [
          ...current,
          { id: userId, role: "user", content: goal, createdAt: at },
          {
            id: agentAssistantId,
            role: "assistant",
            content: "",
            createdAt: at,
            trace: [{ type: "tool", name: "操控电脑", detail: "正在绑定目标窗口…" }],
          },
        ]);
      }
      const level = (prefsRef.current.computerSafety || "confirm-risky") as SafetyLevel;
      const maxSteps = Math.max(1, Math.min(50, prefsRef.current.computerMaxSteps || 15));
      let base: Conversation | null = activeRef.current;
      let note = goal;
      // 只提醒一次格式，别陷进「提醒→还是不给→再提醒」的死循环。
      let nudged = false;
      let failures = 0;
      let previousAction: ComputerOp | null = null;
      const runId = crypto.randomUUID();
      let firstSend = true;
      let lastReply: { assistantMessageId: string; conversationId: string } | null = null;

      const recordComputerStep = (
        reply: { assistantMessageId: string; conversationId: string },
        kind: "notice" | "error",
        text: string,
        content?: string,
      ) => {
        setActive((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === reply.assistantMessageId
                    ? {
                        ...message,
                        ...(content === undefined ? {} : { content }),
                        steps: [...(message.steps ?? []), { kind, text, at: Date.now() }],
                      }
                    : message,
                ),
              }
            : current,
        );
        if (agentAssistantId) {
          setAgentMessages((current) =>
            current.map((item) =>
              item.id === agentAssistantId
                ? {
                    ...item,
                    ...(content === undefined ? {} : { content }),
                    trace: appendToolTrace(
                      item.trace,
                      kind === "error" ? "出错" : "操控电脑",
                      text,
                    ),
                  }
                : item,
            ),
          );
        }
        void fetch(`/api/conversations/${reply.conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              id: reply.assistantMessageId,
              ...(content === undefined ? {} : { content }),
              step: { kind, text },
            },
          }),
        });
      };

      try {
        const begun = await desktop.computerBegin();
        if (!begun.ok) {
          if (agentAssistantId) {
            setAgentMessages((current) =>
              current.map((item) =>
                item.id === agentAssistantId
                  ? {
                      ...item,
                      trace: appendToolTrace(item.trace, "出错", begun.error),
                    }
                  : item,
              ),
            );
          } else {
            showToast(begun.error);
          }
          return;
        }
        note = `目标：${goal}\n已锁定窗口「${begun.target.title}」。请从当前画面开始完成任务。`;
        for (let step = 0; step < maxSteps; step++) {
          if (computerStopRef.current) break;
          const captured = await captureForModel();
          if (!captured.ok) {
            if (lastReply) recordComputerStep(lastReply, "error", `电脑控制已停止：${captured.error}`);
            else showToast(captured.error);
            break;
          }
          if (
            previousAction &&
            !["move", "wait", "foreground"].includes(previousAction.op) &&
            typeof captured.shot.changedRatio === "number" &&
            captured.shot.changedRatio < 0.002
          ) {
            note += "\n执行后画面几乎没有变化，上一步可能没有生效。请重新观察并换一种定位方式，不要重复点击同一坐标。";
          }
          // 第一轮可能还没有对话，send 会自己建一条，别在这儿拦下来。
          // send 在几种情况下会提前 return（比如正在流式中），拿不到正文就当空。
          /*
           * **必须走 sendRef**。直接闭包捕获 send 的话，拿到的是这个 useCallback
           * 创建那一刻的版本 —— 那时 providers 还没加载完、modelKey 是空字符串，
           * send 会在 `if (!key) return` 就掉头走人，一句话都发不出去，
           * 表现就是「模型没给出动作」（0.14.3 修的）。
           */
          /*
           * 这一轮的每条消息都带同一个 computerRun，界面据此把整轮合并成一条回复；
           * 只有第一条带 computerGoal（用户原话），后面那些「已执行…新截图」是程序替用户
           * 发给模型的上下文，不显示成用户气泡。
           */
          const payload = {
            content: note,
            base: base ?? activeRef.current,
            attachments: [captured.attachment],
            computerRun: runId,
            computerGoal: firstSend ? goal : undefined,
          };
          let reply = await sendRef.current("send", payload);
          if (!reply) {
            await new Promise((resolve) => setTimeout(resolve, 80));
            reply = await sendRef.current("send", { ...payload, base: base ?? activeRef.current });
          }
          firstSend = false;
          const replyText = reply?.text ?? "";
          if (reply) lastReply = reply;
          if (computerStopRef.current) break;

          base = activeRef.current ?? base;
          const actions = extractActions(replyText);
          const action = actions[0];
          if (!action) {
            /*
             * 模型没按协议给动作。多半是它忘了格式或者压根没看懂截图 ——
             * 先明确提醒一次再放弃，比直接停下有用得多。
             */
            if (!nudged) {
              nudged = true;
              note =
                "你上一条回复里没有动作代码块。请**只**回一个 ```action 代码块，" +
                '例如 {"op":"click","x":640,"y":400}；做不了就回 {"op":"done","summary":"原因"}。';
              continue;
            }
            const said = replyText.trim().replace(/\s+/g, " ").slice(0, 80);
            if (reply) {
              recordComputerStep(
                reply,
                "error",
                said ? `电脑控制已停止：模型没有给出可执行动作（${said}）` : "电脑控制已停止：模型没有回复",
                stripActions(replyText),
              );
            } else {
              showToast("模型没有任何回复，已停下");
            }
            break;
          }
          nudged = false;
          if (reply) {
            const cleaned = stripActions(replyText);
            const progress =
              action.op === "done"
                ? `电脑控制完成：${action.summary || "任务已完成"}`
                : `准备执行：${describeAction(action)}`;
            recordComputerStep(reply, "notice", progress, cleaned);
          }
          if (action.op === "done") break;

          if (needsConfirm(action, level)) {
            // 正常任务不会走这里。只有删除、发送、支付等真正的提交点才把 AllAi 显示出来。
            await desktop.computerPause();
            const ok = await new Promise<boolean>((resolve) => {
              setPendingAction({ action, resolve });
            });
            setPendingAction(null);
            if (computerStopRef.current) break;
            const resumed = await desktop.computerResume();
            if (!resumed.ok) {
              note = `恢复目标窗口失败：${resumed.error}。请重新观察后结束任务。`;
              failures += 1;
              continue;
            }
            if (!ok) {
              note = "用户拒绝了这个动作，请换一种做法，或者用 done 结束。";
              continue;
            }
          }

          if (action.op === "wait") {
            await new Promise((r) => setTimeout(r, action.ms));
            note = `已等待 ${action.ms}ms。这是最新的屏幕，请继续。`;
            continue;
          }

          if (!shotSizeRef.current.target) {
            note = "目标窗口信息丢失，请重新截图定位。";
            continue;
          }
          const ran = await desktop.computerAct(action, {
            width: shotSizeRef.current.width,
            height: shotSizeRef.current.height,
            target: shotSizeRef.current.target,
          });
          if (!ran.ok) {
            /*
             * 连着两次执行失败基本就是环境问题（输入宿主起不来之类），
             * 再让模型重试只是空转烧 token —— 直接停下把原因摆出来。
             */
            failures += 1;
            if (failures >= 2) {
              if (lastReply) recordComputerStep(lastReply, "error", `电脑控制已停止：${ran.error}`);
              else showToast(`动作执行失败：${ran.error}`);
              break;
            }
            note = `上一个动作失败了：${ran.error}。请换个做法。`;
            continue;
          }
          failures = 0;
          previousAction = action;
          if (action.op === "foreground" && ran.foreground) {
            note = `当前前台窗口是「${ran.foreground.title || "(无标题)"}」。这是最新的屏幕，请继续。`;
            continue;
          }
          // 输入和移动反馈很快；导航类动作多留一点时间。固定等 700ms 会把长任务白白拖慢。
          const settleMs =
            action.op === "move"
              ? 60
              : action.op === "text"
                ? action.submit
                  ? 500
                  : 180
                : action.op === "scroll"
                  ? 220
                  : 360;
          await new Promise((r) => setTimeout(r, settleMs));
          note = `已执行：${describeAction(action)}。这是执行后的屏幕，请继续下一步；做完了就给 done。`;
          if (step === maxSteps - 1 && lastReply) {
            recordComputerStep(lastReply, "error", `电脑控制已达到 ${maxSteps} 步上限，请提高上限或继续发送任务`);
          }
        }
      } finally {
        computerUseRef.current = previousComputer;
        setComputerBusy(false);
        setPendingAction(null);
        void getDesktop()?.computerStop?.();
      }
    },
    // send / prefs / modelKey 一律走 ref，这里只留真正稳定的东西。
    [captureForModel, showToast],
  );

  return (
    <div className="flex h-full bg-canvas text-ink">
      {mobileOpen ? (
        <button
          type="button"
          aria-label={t("关闭菜单")}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] md:static md:z-0 md:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${sidebarOpen ? "md:w-72" : "md:w-0"} overflow-hidden`}
      >
        <Sidebar
          view={view}
          onViewChange={(next) => {
            setView(next);
            setMobileOpen(false);
          }}
          conversations={conversations}
          activeId={active?.id ?? null}
          onNewChat={newChat}
          onSelect={selectConversation}
          onRename={renameConversation}
          onDelete={deleteConversation}
          onOpenSettings={() => openSettings(view === "agents" ? "agents" : "chat")}
          onOpenSearch={() => setSearchOpen(true)}
          onCloseMobile={() => setMobileOpen(false)}
          works={visibleWorks}
          workChains={workChains}
          activeWorkId={activeWorkId}
          onRenameWork={renameWork}
          onDeleteWork={deleteWork}
          onNewWork={() => setNewWorkOpen(true)}
          onSelectWork={selectWork}
          studioConversations={studioConversations}
          activeStudioId={activeStudioId}
          onNewStudio={() => {
            setView("studio");
            setActiveStudioId(null);
            setStudioJobs([]);
          }}
          onSelectStudio={(id) => {
            setView("studio");
            setActiveStudioId(id);
            void loadStudioThread(id);
          }}
          onRenameStudio={async (id, title) => {
            const response = await fetch(`/api/studio/conversations/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            }).catch(() => null);
            if (!response?.ok) {
              showToast("重命名失败");
              return;
            }
            const data = (await response.json()) as {
              conversation?: { title?: string };
            };
            const savedTitle = data.conversation?.title || title.trim() || "新创作";
            setStudioConversations((current) =>
              current.map((item) =>
                item.id === id ? { ...item, title: savedTitle } : item,
              ),
            );
          }}
          onDeleteStudio={async (id) => {
            const item = studioConversations.find((entry) => entry.id === id);
            const ok = await confirm({
              title: `删除「${item?.title || "这条创作"}」？`,
              detail: "生成的图片和视频也会一起删掉，无法恢复。",
              confirmText: "删除",
              danger: true,
            });
            if (!ok) return;
            const response = await fetch(`/api/studio/conversations/${id}`, { method: "DELETE" });
            if (!response.ok) {
              showToast("删除失败");
              return;
            }
            setStudioConversations((current) => current.filter((entry) => entry.id !== id));
            if (activeStudioId === id) {
              setActiveStudioId(null);
              setStudioJobs([]);
            }
            showToast("已删除");
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {view === "studio" ? (
          <Studio
            onToast={showToast}
            conversationId={activeStudioId}
            jobs={studioJobs}
            onAddJob={(job) => setStudioJobs((current) => [...current, job])}
            onConversation={(conversation) => {
              setActiveStudioId(conversation.id);
              setStudioConversations((current) => {
                const row = {
                  id: conversation.id,
                  title: conversation.title,
                  modelKey: "",
                  createdAt: conversation.createdAt,
                  updatedAt: conversation.updatedAt,
                  preview: "",
                };
                return [row, ...current.filter((item) => item.id !== conversation.id)];
              });
            }}
            providers={providers}
            prefs={prefs}
            onPrefs={(patch) => {
              setPrefs((current) => ({ ...current, ...patch }));
              void fetch("/api/prefs", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
            }}
            onThreadChanged={async (id) => {
              const list = await loadStudioConversations();
              const next = id || activeStudioId || list[0]?.id || null;
              if (next) setActiveStudioId(next);
              await loadStudioThread(next);
            }}
          />
        ) : view === "agents" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 items-center gap-2 border-b border-line px-3 md:hidden">
              <button
                type="button"
                className="grid size-9 place-items-center rounded-lg hover:bg-user"
                aria-label={t("打开菜单")}
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="size-4" />
              </button>
              <span className="text-sm font-medium">本地 Agent</span>
            </div>
            <AgentWorkspace
              work={activeWork}
              agent={workAgent}
              messages={agentMessages}
              draft={agentDraft}
              streaming={agentStreaming || computerBusy}
              cwd={cwd}
              isDesktop={isDesktop}
              onDraft={(value) => {
                agentDraftRef.current = value;
              }}
              onSend={onAgentSend}
              onStop={onAgentStop}
              onPickFolder={pickFolder}
              onNewWork={onOpenNewWork}
              onHandoff={onHandoff}
              handoffBusy={handoffBusy}
              handoffFromId={handoffFrom?.id}
              handoffFromTitle={handoffFrom?.title}
              handoffToId={handoffTo?.id}
              handoffToTitle={handoffTo?.title}
              onOpenWork={onOpenWork}
              onAnswer={onAgentAnswer}
              attachments={agentAttachments}
              onAttachments={setAgentAttachments}
              reasoning={reasoning}
              onReasoning={onAgentReasoning}
              reasoningOptions={reasoningOptions}
              permission={agentPermission}
              onPermission={onAgentPermission}
              permissionOptions={agentPermissionOptions}
              onVoiceError={showToast}
              webSearch={prefs.webSearchAgent}
              onWebSearch={onAgentWebSearch}
              cliAdmin={isDesktop ? prefs.cliAdminAgent : undefined}
              onCliAdmin={isDesktop ? onAgentCliAdmin : undefined}
              computerUse={computerUseAgent}
              computerUseDisabled={Boolean(officialSpecNow)}
              computerUseHint={
                officialSpecNow
                  ? t("官方登录的模型走 CLI 单轮模式，收不到截图。换成第三方接口里的视觉模型才能用。")
                  : undefined
              }
              onComputerUse={onAgentComputerUse}
              computerBusy={computerBusy}
              pendingAction={pendingAction?.action ?? null}
              onConfirmAction={onAgentConfirmAction}
              onRejectAction={onAgentRejectAction}
              onStopComputer={onAgentStopComputer}
              modelProviders={agentModels}
              modelKey={agentModelKey}
              onModelChange={changeAgentModel}
              showStats={prefs.showStats}
              stats={agentStats}
              icons={prefs.brandIcons}
            />
          </div>
        ) : (
          <>
        <header className="flex h-14 items-center gap-2 border-b border-line px-3">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg hover:bg-user md:hidden"
            aria-label={t("打开菜单")}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" />
          </button>
          <button
            type="button"
            className="hidden size-9 place-items-center rounded-lg hover:bg-user md:grid"
            aria-label={sidebarOpen ? t("收起侧栏") : t("展开侧栏")}
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-4" />
          </button>
          <ModelSelect
            providers={providers}
            value={modelKey}
            onChange={changeModel}
            disabled={streaming}
            extra={CHATGPT_OPTION}
            kinds={["chat"]}
            onOpenChange={setModelMenuOpen}
            icons={prefs.brandIcons}
          />
          {chatgptWeb || streaming || !ready ? (
          <div className="ml-auto text-xs text-muted">
            {chatgptWeb ? t("ChatGPT 网页额度") : streaming ? t("生成中") : t("加载中")}
          </div>
          ) : null}
        </header>

        {chatgptWeb ? (
          <ChatGptPane active={!settingsOpen && !mobileOpen && !modelMenuOpen && !searchOpen} />
        ) : active && active.messages.length > 0 ? (
          <MessageList
            threadId={active.id}
            messages={active.messages}
            providers={providers}
            streaming={streaming}
            onRegenerate={regenerate}
            onEditUser={onEditUser}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
            <Logo className="mb-4 size-12" />
            <h1 className="text-2xl font-semibold tracking-tight">{t(greeting())}</h1>
            {chatModelSource ? (
              <p className="mt-2 text-sm text-muted">{t("{name} 愿意为您提供帮助", { name: chatModelSource.label })}</p>
            ) : null}
            {!hasModels && !isDesktop ? (
              <button
                type="button"
                onClick={() => openSettings("chat")}
                className="mt-6 rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas"
              >
                {t("接入第一个模型")}
              </button>
            ) : null}
          </div>
        )}

        {chatgptWeb || !prefs.showStats ? null : (
          <StatsBar
            data={{
              tokensPerSecond,
              contextTokens: chatContext.used,
              contextLimit: chatContext.limit,
              contextLevel: chatContext.level,
              contextNote: chatContext.note,
              conversationTokens: convUsage.tokens,
              conversationRequests: convUsage.requests,
              conversationInput: convUsage.input,
              conversationOutput: convUsage.output,
              conversationCacheRead: convUsage.cacheRead,
              conversationPrompt: convUsage.prompt,
              costUsd: convUsage.costUsd,
              model: chatModelSource,
              fields: prefs.statsFields,
              official: officialWindow,
            }}
          />
        )}
        {chatgptWeb ? null : (
          <ActionBar
            busy={computerBusy}
            pending={pendingAction?.action ?? null}
            onConfirm={() => pendingAction?.resolve(true)}
            onReject={() => pendingAction?.resolve(false)}
            onStop={() => {
              computerStopRef.current = true;
              pendingAction?.resolve(false);
            }}
          />
        )}
        {chatgptWeb ? null : (
        <Composer
          value={draft}
          onChange={(value) => {
            draftRef.current = value;
          }}
          onSend={() => {
            if (computerUse) {
              const goal = draftRef.current.trim();
              if (!goal || computerBusy) return;
              setDraft("");
              void runComputerLoop(goal);
              return;
            }
            void send("send");
          }}
          onStop={stop}
          streaming={streaming}
          disabled={!canChat}
          placeholder={
            canChat ? t("问点什么…") : t("先在左下角接入模型")
          }
          attachments={attachments}
          onAttachments={setAttachments}
          computerUse={computerUse}
          computerUseDisabled={Boolean(officialSpecNow)}
          computerUseHint={
            officialSpecNow
              ? t("官方登录的模型走 CLI 单轮模式，收不到截图。换成第三方接口里的视觉模型才能用。")
              : undefined
          }
          onComputerUse={(value) => {
            setComputerUse(value);
            computerUseRef.current = value;
            if (!value) computerStopRef.current = true;
          }}
          reasoning={reasoning}
          onReasoning={(value) => {
            setReasoning(value);
            void fetch("/api/prefs", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reasoningEffort: value }),
            });
          }}
          reasoningOptions={reasoningOptions}
          onVoiceError={showToast}
          webSearch={prefs.webSearchChat}
          onWebSearch={(value) => {
            setPrefs((current) => ({ ...current, webSearchChat: value }));
            void fetch("/api/prefs", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ webSearchChat: value }),
            });
          }}
          cliAdmin={isDesktop ? prefs.cliAdminChat : undefined}
          onCliAdmin={
            isDesktop
              ? (value) => {
                  void toggleCliAdmin("chat", value);
                }
              : undefined
          }
        />
        )}
          </>
        )}
      </div>

      {settingsOpen ? (
        <SettingsDialog
          providers={providers}
          agents={agents}
          initialTab={settingsTab}
          initialAgentId={settingsAgentId ?? undefined}
          onClose={() => setSettingsOpen(false)}
          onChanged={loadProviders}
          onChangedAgents={loadAgents}
          prefs={prefs}
          skills={skills}
          onReloadSkills={loadSkills}
          onToast={showToast}
          onPrefs={(patch) => {
            setPrefs((current) => ({ ...current, ...patch }));
            void fetch("/api/prefs", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
          }}
          onLogin={(id) => {
            const desktop = getDesktop();
            if (!desktop) {
              showToast("请用桌面版 AllAi 打开");
              return;
            }
            const agent = agents.find((item) => item.id === id);
            showToast("请在浏览器里完成授权");
            void desktop.login(id).then(async (result) => {
              if (agent && desktop.cliAuthStatus && agent.kind !== "custom") {
                const status = await desktop
                  .cliAuthStatus(agent.kind, agent.command)
                  .catch(() => null);
                // Agent 的登录和聊天共用同一个 CLI，顺手刷一下聊天那边的状态。
                await refreshOfficialStatus();
                showToast(
                  status?.loggedIn
                    ? `${agent.name} 已登录`
                    : result.ok
                      ? "没有检测到登录，请再试一次"
                      : result.error,
                );
                return;
              }
              if (!result.ok) showToast(result.error);
              else showToast("登录窗口已关闭");
            });
          }}
          officialStatus={officialStatus}
          officialBusy={officialBusy}
          onOfficialLogin={loginOfficial}
          onOfficialLogout={logoutOfficial}
          themeMode={themeMode}
          onThemeMode={pickTheme}
          langMode={langMode}
          onLangMode={pickLang}
        />
      ) : null}

      {newWorkOpen ? (
        <NewWorkDialog
          agents={agents}
          cwd={cwd}
          onPickFolder={pickFolder}
          onClose={() => setNewWorkOpen(false)}
          onStart={startNewWork}
          onSyncModels={syncAgentModels}
          icons={prefs.brandIcons}
        />
      ) : null}

      <HandoffPanel
        state={handoff}
        onClose={onHandoffClose}
        onStop={onHandoffStop}
        onOpenNewWork={onHandoffOpenWork}
      />

      {toast ? (
        <div
          role="status"
          className="toast-in fixed bottom-6 left-1/2 z-50 max-w-[min(90vw,26rem)] -translate-x-1/2 rounded-xl border border-line bg-elevated px-3.5 py-2 text-sm text-ink shadow-lg shadow-black/20"
        >
          {t(toast)}
        </div>
      ) : null}

      <SearchPalette
        key={searchOpen ? "open" : "closed"}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        conversations={conversations}
        works={visibleWorks}
        studio={studioConversations}
        onJump={(hit) => {
          if (hit.area === "chat") {
            setView("chat");
            void selectConversation(hit.id);
            return;
          }
          if (hit.area === "agents") {
            setView("agents");
            void selectWork(hit.id);
            return;
          }
          setView("studio");
          setActiveStudioId(hit.id);
          void loadStudioThread(hit.id);
        }}
      />
    </div>
  );
}
