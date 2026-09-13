"use client";

import { useEffect, useRef } from "react";
import type { SlashCommandHint } from "@/lib/cli-commands";
import { useT } from "./I18n";

type Props = {
  id: string;
  items: SlashCommandHint[];
  active: number;
  onActive: (index: number) => void;
  onPick: (item: SlashCommandHint) => void;
};

export function SlashCommandMenu({ id, items, active, onActive, onPick }: Props) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>("[data-active='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label={t("可选指令")}
      className="slash-menu"
    >
      {items.length ? (
        items.map((item, index) => {
          const selected = index === active;
          const alias = item.aliases.find((name) => /[\u4e00-\u9fff]/.test(name));
          return (
            <button
              key={item.insert}
              type="button"
              role="option"
              id={`${id}-${index}`}
              aria-selected={selected}
              data-active={selected ? "true" : undefined}
              onMouseEnter={() => onActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(item);
              }}
              className={`slash-cmd ${selected ? "slash-cmd-active" : ""}`}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-[13px] text-accent">{item.insert}</span>
                <span className="truncate text-[13px] font-medium">{t(item.title)}</span>
                {alias ? <span className="ml-auto shrink-0 text-[11px] text-muted">{t("也可 {alias}", { alias: `/${alias}` })}</span> : null}
              </span>
              <span className="mt-0.5 block text-left text-[12px] leading-5 text-muted">{t(item.usage)}</span>
            </button>
          );
        })
      ) : (
        <p className="px-3 py-2.5 text-[13px] leading-5 text-muted">{t("没有匹配的指令。Enter 会把你打的原文发给 Agent。")}</p>
      )}
      <p className="px-3 pb-1.5 pt-1 text-[11px] text-muted">{t("↑↓ 选择 · Enter 填入 · Esc 关闭")}</p>
    </div>
  );
}
