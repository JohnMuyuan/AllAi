"use client";

import { useEffect, useRef, useState } from "react";
import { getDesktop } from "@/lib/desktop";
import { agentModelProviders } from "@/lib/agent-models";
import { isAnswerMessage } from "@/lib/agent-answer";
import { isHandoffPrompt } from "@/lib/agent-handoff";
import { classifyModel } from "@/lib/models";
import { DEFAULT_COMPACT_PERCENT, contextLimit } from "@/lib/context-window";
import { permissionOptions, resolvePermission } from "@/lib/permission-mode";
import { makeModelKey } from "@/lib/public";
import type {
  AppPrefs,
  ChatAttachment,
  ChatMessage,
  Conversation,
  ConversationSummary,
  PublicAgent,
  PublicProvider,
} from "@/lib/types";
import type { AgentMessage, AgentWork, RemoteCaps, RemoteCommand, RemoteStatus } from "@/types/desktop";

/**
 * 远程控制在界面这一侧的两件事：
 * 1. 执行手机发来的操作（主进程转过来的 remote:command）—— 手机操控的就是这个界面本身；
 * 2. 有手机连着时，把当前状态推给主进程，由它做差量、加密后发给手机。
 *
 * 没有手机连着时什么都不推，平时零开销。
 */

export type RemoteView = "chat" | "agents" | "studio";

/** ChatApp 每次渲染都把最新的函数放进 ref，这里拿到的永远不是过期闭包。 */
export type RemoteApi = {
  state: () => {
    view: RemoteView;
    chatId: string | null;
    workId: string | null;
    chatStreaming: boolean;
    agentStreaming: boolean;
  };
  setView: (view: RemoteView) => void;
  openChat: (id: string) => Promise<void>;
  newChat: () => void;
  sendChat: (text: string, attachments: ChatAttachment[]) => void;
  stopChat: () => void;
  changeModel: (key: string) => Promise<void>;
  openWork: (id: string) => Promise<void>;
  newWork: (draft: { agentId: string; modelKey: string; cwd: string }) => string | null;
  sendAgent: (remote: {
    text: string;
    attachments: ChatAttachment[];
    caps: RemoteCaps;
    workId?: string;
  }) => Promise<string | void>;
  stopAgent: (workId?: string) => void;
  changeAgentModel: (key: string, workId?: string) => void;
  refreshStudio: (conversationId?: string) => Promise<void>;
  publish: () => void;
  patchPrefs: (patch: Partial<AppPrefs>) => void;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameWork: (id: string, title: string) => Promise<void>;
  deleteWork: (id: string) => Promise<void>;
};

const MAX_MESSAGES = 120;
const MAX_TRACE = 80;

function clip(text: string | undefined, limit: number) {
  if (!text) return text;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function remoteChatMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    steps: message.steps?.map((step) => ({ kind: step.kind, text: clip(step.text, 4000) })),
    modelKey: message.modelKey,
    fromModelKey: message.fromModelKey,
    attachments: message.attachments?.map(({ id, name, mime, kind }) => ({ id, name, mime, kind })),
    computerRun: message.computerRun,
    computerGoal: message.computerGoal,
    createdAt: message.createdAt,
  };
}

function remoteAgentMessage(message: AgentMessage) {
  // 从会话文件读回来的历史只有 thinking/tools，没有 trace，这里统一成 trace。
  const trace =
    message.trace ??
    [
      ...(message.thinking ? [{ type: "thinking" as const, text: message.thinking }] : []),
      ...(message.tools ?? []).map((tool) => ({ type: "tool" as const, name: tool.name, detail: tool.detail })),
    ];
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    trace: trace.slice(-MAX_TRACE).map((item) =>
      item.type === "thinking"
        ? { type: "thinking" as const, text: clip(item.text, 3000) }
        // ask 一定要带过去：Agent 向用户提问时，手机上没有卡片就没法回答，整条工作卡死。
        : { type: "tool" as const, name: item.name, detail: clip(item.detail, 1500), ask: "ask" in item ? item.ask : undefined },
    ),
    modelKey: message.modelKey,
    fromModelKey: message.fromModelKey,
    createdAt: message.createdAt,
  };
}

function modelOptions(providers: PublicProvider[], kind: "chat" | "image" | "video") {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => (model.kind || classifyModel(model.id)) === kind)
      .map((model) => ({
        key: makeModelKey(provider.id, model.id),
        label: model.label || model.id,
        group: provider.name,
      })),
  );
}

export function buildRemoteSnapshot(input: {
  view: RemoteView;
  providers: PublicProvider[];
  conversations: ConversationSummary[];
  active: Conversation | null;
  modelKey: string;
  streaming: boolean;
  works: AgentWork[];
  activeWork: AgentWork | null;
  agentMessages: AgentMessage[];
  agentStreaming: boolean;
  agents: PublicAgent[];
  agentModelKey: string;
  cwd: string;
  studioConversations: ConversationSummary[];
  activeStudioId: string | null;
  prefs: AppPrefs;
  reasoning: string;
  reasoningOptions: { value: string; label: string; description?: string }[];
  /** 上下文占用。手机上也要看得到还剩多少，不然只能等它突然开始压缩。 */
  chatContext: { used: number; limit: number; level: string };
  agentContext: { used: number; limit: number; level: string };
}) {
  const folders = [input.cwd, ...input.works.map((item) => item.cwd)].filter(
    (item, index, all): item is string => Boolean(item) && all.indexOf(item) === index,
  );
  const activeChatId = input.active && input.active.id !== "pending" ? input.active.id : null;
  return {
    view: input.view,
    chat: {
      list: input.conversations.slice(0, 200).map(({ id, title, updatedAt, preview, modelKey }) => ({
        id,
        title,
        updatedAt,
        preview: clip(preview, 80),
        modelKey,
      })),
      activeId: activeChatId,
      modelKey: input.modelKey,
      models: modelOptions(input.providers, "chat"),
      streaming: input.streaming,
      webSearch: input.prefs.webSearchChat,
      reasoning: input.reasoning,
      reasoningOptions: input.reasoningOptions,
      context: input.chatContext,
    },
    agent: {
      /*
       * 每条工作都带上自己的型号和窗口上限。
       *
       * 手机看的是**它自己**打开的那条（约定 51：agent.open 在主进程按手机分开处理），
       * 所以凡是「当前这条工作」的东西都不能只发电脑选中那条的 —— 否则电脑上一换对话，
       * 手机的型号和上下文条就跟着变，可手机的消息还停在原来那条（0.16.34 修的）。
       */
      list: input.works.slice(0, 200).map((item) => ({
        id: item.id,
        title: item.title,
        agentName: item.agentName,
        kind: item.kind,
        cwd: item.cwd,
        updatedAt: item.updatedAt,
        running: item.running,
        modelKey: item.modelKey || makeModelKey(item.endpointId || "", item.model || ""),
        contextLimit: contextLimit(item.model || "", input.prefs.contextLimits).tokens,
      })),
      activeId: input.activeWork?.id ?? null,
      streaming: input.agentStreaming,
      modelKey: input.agentModelKey,
      agents: input.agents
        .filter((item) => item.kind !== "custom")
        .map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
          models: agentModelProviders(item).flatMap((provider) =>
            provider.models.map((model) => ({
              key: makeModelKey(provider.id, model.id),
              label: model.label || model.id,
              group: provider.name,
            })),
          ),
        })),
      folders: folders.slice(0, 20),
      webSearch: input.prefs.webSearchAgent,
      reasoning: input.reasoning,
      reasoningOptions: input.reasoningOptions,
      // 电脑选中那条的占用。手机打开了别的工作时，主进程会在 metaOf 里换成它自己那条。
      context: input.agentContext,
      compactPercent: input.prefs.compactPercent || DEFAULT_COMPACT_PERCENT,
      permission: Object.fromEntries(
        input.agents.map((item) => {
          const value = resolvePermission(item.kind, input.prefs.agentPermissionMode[item.kind]);
          return [item.kind, value];
        }),
      ),
      permissionOptions: Object.fromEntries(
        input.agents.map((item) => [
          item.kind,
          permissionOptions(item.kind).map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
          })),
        ]),
      ),
    },
    studio: {
      list: input.studioConversations.slice(0, 200).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      activeId: input.activeStudioId,
      imageModels: modelOptions(input.providers, "image"),
      videoModels: modelOptions(input.providers, "video"),
      imageModelKey: input.prefs.studioImageModelKey,
      videoModelKey: input.prefs.studioVideoModelKey || input.prefs.studioImageModelKey,
    },
    threads: {
      chat: {
        id: activeChatId,
        messages: (input.active?.messages ?? []).slice(-MAX_MESSAGES).map(remoteChatMessage),
      },
      agent: {
        id: input.activeWork?.id ?? null,
        messages: input.agentMessages
          .filter(
            (message) =>
              !(message.role === "user" && (isAnswerMessage(message.content) || isHandoffPrompt(message.content))),
          )
          .slice(-MAX_MESSAGES)
          .map(remoteAgentMessage),
      },
    },
  };
}

/** 主进程报来的远程状态。标题栏和设置页也用它。 */
export function useRemoteStatus() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.remoteStatus) return;
    let alive = true;
    void desktop
      .remoteStatus()
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => undefined);
    const off = desktop.onRemoteStatus((value) => setStatus(value));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

function until(check: () => boolean, timeoutMs = 8000) {
  return new Promise<boolean>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      window.setTimeout(tick, 30);
    };
    tick();
  });
}

/**
 * 执行手机来的操作，并在有手机连着时推送状态。
 * `snapshot` 只在有手机连着时由 ChatApp 算出来，否则传 null。
 */
export function useRemoteBridge(apiRef: React.RefObject<RemoteApi | null>, snapshot: unknown) {
  const latest = useRef(snapshot);
  const timer = useRef<number | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    latest.current = snapshot;
    const desktop = getDesktop();
    if (!snapshot || !desktop?.remotePublish) return;
    // 流式输出时每个 token 都会重渲染一次，200ms 合并推一次足够顺滑。
    const push = () => {
      timer.current = null;
      lastSent.current = Date.now();
      if (latest.current) desktop.remotePublish(latest.current);
    };
    if (timer.current !== null) return;
    const wait = Math.max(0, 200 - (Date.now() - lastSent.current));
    timer.current = window.setTimeout(push, wait);
  }, [snapshot]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.onRemoteCommand) return;
    const api = () => {
      const current = apiRef.current;
      if (!current) throw new Error("电脑端界面还没准备好");
      return current;
    };

    async function run(op: string, args: Record<string, unknown>): Promise<unknown> {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      const attachments = Array.isArray(args.attachments) ? (args.attachments as ChatAttachment[]) : [];
      const threadId = typeof args.threadId === "string" ? args.threadId : null;

      switch (op) {
        case "publish":
          api().publish();
          return null;
        case "view":
          if (args.view === "chat" || args.view === "agents" || args.view === "studio") api().setView(args.view);
          return null;
        case "chat.open": {
          if (!threadId) throw new Error("缺少对话编号");
          await api().openChat(threadId);
          if (!(await until(() => api().state().chatId === threadId))) throw new Error("打不开这条对话");
          return null;
        }
        case "chat.new":
          api().newChat();
          await until(() => api().state().chatId === null);
          return null;
        case "chat.send": {
          if (!text && !attachments.length) throw new Error("消息是空的");
          if (api().state().chatId !== threadId) {
            if (threadId) await api().openChat(threadId);
            else api().newChat();
            if (!(await until(() => api().state().chatId === threadId))) throw new Error("打不开这条对话");
          }
          if (api().state().chatStreaming) throw new Error("上一条还在生成，先停止它");
          // 不等整轮生成完：结果会随状态推送一点点流过去。
          api().sendChat(text, attachments);
          return null;
        }
        case "chat.stop":
          api().stopChat();
          return null;
        case "chat.model":
          if (typeof args.modelKey !== "string") throw new Error("缺少模型");
          if (api().state().chatStreaming) throw new Error("生成中不能换模型");
          await api().changeModel(args.modelKey);
          return null;
        case "agent.new": {
          const id = api().newWork({
            agentId: String(args.agentId ?? ""),
            modelKey: String(args.modelKey ?? ""),
            cwd: String(args.cwd ?? ""),
          });
          if (!id) throw new Error("新建失败：检查 Agent 和工作目录");
          await until(() => api().state().workId === id);
          return { id };
        }
        case "agent.send": {
          if (!text && !attachments.length) throw new Error("消息是空的");
          if (!threadId) throw new Error("先选一条工作");
          if (api().state().agentStreaming && api().state().workId === threadId) {
            throw new Error("Agent 还在跑，先停止它");
          }
          const caps = (args.caps ?? { followPermission: true, allowAdmin: false }) as RemoteCaps;
          const error = await api().sendAgent({ text, attachments, caps, workId: threadId });
          if (error) throw new Error(error);
          return null;
        }
        case "agent.stop":
          api().stopAgent(threadId || undefined);
          return null;
        case "agent.model":
          if (typeof args.modelKey !== "string") throw new Error("缺少模型");
          // 手机看的是它自己打开的那条工作，改的也得是那条（不是电脑选中的那条）。
          if (!threadId && api().state().agentStreaming) throw new Error("运行中不能换模型");
          api().changeAgentModel(args.modelKey, threadId || undefined);
          return null;
        case "prefs.patch": {
          const patch: Partial<AppPrefs> = {};
          if (typeof args.webSearchChat === "boolean") patch.webSearchChat = args.webSearchChat;
          if (typeof args.webSearchAgent === "boolean") patch.webSearchAgent = args.webSearchAgent;
          if (typeof args.reasoningEffort === "string") patch.reasoningEffort = args.reasoningEffort as AppPrefs["reasoningEffort"];
          if (args.agentPermissionMode && typeof args.agentPermissionMode === "object") {
            patch.agentPermissionMode = args.agentPermissionMode as AppPrefs["agentPermissionMode"];
          }
          if (!Object.keys(patch).length) throw new Error("没有要改的设置");
          api().patchPrefs(patch);
          return null;
        }
        case "chat.rename": {
          if (!threadId) throw new Error("缺少对话编号");
          const title = String(args.title ?? "").trim();
          if (!title) throw new Error("请填写名称");
          await api().renameChat(threadId, title);
          return null;
        }
        case "chat.delete": {
          if (!threadId) throw new Error("缺少对话编号");
          await api().deleteChat(threadId);
          return null;
        }
        case "agent.rename": {
          if (!threadId) throw new Error("缺少工作编号");
          const title = String(args.title ?? "").trim();
          if (!title) throw new Error("请填写名称");
          await api().renameWork(threadId, title);
          return null;
        }
        case "agent.delete": {
          if (!threadId) throw new Error("缺少工作编号");
          await api().deleteWork(threadId);
          return null;
        }
        case "studio.refresh":
          await api().refreshStudio(typeof args.conversationId === "string" ? args.conversationId : undefined);
          return null;
        default:
          throw new Error(`不支持的操作：${op}`);
      }
    }

    return desktop.onRemoteCommand((command: RemoteCommand) => {
      void run(command.op, command.args ?? {})
        .then((result) => desktop.remoteReply(command.id, { ok: true, result }))
        .catch((error: unknown) =>
          desktop.remoteReply(command.id, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    });
  }, [apiRef]);
}
