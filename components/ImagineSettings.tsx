"use client";

import { classifyModel } from "@/lib/models";
import { makeModelKey, parseModelKey } from "@/lib/public";
import type { AppPrefs, PublicProvider } from "@/lib/types";
import { useT } from "./I18n";
import { ModelIcon } from "./ModelIcon";
import { OptionSelect } from "./OptionSelect";

type Props = {
  providers: PublicProvider[];
  prefs: AppPrefs;
  onChange: (patch: Partial<AppPrefs>) => void;
};

type Item = { key: string; label: string; modelId: string; providerId: string; baseUrl: string };

function options(providers: PublicProvider[], kinds: Array<"image" | "video">): Item[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => kinds.includes((model.kind || classifyModel(model.id)) as "image" | "video"))
      .map((model) => ({
        key: makeModelKey(provider.id, model.id),
        label: `${model.label || model.id} · ${provider.name}`,
        modelId: model.id,
        providerId: provider.id,
        baseUrl: provider.baseUrl,
      })),
  );
}

function Select({
  label,
  hint,
  value,
  items,
  icons,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  items: Item[];
  icons: AppPrefs["brandIcons"];
  onChange: (value: string) => void;
}) {
  // 生图模型的名字长得都差不多（grok-imagine-image-2.0 / qwen-image / FLUX.1…），
  // 没有图标只能靠后面的接口名区分，所以图标和模型列表用同一套（约定 93）。
  const pick = (item: Item) => (
    <ModelIcon
      modelId={item.modelId}
      baseUrl={item.baseUrl}
      providerId={item.providerId}
      icons={icons ?? {}}
      className="size-4"
    />
  );
  return (
    <div className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <OptionSelect label={label} value={value} onChange={onChange}
        options={[
          { value: "", label: "未选择" },
          ...items.map((item) => ({
            value: item.key,
            label: item.label,
            icon: pick(item),
          })),
        ]} />
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
        icons={prefs.brandIcons}
        onChange={(chatImageModelKey) => onChange({ chatImageModelKey })}
      />
      <Select
        label={t("Agent 生图模型")}
        hint={t("Agent 输入框的生图按钮使用，图片会写进工作目录")}
        value={prefs.agentImageModelKey}
        items={images}
        icons={prefs.brandIcons}
        onChange={(agentImageModelKey) => onChange({ agentImageModelKey })}
      />
      {current ? (
        <p className="text-xs text-muted">{t("当前聊天生图模型 ID：{id}", { id: current })}</p>
      ) : null}

    </div>
  );
}
