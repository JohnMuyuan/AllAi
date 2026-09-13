"use client";

import { ImageIcon, MessageSquare, Search, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationSummary } from "@/lib/types";
import type { AgentWork } from "@/types/desktop";
import { useT } from "./I18n";

export type SearchJump = { area: "chat" | "agents" | "studio"; id: string };

type Hit = SearchJump & { title: string; snippet: string; source: "local" | "body" };

type Props = {
  open: boolean;
  onClose: () => void;
  conversations: ConversationSummary[];
  works: AgentWork[];
  studio: ConversationSummary[];
  onJump: (hit: SearchJump) => void;
};

const AREA: Record<Hit["area"], { label: string; icon: typeof Search }> = {
  chat: { label: "聊天", icon: MessageSquare },
  agents: { label: "Agent", icon: SquareTerminal },
  studio: { label: "创作", icon: ImageIcon },
};

function clip(text: string, n = 72) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

function localHits(query: string, conversations: ConversationSummary[], works: AgentWork[], studio: ConversationSummary[]) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [] as Hit[];
  const hits: Hit[] = [];
  for (const item of conversations) {
    if (item.title.toLowerCase().includes(needle) || item.preview.toLowerCase().includes(needle)) {
      hits.push({
        area: "chat",
        id: item.id,
        title: item.title || "未命名",
        snippet: clip(item.preview || item.title),
        source: "local",
      });
    }
  }
  for (const item of works) {
    if (
      item.title.toLowerCase().includes(needle) ||
      item.preview.toLowerCase().includes(needle) ||
      item.agentName.toLowerCase().includes(needle) ||
      item.cwd.toLowerCase().includes(needle)
    ) {
      hits.push({
        area: "agents",
        id: item.id,
        title: item.title || "未命名",
        snippet: clip(`${item.agentName} · ${item.preview || item.cwd}`),
        source: "local",
      });
    }
  }
  for (const item of studio) {
    if (item.title.toLowerCase().includes(needle) || item.preview.toLowerCase().includes(needle)) {
      hits.push({
        area: "studio",
        id: item.id,
        title: item.title || "未命名",
        snippet: clip(item.preview || item.title),
        source: "local",
      });
    }
  }
  return hits.slice(0, 30);
}

export function SearchPalette({ open, onClose, conversations, works, studio, onJump }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [cursorFor, setCursorFor] = useState("");
  const [bodyHits, setBodyHits] = useState<Hit[]>([]);
  const [bodyFor, setBodyFor] = useState("");
  const input = useRef<HTMLInputElement>(null);

  if (cursorFor !== query) {
    setCursorFor(query);
    setCursor(0);
  }

  const quick = useMemo(
    () => localHits(query, conversations, works, studio),
    [query, conversations, works, studio],
  );
  const ids = new Set(quick.map((item) => `${item.area}:${item.id}`));
  const needle = query.trim();
  const extra =
    needle.length >= 2 && bodyFor === needle
      ? bodyHits.filter((item) => !ids.has(`${item.area}:${item.id}`))
      : [];
  const hits = [...quick, ...extra].slice(0, 40);
  const active = hits.length ? Math.min(cursor, hits.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => input.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((response) => response.json())
        .then((data: { results?: { area: Hit["area"]; id: string; title: string; snippet: string }[] }) => {
          setBodyHits(
            (data.results ?? []).map((item) => ({
              ...item,
              source: "body" as const,
            })),
          );
          setBodyFor(q);
        })
        .catch(() => {
          setBodyHits([]);
          setBodyFor(q);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  function jump(hit: Hit) {
    onJump(hit);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh] px-4" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((current) => Math.min(hits.length - 1, current + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((current) => Math.max(0, current - 1));
              }
              if (event.key === "Enter" && hits[active]) {
                event.preventDefault();
                jump(hits[active]);
              }
            }}
            placeholder={t("搜索聊天、Agent、创作…")}
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted sm:inline">Esc</kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!query.trim() ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t("输入标题或正文里的字")}</p>
          ) : !hits.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted">{t("没有找到「{query}」", { query: query.trim() })}</p>
          ) : (
            hits.map((hit, index) => {
              const meta = AREA[hit.area];
              const Icon = meta.icon;
              return (
                <button
                  key={`${hit.area}:${hit.id}:${hit.snippet}`}
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => jump(hit)}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left ${
                    index === active ? "bg-user" : ""
                  }`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{hit.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{t(meta.label)}</span>
                    </span>
                    {hit.snippet ? (
                      <span className="mt-0.5 block truncate text-xs text-muted">{hit.snippet}</span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
