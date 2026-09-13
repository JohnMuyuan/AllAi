"use client";

import { classifyModel } from "@/lib/models";
import { makeModelKey, parseModelKey } from "@/lib/public";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { OptionSelect } from "./OptionSelect";

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onChange: (patch: Partial<AppPrefs>) => void;
};

function options(providers: PublicProvider[], kinds: Array<"image" | "video">) {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => kinds.includes((model.kind || classifyModel(model.id)) as "image" | "video"))
      .map((model) => ({
        key: makeModelKey(provider.id, model.id),
        label: `${model.label || model.id} · ${provider.name}`,
      })),
  );
}

function Select({
  label,
  hint,
  value,
  items,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  items: { key: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <OptionSelect label={label} value={value} onChange={onChange}
        options={[{ value: "", label: "未选择" }, ...items.map((item) => ({ value: item.key, label: item.label }))]} />
      <span className="mt-1 block text-xs text-muted">{hint}</span>
    </div>
  );
}

export function ImagineSettings({ providers, prefs, onChange }: Props) {
  const t = useT();
  const images = options(providers, ["image"]);
  const current = prefs.chatImageModelKey
    ? parseModelKey(prefs.chatImageModelKey).modelId
    : "";

  return (
    <div className="p-5">
      <p className="mb-4 text-sm text-muted">
        {t("生图和视频模型单独管理，不会出现在普通聊天的模型列表里。聊天和 Agent 里的生图按钮会用这里指定的模型。")}
      </p>
      {images.length === 0 ? (
        <p className="mb-4 rounded-xl border border-line bg-elevated px-3 py-2 text-sm text-muted">
          {t("还没有生图模型。在「聊天模型」里给接口加上例如 grok-imagine-image-2.0，保存后会自动识别。")}
        </p>
      ) : null}
      <Select
        label={t("聊天生图模型")}
        hint={t("聊天输入框的生图按钮使用")}
        value={prefs.chatImageModelKey}
        items={images}
        onChange={(chatImageModelKey) => onChange({ chatImageModelKey })}
      />
      <Select
        label={t("Agent 生图模型")}
        hint={t("Agent 输入框的生图按钮使用，图片会写进工作目录")}
        value={prefs.agentImageModelKey}
        items={images}
        onChange={(agentImageModelKey) => onChange({ agentImageModelKey })}
      />
      {current ? (
        <p className="text-xs text-muted">{t("当前聊天生图模型 ID：{id}", { id: current })}</p>
      ) : null}

    </div>
  );
}
