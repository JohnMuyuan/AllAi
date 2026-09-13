"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

export type Turn = { id: string; label: string };

/** 竖条最多画这么多格；轮数再多就均匀抽样，悬停的列表里仍然是全部。 */
const MAX_TICKS = 48;

/**
 * 长对话的快速跳转（仿 Codex 那一列短横线）：一格是用户发过的一句话。
 * 当前看到的那一轮高亮；鼠标移上去展开成列表，点哪条跳到哪条。
 *
 * 用法：每一轮的外层元素加 `data-turn={id}`，把滚动容器和轮次列表传进来。
 * 外层要是 `relative` + `@container`：栏目窄的时候不显示，免得压住消息。
 */
export const TurnRail = memo(function TurnRail({
  turns,
  container,
}: {
  turns: Turn[];
  container: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el || turns.length < 2) return;
    let frame = 0;
    // 读的是已经排好版的位置，放到下一帧里算，滚动时一帧最多算一次。
    const measure = () => {
      frame = 0;
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.3;
      const nodes = el.querySelectorAll<HTMLElement>("[data-turn]");
      let current = 0;
      nodes.forEach((node, index) => {
        if (node.getBoundingClientRect().top <= line) current = index;
      });
      // 翻到底了就算最后一轮：最后一轮常常很短，顶不到 30% 那条线。
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 4) current = Math.max(0, nodes.length - 1);
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    el.addEventListener("scroll", schedule, { passive: true });
    return () => {
      el.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [container, turns]);

  // 展开列表时把当前那一轮滚到看得见的地方。
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  if (turns.length < 2) return null;

  function jump(index: number) {
    const el = container.current;
    const turn = turns[index];
    if (!el || !turn) return;
    const target = el.querySelector<HTMLElement>(`[data-turn="${CSS.escape(turn.id)}"]`);
    if (!target) return;
    const top = el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
    // 平滑滚动一万像素要一秒半（实测），跳几十轮时反而像卡住了：超过两屏直接到位，近的才平滑。
    const far = Math.abs(top - el.scrollTop) > el.clientHeight * 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top, behavior: reduce || far ? "auto" : "smooth" });
  }

  const ticks =
    turns.length > MAX_TICKS
      ? Array.from({ length: MAX_TICKS }, (_, k) => Math.round((k * (turns.length - 1)) / (MAX_TICKS - 1)))
      : turns.map((_, index) => index);
  let activeTick = 0;
  ticks.forEach((turnIndex, k) => {
    if (turnIndex <= active) activeTick = k;
  });

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <nav
      aria-label={t("跳转到对话里的某一轮")}
      className="absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 @[880px]:block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <div className="flex flex-col items-start py-2">
        {ticks.map((turnIndex, k) => (
          <button
            key={turns[turnIndex].id}
            type="button"
            tabIndex={k === activeTick ? 0 : -1}
            aria-label={t("第 {n} 轮：{label}", { n: turnIndex + 1, label: turns[turnIndex].label })}
            onClick={() => jump(turnIndex)}
            className="group/tick flex h-2 w-7 items-center"
          >
            <span
              className={`block h-[3px] rounded-full transition-all duration-150 ${
                k === activeTick ? "w-5 bg-ink" : "w-3 bg-muted/35 group-hover/tick:w-4 group-hover/tick:bg-muted"
              }`}
            />
          </button>
        ))}
      </div>
      {open ? (
        <div className="absolute left-full top-1/2 ml-1 w-72 -translate-y-1/2 rounded-2xl border border-line bg-elevated p-1.5 shadow-xl">
          <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto">
            {turns.map((turn, index) => (
              <button
                key={turn.id}
                type="button"
                aria-current={index === active ? "true" : undefined}
                onClick={() => jump(index)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                  index === active ? "bg-user font-medium text-ink" : "text-muted hover:bg-user/70 hover:text-ink"
                }`}
              >
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted">{index + 1}</span>
                <span className="truncate">{turn.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
});

/** 取用户那句话的第一行当标签。 */
export function turnLabel(text: string, fallback = "（图片或附件）") {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
