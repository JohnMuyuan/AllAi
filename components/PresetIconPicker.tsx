"use client";

import { PRESET_ICONS, presetSrc } from "@/lib/preset-icons";
import { useT } from "./I18n";

type Props = {
  value: string;
  onPick: (src: string) => void;
};

export function PresetIconPicker({ value, onPick }: Props) {
  const t = useT();
  return (
    <div className="mt-2">
      <div className="mb-1.5 text-[11px] text-muted">{t("预设图标")}</div>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {PRESET_ICONS.map((item) => {
          const src = presetSrc(item.file);
          const active = value === src;
          return (
            <button
              key={item.id}
              type="button"
              title={t(item.label)}
              onClick={() => onPick(src)}
              className={`grid size-8 place-items-center rounded-lg border ${
                active ? "border-accent bg-user" : "border-line hover:bg-user"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 预设 SVG */}
              <img
                src={src}
                alt=""
                aria-hidden="true"
                className={`size-5 object-contain ${item.color ? "" : "brand-invert"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
