"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "./I18n";

type Option = { value: string; label: string; description?: string; icon?: ReactNode };

/** Shared compact picker; the portal keeps menus clear of scroll containers. */
export function OptionSelect({ label, value, options, onChange, disabled, icon, compact = false, hideLabel = false }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: ReactNode;
  compact?: boolean;
  /**
   * 紧凑模式下只显示选中的那一项，不显示「推理 ·」这种前缀。
   * 英文比中文长一截，前缀会把同一行的按钮挤到下一排（约定 96）。
   * 名字还是留在 aria-label 里，读屏和自动化测试不受影响。
   */
  hideLabel?: boolean;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const selected = options.find((option) => option.value === value);
  const open = Boolean(position) && !disabled;
  const lead = icon ?? selected?.icon;

  function close(restore = false) {
    setPosition(null);
    if (restore) trigger.current?.focus();
  }

  function show() {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const height = Math.min(360, 44 + options.length * 66, Math.max(below, above));
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(below >= height ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }), width, maxHeight: height });
  }

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    items?.[Math.max(0, options.findIndex((option) => option.value === value))]?.focus();
    function outside(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
    }
    function reposition(event: Event) {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, options, value]);

  return <>
    <button ref={trigger} type="button" className={`ui-select ${compact ? "ui-select-compact" : ""}`}
      disabled={disabled || !options.length} aria-label={`${t(label)}：${selected ? t(selected.label) : t("未选择")}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}>
      {lead}
      <span className="min-w-0 truncate">
        {compact && !hideLabel ? `${t(label)} · ` : ""}
        {selected ? t(selected.label) : t("未选择")}
      </span>
      <ChevronDown className={`ml-auto size-3.5 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={t(label)} style={position!}
      className="ui-option-menu" onKeyDown={(event) => {
        const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === "Tab") { event.preventDefault(); close(true); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      <div className="px-3 pb-2 pt-1 text-[11px] font-medium tracking-wide text-muted">{t(label)}</div>
      {options.map((option) => <button key={option.value} type="button" role="menuitemradio"
        aria-checked={option.value === value} tabIndex={-1} className="ui-option"
        onClick={() => { onChange(option.value); close(true); }}>
        {/* 不管有没有图标都占同一格：不然带图标的选项会比不带的缩进一截，看着像错位。 */}
        <span className="grid size-4 shrink-0 place-items-center">{option.icon}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{t(option.label)}</span>
          {option.description && <span className="mt-0.5 block text-xs text-muted">{t(option.description)}</span>}</span>
        {option.value === value && <Check className="size-4 shrink-0 text-accent" />}
      </button>)}
    </div>, document.body)}
  </>;
}
