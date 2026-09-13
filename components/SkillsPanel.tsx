"use client";

import { FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { getDesktop } from "@/lib/desktop";
import type { AgentKind, ManagedSkill } from "@/lib/types";
import { useConfirm } from "./ConfirmDialog";
import { BrandMark } from "./BrandMarks";
import { useT } from "./I18n";

const AGENTS: { id: AgentKind; label: string }[] = [
  { id: "grok-build", label: "Grok" },
  { id: "claude-code", label: "Claude" },
  { id: "codex", label: "Codex" },
];

type Props = {
  skills: ManagedSkill[];
  onReload: () => Promise<unknown>;
  onToast: (text: string) => void;
};

export function SkillsPanel({ skills, onReload, onToast }: Props) {
  const t = useT();
  const confirm = useConfirm();
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  async function toggle(skill: ManagedSkill, kind: AgentKind) {
    if (pendingRef.current.has(skill.id)) return;
    pendingRef.current.add(skill.id);
    setPending(new Set(pendingRef.current));
    try {
      const disabledFor = skill.disabledFor.includes(kind)
        ? skill.disabledFor.filter((item) => item !== kind)
        : [...skill.disabledFor, kind];
      await patch(skill.id, { disabledFor });
    } catch {
      onToast(t("保存失败，请重试"));
    } finally {
      pendingRef.current.delete(skill.id);
      setPending(new Set(pendingRef.current));
    }
  }
  async function importFolder() {
    const desktop = getDesktop();
    const folder = desktop ? await desktop.pickFolder() : window.prompt(t("Skills 文件夹路径"));
    if (!folder) return;
    const response = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folder }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      onToast(data.error ? t(data.error) : t("导入失败"));
      return;
    }
    await onReload();
    onToast(t("已导入 Skill"));
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      onToast(data.error ? t(data.error) : t("保存失败"));
      return;
    }
    await onReload();
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "删除这个导入的 Skill？",
      detail: "只删除 AllAi 导入的那一份，原始文件夹不动。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    const response = await fetch(`/api/skills/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      onToast(data.error ? t(data.error) : t("删除失败"));
      return;
    }
    await onReload();
  }

  return (
    <div className="min-h-0 overflow-y-auto p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {t("点击图标切换 Agent：彩色亮起表示启用，灰色表示停用。")}
        </p>
        <button
          type="button"
          onClick={() => void importFolder()}
          className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-user"
        >
          <FolderOpen className="size-3.5" />
          {t("导入文件夹")}
        </button>
      </div>
      {skills.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t("还没有发现 Skills")}</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-elevated">
          {skills.map((skill) => (
            <div key={skill.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-4 last:border-b-0">
              <div className="min-w-0 flex-1 basis-48">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{skill.name}</div>
                  <div className="truncate text-[11px] text-muted">
                    {skill.source} · {skill.description || skill.path}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={t("{name} 的 Agent 开关", { name: skill.name })}>
                {AGENTS.map((agent) => {
                  const on = !skill.disabledFor.includes(agent.id);
                  return <button key={agent.id} type="button"
                    className="skill-agent-toggle" data-agent={agent.id} aria-pressed={on}
                    aria-label={`${skill.name} · ${agent.label}`} title={`${agent.label} · ${on ? t("已启用，点击停用") : t("已停用，点击启用")}`}
                    disabled={pending.has(skill.id)} aria-busy={pending.has(skill.id)}
                    onClick={() => void toggle(skill, agent.id)}>
                    <BrandMark kind={agent.id} />
                  </button>;
                })}
              </div>
              {skill.managed ? (
                  <>
                    <button
                      type="button"
                      aria-label={t("更新")}
                      onClick={() => void patch(skill.id, { refresh: true })}
                      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-ink"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("删除")}
                      onClick={() => void remove(skill.id)}
                      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
