"use client";

import { Check, Copy, FolderOpen, GitBranchPlus, LoaderCircle, TerminalSquare } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { canResume, resumeCommand } from "@/lib/agent-resume";
import { kindInfo } from "@/lib/agents";
import { answerBody, isAnswerMessage } from "@/lib/agent-answer";
import { isHandoffPrompt } from "@/lib/agent-handoff";
import { asTrace } from "@/lib/agent-trace";
import type { ComputerOp } from "@/lib/computer-use";
import type { ChatAttachment, PublicAgent, PublicProvider } from "@/lib/types";
import type { AgentMessage, AgentWork } from "@/types/desktop";
import { ActionBar } from "./ActionBar";
import { useT } from "./I18n";
import { AgentQuestions } from "./AgentQuestions";
import { FileChanges } from "./FileChanges";
import { TurnRail, turnLabel } from "./TurnRail";
import { useStickToBottom } from "./useStickToBottom";
import { AgentTrace } from "./AgentTrace";
import { BrandMark } from "./BrandMarks";
import { Composer } from "./Composer";
import { Foldable } from "./Foldable";
import { Markdown } from "./Markdown";
import { ModelSelect, type ExtraModelOption } from "./ModelSelect";
import { modelInfo, SwitchBadge } from "./ModelSwitch";
import { StatsBar, type StatsBarData } from "./StatsBar";

type Props = {
  work: AgentWork | null;
  agent: PublicAgent | null;
  messages: AgentMessage[];
  draft: string;
  streaming: boolean;
  cwd: string;
  isDesktop: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPickFolder: () => void;
  onNewWork: () => void;
  attachments?: ChatAttachment[];
  onAttachments?: (files: ChatAttachment[]) => void;
  reasoning?: string;
  onReasoning?: (value: string) => void;
  reasoningOptions?: { value: string; label: string; description?: string }[];
  permission?: string;
  onPermission?: (value: string) => void;
  permissionOptions?: { value: string; label: string; description?: string }[];
  onVoiceError?: (message: string) => void;
  modelProviders?: PublicProvider[];
  modelKey?: string;
  modelExtra?: ExtraModelOption[];
  onModelChange?: (key: string) => void;
  icons?: Record<string, string>;
  webSearch?: boolean;
  onWebSearch?: (value: boolean) => void;
  cliAdmin?: boolean;
  onCliAdmin?: (value: boolean) => void;
  computerUse?: boolean;
  onComputerUse?: (value: boolean) => void;
  computerUseDisabled?: boolean;
  computerUseHint?: string;
  computerBusy?: boolean;
  pendingAction?: ComputerOp | null;
  onConfirmAction?: () => void;
  onRejectAction?: () => void;
  onStopComputer?: () => void;
  showStats?: boolean;
  stats?: StatsBarData;
  /** 接续到新对话（写交接摘要 → 开新工作 → 摘要放进输入框）。 */
  onHandoff?: () => void;
  handoffBusy?: boolean;
  /** 这条是从哪条接过来的 / 接到了哪条，点标题跳过去。 */
  handoffFromId?: string;
  handoffFromTitle?: string;
  handoffToId?: string;
  handoffToTitle?: string;
  onOpenWork?: (id: string) => void;
  /** 回答 Agent 的提问（作为下一条消息发出去）。 */
  onAnswer?: (text: string) => void;
};

const AgentBubble = memo(function AgentBubble({
  message,
  streaming,
  cwd,
  answered,
  moved,
  onAnswer,
}: {
  message: AgentMessage;
  streaming: boolean;
  cwd?: string;
  /** 通过提问卡片回答的内容（这条之后那条带标记的消息，去掉标记）。 */
  answered?: string;
  /** 这条之后你自己发了别的消息（没点卡片）。 */
  moved?: boolean;
  onAnswer?: (text: string) => void;
}) {
  const t = useT();
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <Foldable text={message.content} align="end">
          {(shown) => (
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-user px-4 py-2.5 text-[15px] leading-7 [overflow-wrap:anywhere] md:max-w-[75%]">
              {shown}
            </div>
          )}
        </Foldable>
      </div>
    );
  }
  const trace = asTrace(message);
  const asks = trace.flatMap((item) => (item.type === "tool" && item.ask ? [item.ask] : []));
  const empty = !message.content && !trace.length;
  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <AgentTrace items={trace} streaming={streaming} hasContent={Boolean(message.content)} />
      {empty && streaming ? (
        <div className="flex gap-1 py-2" aria-label={t("正在生成")}>
          <span className="size-1.5 animate-pulse rounded-full bg-muted" />
          <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:240ms]" />
        </div>
      ) : null}
      {message.content ? (
        <Foldable text={message.content}>
          {(shown) => (
            <div className="min-w-0 max-w-full overflow-hidden">
              <Markdown cwd={cwd}>{shown}</Markdown>
              {streaming ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-accent align-middle" />
              ) : null}
            </div>
          )}
        </Foldable>
      ) : null}
      {asks.length ? (
        <AgentQuestions asks={asks} answered={answered} moved={moved} disabled={streaming} onAnswer={onAnswer} />
      ) : null}
      {/* 这一轮改了哪些文件，不用展开执行过程就能看到。 */}
      <FileChanges items={trace} />
    </div>
  );
});

const AgentMessageList = memo(function AgentMessageList({
  messages,
  streaming,
  cwd,
  modelProviders,
  onAnswer,
}: {
  messages: AgentMessage[];
  streaming: boolean;
  cwd: string;
  modelProviders: PublicProvider[];
  onAnswer?: (text: string) => void;
}) {
  // 每条消息之后你发的第一条消息：提问卡片据此判断「已回答」。倒着扫一遍，别每条都往后找。
  const nextUser = useMemo(() => {
    const out: (string | undefined)[] = new Array(messages.length);
    let next: string | undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
      out[index] = next;
      if (messages[index].role === "user") next = messages[index].content;
    }
    return out;
  }, [messages]);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-8">
      {messages.map((message, index) =>
        // 回答提问的那条不是用户打的字，不画成气泡；回答显示在上一条回复的提问卡片里。
        message.role === "user" && (isAnswerMessage(message.content) || isHandoffPrompt(message.content)) ? null : message.role === "notice" ? (
          <SwitchBadge
            key={message.id}
            from={modelInfo(message.fromModelKey, modelProviders)}
            to={modelInfo(message.modelKey, modelProviders)}
          />
        ) : (
          <div key={message.id} data-turn={message.role === "user" ? message.id : undefined}>
            <AgentBubble
              message={message}
              streaming={streaming && index === messages.length - 1 && message.role === "assistant"}
              cwd={cwd}
              answered={isAnswerMessage(nextUser[index]) ? answerBody(nextUser[index]!) : undefined}
              moved={Boolean(nextUser[index]) && !isAnswerMessage(nextUser[index])}
              onAnswer={onAnswer}
            />
          </div>
        ),
      )}
    </div>
  );
});

export const AgentWorkspace = memo(function AgentWorkspace({
  work,
  agent,
  messages,
  draft,
  streaming,
  cwd,
  isDesktop,
  onDraft,
  onSend,
  onStop,
  onPickFolder,
  onNewWork,
  attachments,
  onAttachments,
  reasoning,
  onReasoning,
  reasoningOptions,
  permission,
  onPermission,
  permissionOptions,
  onVoiceError,
  modelProviders = [],
  modelKey = "",
  modelExtra = [],
  onModelChange,
  icons = {},
  webSearch,
  onWebSearch,
  cliAdmin,
  onCliAdmin,
  computerUse,
  onComputerUse,
  computerUseDisabled,
  computerUseHint,
  computerBusy,
  pendingAction,
  onConfirmAction,
  onRejectAction,
  onStopComputer,
  showStats,
  stats,
  onHandoff,
  handoffBusy,
  handoffFromId,
  handoffFromTitle,
  handoffToId,
  handoffToTitle,
  onOpenWork,
  onAnswer,
}: Props) {
  const t = useT();
  const { ref: scroller, node: scrollNode } = useStickToBottom(messages, work?.id ?? null);
  const turns = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.role === "user" && !isAnswerMessage(message.content) && !isHandoffPrompt(message.content),
        )
        .map((message) => ({ id: message.id, label: turnLabel(message.content) })),
    [messages],
  );
  const [copied, setCopied] = useState<"cwd" | "resume" | null>(null);

  const folder = work?.cwd || cwd || "";
  const resume = work && canResume(work) ? resumeCommand(work.kind, work.cliSessionId) : "";

  async function copy(what: "cwd" | "resume", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      onVoiceError?.(t("复制失败，请手动选中"));
    }
  }

  if (!isDesktop) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("本地工作需要桌面版")}</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted">
          {t("双击桌面上的 AllAi 打开，就能用聊天界面驱动 Grok Build、Claude Code 和 Codex。")}
        </p>
      </div>
    );
  }

  const info = agent ? kindInfo(agent.kind) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        * 标题很长 + 窗口很窄时，右边那组按钮会被挤到第二排。
        * 所以把「换模型」和右边那组放进**同一个**会换行的容器里：要么一起待在第一排，
        * 要么整组一起掉到第二排（换模型在左、按钮在右），不会出现
        * 「换模型留在上面、按钮孤零零掉下来」那种错位。
        */}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate text-sm font-semibold">
            {work?.title || agent?.name || t("本地工作")}
          </div>
          <div className="truncate text-[11px] text-muted">
            {work?.running ? `${t("运行中")} · ` : work?.online ? `${t("在线")} · ` : ""}
            {agent?.name || work?.agentName || t("未选择 Agent")}
          </div>
        </div>
        {/*
          换模型和右边那排按钮绑成一组：shrink-0 让这一组要么整组待在标题右边，
          要么整组掉到第二排（换模型在最左），不会出现「标题挤到只剩两个字、
          按钮还硬撑在同一排」的样子。标题自己 min-w-0，该截断就截断。
        */}
        <div className="ml-auto flex max-w-full shrink-0 items-center gap-2">
        {work && onModelChange && modelProviders.length ? (
          <ModelSelect
            providers={modelProviders}
            value={modelKey}
            extra={modelExtra}
            onChange={onModelChange}
            disabled={streaming}
            kinds={["chat"]}
            icons={icons}
          />
        ) : null}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {work && onHandoff && messages.some((message) => message.role === "assistant") ? (
            <button
              type="button"
              onClick={onHandoff}
              // 接续期间这条工作正在跑，streaming 是真的；但这时按钮是「查看进度」，
              // 跟着禁用等于关掉面板就再也打不开（0.16.15 的 BUG）。
              disabled={streaming && !handoffBusy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs text-muted hover:bg-user hover:text-ink disabled:opacity-60"
            >
              {handoffBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <GitBranchPlus className="size-3.5" />
              )}
              {handoffBusy ? t("查看进度") : t("接续到新对话")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onPickFolder}
            className="ui-select min-w-0 max-w-[280px] text-xs"
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">{work?.cwd || cwd || t("选择工作目录")}</span>
          </button>
          {folder ? (
            <button
              type="button"
              aria-label={t("复制工作目录")}
              title={`复制工作目录
${folder}`}
              onClick={() => copy("cwd", folder)}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
            >
              {copied === "cwd" ? (
                <Check className="size-3.5 text-accent" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          ) : null}
          {resume ? (
            <button
              type="button"
              aria-label={t("复制恢复命令")}
              title={`在官方终端里接着这条会话
${resume}`}
              onClick={() => copy("resume", resume)}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
            >
              {copied === "resume" ? (
                <Check className="size-3.5 text-accent" />
              ) : (
                <TerminalSquare className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
        </div>
      </header>
      {handoffFromId || handoffToId ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-user/30 px-4 py-1.5 text-xs text-muted">
          {handoffFromId ? (
            <span>
              {t("接续自")}{" "}
              <button
                type="button"
                onClick={() => onOpenWork?.(handoffFromId)}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                《{handoffFromTitle || t("上一条工作")}》
              </button>
            </span>
          ) : null}
          {handoffToId ? (
            <span>
              {t("已接续到")}{" "}
              <button
                type="button"
                onClick={() => onOpenWork?.(handoffToId)}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                《{handoffToTitle || t("新工作")}》
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {work ? (
        <>
          {messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
              <BrandMark kind={work.kind} className="mb-3 size-10 text-ink" />
              <p className="text-lg font-medium">{info?.title || work.agentName}</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                {t("发送你的需求，让 Agent 开始工作")}
              </p>
            </div>
          ) : (
            <div className="@container relative flex min-h-0 flex-1 flex-col">
              <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <AgentMessageList
                  messages={messages}
                  streaming={streaming}
                  cwd={folder}
                  modelProviders={modelProviders}
                  onAnswer={onAnswer}
                />
              </div>
              <TurnRail turns={turns} container={scrollNode} />
            </div>
          )}
          {onHandoff && !streaming && !handoffBusy && (stats?.contextLevel === "warn" || stats?.contextLevel === "over") ? (
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pt-2 text-xs text-muted">
              <span className="min-w-0 flex-1">
                {t("上下文快满了。可以接续到新对话：AI 先把进度写成交接摘要，再开一条新工作接着做。")}
              </span>
              <button
                type="button"
                onClick={onHandoff}
                className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-ink hover:bg-user"
              >
                {t("接续到新对话")}
              </button>
            </div>
          ) : null}
          {showStats && stats ? <StatsBar data={stats} /> : null}
          {onComputerUse ? (
            <ActionBar
              busy={Boolean(computerBusy)}
              pending={pendingAction ?? null}
              onConfirm={() => onConfirmAction?.()}
              onReject={() => onRejectAction?.()}
              onStop={() => onStopComputer?.()}
            />
          ) : null}
          <Composer
            value={draft}
            onChange={onDraft}
            onSend={onSend}
            onStop={onStop}
            streaming={streaming}
            disabled={!agent}
            agentKind={agent?.kind}
            placeholder={agent ? t("给这个 Agent 下达任务…") : t("先点新工作选择 Agent")}
            attachments={attachments}
            onAttachments={onAttachments}
            reasoning={reasoning}
            onReasoning={onReasoning}
            reasoningOptions={reasoningOptions}
            permission={permission}
            onPermission={onPermission}
            permissionOptions={permissionOptions}
            onVoiceError={onVoiceError}
            webSearch={webSearch}
            onWebSearch={onWebSearch}
            cliAdmin={cliAdmin}
            onCliAdmin={onCliAdmin}
            computerUse={computerUse}
            onComputerUse={onComputerUse}
            computerUseDisabled={computerUseDisabled}
            computerUseHint={computerUseHint}
          />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-lg font-medium">{t("本地工作")}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">
            {t("左侧是各 Agent 的历史工作。点「新工作」选择 Grok Build、Claude Code 或 Codex，以及要用的模型。")}
          </p>
          <button
            type="button"
            onClick={onNewWork}
            className="mt-6 rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas"
          >
            {t("新工作")}
          </button>
        </div>
      )}
    </div>
  );
});
