"use client";

import { LogIn, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  officialSpecForProvider,
  OFFICIAL_CHATS,
  type OfficialChatKind,
} from "@/lib/official-chat";
import { getDesktop } from "@/lib/desktop";
import { detectReasoning } from "@/lib/reasoning";
import { providerIconKey, writeProviderIcon } from "@/lib/brand";
import { PROVIDER_TEMPLATES } from "@/lib/templates";

import type { AppPrefs, ManagedSkill, ModelRef, ProviderAuth, PublicAgent, PublicProvider } from "@/lib/types";
import type { LangMode } from "@/lib/i18n";
import type { ThemeMode } from "@/lib/theme";
import type { CliAuthStatus } from "@/types/desktop";
import { useConfirm } from "./ConfirmDialog";
import { useT } from "./I18n";
import { AgentSettingsPanel } from "./AgentSettingsDialog";
import { GlobalEndpointsPanel } from "./GlobalEndpoints";
import { ModelIcon, ServiceIcon } from "./ModelIcon";
import { ProviderIconField } from "./ProviderIconField";
import { GeneralSettings } from "./GeneralSettings";
import { ImagineSettings } from "./ImagineSettings";
import { SkillsPanel } from "./SkillsPanel";
import { UsageStats } from "./UsageStats";
import { RemoteSettings } from "./RemoteSettings";
import { AboutSettings } from "./AboutSettings";

/** 侧栏里「全局提供商」那一项不是真 Agent，用这个哨兵 id 区分。 */
const GLOBAL_ID = "__global__";

/** 「模型与接口」下面的三个二级页。 */
const MODEL_TABS: string[] = ["chat", "agents", "imagine"];

type Props = {
  providers: PublicProvider[];
  agents?: PublicAgent[];
  initialTab?: "chat" | "agents" | "imagine" | "skills" | "usage" | "general" | "remote" | "about";
  prefs?: AppPrefs;
  skills?: ManagedSkill[];
  onPrefs?: (patch: Partial<AppPrefs>) => void;
  onReloadSkills?: () => Promise<unknown>;
  onToast?: (text: string) => void;
  initialAgentId?: string;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
  onChangedAgents?: () => Promise<unknown>;
  onLogin?: (agentId: string) => void;
  officialStatus?: Partial<Record<OfficialChatKind, CliAuthStatus>>;
  officialBusy?: OfficialChatKind | null;
  onOfficialLogin?: (kind: OfficialChatKind) => void | Promise<void>;
  onOfficialLogout?: (kind: OfficialChatKind) => void | Promise<void>;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  langMode: LangMode;
  onLangMode: (mode: LangMode) => void;
};

type FormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** 用户点了「清除」：保存时要把已存的 Key 抹掉，而不是留着不动。 */
  clearKey?: boolean;
  models: ModelRef[];
  auth: ProviderAuth;
};

const emptyForm = (): FormState => ({
  name: "",
  baseUrl: "https://api.x.ai/v1",
  apiKey: "",
  models: [],
  auth: "api",
});

export function SettingsDialog({
  providers,
  agents = [],
  initialTab = "chat",
  initialAgentId,
  onClose,
  onChanged,
  onChangedAgents,
  onLogin,
  officialStatus = {},
  officialBusy = null,
  onOfficialLogin,
  onOfficialLogout,
  prefs,
  skills = [],
  onPrefs,
  onReloadSkills,
  onToast,
  themeMode,
  onThemeMode,
  langMode,
  onLangMode,
}: Props) {
  const t = useT();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"chat" | "agents" | "imagine" | "skills" | "usage" | "general" | "remote" | "about">(initialTab);
  const [agentId, setAgentId] = useState(initialAgentId || agents[0]?.id || "");
  const selectedAgent =
    agentId === GLOBAL_ID ? null : agents.find((item) => item.id === agentId) ?? agents[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | "new">(providers[0]?.id ?? "new");
  const [form, setForm] = useState<FormState>(() => {
    const current = providers[0];
    if (!current) return emptyForm();
    return {
      name: current.name,
      baseUrl: current.baseUrl,
      apiKey: "",
      clearKey: false,
      models: current.models,
      auth: officialSpecForProvider(current)?.auth ?? "api",
    };
  });
  const [modelDraft, setModelDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** 新服务还没有 id，抓到的图标先搁这儿，保存之后再写进 prefs。 */
  const [iconDraft, setIconDraft] = useState("");
  const iconsRef = useRef(prefs?.brandIcons ?? {});
  useEffect(() => {
    iconsRef.current = prefs?.brandIcons ?? {};
  }, [prefs?.brandIcons]);

  function applyTemplate(name: string) {
    const template = PROVIDER_TEMPLATES.find((item) => item.name === name);
    if (!template) return;
    if (template.auth && template.auth !== "api") {
      const existing = providers.find(
        (item) => officialSpecForProvider(item)?.auth === template.auth,
      );
      if (existing) {
        selectProvider(existing.id);
        return;
      }
      if (!getDesktop()) {
        onToast?.(t("请用桌面版 AllAi 打开"));
        return;
      }
    }
    setSelectedId("new");
    // 预设的名称和型号标签按**当前语言**写进表单：这是要存进 db 的用户数据，
    // 存下来之后就不再跟着语言变了（用户在设置里改的也一样）。
    setForm({
      name: t(template.name),
      baseUrl: template.baseUrl,
      apiKey: "",
      clearKey: false,
      models: template.models.map((model) => ({ ...model, label: t(model.label) })),
      auth: template.auth || "api",
    });
    setError("");
    setNotice("");
    setIconDraft("");
  }

  function patchProviderIcon(id: string, icon: string) {
    if (!onPrefs) return;
    const next = writeProviderIcon(iconsRef.current, id, icon);
    iconsRef.current = next;
    onPrefs({ brandIcons: next });
  }

  function selectProvider(id: string) {
    const current = providers.find((item) => item.id === id);
    if (!current) return;
    setSelectedId(id);
    setForm({
      name: current.name,
      baseUrl: current.baseUrl,
      apiKey: "",
      clearKey: false,
      models: current.models,
      auth: officialSpecForProvider(current)?.auth ?? "api",
    });
    setError("");
    setNotice("");
    setIconDraft("");
  }

  function addModel() {
    const id = modelDraft.trim();
    if (!id) return;
    if (form.models.some((item) => item.id === id)) {
      setModelDraft("");
      return;
    }
    setForm((current) => ({
      ...current,
      models: [...current.models, { id, label: id }],
    }));
    setModelDraft("");
  }

  function removeModel(id: string) {
    setForm((current) => ({
      ...current,
      models: current.models.filter((item) => item.id !== id),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const claude = form.auth !== "api";
      const payload = claude
        ? {
            name: form.name,
            auth: form.auth,
            models: form.models,
          }
        : {
            name: form.name,
            baseUrl: form.baseUrl,
            models: form.models,
            ...(form.apiKey.trim()
              ? { apiKey: form.apiKey.trim() }
              : form.clearKey
                ? { apiKey: null }
                : {}),
          };
      const isNew = selectedId === "new";
      if (isNew && !claude && !form.apiKey.trim()) {
        setError(t("新接入的服务需要填写 API Key"));
        return;
      }
      const response = await fetch(isNew ? "/api/providers" : `/api/providers/${selectedId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string; provider?: PublicProvider };
      if (!response.ok) {
        setError(data.error ? t(data.error) : t("保存失败"));
        return;
      }
      await onChanged();
      if (data.provider) {
        if (isNew && iconDraft) patchProviderIcon(data.provider.id, iconDraft);
        setSelectedId(data.provider.id);
        setForm({
          name: data.provider.name,
          baseUrl: data.provider.baseUrl,
          apiKey: "",
          clearKey: false,
          models: data.provider.models,
          auth: officialSpecForProvider(data.provider)?.auth ?? "api",
        });
        setIconDraft("");
      }
      setNotice(t("已保存"));
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (selectedId === "new") {
      setForm(emptyForm());
      return;
    }
    const ok = await confirm({
      title: "删除这个服务？",
      detail: "已有聊天记录会保留，但不能再用它继续发消息。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    const response = await fetch(`/api/providers/${selectedId}`, { method: "DELETE" });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ? t(data.error) : t("删除失败"));
      return;
    }
    await onChanged();
    setSelectedId("new");
    setForm(emptyForm());
  }

  async function syncModels() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      if (officialForm) {
        const desktop = getDesktop();
        if (!desktop?.cliListModels) {
          setError(t("请用桌面版 AllAi 打开"));
          return;
        }
        const result = await desktop.cliListModels(officialForm.cliKind);
        if (!result.ok) {
          setError(t(result.error));
          return;
        }
        const incoming = result.models ?? [];
        setForm((current) => ({ ...current, models: incoming }));
        if (selectedId !== "new") {
          await fetch(`/api/providers/${selectedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ models: incoming }),
          });
          await onChanged();
        }
        setNotice(t("已同步 {n} 个模型", { n: incoming.length }));
        return;
      }
      if (selectedId === "new") {
        setError(t("请先保存服务，再从接口同步模型"));
        return;
      }
      const response = await fetch(`/api/providers/${selectedId}/models`, { method: "POST" });
      const data = (await response.json()) as { error?: string; models?: ModelRef[] };
      if (!response.ok) {
        setError(data.error ? t(data.error) : t("同步失败"));
        return;
      }
      const incoming = data.models ?? [];
      setForm((current) => ({ ...current, models: incoming }));
      setNotice(t("已同步 {n} 个模型，确认后点保存", { n: incoming.length }));
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("同步失败"));
    } finally {
      setSyncing(false);
    }
  }

  const current = selectedId === "new" ? null : providers.find((item) => item.id === selectedId);
  // 当前编辑的是哪个官方登录服务（Claude 账号 / Grok 账号），不是就 null。
  const officialForm = OFFICIAL_CHATS.find((item) => item.auth === form.auth) ?? null;
  const status = officialForm ? officialStatus[officialForm.kind] : undefined;
  const busy = officialForm ? officialBusy === officialForm.kind : false;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      {/*
        固定高度，不跟着内容伸缩。以前是 max-h：切到「远程」时那一页先显示一行「读取中…」再撑开，
        对话框先缩成一小条再长回来，后面的页面露出来，看着像闪了一下（Agent 页在后面最明显）。
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[min(92vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-line bg-canvas sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              {t("设置")}
            </h2>
            <p className="text-sm text-muted">
              {t("模型与接口、Agent 官方登录、远程控制都在这里；本机 CLI 的版本和更新在「关于」。")}
            </p>
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

        <div className="border-b border-line px-5 py-2">
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
            {(
              [
                // 通用放第一个；聊天模型 / Agent 接口 / 生图视频都是「接模型」，收进一个入口再分二级。
                ["general", t("通用")],
                ["models", t("模型与接口")],
                ["skills", "Skills"],
                ["usage", t("使用统计")],
                ["remote", t("远程")],
                ["about", t("关于")],
              ] as const
            ).map(([id, label]) => {
              const selected = id === "models" ? MODEL_TABS.includes(tab) : tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id === "models" ? (MODEL_TABS.includes(tab) ? tab : "chat") : id)}
                  className={`rounded-xl px-2 py-2 text-sm ${
                    selected ? "bg-user font-medium" : "text-muted hover:bg-user/70"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {MODEL_TABS.includes(tab) ? (
            <div className="mt-2 flex gap-1 rounded-xl bg-user/50 p-1">
              {(
                [
                  ["chat", t("聊天模型")],
                  ["agents", t("Agent 接口")],
                  ["imagine", t("生图视频")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-sm ${
                    tab === id ? "bg-elevated font-medium shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {tab === "about" ? (
          <AboutSettings />
        ) : tab === "general" && prefs && onPrefs ? (
          <GeneralSettings agents={agents} providers={providers} prefs={prefs} onChange={onPrefs} onToast={onToast}   themeMode={themeMode}
          onThemeMode={onThemeMode}
          langMode={langMode}
          onLangMode={onLangMode}
        />
        ) : tab === "remote" ? (
          <RemoteSettings onToast={onToast} />
        ) : tab === "usage" ? (
          <UsageStats onToast={onToast} providers={providers} prefs={prefs} />
        ) : tab === "imagine" && prefs && onPrefs ? (
          <ImagineSettings providers={providers} prefs={prefs} onChange={onPrefs} />
        ) : tab === "skills" && onReloadSkills ? (
          <SkillsPanel skills={skills} onReload={onReloadSkills} onToast={onToast || (() => undefined)} />
        ) : tab === "agents" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_1fr]">
            <aside className="border-b border-line p-3 md:border-b-0 md:border-r">
              {/* 全局提供商排在最前：配一次，下面所有 Agent 都能选。 */}
              <button
                type="button"
                onClick={() => setAgentId(GLOBAL_ID)}
                className={`mb-2 w-full rounded-xl px-3 py-2 text-left ${
                  agentId === GLOBAL_ID ? "bg-user" : "hover:bg-user/70"
                }`}
              >
                <div className="truncate text-sm font-medium">{t("全局提供商")}</div>
                <div className="truncate text-[11px] text-muted">{t("所有 Agent 共用")}</div>
              </button>
              {agents.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted">{t("还没有 Agent")}</p>
              ) : (
                agents.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAgentId(item.id)}
                    className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${
                      agentId === item.id ? "bg-user" : "hover:bg-user/70"
                    }`}
                  >
                    <div className="truncate text-sm font-medium">{item.name}</div>
                    <div className="truncate text-[11px] text-muted">
                      {(item.endpoints?.length || 0) > 0
                        ? t("{n} 个接口", { n: item.endpoints.length })
                        : item.authMode === "api"
                          ? t("第三方接口")
                          : t("官方登录")}
                    </div>
                  </button>
                ))
              )}
            </aside>
            <div className="min-h-0 overflow-y-auto p-5">
              {agentId === GLOBAL_ID ? (
                <GlobalEndpointsPanel
                  onChanged={onChangedAgents ?? (() => undefined)}
                  onToast={onToast}
                  icons={prefs?.brandIcons ?? {}}
                  onIcons={(brandIcons) => onPrefs?.({ brandIcons })}
                />
              ) : selectedAgent && onChangedAgents ? (
                <AgentSettingsPanel
                  key={selectedAgent.id}
                  agent={selectedAgent}
                  onChanged={onChangedAgents}
                  onLogin={onLogin}
                  onToast={onToast}
                  icons={prefs?.brandIcons ?? {}}
                  onIcons={(brandIcons) => onPrefs?.({ brandIcons })}
                />
              ) : (
                <p className="text-sm text-muted">{t("没有可配置的 Agent。")}</p>
              )}
            </div>
          </div>
        ) : (
        <>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_1fr]">
          <aside className="border-b border-line p-3 md:border-b-0 md:border-r">
            <button
              type="button"
              onClick={() => {
                setSelectedId("new");
                setForm(emptyForm());
                setError("");
                setNotice("");
                setIconDraft("");
              }}
              className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${
                selectedId === "new" ? "bg-user" : "hover:bg-user/70"
              }`}
            >
              <Plus className="size-4" />
              {t("添加服务")}
            </button>
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => selectProvider(provider.id)}
                className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${
                  selectedId === provider.id ? "bg-user" : "hover:bg-user/70"
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ServiceIcon
                    providerId={provider.id}
                    baseUrl={provider.baseUrl}
                    icons={prefs?.brandIcons ?? {}}
                    className="size-4"
                  />
                  <span className="truncate text-sm font-medium">{t(provider.name)}</span>
                </div>
                <div className="truncate text-[11px] text-muted">
                  {officialSpecForProvider(provider)
                    ? officialStatus[officialSpecForProvider(provider)!.kind]?.loggedIn
                      ? t("已登录 · {n} 个模型", { n: provider.models.length })
                      : t("官方登录")
                    : t("{n} 个模型", { n: provider.models.length })}
                </div>
              </button>
            ))}
          </aside>

          <div className="min-h-0 overflow-y-auto p-5">
            {selectedId === "new" ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {PROVIDER_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => applyTemplate(template.name)}
                    className="rounded-full border border-line px-3 py-1 text-xs transition-colors duration-150 hover:bg-user"
                  >
                    {t(template.name)}
                  </button>
                ))}
              </div>
            ) : null}

            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">{t("名称")}</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={t("例如 SpaceXAI")}
                className="w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>

            {officialForm ? (
              <div className="mb-4 rounded-2xl border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("官方登录")}</div>
                    <p className="text-xs text-muted">
                      {busy
                        ? t("请在打开的浏览器里完成授权，成功后这里会变成已登录")
                        : status?.loggedIn
                          ? status.email || status.account || t("已登录{name}", { name: officialForm.name })
                          : status && !status.installed
                            ? t("未检测到 {name}，请先安装对应的命令行", { name: officialForm.cliName })
                            : t(officialForm.loggedOutHint)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {status?.loggedIn ? (
                      <>
                        <button
                          type="button"
                          disabled
                          className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-100"
                        >
                          {t("已登录")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onOfficialLogout?.(officialForm.kind)}
                          className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-user disabled:opacity-50"
                        >
                          {t("退出登录")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || (status ? !status.installed : false) || !onOfficialLogin}
                        onClick={() => {
                          void Promise.resolve(onOfficialLogin?.(officialForm.kind)).then(
                            () => void syncModels(),
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-50"
                      >
                        <LogIn className="size-3.5" />
                        {busy ? t("正在登录…") : t("登录{name}", { name: officialForm.name })}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {officialForm ? null : (
            <>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">{t("接口地址")}</span>
              <input
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, baseUrl: event.target.value }))
                }
                placeholder="https://api.x.ai/v1"
                className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
              <span className="mt-1 block text-xs text-muted">
                {t("需要包含版本路径，例如 /v1。兼容 OpenAI Chat Completions 的服务都可以接。")}
              </span>
            </label>

            <label className="mb-4 block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium">API Key</span>
                {current?.hasKey && !form.clearKey ? (
                  <button
                    type="button"
                    onClick={() => setForm((item) => ({ ...item, apiKey: "", clearKey: true }))}
                    className="text-xs text-danger hover:underline"
                  >
                    {t("清除已保存的 Key")}
                  </button>
                ) : null}
              </div>
              <input
                type="password"
                value={form.apiKey}
                onChange={(event) =>
                  setForm((item) => ({
                    ...item,
                    apiKey: event.target.value,
                    clearKey: event.target.value ? false : item.clearKey,
                  }))
                }
                placeholder={
                  form.clearKey
                    ? t("保存后清空")
                    : current?.hasKey
                      ? t("已保存 {masked}", { masked: current.apiKeyMasked })
                      : "sk-..."
                }
                className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
              <span className="mt-1 block text-xs text-muted">
                {form.clearKey
                  ? t("点保存后这个服务就没有 Key 了，可以直接填新的覆盖。")
                  : t("密钥只保存在本机，不会发到浏览器页面里。")}
              </span>
            </label>
            </>
            )}

            <ProviderIconField
              key={selectedId}
              ownerId={selectedId}
              icon={
                selectedId === "new"
                  ? iconDraft
                  : prefs?.brandIcons?.[providerIconKey(selectedId)] || ""
              }
              onIcon={(icon) => {
                if (selectedId === "new") setIconDraft(icon);
                else patchProviderIcon(selectedId, icon);
              }}
              autoSource={officialForm ? "" : form.baseUrl}
              auto={!officialForm && selectedId === "new"}
              onToast={onToast}
            />

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium">{t("模型")}</span>
                <button
                  type="button"
                  onClick={syncModels}
                  disabled={syncing}
                  className="text-xs text-accent hover:underline disabled:opacity-50"
                >
                  {syncing ? t("同步中…") : officialForm ? t("从官方同步") : t("从接口同步")}
                </button>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                {form.models.length === 0 ? (
                  <span className="text-sm text-muted">{t("还没有模型，手动添加或同步。")}</span>
                ) : (
                  form.models.map((model) => (
                    <span
                      key={model.id}
                      className="inline-flex items-center gap-1 rounded-full bg-user py-1 pl-1.5 pr-2.5 text-xs"
                    >
                      <ModelIcon
                        modelId={model.id}
                        baseUrl={form.baseUrl}
                        icons={prefs?.brandIcons ?? {}}
                        className="size-3.5"
                      />
                      {model.label}
                      <button
                        type="button"
                        aria-label={t("移除 {name}", { name: model.label })}
                        onClick={() => removeModel(model.id)}
                        className="text-muted hover:text-ink"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addModel();
                    }
                  }}
                  placeholder={t("输入模型 ID，例如 grok-4.6")}
                  className="flex-1 rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={addModel}
                  className="rounded-xl border border-line px-3 text-sm hover:bg-user"
                >
                  {t("添加")}
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">
                {t("识别不到的模型可在下面填写推理档位，逗号分隔，例如 none,low,medium,high。留空则自动识别，默认均衡 medium。")}
              </p>
              <div className="mt-2 space-y-2">
                {form.models.map((model) => (
                  <label key={model.id} className="block">
                    <span className="mb-1 block text-[11px] text-muted">
                      {model.label || model.id} · {t("自动")}{" "}
                      {detectReasoning(model.id).levels.map((item) => item.id).join("/") || t("无")}
                    </span>
                    <input
                      value={(model.reasoningLevels || []).join(",")}
                      onChange={(event) => {
                        const reasoningLevels = event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean);
                        setForm((current) => ({
                          ...current,
                          models: current.models.map((entry) =>
                            entry.id === model.id ? { ...entry, reasoningLevels } : entry,
                          ),
                        }));
                      }}
                      placeholder={t("留空=自动识别")}
                      className="w-full rounded-xl border border-line bg-elevated px-3 py-1.5 font-mono text-xs outline-none focus:border-accent"
                    />
                  </label>
                ))}
              </div>
            </div>

            {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
            {notice ? <p className="mb-3 text-sm text-accent">{notice}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-canvas disabled:opacity-50"
              >
                {saving ? t("保存中…") : t("保存")}
              </button>
              {selectedId !== "new" ? (
                <button
                  type="button"
                  onClick={remove}
                  className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm text-danger hover:bg-user"
                >
                  <Trash2 className="size-4" />
                  {t("删除服务")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        </>
        )}
        <div className="border-t border-line px-5 py-2.5 text-xs text-muted">
          AllAi
        </div>
      </div>
    </div>
  );
}
