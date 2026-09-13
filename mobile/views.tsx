import { Bot, ChevronRight, Globe, ImageIcon, MessageSquare, Plus, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { useT } from "../components/I18n";
import type { DesktopLink } from "./link";
import { Questions } from "./Questions";
import {
  Composer,
  ConfirmSheet,
  ContextBar,
  Empty,
  ListButton,
  ModelPicker,
  RemoteMedia,
  Sheet,
  ToolChip,
  TopBar,
  Typing,
  Viewer,
  baseName,
  errorText,
  modelLabel,
  timeAgo,
  useNotify,
  useStickToBottom,
  type AgentMsg,
  type ChatMsg,
  type Meta,
  type Thread,
} from "./ui";

type PaneProps = {
  link: DesktopLink;
  meta: Meta;
  screen: "list" | "thread";
  open: () => void;
  back: () => void;
};

function ItemActions({
  title,
  onRename,
  onDelete,
  onClose,
}: {
  title: string;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet title={title} onClose={onClose}>
      <button type="button" onClick={onRename} className="w-full rounded-xl bg-user px-3 py-2.5 text-left text-[15px]">
        {t("重命名")}
      </button>
      <button type="button" onClick={onDelete} className="mt-2 w-full rounded-xl px-3 py-2.5 text-left text-[15px] text-danger">
        {t("删除")}
      </button>
    </Sheet>
  );
}

function RenameSheet({
  title,
  value,
  onSubmit,
  onClose,
}: {
  title: string;
  value: string;
  onSubmit: (next: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const notify = useNotify();
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 outline-none focus:border-accent"
        autoFocus
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit(text.trim());
            onClose();
          } catch (error) {
            notify(t(errorText(error)));
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 w-full rounded-xl bg-accent py-2.5 text-[15px] font-medium text-accent-fg disabled:opacity-40"
      >
        {busy ? t("保存中…") : t("保存")}
      </button>
    </Sheet>
  );
}

function NewButton({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-accent disabled:opacity-50"
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-user px-3.5 py-2 text-[15px] leading-6 whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

function SwitchLine({ text }: { text: string }) {
  return <div className="text-center text-[11px] text-muted">{text}</div>;
}

/* =============================== 聊天 =============================== */

export function ChatPane({ link, meta, screen, open, back, thread }: PaneProps & { thread?: Thread<ChatMsg> }) {
  const t = useT();
  const notify = useNotify();
  const [opening, setOpening] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const chat = meta.chat;
  const messages = thread && thread.id === chat.activeId ? thread.messages : [];
  const last = messages.at(-1);
  const { ref: scroller } = useStickToBottom(
    `${messages.length}:${last?.content.length ?? 0}:${last?.steps?.length ?? 0}`,
    chat.activeId,
  );

  async function run(op: string, args: Record<string, unknown>, id: string) {
    setOpening(id);
    try {
      await link.call(op, args);
      open();
    } catch (error) {
      notify(t(errorText(error)));
    } finally {
      setOpening(null);
    }
  }

  if (screen === "list") {
    const menuItem = chat.list.find((item) => item.id === menuId || item.id === renameId || item.id === deleteId);
    return (
      <>
        <TopBar title={t("聊天")} right={<NewButton label={t("新对话")} busy={opening === "new"} onClick={() => void run("chat.new", {}, "new")} />} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {chat.list.length ? (
            chat.list.map((item) => (
              <ListButton
                key={item.id}
                title={item.title}
                subtitle={`${timeAgo(item.updatedAt, t)}${item.preview ? ` · ${item.preview}` : ""}`}
                active={item.id === chat.activeId}
                busy={opening === item.id}
                right={<ChevronRight className="size-4 shrink-0 text-muted" />}
                onClick={() => void run("chat.open", { threadId: item.id }, item.id)}
                onMenu={() => setMenuId(item.id)}
              />
            ))
          ) : (
            <Empty icon={<MessageSquare className="size-9" />} title={t("还没有对话")} hint={t("点右上角「新对话」开始。")} />
          )}
        </div>
        {menuId && menuItem ? (
          <ItemActions
            title={menuItem.title || t("对话")}
            onClose={() => setMenuId(null)}
            onRename={() => {
              setMenuId(null);
              setRenameId(menuItem.id);
            }}
            onDelete={() => {
              setMenuId(null);
              setDeleteId(menuItem.id);
            }}
          />
        ) : null}
        {renameId && menuItem ? (
          <RenameSheet
            title={t("重命名对话")}
            value={menuItem.title}
            onClose={() => setRenameId(null)}
            onSubmit={(title) => link.call("chat.rename", { threadId: renameId, title })}
          />
        ) : null}
        {deleteId && menuItem ? (
          <ConfirmSheet
            title={t("删除「{name}」？", { name: menuItem.title || t("对话") })}
            detail={t("对话和里面的消息都会删掉，无法恢复。")}
            confirmText={t("删除")}
            danger
            onClose={() => setDeleteId(null)}
            onConfirm={() => {
              void link.call("chat.delete", { threadId: deleteId }).then(() => setDeleteId(null)).catch((error) => notify(t(errorText(error))));
            }}
          />
        ) : null}
      </>
    );
  }

  const title = chat.list.find((item) => item.id === chat.activeId)?.title || t("新对话");
  const visible = messages.filter(
    (item) => item.role !== "system" && !(item.role === "user" && item.computerRun && !item.computerGoal),
  );
  return (
    <div className="pane-enter flex min-h-0 flex-1 flex-col">
      <TopBar
        title={title}
        subtitle={modelLabel(chat.models, chat.modelKey)}
        onBack={back}
        right={<ContextBar context={chat.context} />}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {visible.length ? (
          <div className="flex flex-col gap-4">
            {visible.map((item, index) => {
              if (item.role === "notice") {
                return (
                  <SwitchLine key={item.id} text={t("换成了 {model}", { model: modelLabel(chat.models, item.modelKey) })} />
                );
              }
              if (item.role === "user") {
                return (
                  <div key={item.id} className="flex flex-col items-end gap-1.5">
                    {item.attachments?.length ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {item.attachments.map((file) =>
                          file.kind === "image" ? (
                            <RemoteMedia
                              key={file.id}
                              link={link}
                              id={file.id}
                              mime={file.mime}
                              onOpen={setViewer}
                              className="size-24 rounded-xl object-cover"
                            />
                          ) : (
                            <span key={file.id} className="rounded-lg bg-user px-2 py-1 text-xs">
                              {file.name}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                    {item.computerGoal || item.content ? (
                      <UserBubble>{item.computerGoal || item.content}</UserBubble>
                    ) : null}
                  </div>
                );
              }
              const streamingHere = chat.streaming && index === visible.length - 1;
              return (
                <div key={item.id} className="min-w-0">
                  {item.reasoning ? (
                    <details className="mb-2 rounded-xl border border-line px-3 py-2 text-sm" open={streamingHere && !item.content}>
                      <summary className="text-xs text-muted">{t("思考过程")}</summary>
                      <div className="mt-2 text-[13px] leading-6 whitespace-pre-wrap text-muted">{item.reasoning}</div>
                    </details>
                  ) : null}
                  {item.steps?.length ? (
                    <div className="mb-2 flex flex-col gap-1">
                      {item.steps.map((step, i) => (
                        <div
                          key={i}
                          className={`rounded-lg px-2.5 py-1.5 text-xs leading-5 ${
                            step.kind === "error" ? "bg-danger/10 text-danger" : "bg-user/60 text-muted"
                          }`}
                        >
                          {step.text}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {item.content ? (
                    <div className="text-[15px] leading-7">
                      <Markdown>{item.content}</Markdown>
                    </div>
                  ) : streamingHere ? (
                    <Typing />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty icon={<MessageSquare className="size-9" />} title={t("新对话")} hint={t("电脑屏幕上会同步显示。")} />
        )}
      </div>
      <Composer
        link={link}
        busy={chat.streaming}
        placeholder={t("发消息…")}
        top={
          <>
            <ModelPicker
              models={chat.models}
              value={chat.modelKey}
              disabled={chat.streaming}
              onChange={(key) => void link.call("chat.model", { modelKey: key }).catch((error) => notify(t(errorText(error))))}
            />
            <ToolChip
              pressed={Boolean(chat.webSearch)}
              label={t("联网")}
              title={chat.webSearch ? t("联网搜索已开") : t("联网搜索已关")}
              icon={<Globe className={`size-3.5 ${chat.webSearch ? "text-accent" : ""}`} />}
              onClick={() =>
                void link
                  .call("prefs.patch", { webSearchChat: !chat.webSearch })
                  .catch((error) => notify(t(errorText(error))))
              }
            />
            {chat.reasoningOptions?.length ? (
              <select
                value={chat.reasoning || ""}
                aria-label={t("推理")}
                onChange={(event) =>
                  void link
                    .call("prefs.patch", { reasoningEffort: event.target.value })
                    .catch((error) => notify(t(errorText(error))))
                }
                className="max-w-[40vw] rounded-lg border border-line bg-elevated px-2 py-1 text-[13px]!"
              >
                {chat.reasoningOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        }
        onStop={() => void link.call("chat.stop").catch((error) => notify(t(errorText(error))))}
        onSend={async (text, attachments) => {
          await link.call("chat.send", { threadId: chat.activeId, text, attachments });
        }}
      />
      {viewer ? <Viewer url={viewer} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

/* =============================== Agent =============================== */

function Trace({ items, open }: { items: NonNullable<AgentMsg["trace"]>; open: boolean }) {
  const t = useT();
  const tools = items.filter((item) => item.type === "tool").length;
  return (
    <details className="mb-2 rounded-xl border border-line text-sm" open={open}>
      <summary className="px-3 py-2 text-xs text-muted">
        {t("执行过程")} · {tools ? t("{n} 个操作", { n: tools }) : t("{n} 步", { n: items.length })}
      </summary>
      <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto border-t border-line px-3 py-2">
        {items.map((item, index) =>
          item.type === "thinking" ? (
            <div key={index} className="text-[12px] leading-5 whitespace-pre-wrap text-muted italic">
              {item.text}
            </div>
          ) : (
            <div key={index} className="flex min-w-0 gap-1.5 text-[12px] leading-5">
              <Wrench className="mt-0.5 size-3 shrink-0 text-muted" />
              <div className="min-w-0">
                <span className="font-medium">{item.name}</span>
                {item.detail ? (
                  <div className="font-mono text-[11px] break-all whitespace-pre-wrap text-muted">{item.detail}</div>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>
    </details>
  );
}

function NewWorkSheet({
  link,
  meta,
  onClose,
  onCreated,
}: {
  link: DesktopLink;
  meta: Meta;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const notify = useNotify();
  const agents = meta.agent.agents;
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const agent = agents.find((item) => item.id === agentId);
  const [modelKey, setModelKey] = useState(agent?.models[0]?.key ?? "");
  const [cwd, setCwd] = useState(meta.agent.folders[0] ?? "");
  const [busy, setBusy] = useState(false);
  const selectClass = "w-full rounded-xl border border-line bg-elevated px-3 py-2";

  return (
    <Sheet title={t("新建 Agent 工作")} onClose={onClose}>
        {agents.length ? (
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1 text-xs text-muted">
              Agent
              <select
                className={selectClass}
                value={agentId}
                onChange={(event) => {
                  setAgentId(event.target.value);
                  setModelKey(agents.find((item) => item.id === event.target.value)?.models[0]?.key ?? "");
                }}
              >
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              {t("模型")}
              <ModelPicker models={agent?.models ?? []} value={modelKey} onChange={setModelKey} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              {t("工作目录（只能选电脑上用过的目录）")}
              <select className={selectClass} value={cwd} onChange={(event) => setCwd(event.target.value)}>
                {meta.agent.folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {baseName(folder)} — {folder}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !agentId || !cwd}
              onClick={async () => {
                setBusy(true);
                try {
                  await link.call("agent.new", { agentId, modelKey, cwd });
                  onCreated();
                } catch (error) {
                  notify(t(errorText(error)));
                } finally {
                  setBusy(false);
                }
              }}
              className="mt-1 rounded-xl bg-accent py-2.5 text-[15px] font-medium text-accent-fg disabled:opacity-40"
            >
              {busy ? t("创建中…") : t("创建")}
            </button>
            {!meta.agent.folders.length ? (
              <p className="text-xs text-danger">{t("电脑上还没用过任何工作目录，先在电脑上建一条工作。")}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("电脑上还没有可用的 Agent。")}</p>
        )}
    </Sheet>
  );
}

export function AgentPane({ link, meta, screen, open, back, thread }: PaneProps & { thread?: Thread<AgentMsg> }) {
  const t = useT();
  const notify = useNotify();
  const [opening, setOpening] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const agent = meta.agent;
  const messages = thread && thread.id === agent.activeId ? thread.messages : [];
  const last = messages.at(-1);
  const { ref: scroller } = useStickToBottom(
    `${messages.length}:${last?.content.length ?? 0}:${last?.trace?.length ?? 0}`,
    agent.activeId,
  );
  const work = agent.list.find((item) => item.id === agent.activeId);
  const profile = agent.agents.find((item) => item.kind === work?.kind);

  if (screen === "list") {
    const menuItem = agent.list.find((item) => item.id === menuId || item.id === renameId || item.id === deleteId);
    return (
      <>
        <TopBar title={t("Agent")} right={<NewButton label={t("新工作")} onClick={() => setCreating(true)} />} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {agent.list.length ? (
            agent.list.map((item) => (
              <ListButton
                key={item.id}
                title={item.title}
                subtitle={`${item.agentName} · ${baseName(item.cwd)} · ${timeAgo(item.updatedAt, t)}`}
                active={item.id === agent.activeId}
                busy={opening === item.id}
                right={
                  item.running || (item.id === agent.activeId && agent.streaming) ? (
                    <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label={t("运行中")} />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted" />
                  )
                }
                onClick={async () => {
                  setOpening(item.id);
                  try {
                    await link.call("agent.open", { threadId: item.id });
                    open();
                  } catch (error) {
                    notify(t(errorText(error)));
                  } finally {
                    setOpening(null);
                  }
                }}
                onMenu={() => setMenuId(item.id)}
              />
            ))
          ) : (
            <Empty icon={<Bot className="size-9" />} title={t("还没有工作")} hint={t("点右上角「新工作」开始。")} />
          )}
        </div>
        {creating ? (
          <NewWorkSheet
            link={link}
            meta={meta}
            onClose={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              open();
            }}
          />
        ) : null}
        {menuId && menuItem ? (
          <ItemActions
            title={menuItem.title || t("工作")}
            onClose={() => setMenuId(null)}
            onRename={() => {
              setMenuId(null);
              setRenameId(menuItem.id);
            }}
            onDelete={() => {
              setMenuId(null);
              setDeleteId(menuItem.id);
            }}
          />
        ) : null}
        {renameId && menuItem ? (
          <RenameSheet
            title={t("重命名工作")}
            value={menuItem.title}
            onClose={() => setRenameId(null)}
            onSubmit={(title) => link.call("agent.rename", { threadId: renameId, title })}
          />
        ) : null}
        {deleteId && menuItem ? (
          <ConfirmSheet
            title={t("删除「{name}」？", { name: menuItem.title || t("工作") })}
            detail={t("这条会话在 {agent} 自己的历史记录里也会一并删掉。", { agent: menuItem.agentName })}
            confirmText={t("删除")}
            danger
            onClose={() => setDeleteId(null)}
            onConfirm={() => {
              void link.call("agent.delete", { threadId: deleteId }).then(() => setDeleteId(null)).catch((error) => notify(t(errorText(error))));
            }}
          />
        ) : null}
      </>
    );
  }

  const permission = work ? agent.permission[work.kind] : "";
  const permissionChoices = work ? agent.permissionOptions?.[work.kind] ?? [] : [];
  return (
    <div className="pane-enter flex min-h-0 flex-1 flex-col">
      <TopBar
        title={work?.title || "Agent"}
        subtitle={work ? `${work.agentName} · ${baseName(work.cwd)}` : undefined}
        onBack={back}
        right={<ContextBar context={agent.context} percent={agent.compactPercent} />}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length ? (
          <div className="flex flex-col gap-4">
            {messages.map((item, index) => {
              if (item.role === "notice") {
                return (
                  <SwitchLine key={item.id} text={t("换成了 {model}", { model: modelLabel(profile?.models ?? [], item.modelKey) })} />
                );
              }
              if (item.role === "user") return <UserBubble key={item.id}>{item.content}</UserBubble>;
              const streamingHere = agent.streaming && index === messages.length - 1;
              /*
               * Agent 向用户提问：只在**最后一条**回复上画卡片。
               * 后面又有了消息就说明这一问已经过去了（回答那条带标记，不会传到手机上，
               * 所以答完之后卡片靠自己的「已回答」状态顶着，直到新回复冲掉它）。
               */
              const asks =
                index === messages.length - 1
                  ? (item.trace ?? []).flatMap((row) =>
                      row.type === "tool" && row.ask ? [row.ask] : [],
                    )
                  : [];
              return (
                <div key={item.id} className="min-w-0">
                  {item.trace?.length ? <Trace items={item.trace} open={streamingHere} /> : null}
                  {item.content ? (
                    <div className="text-[15px] leading-7">
                      <Markdown cwd={work?.cwd}>{item.content}</Markdown>
                    </div>
                  ) : streamingHere ? (
                    <Typing />
                  ) : null}
                  {asks.length && !streamingHere ? (
                    <div className="mt-3">
                      <Questions
                        asks={asks}
                        disabled={agent.streaming}
                        onAnswer={async (text) => {
                          await link.call("agent.send", { threadId: agent.activeId, text }, 120_000);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={<Bot className="size-9" />}
            title={work?.title || t("Agent")}
            hint={work ? t("在 {cwd} 里工作。发一句话开始。", { cwd: work.cwd }) : undefined}
          />
        )}
      </div>
      <Composer
        link={link}
        busy={agent.streaming}
        agentKind={work?.kind}
        placeholder={t("让 Agent 做点什么…")}
        top={
          <>
            <ModelPicker
              models={profile?.models ?? []}
              value={agent.modelKey}
              disabled={agent.streaming}
              onChange={(key) =>
                // 带上自己打开的那条工作，别改到电脑选中的那条去。
                void link
                  .call("agent.model", { modelKey: key, threadId: agent.activeId })
                  .catch((error) => notify(t(errorText(error))))
              }
            />
            <ToolChip
              pressed={Boolean(agent.webSearch)}
              label={t("联网")}
              title={agent.webSearch ? t("联网搜索已开") : t("联网搜索已关")}
              icon={<Globe className={`size-3.5 ${agent.webSearch ? "text-accent" : ""}`} />}
              onClick={() =>
                void link
                  .call("prefs.patch", { webSearchAgent: !agent.webSearch })
                  .catch((error) => notify(t(errorText(error))))
              }
            />
            {permissionChoices.length ? (
              <select
                value={permission}
                aria-label={t("权限")}
                onChange={(event) =>
                  void link
                    .call("prefs.patch", {
                      agentPermissionMode: { [work?.kind || ""]: event.target.value },
                    })
                    .catch((error) => notify(t(errorText(error))))
                }
                className="max-w-[40vw] rounded-lg border border-line bg-elevated px-2 py-1 text-[13px]!"
              >
                {permissionChoices.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            ) : null}
            {agent.reasoningOptions?.length ? (
              <select
                value={agent.reasoning || ""}
                aria-label={t("推理")}
                onChange={(event) =>
                  void link
                    .call("prefs.patch", { reasoningEffort: event.target.value })
                    .catch((error) => notify(t(errorText(error))))
                }
                className="max-w-[40vw] rounded-lg border border-line bg-elevated px-2 py-1 text-[13px]!"
              >
                {agent.reasoningOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        }
        onStop={() => void link.call("agent.stop").catch((error) => notify(t(errorText(error))))}
        onSend={async (text, attachments) => {
          await link.call("agent.send", { threadId: agent.activeId, text, attachments }, 120_000);
        }}
      />
    </div>
  );
}

/* =============================== 创作 =============================== */

type StudioJob = {
  id: string;
  mode: "image" | "video";
  prompt: string;
  status: "running" | "done" | "error";
  error?: string;
  outputs: { id: string; mime: string }[];
  kind?: "model-switch" | "compact";
  notice?: string;
  modelKey: string;
  fromModelKey?: string;
  createdAt: number;
};

type StudioSummary = { id: string; title: string; updatedAt: number; createdAt?: number };

const RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function StudioPane({
  link,
  meta,
  screen,
  open,
  back,
  tick,
  visible,
}: PaneProps & { tick: number; visible: boolean }) {
  const t = useT();
  const notify = useNotify();
  const [list, setList] = useState<StudioSummary[] | null>(null);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [mode, setMode] = useState<"image" | "video">("image");
  const [ratio, setRatio] = useState("auto");
  const [modelKey, setModelKey] = useState("");
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const studio = meta.studio;
  const models = mode === "video" ? studio.videoModels : studio.imageModels;
  const effectiveModel = modelKey && models.some((item) => item.key === modelKey)
    ? modelKey
    : mode === "video"
      ? studio.videoModelKey
      : studio.imageModelKey;
  const { ref: scroller } = useStickToBottom(`${jobs.length}:${jobs.map((job) => job.status).join()}`, studioId);
  // 异步回来的结果要对照「现在打开的是哪条」，旧请求回来别覆盖新的。
  const idRef = useRef(studioId);
  useEffect(() => {
    idRef.current = studioId;
  }, [studioId]);

  const loadList = useCallback(async () => {
    const data = await link.call<{ conversations: StudioSummary[] }>("studio.list");
    setList(data.conversations);
    return data.conversations;
  }, [link]);

  const loadThread = useCallback(
    async (id: string | null) => {
      if (!id) {
        setJobs([]);
        return;
      }
      const data = await link.call<{ jobs: StudioJob[] }>("studio.thread", { id });
      if (idRef.current === id) setJobs(data.jobs);
    },
    [link],
  );

  const refresh = useCallback(async () => {
    try {
      const conversations = await loadList();
      let id = idRef.current;
      if (!id && waitingSince) {
        // 新创作刚发出去：找那条在这之后建出来的。
        const created = conversations.find((item) => (item.createdAt ?? item.updatedAt) >= waitingSince - 5000);
        if (created) {
          id = created.id;
          setStudioId(id);
          idRef.current = id;
          setWaitingSince(null);
        }
      }
      await loadThread(id);
    } catch (error) {
      notify(t(errorText(error)));
    }
  }, [loadList, loadThread, notify, t, waitingSince]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切进来和收到创作事件时刷
  }, [visible, tick]);

  const running = jobs.some((job) => job.status === "running") || waitingSince !== null;
  useEffect(() => {
    if (!visible || !running) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh, running, visible]);

  if (screen === "list") {
    const menuItem = list?.find((item) => item.id === menuId || item.id === renameId || item.id === deleteId);
    return (
      <>
        <TopBar
          title={t("创作")}
          right={
            <NewButton
              label={t("新创作")}
              onClick={() => {
                setStudioId(null);
                setJobs([]);
                open();
              }}
            />
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list === null ? (
            <Empty icon={<ImageIcon className="size-9" />} title={t("读取中…")} />
          ) : list.length ? (
            list.map((item) => (
              <ListButton
                key={item.id}
                title={item.title}
                subtitle={timeAgo(item.updatedAt, t)}
                active={item.id === studioId}
                right={<ChevronRight className="size-4 shrink-0 text-muted" />}
                onClick={() => {
                  setStudioId(item.id);
                  idRef.current = item.id;
                  setJobs([]);
                  void loadThread(item.id).catch((error) => notify(t(errorText(error))));
                  open();
                }}
                onMenu={() => setMenuId(item.id)}
              />
            ))
          ) : (
            <Empty icon={<ImageIcon className="size-9" />} title={t("还没有创作")} hint={t("点右上角「新创作」开始。")} />
          )}
        </div>
        {menuId && menuItem ? (
          <ItemActions
            title={menuItem.title || t("创作")}
            onClose={() => setMenuId(null)}
            onRename={() => {
              setMenuId(null);
              setRenameId(menuItem.id);
            }}
            onDelete={() => {
              setMenuId(null);
              setDeleteId(menuItem.id);
            }}
          />
        ) : null}
        {renameId && menuItem ? (
          <RenameSheet
            title={t("重命名创作")}
            value={menuItem.title}
            onClose={() => setRenameId(null)}
            onSubmit={async (title) => {
              await link.call("studio.rename", { id: renameId, title });
              await loadList();
            }}
          />
        ) : null}
        {deleteId && menuItem ? (
          <ConfirmSheet
            title={t("删除「{name}」？", { name: menuItem.title || t("创作") })}
            detail={t("生成的图片和视频也会一起删掉。")}
            confirmText={t("删除")}
            danger
            onClose={() => setDeleteId(null)}
            onConfirm={() => {
              void link
                .call("studio.delete", { id: deleteId })
                .then(async () => {
                  if (studioId === deleteId) {
                    setStudioId(null);
                    setJobs([]);
                  }
                  setDeleteId(null);
                  await loadList();
                })
                .catch((error) => notify(t(errorText(error))));
            }}
          />
        ) : null}
      </>
    );
  }

  const title = list?.find((item) => item.id === studioId)?.title || t("新创作");
  return (
    <div className="pane-enter flex min-h-0 flex-1 flex-col">
      <TopBar title={title} onBack={back} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {jobs.length || waitingSince ? (
          <div className="flex flex-col gap-5">
            {jobs.map((job) => {
              if (job.kind === "model-switch") {
                return <SwitchLine key={job.id} text={t("换成了 {model}", { model: modelLabel([...studio.imageModels, ...studio.videoModels], job.modelKey) })} />;
              }
              if (job.kind === "compact") return <SwitchLine key={job.id} text={job.notice ? t(job.notice) : t("已压缩上下文")} />;
              return (
                <div key={job.id} className="flex flex-col gap-2">
                  <UserBubble>{job.prompt}</UserBubble>
                  {job.status === "running" ? (
                    <div className="flex aspect-[4/3] w-full animate-pulse items-center justify-center rounded-2xl bg-user text-sm text-muted">
                      {t("正在生成")}{job.mode === "video" ? t("视频") : t("图片")}…
                    </div>
                  ) : job.status === "error" ? (
                    <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{job.error ? t(job.error) : t("生成失败")}</div>
                  ) : (
                    <div className={`grid gap-2 ${job.outputs.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                      {job.outputs.map((output) => (
                        <RemoteMedia
                          key={output.id}
                          link={link}
                          id={output.id}
                          mime={output.mime}
                          onOpen={setViewer}
                          className="w-full rounded-2xl"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {waitingSince && !jobs.some((job) => job.status === "running") ? (
              <div className="flex aspect-[4/3] w-full animate-pulse items-center justify-center rounded-2xl bg-user text-sm text-muted">
                {t("已发送，等待电脑开始生成…")}
              </div>
            ) : null}
          </div>
        ) : (
          <Empty icon={<ImageIcon className="size-9" />} title={t("新创作")} hint={t("描述画面就能出图。可以附参考图。")} />
        )}
      </div>
      <Composer
        link={link}
        busy={false}
        placeholder={mode === "video" ? t("描述视频画面…") : t("描述画面…")}
        sendLabel={t("生成")}
        top={
          <>
            <div className="flex rounded-lg bg-user p-0.5 text-[13px]">
              {(["image", "video"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={`rounded-md px-2.5 py-0.5 ${mode === item ? "bg-elevated font-medium" : "text-muted"}`}
                >
                  {item === "image" ? t("图片") : t("视频")}
                </button>
              ))}
            </div>
            <select
              value={ratio}
              onChange={(event) => setRatio(event.target.value)}
              className="rounded-lg border border-line bg-elevated px-2 py-1 text-[13px]!"
              aria-label={t("比例")}
            >
              {RATIOS.map((item) => (
                <option key={item} value={item}>
                  {item === "auto" ? t("自适应") : item}
                </option>
              ))}
            </select>
            <ModelPicker models={models} value={effectiveModel} onChange={setModelKey} />
          </>
        }
        onSend={async (text, attachments) => {
          if (!text) throw new Error("请填写提示词");
          const result = await link.call<{ startedAt: number }>("studio.generate", {
            conversationId: studioId,
            mode,
            prompt: text,
            aspectRatio: ratio,
            imageIds: attachments.filter((item) => item.kind === "image").map((item) => item.id),
            modelKey: effectiveModel,
          });
          if (!studioId) setWaitingSince(result.startedAt);
          window.setTimeout(() => void refresh(), 1200);
        }}
      />
      {viewer ? <Viewer url={viewer} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}
