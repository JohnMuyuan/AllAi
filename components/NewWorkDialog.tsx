"use client";

import { FolderOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kindInfo } from "@/lib/agents";
import { agentModelProviders, modelKeyFromWork } from "@/lib/agent-models";
import { officialModelsNeedRefresh } from "@/lib/sync-agent-models";
import type { PublicAgent } from "@/lib/types";
import { ModelSelect } from "./ModelSelect";
import { useT } from "./I18n";

type Draft = {
  agentId: string;
  modelKey: string;
  cwd: string;
};

type Props = {
  agents: PublicAgent[];
  cwd: string;
  onPickFolder: () => Promise<string | void> | void;
  onClose: () => void;
  onStart: (draft: Draft) => void;
  onSyncModels?: (agentId: string, endpointId: string) => Promise<void>;
  icons?: Record<string, string>;
};

export function NewWorkDialog({
  agents,
  cwd,
  onPickFolder,
  onClose,
  onStart,
  onSyncModels,
  icons = {},
}: Props) {
  const t = useT();
  const usable = agents.filter((item) => item.kind !== "custom" || item.command);
  const [agentId, setAgentId] = useState(usable[0]?.id ?? "");
  const agent = usable.find((item) => item.id === agentId) ?? usable[0];
  const groups = agent ? agentModelProviders(agent) : [];
  const [modelKey, setModelKey] = useState(() => modelKeyFromWork(null, usable[0] ?? null));
  const tried = useRef(new Set<string>());
  const valid = groups.some((item) =>
    item.models.some((model) => `${item.id}::${model.id}` === modelKey),
  );
  const selectedKey = valid ? modelKey : modelKeyFromWork(null, agent ?? null);

  useEffect(() => {
    if (!agent || !onSyncModels) return;
    for (const endpoint of agent.endpoints) {
      const needsOfficial =
        endpoint.mode === "official" && officialModelsNeedRefresh(agent.kind, endpoint.models);
      const needsApi = endpoint.mode === "api" && endpoint.hasKey && !endpoint.models?.length;
      if (!needsOfficial && !needsApi) continue;
      const key = `${agent.id}:${endpoint.id}`;
      if (tried.current.has(key)) continue;
      tried.current.add(key);
      void onSyncModels(agent.id, endpoint.id);
    }
  }, [agent, onSyncModels]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-labelledby="new-work-title"
        className="w-full max-w-lg overflow-hidden rounded-t-3xl border border-line bg-canvas sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="new-work-title" className="text-base font-semibold">
              {t("新工作")}
            </h2>
            <p className="text-sm text-muted">{t("模型和接口来自这个 Agent 自己的设置。")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("关闭")}
            className="grid size-9 place-items-center rounded-full hover:bg-user"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <span className="mb-2 block text-sm font-medium">Agent</span>
            <div className="grid gap-2">
              {usable.map((item) => {
                const info = kindInfo(item.kind);
                const active = item.id === agentId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setAgentId(item.id);
                      setModelKey(modelKeyFromWork(null, item));
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left ${
                      active ? "border-accent bg-user" : "border-line hover:bg-user/70"
                    }`}
                  >
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-xs text-muted">{t(info.blurb)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">{t("模型")}</span>
            <ModelSelect
              providers={groups}
              value={selectedKey}
              kinds={["chat"]}
              onChange={setModelKey}
              icons={icons}
            />
            <p className="mt-2 text-xs text-muted">{t("不用的模型在 Agent 设置里删。")}</p>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">{t("工作目录")}</span>
            <button
              type="button"
              onClick={() => void onPickFolder()}
              className="flex w-full items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2 text-left text-sm hover:bg-user"
            >
              <FolderOpen className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 truncate">{cwd || t("选择项目文件夹")}</span>
            </button>
          </div>

          <button
            type="button"
            disabled={!agentId || !selectedKey}
            onClick={() => onStart({ agentId, modelKey: selectedKey, cwd })}
            className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-canvas disabled:opacity-40"
          >
            {t("开始工作")}
          </button>
        </div>
      </div>
    </div>
  );
}
