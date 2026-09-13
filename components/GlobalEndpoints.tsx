"use client";

import { Globe, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { providerIconKey, type BrandIcons } from "@/lib/brand";
import { useT } from "./I18n";
import { ProviderIconField } from "./ProviderIconField";
import type { PublicEndpoint } from "@/lib/types";

/**
 * 全局提供商池。
 *
 * 三个 Agent 多半用同一个中转站，以前得在每个 Agent 里各填一遍 key 和地址，
 * 换中转站要改三次。这里配一次，所有 Agent 的接口列表里自动都有（只读显示，
 * 带「全局」标记），要改还是回到这里改。
 */

type Draft = PublicEndpoint & { apiKey: string };

export function GlobalEndpointsPanel({
  onChanged,
  onToast,
  icons = {},
  onIcons,
}: {
  onChanged: () => Promise<unknown> | void;
  onToast?: (text: string) => void;
  icons?: BrandIcons;
  onIcons?: (icons: BrandIcons) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [freshIds, setFreshIds] = useState<Record<string, true>>({});

  useEffect(() => {
    void fetch("/api/agent-endpoints")
      .then((response) => response.json() as Promise<{ endpoints?: PublicEndpoint[] }>)
      .then((data) => setDrafts((data.endpoints ?? []).map((item) => ({ ...item, apiKey: "" }))))
      .catch(() => setError(t("读取失败")))
      .finally(() => setLoading(false));
  }, [t]);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function add() {
    const id = crypto.randomUUID();
    setDrafts((current) => [
      ...current,
      {
        id,
        label: t("全局接口 {n}", { n: current.length + 1 }),
        mode: "api",
        apiKey: "",
        baseUrl: "",
        model: "",
        models: [],
        hasKey: false,
        apiKeyMasked: "",
      },
    ]);
    setFreshIds((current) => ({ ...current, [id]: true }));
  }

  function patchIcon(id: string, icon: string) {
    if (!onIcons) return;
    const next = { ...icons };
    const key = providerIconKey(id);
    if (icon) next[key] = icon;
    else delete next[key];
    onIcons(next);
  }

  async function remove(id: string) {
    const target = drafts.find((item) => item.id === id);
    const ok = await confirm({
      title: t("删除「{name}」？", { name: target?.label || t("这个接口") }),
      detail: t("所有 Agent 的接口列表里都会少掉它。正在用它的 Agent 会回到自己的接口。"),
      confirmText: t("删除"),
      danger: true,
    });
    if (!ok) return;
    setDrafts((current) => current.filter((item) => item.id !== id));
  }

  async function save(next = drafts) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/agent-endpoints", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoints: next.map((item) => ({
            id: item.id,
            label: item.label.trim() || "全局接口",
            baseUrl: item.baseUrl,
            model: item.model,
            models: item.models,
            ...(item.apiKey.trim() ? { apiKey: item.apiKey.trim() } : {}),
          })),
        }),
      });
      const data = (await response.json()) as { error?: string; endpoints?: PublicEndpoint[] };
      if (!response.ok) {
        setError(data.error ? t(data.error) : t("保存失败"));
        return false;
      }
      setDrafts((data.endpoints ?? []).map((item) => ({ ...item, apiKey: "" })));
      setNotice(t("已保存，所有 Agent 都已生效"));
      await onChanged();
      return true;
    } catch {
      setError(t("保存失败"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** 从接口拉模型列表。借 Agent 的同步接口，但写回的是全局池。 */
  async function sync(id: string) {
    const item = drafts.find((row) => row.id === id);
    if (!item) return;
    // 同步要服务端拿得到 key，所以先存一次。
    if (!(await save())) return;
    setSaving(true);
    try {
      const response = await fetch("/api/agent-endpoints/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointId: id }),
      });
      const data = (await response.json()) as { error?: string; endpoints?: PublicEndpoint[] };
      if (!response.ok) {
        setError(data.error ? t(data.error) : t("同步失败"));
        return;
      }
      setDrafts((data.endpoints ?? []).map((row) => ({ ...row, apiKey: "" })));
      onToast?.(t("已同步模型"));
      await onChanged();
    } catch {
      setError(t("同步失败"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">{t("读取中…")}</p>;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4" />
          {t("全局提供商")}
        </h3>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] hover:bg-elevated"
        >
          <Plus className="size-3" />
          {t("新增")}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted">
        {t("这里配一次，所有 Agent 的接口列表里都会出现，不用每个 Agent 各填一遍。去对应 Agent 里点「设为当前」就能用。")}
      </p>

      {drafts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
          {t("还没有全局提供商。点「新增」填一个中转站，三个 Agent 就都能选它了。")}
        </p>
      ) : (
        <div className="space-y-3">
          {drafts.map((item) => (
            <div key={item.id} className="rounded-2xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  value={item.label}
                  onChange={(event) => update(item.id, { label: event.target.value })}
                  placeholder={t("备注，例如「我的中转站」")}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  aria-label={t("删除接口")}
                  onClick={() => void remove(item.id)}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="space-y-2">
                <input
                  type="password"
                  value={item.apiKey}
                  onChange={(event) => update(item.id, { apiKey: event.target.value })}
                  placeholder={item.hasKey ? t("已保存 {masked}", { masked: item.apiKeyMasked }) : "sk-..."}
                  className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                <input
                  value={item.baseUrl}
                  onChange={(event) => update(item.id, { baseUrl: event.target.value })}
                  placeholder="https://your-gateway/v1"
                  className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                <ProviderIconField
                  icon={icons[providerIconKey(item.id)] || ""}
                  onIcon={(icon) => patchIcon(item.id, icon)}
                  autoSource={item.baseUrl}
                  auto={Boolean(freshIds[item.id])}
                  onToast={onToast}
                />
              </div>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{t("模型")}</span>
                  <button
                    type="button"
                    onClick={() => void sync(item.id)}
                    disabled={saving || (!item.hasKey && !item.apiKey)}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-40"
                  >
                    <RefreshCw className="size-3" />
                    {saving ? t("同步中…") : t("从接口同步")}
                  </button>
                </div>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {(item.models ?? []).length === 0 ? (
                    <span className="text-xs text-muted">{t("还没有模型，同步或手动添加。")}</span>
                  ) : (
                    (item.models ?? []).map((model) => (
                      <span
                        key={model.id}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                          item.model === model.id ? "bg-elevated ring-1 ring-accent" : "bg-user"
                        }`}
                      >
                        <button type="button" onClick={() => update(item.id, { model: model.id })}>
                          {model.label || model.id}
                        </button>
                        <button
                          type="button"
                          aria-label={t("移除 {name}", { name: model.label || model.id })}
                          onClick={() =>
                            update(item.id, {
                              models: (item.models ?? []).filter((row) => row.id !== model.id),
                              model: item.model === model.id ? "" : item.model,
                            })
                          }
                          className="text-muted hover:text-ink"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <input
                  value={modelDrafts[item.id] || ""}
                  onChange={(event) =>
                    setModelDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const id = (modelDrafts[item.id] || "").trim();
                    if (!id || (item.models ?? []).some((row) => row.id === id)) return;
                    update(item.id, {
                      models: [...(item.models ?? []), { id, label: id }],
                      model: item.model || id,
                    });
                    setModelDrafts((current) => ({ ...current, [item.id]: "" }));
                  }}
                  placeholder={t("输入模型 ID 后回车添加")}
                  className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-emerald-500">{notice}</p> : null}
      <div className="mt-4">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas disabled:opacity-50"
        >
          {saving ? t("保存中…") : t("保存")}
        </button>
      </div>
    </div>
  );
}
