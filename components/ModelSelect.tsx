"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { classifyModel } from "@/lib/models";
import { makeModelKey } from "@/lib/public";
import type { BrandIcons } from "@/lib/brand";
import type { ModelKind, PublicProvider } from "@/lib/types";
import { ModelIcon } from "./ModelIcon";
import { useT } from "./I18n";

export type ExtraModelOption = {
  key: string;
  label: string;
  provider: string;
};

type Props = {
  providers: PublicProvider[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  extra?: ExtraModelOption[];
  kinds?: ModelKind[];
  onOpenChange?: (open: boolean) => void;
  /** 用户自己配的厂商图标。 */
  icons?: BrandIcons;
};

export function ModelSelect({
  providers,
  value,
  onChange,
  disabled,
  extra = [],
  kinds,
  onOpenChange,
  icons = {},
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 菜单挂到 body 上：不然会被对话框的 overflow-hidden 裁掉半截。
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const extras = extra.map((item) => ({
      key: item.key,
      label: item.label,
      modelId: item.key,
      provider: item.provider,
      providerId: "",
      baseUrl: "",
    }));
    const models = providers.flatMap((provider) =>
      provider.models
        .filter((model) => {
          if (!kinds?.length) return true;
          return kinds.includes(model.kind || classifyModel(model.id));
        })
        .map((model) => ({
          key: makeModelKey(provider.id, model.id),
          label: model.label || model.id,
          modelId: model.id,
          provider: provider.name,
          providerId: provider.id,
          baseUrl: provider.baseUrl,
        })),
    );
    return [...extras, ...models];
  }, [extra, kinds, providers]);

  const selected = options.find((item) => item.key === value);
  const filtered = options.filter((item) => {
    const blob = `${item.label} ${item.modelId} ${item.provider}`.toLowerCase();
    return blob.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    function close() {
      setOpen(false);
      onOpenChange?.(false);
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onOpenChange]);

  /** 贴着触发按钮定位，空间不够就翻到上方，并且永远留在视口里。 */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(Math.max(trigger.width, 288), window.innerWidth - 24);
      const below = window.innerHeight - trigger.bottom - 16;
      const above = trigger.top - 16;
      const flip = below < 220 && above > below;
      const maxHeight = Math.max(160, Math.min(384, flip ? above : below));
      setBox({
        left: Math.max(12, Math.min(trigger.left, window.innerWidth - width - 12)),
        top: flip ? Math.max(12, trigger.top - 8 - maxHeight) : trigger.bottom + 8,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => {
          if (!open) setQuery("");
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        className="ui-select max-w-full"
      >
        {selected ? (
          <ModelIcon
            modelId={selected.modelId}
            baseUrl={selected.baseUrl}
            icons={icons}
            className="size-4"
          />
        ) : null}
        <span className="min-w-0 truncate font-medium">
          {selected ? selected.label : options.length ? t("选择模型") : t("还没有模型")}
        </span>
        {selected ? (
          <span className="hidden truncate text-xs text-muted sm:inline">
            {t(selected.provider)}
          </span>
        ) : null}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
      </button>
      {open && box
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: "fixed",
                left: box.left,
                top: box.top,
                width: box.width,
                maxHeight: box.maxHeight,
              }}
              className="z-[60] flex flex-col overflow-hidden rounded-2xl border border-line bg-elevated p-2 shadow-xl shadow-black/20"
            >
              <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-canvas px-2.5 py-2">
                <Search className="size-4 text-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("搜索模型或服务")}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted">{t("没有匹配的模型")}</p>
                ) : (
                  filtered.map((item) => {
                    const active = item.key === value;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          onChange(item.key);
                          setOpen(false);
                          onOpenChange?.(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-user ${
                          active ? "bg-user" : ""
                        }`}
                      >
                        <ModelIcon
                          modelId={item.modelId}
                          baseUrl={item.baseUrl}
                          icons={icons}
                          className="size-5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.label}</div>
                          <div className="truncate text-xs text-muted">
                            {t(item.provider)} · {item.modelId}
                          </div>
                        </div>
                        {active ? <Check className="size-4 shrink-0 text-accent" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
