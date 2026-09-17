"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * 列表里的上移 / 下移。
 *
 * HTML 不允许按钮套按钮，所以整行本身是选中按钮时，调用方要把这一组放在它**外面**
 * （见设置里的服务列表）。键盘可达：两个都是真按钮，到头就 disabled。
 */
export function OrderButtons({
  upLabel,
  downLabel,
  first,
  last,
  onMove,
  className = "",
}: {
  upLabel: string;
  downLabel: string;
  first: boolean;
  last: boolean;
  /** -1 上移，1 下移。 */
  onMove: (step: number) => void;
  className?: string;
}) {
  const style =
    "grid h-4 w-5 place-items-center rounded text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <span className={`flex shrink-0 flex-col ${className}`}>
      <button type="button" aria-label={upLabel} title={upLabel} disabled={first} onClick={() => onMove(-1)} className={style}>
        <ChevronUp className="size-3" />
      </button>
      <button type="button" aria-label={downLabel} title={downLabel} disabled={last} onClick={() => onMove(1)} className={style}>
        <ChevronDown className="size-3" />
      </button>
    </span>
  );
}
