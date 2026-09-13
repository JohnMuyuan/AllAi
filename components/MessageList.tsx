"use client";

import { TurnRail, turnLabel } from "./TurnRail";
import { useStickToBottom } from "./useStickToBottom";

import { AlertTriangle, Check, Copy, Globe, Info, MonitorCog, Pencil, RefreshCw, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { stripActions } from "@/lib/computer-use";
import type { ChatMessage, ChatStep, PublicProvider } from "@/lib/types";
import { Foldable } from "./Foldable";
import { useT } from "./I18n";
import { Markdown } from "./Markdown";
import { modelInfo, StartBadge, SwitchBadge } from "./ModelSwitch";

type Props = {
  messages: ChatMessage[];
  providers: PublicProvider[];
  streaming: boolean;
  onRegenerate: () => void;
  /** 改掉某条用户消息并从那里重发；它后面的回复会被丢掉。 */
  onEditUser?: (messageId: string, content: string) => void;
};

const UserBubble = memo(function UserBubble({
  message,
  canEdit,
  onEdit,
}: {
  message: ChatMessage;
  canEdit: boolean;
  /** 收 (id, content)：每条消息现造一个闭包的话 memo 会被每次渲染打穿。 */
  onEdit?: (id: string, content: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%] md:max-w-[75%]">
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim()) {
                  onEdit?.(message.id, draft.trim());
                  setEditing(false);
                }
              }
              if (event.key === "Escape") {
                setDraft(message.content);
                setEditing(false);
              }
            }}
            rows={Math.min(10, draft.split("\n").length + 1)}
            className="w-full resize-none rounded-2xl border border-accent bg-elevated px-4 py-2.5 text-[15px] leading-7 outline-none"
          />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-muted">
              {t("改完会重新发一次，后面的回复会被替换")}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-user hover:text-ink"
            >
              <X className="size-3.5" />
              {t("取消")}
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                onEdit?.(message.id, draft.trim());
                setEditing(false);
              }}
              className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-canvas disabled:opacity-40"
            >
              {t("发送")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user flex justify-end">
      <Foldable text={message.content} align="end">
        {(shown) => (
          <div className="max-w-[85%] space-y-2 md:max-w-[75%]">
            {message.attachments?.length ? (
              <div className="flex flex-wrap justify-end gap-2">
                {message.attachments.map((item) =>
                  item.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={item.id}
                      src={`/api/uploads/${item.id}`}
                      alt={item.name}
                      className="max-h-40 rounded-2xl object-cover"
                    />
                  ) : (
                    <span
                      key={item.id}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
                    >
                      {item.name}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            {shown ? (
              <div className="relative">
                <div className="whitespace-pre-wrap break-words rounded-3xl bg-user px-4 py-2.5 text-[15px] leading-7 text-ink [overflow-wrap:anywhere]">
                  {shown}
                </div>
                {canEdit && onEdit ? (
                  <button
                    type="button"
                    aria-label={t("编辑这条消息")}
                    onClick={() => {
                      setDraft(message.content);
                      setEditing(true);
                    }}
                    className="absolute -left-9 top-1/2 hidden -translate-y-1/2 rounded-lg p-1.5 text-muted hover:bg-user hover:text-ink group-hover/user:block"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Foldable>
    </div>
  );
});

/** AI 这一轮干的事，直接长在回答上面，不弹窗。 */
function Steps({ steps, streaming }: { steps: ChatStep[]; streaming: boolean }) {
  if (!steps.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const Icon =
          step.kind === "search" ? Globe : step.kind === "error" ? AlertTriangle : Info;
        const active = step.kind === "search" && streaming && last;
        return (
          <div
            key={`${step.at}-${index}`}
            className={`flex items-baseline gap-1.5 text-[11px] leading-5 ${
              step.kind === "error" ? "text-danger" : "text-muted"
            }`}
          >
            <Icon
              className={`size-3 shrink-0 translate-y-0.5 ${
                step.kind === "search" ? "text-accent" : ""
              } ${active ? "animate-pulse" : ""}`}
            />
            <span className="min-w-0 whitespace-pre-wrap">
              {step.text}
              {active ? "…" : ""}
              {step.image ? <StepShot id={step.image} /> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 执行过程里某一步 AI 看到的画面。默认一条缩略图，点一下放大，再点收起。 */
function StepShot({ id }: { id: string }) {
  const t = useT();
  const [big, setBig] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setBig((value) => !value)}
      aria-label={big ? t("收起截图") : t("放大截图")}
      className="mt-1 block overflow-hidden rounded-md border border-line"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/uploads/${id}`}
        alt={t("这一步 AI 看到的画面")}
        className={big ? "max-h-[60vh] w-auto max-w-full" : "h-14 w-auto"}
      />
    </button>
  );
}

const noop = () => undefined;

/** 模型某一步说的话：去掉动作代码块；还在流式、代码块没收尾的那截也先藏起来。 */
function spokenText(text: string) {
  let out = stripActions(text || "");
  if ((out.split("```").length - 1) % 2 === 1) out = out.slice(0, out.lastIndexOf("```"));
  return out.trim();
}

type RunView = { message: ChatMessage; count: number };

/**
 * 操控电脑的一轮在对话里存的是：用户目标 → 助手 → 程序替用户发的「已执行…新截图」→ 助手 → …
 * 中间那些「用户消息」只是给模型看的上下文。界面上把整轮合并成一条回复：每一步模型说的话、
 * 它要执行的动作都放进「执行过程」，截图挂在对应那一步上，最后的结论放在下面。
 */
function mergeRun(group: ChatMessage[]): RunView | null {
  const assistants = group.filter((item) => item.role === "assistant");
  const last = assistants.at(-1);
  if (!last) return null;
  const steps: ChatStep[] = [];
  let shot: string | undefined;
  for (const item of group) {
    if (item.role === "user") {
      shot = item.attachments?.find((file) => file.kind === "image")?.id;
      continue;
    }
    if (item.role !== "assistant") continue;
    const said = spokenText(item.content);
    if (item !== last && said) {
      steps.push({
        kind: "notice",
        text: said.length > 240 ? `${said.slice(0, 240)}…` : said,
        at: item.createdAt,
        image: shot,
      });
      shot = undefined;
    }
    for (const step of item.steps ?? []) {
      steps.push(shot ? { ...step, image: shot } : step);
      shot = undefined;
    }
  }
  return { message: { ...last, content: spokenText(last.content), steps }, count: assistants.length };
}

const RunBubble = memo(function RunBubble({ run, streaming }: { run: RunView; streaming: boolean }) {
  const t = useT();
  const steps = run.message.steps ?? [];
  const failed = steps.at(-1)?.kind === "error";
  return (
    <div className="min-w-0">
      {steps.length ? (
        <details
          open={streaming || failed}
          className="mb-3 rounded-xl border border-line bg-elevated px-3 py-2"
        >
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted">
            <MonitorCog className={`size-3.5 ${streaming ? "animate-pulse text-accent" : ""}`} />
            {t("操控电脑 · 执行过程（{n} 步）", { n: run.count })}
          </summary>
          <div className="mt-2">
            <Steps steps={steps} streaming={streaming} />
          </div>
        </details>
      ) : null}
      <AssistantBubble
        message={{ ...run.message, steps: [] }}
        streaming={streaming}
        showRegenerate={false}
        onRegenerate={noop}
      />
    </div>
  );
});

const AssistantBubble = memo(function AssistantBubble({
  message,
  streaming,
  showRegenerate,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  showRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const steps = message.steps ?? [];
  const empty = !message.content && !message.reasoning;
  const autoThink = streaming && !message.content;
  if (autoThink && !thinkingOpen) setThinkingOpen(true);

  async function copy() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="group min-w-0">
      <Steps steps={steps} streaming={streaming} />
      {message.reasoning ? (
        <div className="mb-3 rounded-xl border border-line bg-elevated px-3 py-2 text-sm text-muted">
          <button
            type="button"
            onClick={() => setThinkingOpen((current) => !current)}
            className="cursor-pointer select-none text-xs font-medium"
          >
            {t("思考过程")}
          </button>
          {thinkingOpen ? (
            <Foldable text={message.reasoning}>
              {(shown) => <div className="mt-2 whitespace-pre-wrap leading-6">{shown}</div>}
            </Foldable>
          ) : null}
        </div>
      ) : null}
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
            <div className="relative min-w-0 max-w-full overflow-hidden">
              <Markdown>{shown}</Markdown>
              {streaming ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-accent align-middle" />
              ) : null}
            </div>
          )}
        </Foldable>
      ) : null}
      {!streaming && (message.content || steps.some((item) => item.kind === "error")) ? (
        <div className="mt-2 flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors duration-150 hover:bg-user hover:text-ink"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t("已复制") : t("复制")}
          </button>
          {showRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors duration-150 hover:bg-user hover:text-ink"
            >
              <RefreshCw className="size-3.5" />
              {t("重新生成")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  providers,
  streaming,
  onRegenerate,
  onEditUser,
  threadId,
}: Props & { threadId?: string | null }) {
  const t = useT();
  // 打开 / 换一条对话直接到最新；往上翻着看时不打扰。见 useStickToBottom。
  const { ref: scroller, node: scrollNode } = useStickToBottom(messages, threadId);
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  // 只让改最后一条用户消息：再往前改就要重跑整段，容易和 CLI 的会话对不上。
  const lastUser = [...messages].reverse().find((item) => item.role === "user");
  /** 这条对话用哪个模型开始的：第一条回复的型号。显示在最前面。 */
  const startModel = messages.find((item) => item.role === "assistant" && item.modelKey)?.modelKey;

  /*
   * 「这条和上一条助手消息换模型了吗」原来是每条消息都往回扫一遍，240 条就是
   * 上万次比较，而且每次渲染都重算。改成一次遍历预先算好。
   */
  const switchInfo = useMemo(() => {
    const out: { prev?: ChatMessage; switched: boolean }[] = [];
    let prev: ChatMessage | undefined;
    let noticeSincePrev = false;
    for (const message of messages) {
      const switched =
        message.role === "assistant" &&
        Boolean(message.modelKey) &&
        Boolean(prev?.modelKey) &&
        message.modelKey !== prev?.modelKey &&
        !noticeSincePrev;
      out.push({ prev, switched });
      if (message.role === "notice") noticeSincePrev = true;
      if (message.role === "assistant" && message.modelKey) {
        prev = message;
        noticeSincePrev = false;
      }
    }
    return out;
  }, [messages]);

  /** 同一轮操控电脑的消息合并成一组；其它消息原样一条一条。 */
  const items = useMemo(() => {
    type RunItem = { kind: "run"; id: string; group: ChatMessage[]; index: number; seeded: boolean };
    const out: (
      | { kind: "message"; message: ChatMessage; index: number; goal: boolean }
      | RunItem
    )[] = [];
    const runs = new Map<string, RunItem>();
    messages.forEach((message, index) => {
      const runId = message.computerRun;
      if (!runId) {
        out.push({ kind: "message", message, index, goal: false });
        return;
      }
      let run = runs.get(runId);
      if (!run && message.role === "user" && message.computerGoal !== undefined) {
        // 用户原话照常显示成用户气泡；截图不挂在这里，放进执行过程的第一步。
        out.push({
          kind: "message",
          message: { ...message, content: message.computerGoal, attachments: undefined },
          index,
          goal: true,
        });
      }
      if (!run) {
        run = { kind: "run", id: runId, group: [], index, seeded: false };
        runs.set(runId, run);
        out.push(run);
      }
      if (message.role === "assistant" && !run.seeded) {
        run.seeded = true;
        run.index = index;
      }
      run.group.push(message);
    });
    return out;
  }, [messages]);

  /** 左侧快速跳转：每一轮用户说的话。操控电脑那一轮用的是用户原话（items 里已经换好）。 */
  const turns = useMemo(
    () =>
      items.flatMap((item) =>
        item.kind === "message" && item.message.role === "user"
          ? [{ id: item.message.id, label: turnLabel(item.message.content, t("（图片或附件）")) }]
          : [],
      ),
    [items, t],
  );

  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
    <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-8">
        {startModel ? <StartBadge model={modelInfo(startModel, providers)} /> : null}
        {items.map((item) => {
          if (item.kind === "run") {
            const run = mergeRun(item.group);
            if (!run) return null;
            const info = switchInfo[item.index];
            return (
              <div key={`run-${item.id}`}>
                {info?.switched ? (
                  <div className="mb-4">
                    <SwitchBadge
                      from={modelInfo(info.prev?.modelKey, providers)}
                      to={modelInfo(run.message.modelKey, providers)}
                    />
                  </div>
                ) : null}
                <RunBubble
                  run={run}
                  streaming={streaming && item.group.some((entry) => entry.id === lastAssistant?.id)}
                />
              </div>
            );
          }
          const { message, index } = item;
          if (message.role === "notice") {
            return (
              <SwitchBadge
                key={message.id}
                from={modelInfo(message.fromModelKey, providers)}
                to={modelInfo(message.modelKey, providers)}
              />
            );
          }
          const prevAssistant = switchInfo[index]?.prev;
          const switched = switchInfo[index]?.switched ?? false;
          return (
            <div key={message.id} data-turn={message.role === "user" ? message.id : undefined}>
              {switched ? (
                <div className="mb-4">
                  <SwitchBadge
                    from={modelInfo(prevAssistant?.modelKey, providers)}
                    to={modelInfo(message.modelKey, providers)}
                  />
                </div>
              ) : null}
              {message.role === "user" ? (
                <UserBubble
                  message={message}
                  canEdit={!streaming && !item.goal && message.id === lastUser?.id}
                  onEdit={onEditUser}
                />
              ) : (
                <AssistantBubble
                  message={message}
                  streaming={streaming && message.id === lastAssistant?.id}
                  showRegenerate={message.id === lastAssistant?.id}
                  onRegenerate={onRegenerate}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
    <TurnRail turns={turns} container={scrollNode} />
    </div>
  );
});
