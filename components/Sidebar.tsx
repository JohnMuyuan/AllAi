"use client";

import {
  Briefcase,
  ChevronRight,
  CornerDownRight,
  ImageIcon,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  Pencil,
  Search,
  Settings,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { groupConversations } from "@/lib/dates";
import { useT } from "./I18n";
import { APP_VERSION } from "@/lib/version";
import type { ConversationSummary } from "@/lib/types";
import type { AgentWork } from "@/types/desktop";
import { Logo } from "./Logo";

export type AppView = "chat" | "agents" | "studio";

type Props = {
  view: AppView;
  onViewChange: (view: AppView) => void;
  conversations: ConversationSummary[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onCloseMobile: () => void;
  works: AgentWork[];
  /** 接续链：工作 id → 它所在链的链头 id（只含接续出来的那些），见 ChatApp 的 workChains。 */
  workChains?: Record<string, string>;
  activeWorkId: string | null;
  onNewWork: () => void;
  onSelectWork: (id: string) => void;
  onRenameWork?: (id: string, title: string) => void;
  onDeleteWork?: (id: string) => void;
  studioConversations?: ConversationSummary[];
  activeStudioId?: string | null;
  onNewStudio?: () => void;
  onSelectStudio?: (id: string) => void;
  onRenameStudio?: (id: string, title: string) => void;
  onDeleteStudio?: (id: string) => void;
};

const EMPTY_CHAINS: Record<string, string> = {};

type ChainInfo = { count: number; expanded: boolean; onToggle: () => void };

export function Sidebar({
  view,
  onViewChange,
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onOpenSettings,
  onOpenSearch,
  onCloseMobile,
  works,
  workChains = EMPTY_CHAINS,
  activeWorkId,
  onNewWork,
  onSelectWork,
  onRenameWork,
  onDeleteWork,
  studioConversations = [],
  activeStudioId = null,
  onNewStudio,
  onSelectStudio,
  onRenameStudio,
  onDeleteStudio,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (item) =>
        item.title.toLowerCase().includes(q) || item.preview.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const groups = groupConversations(filtered);
  /**
   * 用户手动展开 / 收起过的接续链（true = 收起），记在本机。
   * 没动过的：当前打开的工作在哪条链里，哪条就展开，其它默认收起。
   */
  const [collapsedChains, setCollapsedChains] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = JSON.parse(localStorage.getItem("allai-chain-collapsed") || "{}") as unknown;
      return saved && typeof saved === "object" ? (saved as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  function toggleChain(id: string, expanded: boolean) {
    setCollapsedChains((current) => {
      const next = { ...current, [id]: expanded };
      try {
        localStorage.setItem("allai-chain-collapsed", JSON.stringify(next));
      } catch {
        // 写不进去只是下次打开回到默认
      }
      return next;
    });
  }
  const workQuery = query.trim().toLowerCase();
  const filteredWorks = workQuery
    ? works.filter(
        (item) =>
          item.title.toLowerCase().includes(workQuery) ||
          item.preview.toLowerCase().includes(workQuery) ||
          item.agentName.toLowerCase().includes(workQuery),
      )
    : works;
  /**
   * 接续链：链头 → 从它接续出来的工作（按创建先后）。搜索时不分组，平铺显示，免得搜到的接续对话被收起来。
   * 链头不在列表里（被隐藏了）的，接续出来的那些就当普通对话。
   */
  const workIds = new Set(works.map((item) => item.id));
  const chainChildren = new Map<string, AgentWork[]>();
  if (!workQuery) {
    for (const item of works) {
      const root = workChains[item.id];
      if (!root || !workIds.has(root)) continue;
      const list = chainChildren.get(root) ?? [];
      list.push(item);
      chainChildren.set(root, list);
    }
    for (const list of chainChildren.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  }
  const topWorks = workQuery
    ? filteredWorks
    : filteredWorks.filter((item) => !workChains[item.id] || !workIds.has(workChains[item.id]));
  /** 整组按组里最新的一次活动排：接续出来的新对话不会单独跑到别处去。 */
  const chainUpdated = (item: AgentWork) =>
    Math.max(item.updatedAt, ...(chainChildren.get(item.id) ?? []).map((child) => child.updatedAt));
  const workGroups = groupConversations(
    topWorks.map((item) => ({
      id: item.id,
      title: item.title,
      modelKey: "",
      updatedAt: chainUpdated(item),
      createdAt: item.createdAt,
      preview: item.preview,
    })),
  );
  const studioQuery = query.trim().toLowerCase();
  const filteredStudio = studioQuery
    ? studioConversations.filter(
        (item) =>
          item.title.toLowerCase().includes(studioQuery) ||
          item.preview.toLowerCase().includes(studioQuery),
      )
    : studioConversations;
  const studioGroups = groupConversations(filteredStudio);

  /** Agent 列表的一行。chain：这是一条接续链的链头；childIndex：这是链里第几次接续。 */
  function renderWork(work: AgentWork, chain?: ChainInfo, childIndex?: number) {
    const active = work.id === activeWorkId;
    return (
      <div
        key={work.id}
        className={`group/work relative mb-0.5 flex items-center rounded-xl ${
          active ? "bg-user" : "hover:bg-user/70"
        }`}
      >
        {editingId === work.id ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitWorkRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitWorkRename();
              if (event.key === "Escape") setEditingId(null);
            }}
            className="w-full rounded-xl bg-transparent px-3 py-2 text-sm outline-none"
          />
        ) : (
          <>
          {chain ? (
            <button
              type="button"
              aria-label={chain.expanded ? t("收起接续的对话") : t("展开接续的对话")}
              aria-expanded={chain.expanded}
              onClick={chain.onToggle}
              className="ml-1 grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-elevated hover:text-ink"
            >
              <ChevronRight
                className={`size-3.5 transition-transform duration-150 ${chain.expanded ? "rotate-90" : ""}`}
              />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onSelectWork(work.id)}
            className="min-w-0 flex-1 px-3 py-2 text-left"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              {childIndex ? <CornerDownRight className="size-3 shrink-0 text-muted" /> : null}
              {/* 绿点：CLI 进程还开着；跑着活的时候闪。 */}
              {work.running || work.online ? (
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full bg-emerald-500 ${work.running ? "animate-pulse" : ""}`}
                />
              ) : null}
              <span className="truncate">{work.title}</span>
              {chain ? (
                <span className="ml-auto shrink-0 rounded-md bg-user px-1.5 py-px text-[10px] text-muted">
                  {t("共 {n} 段", { n: chain.count })}
                </span>
              ) : null}
            </div>
            <div className="truncate text-[11px] text-muted">
              {childIndex ? t("接续 {n} · ", { n: childIndex }) : ""}
              {work.agentName}
              {work.running ? ` · ${t("运行中")}` : work.online ? ` · ${t("在线")}` : ""}
            </div>
          </button>
          </>
        )}
        {editingId === work.id || (!onRenameWork && !onDeleteWork) ? null : (
          <div className="absolute right-1 hidden items-center group-hover/work:flex">
            {onRenameWork ? (
              <button
                type="button"
                aria-label={t("重命名")}
                onClick={() => {
                  setEditingId(work.id);
                  setDraft(work.title);
                }}
                className="grid size-7 place-items-center rounded-lg bg-sidebar/80 text-muted hover:bg-elevated hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
            {onDeleteWork ? (
              <button
                type="button"
                aria-label={t("删除")}
                onClick={() => onDeleteWork(work.id)}
                className="grid size-7 place-items-center rounded-lg bg-sidebar/80 text-muted hover:bg-elevated hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  function startRename(item: ConversationSummary) {
    setEditingId(item.id);
    setDraft(item.title);
  }

  function commitStudioRename() {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRenameStudio?.(editingId, title);
    setEditingId(null);
  }

  function commitWorkRename() {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRenameWork?.(editingId, title);
    setEditingId(null);
  }

  function commitRename() {
    if (!editingId) return;
    const title = draft.trim();
    if (title) onRename(editingId, title);
    setEditingId(null);
  }

  return (
    <div className="flex h-full w-72 flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-3">
        <Logo className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">AllAi</div>
          <div className="truncate text-[11px] text-muted">v{APP_VERSION} · {t("高效地与AI工作")}</div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-user hover:text-ink md:hidden"
          aria-label={t("收起侧栏")}
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 px-3 pb-3">
        <button
          type="button"
          onClick={() => onViewChange("chat")}
          className={`flex items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs ${
            view === "chat" ? "bg-user font-medium" : "text-muted hover:bg-user/70"
          }`}
        >
          <MessageSquare className="size-3.5" />
          {t("聊天")}
        </button>
        <button
          type="button"
          onClick={() => onViewChange("agents")}
          className={`flex items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs ${
            view === "agents" ? "bg-user font-medium" : "text-muted hover:bg-user/70"
          }`}
        >
          <SquareTerminal className="size-3.5" />
          Agent
        </button>
        <button
          type="button"
          onClick={() => onViewChange("studio")}
          className={`flex items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs ${
            view === "studio" ? "bg-user font-medium" : "text-muted hover:bg-user/70"
          }`}
        >
          <ImageIcon className="size-3.5" />
          {t("创作")}
        </button>
      </div>

      <div className="px-3">
        {view === "studio" ? (
        <button
          type="button"
          onClick={onNewStudio}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-sm font-medium text-canvas transition-transform duration-150 active:scale-[0.98]"
        >
          <ImageIcon className="size-4" />
          {t("新创作")}
        </button>
        ) : view === "chat" ? (
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-sm font-medium text-canvas transition-transform duration-150 active:scale-[0.98]"
        >
          <MessageSquarePlus className="size-4" />
          {t("新对话")}
        </button>
        ) : (
        <button
          type="button"
          onClick={onNewWork}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2.5 text-sm font-medium text-canvas transition-transform duration-150 active:scale-[0.98]"
        >
          <Briefcase className="size-4" />
          {t("新工作")}
        </button>
        )}
      </div>

      <div className="px-3 pt-3">
        <label className="flex items-center gap-2 rounded-xl border border-line bg-elevated px-2.5 py-2">
          <Search className="size-4 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === "studio" ? t("搜索创作") : view === "chat" ? t("搜索对话") : t("搜索工作")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {view === "studio" ? (
        <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {studioGroups.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted">{t("还没有创作")}</p>
          ) : (
            studioGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {t(group.label)}
                </div>
                {group.items.map((item) => {
                  const active = item.id === activeStudioId;
                  return (
                    <div
                      key={item.id}
                      className={`group/studio relative mb-0.5 flex items-center rounded-xl ${
                        active ? "bg-user" : "hover:bg-user/70"
                      }`}
                    >
                      {editingId === item.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={commitStudioRename}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter") commitStudioRename();
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          className="w-full rounded-xl bg-transparent px-3 py-2 text-sm outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectStudio?.(item.id)}
                          className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                        >
                          {item.title}
                        </button>
                      )}
                      {editingId === item.id ? null : (
                        <div className="absolute right-1 hidden items-center group-hover/studio:flex">
                          <button
                            type="button"
                            aria-label={t("重命名")}
                            onClick={() => {
                              setEditingId(item.id);
                              setDraft(item.title);
                            }}
                            className="grid size-7 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={t("删除")}
                            onClick={() => onDeleteStudio?.(item.id)}
                            className="grid size-7 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </nav>
      ) : view === "chat" ? (
        <>

      <nav className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted">{t("还没有聊天记录")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t(group.label)}
              </div>
              {group.items.map((item) => {
                const active = item.id === activeId;
                return (
                  <div
                    key={item.id}
                    className={`group/item relative mb-0.5 flex items-center rounded-xl ${
                      active ? "bg-user" : "hover:bg-user/70"
                    }`}
                  >
                    {editingId === item.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setEditingId(null);
                        }}
                        className="w-full rounded-xl bg-transparent px-3 py-2 text-sm outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                      >
                        {item.title}
                      </button>
                    )}
                    {editingId === item.id ? null : (
                      <div className="absolute right-1 hidden items-center group-hover/item:flex">
                        <button
                          type="button"
                          aria-label={t("重命名")}
                          onClick={() => startRename(item)}
                          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("删除")}
                          onClick={() => onDelete(item.id)}
                          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </nav>
        </>
      ) : (
        <nav className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
          {workGroups.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted">{t("还没有本地工作")}</p>
          ) : (
            workGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {t(group.label)}
                </div>
                {group.items.map((item) => {
                  const work = filteredWorks.find((entry) => entry.id === item.id);
                  if (!work) return null;
                  const children = chainChildren.get(work.id) ?? [];
                  if (!children.length) return renderWork(work);
                  const chainActive = work.id === activeWorkId || children.some((child) => child.id === activeWorkId);
                  const expanded =
                    collapsedChains[work.id] !== undefined ? !collapsedChains[work.id] : chainActive;
                  return (
                    <div key={work.id}>
                      {renderWork(work, {
                        count: children.length + 1,
                        expanded,
                        onToggle: () => toggleChain(work.id, expanded),
                      })}
                      {expanded ? (
                        // 接续出来的对话挂在主对话下面：缩进 + 左边一条竖线
                        <div className="mb-1 ml-4 border-l border-line pl-1.5">
                          {children.map((child, index) => renderWork(child, undefined, index + 1))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </nav>
      )}

      <div className="mt-auto border-t border-line p-2">
        <div className="px-3 py-1 text-[11px] text-muted">版本 {APP_VERSION}</div>
        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 hover:bg-user"
          >
            <Search className="size-4" />
            {t("搜索")}
            <kbd className="ml-auto hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted sm:inline">
              Ctrl+K
            </kbd>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 hover:bg-user"
        >
          <Settings className="size-4" />
          {t("设置")}
        </button>
      </div>
    </div>
  );
}
