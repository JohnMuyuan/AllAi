"use client";

import { ChevronRight, Globe, LogIn, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { kindInfo } from "@/lib/agents";
import { providerIconKey, writeProviderIcon, type BrandIcons } from "@/lib/brand";
import { getDesktop } from "@/lib/desktop";
import { detectReasoning } from "@/lib/reasoning";
import { officialModelsNeedRefresh, syncAgentEndpointModels } from "@/lib/sync-agent-models";
import type { AgentAuthMode, AgentKind, PublicAgent, PublicEndpoint } from "@/lib/types";
import type { CliAuthKind, CliAuthStatus } from "@/types/desktop";
import { useT } from "./I18n";
import { ProviderIconField } from "./ProviderIconField";

type Props = {
  agent: PublicAgent;
  onChanged: () => Promise<unknown>;
  onLogin?: (agentId: string) => void;
  onToast?: (text: string) => void;
  icons?: BrandIcons;
  onIcons?: (icons: BrandIcons) => void;
};

function isCliAuthKind(kind: AgentKind): kind is CliAuthKind {
  return kind === "grok-build" || kind === "claude-code" || kind === "codex";
}

type EndpointDraft = PublicEndpoint & { apiKey: string };

function draftsFrom(agent: PublicAgent): EndpointDraft[] {
  const list =
    agent.endpoints?.length > 0
      ? agent.endpoints
      : [
          {
            id: crypto.randomUUID(),
            label: agent.authMode === "api" ? "第三方接口" : "官方登录",
            mode: agent.authMode,
            baseUrl: agent.baseUrl,
            model: agent.model,
            hasKey: agent.hasKey,
            apiKeyMasked: agent.apiKeyMasked,
          },
        ];
  return list.map((item) => ({ ...item, apiKey: "" }));
}

export function AgentSettingsPanel({ agent, onChanged, onLogin, onToast, icons = {}, onIcons }: Props) {
  const t = useT();
  const info = kindInfo(agent.kind);
  const [name, setName] = useState(agent.name);
  const [command, setCommand] = useState(agent.command);
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(() => draftsFrom(agent));
  const [activeId, setActiveId] = useState(
    agent.activeEndpointId || endpoints[0]?.id || "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [freshIds, setFreshIds] = useState<Record<string, true>>({});
  const [modelsOpen, setModelsOpen] = useState<Record<string, boolean>>({});
  const iconsRef = useRef(icons);
  useEffect(() => {
    iconsRef.current = icons;
  }, [icons]);
  const [authStatus, setAuthStatus] = useState<CliAuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const officialSyncTried = useRef(false);

  useEffect(() => {
    if (!isCliAuthKind(agent.kind)) return;
    const desktop = getDesktop();
    if (!desktop?.cliAuthStatus) return;
    let alive = true;
    const tick = () => {
      void desktop.cliAuthStatus(agent.kind as CliAuthKind, command).then((status) => {
        if (alive) setAuthStatus(status);
      });
    };
    tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [agent.kind, authBusy, command]);

  function updateEndpoint(id: string, patch: Partial<EndpointDraft>) {
    setEndpoints((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addEndpoint(mode: AgentAuthMode) {
    const draft: EndpointDraft = {
      id: crypto.randomUUID(),
      label: mode === "official" ? t("官方登录") : t("接口 {n}", { n: endpoints.length + 1 }),
      mode,
      apiKey: "",
      baseUrl: "",
      model: "",
      hasKey: false,
      apiKeyMasked: "",
      models: [],
    };
    setEndpoints((current) => [...current, draft]);
    setActiveId(draft.id);
    setFreshIds((current) => ({ ...current, [draft.id]: true }));
  }

  function patchEndpointIcon(id: string, icon: string) {
    if (!onIcons) return;
    const next = writeProviderIcon(iconsRef.current, id, icon);
    iconsRef.current = next;
    onIcons(next);
  }

  function removeEndpoint(id: string) {
    setEndpoints((current) => {
      const next = current.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next[0]?.id || "");
      return next;
    });
  }

  async function save(nextActiveId = activeId) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!endpoints.length) {
        setError(t("至少保留一个接口"));
        return false;
      }
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          command,
          activeEndpointId: nextActiveId,
          // 选中的是全局接口时，它的模型记在这个 Agent 自己身上 —— 全局共用 key，
          // 但各 Agent 可以用不同模型。
          model:
            endpoints.find((item) => item.id === nextActiveId)?.model ?? agent.model,
          endpoints: endpoints.map((item) => ({
            id: item.id,
            label: item.label.trim() || "接口",
            mode: item.mode,
            global: item.global,
            baseUrl: item.baseUrl,
            model: item.model,
            models: item.models,
            ...(item.apiKey.trim() ? { apiKey: item.apiKey.trim() } : {}),
          })),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ? t(data.error) : t("保存失败"));
        return false;
      }
      await onChanged();
      setNotice(t("已保存"));
      return true;
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("保存失败"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function syncEndpoint(id: string, keepNotice = "") {
    setError("");
    if (!keepNotice) setNotice("");
    setSaving(true);
    try {
      const models = await syncAgentEndpointModels(agent, id);
      const current = endpoints.find((item) => item.id === id);
      const keep = current?.model && models.some((row) => row.id === current.model) ? current.model : models[0]?.id || "";
      updateEndpoint(id, { models, model: keep });
      await onChanged();
      setNotice(
        keepNotice
          ? t("{keep}，已同步 {n} 个模型", { keep: t(keepNotice), n: models.length })
          : t("已同步 {n} 个模型", { n: models.length }),
      );
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t("同步失败"));
      if (keepNotice) setNotice(keepNotice);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!authStatus?.loggedIn || authBusy || officialSyncTried.current) return;
    if (!isCliAuthKind(agent.kind)) return;
    const target = endpoints.find(
      (item) => item.mode === "official" && officialModelsNeedRefresh(agent.kind, item.models),
    );
    if (!target) return;
    officialSyncTried.current = true;
    const id = target.id;
    // 推到下一个微任务再跑：syncEndpoint 会同步 setState，直接调会连锁重渲染。
    void Promise.resolve().then(() => syncEndpoint(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在登录后补一次，officialSyncTried already gates it
  }, [agent.kind, authBusy, authStatus?.loggedIn, endpoints]);

  async function loginOfficial(endpointId: string) {
    if (!isCliAuthKind(agent.kind)) {
      if (!onLogin) return;
      setActiveId(endpointId);
      const ok = await save(endpointId);
      if (ok) onLogin(agent.id);
      return;
    }
    const desktop = getDesktop();
    if (!desktop?.cliAuthLogin) {
      onToast?.(t("请用桌面版 AllAi 打开"));
      return;
    }
    setActiveId(endpointId);
    setAuthBusy(true);
    setError("");
    setNotice("");
    onToast?.(t("请在浏览器里完成授权"));
    try {
      const ok = await save(endpointId);
      if (!ok) return;
      const result = await desktop.cliAuthLogin(agent.kind, command);
      const status = await desktop.cliAuthStatus(agent.kind, command).catch(() => null);
      if (status) setAuthStatus(status);
      if (result.ok && status?.loggedIn) {
        setNotice(t("已登录"));
        onToast?.(t("{name} 已登录", { name: info.title }));
        officialSyncTried.current = true;
        await syncEndpoint(endpointId, "已登录");
      } else {
        const message = result.ok ? t("没有检测到登录成功，请再点一次登录") : t(result.error);
        setError(message);
        onToast?.(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function logoutOfficial() {
    if (!isCliAuthKind(agent.kind)) return;
    const desktop = getDesktop();
    if (!desktop?.cliAuthLogout) {
      onToast?.(t("请用桌面版 AllAi 打开"));
      return;
    }
    setAuthBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await desktop.cliAuthLogout(agent.kind, command);
      const status = await desktop.cliAuthStatus(agent.kind, command).catch(() => null);
      if (status) setAuthStatus(status);
      if (!result.ok) {
        setError(t(result.error));
        onToast?.(t(result.error));
        return;
      }
      setNotice(t("已退出登录"));
      onToast?.(t("已退出 {name}", { name: info.title }));
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{info.title}</h3>
        <p className="text-xs text-muted">{t(info.blurb)}</p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{t("显示名称")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{t("可执行文件")}</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={t("留空则自动检测 {bin}", { bin: info.bin || t("命令") })}
          className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("接口")}</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => addEndpoint("official")}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-user"
            >
              <Plus className="size-3" />
              {t("官方登录")}
            </button>
            <button
              type="button"
              onClick={() => addEndpoint("api")}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-user"
            >
              <Plus className="size-3" />
              {t("第三方接口")}
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">
          {t("用备注区分多个第三方接口。当前选中的接口会用于新工作。")}
        </p>
        <div className="space-y-3">
          {endpoints.map((item) => {
            const active = item.id === activeId;
            return (
              <div
                key={item.id}
                className={`rounded-2xl border p-3 ${
                  active ? "border-accent bg-user/60" : "border-line"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {item.global ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium">
                      <Globe className="size-3.5 shrink-0 text-muted" />
                      {item.label}
                      <span className="shrink-0 rounded-full bg-user px-1.5 py-0.5 text-[10px] text-muted">
                        {t("全局")}
                      </span>
                    </span>
                  ) : (
                    <input
                      value={item.label}
                      onChange={(event) =>
                        updateEndpoint(item.id, { label: event.target.value })
                      }
                      placeholder={t("备注")}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className="rounded-full border border-line px-2.5 py-1 text-[11px] hover:bg-elevated"
                  >
                    {active ? t("当前使用") : t("设为当前")}
                  </button>
                  {endpoints.length > 1 && !item.global ? (
                    <button
                      type="button"
                      aria-label={t("删除接口")}
                      onClick={() => removeEndpoint(item.id)}
                      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className={`mb-2 grid-cols-2 gap-2 ${item.global ? "hidden" : "grid"}`}>
                  <button
                    type="button"
                    onClick={() =>
                      updateEndpoint(item.id, {
                        mode: "official",
                        apiKey: "",
                        baseUrl: "",
                        label:
                          item.label === "第三方接口" || item.label === "默认接口"
                            ? "官方登录"
                            : item.label,
                      })
                    }
                    className={`rounded-xl border px-3 py-1.5 text-xs ${
                      item.mode === "official"
                        ? "border-accent bg-elevated"
                        : "border-line hover:bg-elevated"
                    }`}
                  >
                    {t("官方登录")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateEndpoint(item.id, {
                        mode: "api",
                        label: item.label === "官方登录" ? "第三方接口" : item.label,
                      })
                    }
                    className={`rounded-xl border px-3 py-1.5 text-xs ${
                      item.mode === "api"
                        ? "border-accent bg-elevated"
                        : "border-line hover:bg-elevated"
                    }`}
                  >
                    {t("API / 第三方")}
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-muted">
                  {item.mode === "official"
                    ? authBusy
                      ? t("请在打开的浏览器里完成授权，成功后这里会变成已登录")
                      : authStatus?.loggedIn
                        ? `${authStatus.email || authStatus.account || t("官方账号")}`
                        : authStatus && !authStatus.installed
                          ? t("未检测到 {name}，请先安装命令行", { name: info.bin || info.title })
                          : t(info.officialHint)
                    : t(info.apiHint)}
                </p>
                {item.mode === "official" && isCliAuthKind(agent.kind) ? (
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {authStatus?.loggedIn ? (
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
                          disabled={authBusy}
                          onClick={() => void logoutOfficial()}
                          className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-elevated disabled:opacity-50"
                        >
                          {t("退出登录")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={authBusy || (authStatus !== null && !authStatus.installed)}
                        onClick={() => void loginOfficial(item.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-50"
                      >
                        <LogIn className="size-3.5" />
                        {authBusy ? t("正在登录…") : t("登录 {name}", { name: info.title })}
                      </button>
                    )}
                  </div>
                ) : item.mode === "official" && onLogin ? (
                  <button
                    type="button"
                    onClick={() => void loginOfficial(item.id)}
                    className="mb-1 inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-elevated"
                  >
                    <LogIn className="size-3.5" />
                    {t("打开官方登录")}
                  </button>
                ) : null}
                {item.mode === "api" && item.global ? (
                  <p className="rounded-xl border border-dashed border-line px-3 py-2 text-[11px] text-muted">
                    {item.hasKey ? `Key ${item.apiKeyMasked}　` : t("还没填 Key")}
                    {item.baseUrl || t("还没填地址")}
                    <br />
                    {t("来自全局提供商，改它去「Agent 接口 → 全局提供商」，改一次三个 Agent 都变。")}
                  </p>
                ) : item.mode === "api" ? (
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={item.apiKey}
                      onChange={(event) =>
                        updateEndpoint(item.id, { apiKey: event.target.value })
                      }
                      placeholder={item.hasKey ? t("已保存 {masked}", { masked: item.apiKeyMasked }) : "sk-..."}
                      className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                    />
                    <input
                      value={item.baseUrl}
                      onChange={(event) =>
                        updateEndpoint(item.id, { baseUrl: event.target.value })
                      }
                      placeholder={info.baseUrlPlaceholder}
                      className="w-full rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                    />
                    <ProviderIconField
                      key={item.id}
                      ownerId={item.id}
                      icon={icons[providerIconKey(item.id)] || ""}
                      onIcon={(icon) => patchEndpointIcon(item.id, icon)}
                      autoSource={item.baseUrl}
                      auto={Boolean(freshIds[item.id])}
                      onToast={onToast}
                    />
                  </div>
                ) : null}
                {item.mode === "api" || item.mode === "official" ? (
                  <div className={`${item.mode === "api" ? "mt-2 " : ""}space-y-2`}>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setModelsOpen((current) => ({
                            ...current,
                            [item.id]: !(item.id in current ? current[item.id] : (item.models?.length ?? 0) <= 8),
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium"
                      >
                        <ChevronRight
                          className={`size-3.5 transition-transform ${
                            (item.id in modelsOpen ? modelsOpen[item.id] : (item.models?.length ?? 0) <= 8)
                              ? "rotate-90"
                              : ""
                          }`}
                        />
                        {t("模型")}
                        {(item.models?.length ?? 0) > 0 ? ` · ${item.models?.length}` : ""}
                      </button>
                      <button
                        type="button"
                        hidden={item.global}
                        onClick={() => void syncEndpoint(item.id)}
                        disabled={
                          saving ||
                          (item.mode === "api" && !item.hasKey && !item.apiKey) ||
                          (item.mode === "official" && authStatus !== null && !authStatus.installed)
                        }
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-40"
                      >
                        <RefreshCw className="size-3" />
                        {saving ? t("同步中…") : item.mode === "official" ? t("从官方同步") : t("从接口同步")}
                      </button>
                    </div>
                    {(item.id in modelsOpen ? modelsOpen[item.id] : (item.models?.length ?? 0) <= 8) ? (
                    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                      {(item.models ?? []).length === 0 ? (
                        <span className="text-xs text-muted">{t("还没有模型，同步或手动添加。删掉后点保存。")}</span>
                      ) : (
                        (item.models ?? []).map((model) => (
                          <span
                            key={model.id}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                              item.model === model.id ? "bg-elevated ring-1 ring-accent" : "bg-user"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => updateEndpoint(item.id, { model: model.id })}
                            >
                              {model.label || model.id}
                            </button>
                            <button
                              type="button"
                              aria-label={t("移除 {name}", { name: model.label || model.id })}
                              onClick={() =>
                                updateEndpoint(item.id, {
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
                    ) : (
                      <p className="text-xs text-muted">
                        {t("已收起 {n} 个模型", { n: item.models?.length ?? 0 })}
                        {item.model ? ` · ${item.model}` : ""}
                      </p>
                    )}
                    {(item.id in modelsOpen ? modelsOpen[item.id] : (item.models?.length ?? 0) <= 8) ? (
                    <>
                    <div className="flex gap-2">
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
                          updateEndpoint(item.id, {
                            models: [...(item.models ?? []), { id, label: id }],
                            model: item.model || id,
                          });
                          setModelDrafts((current) => ({ ...current, [item.id]: "" }));
                        }}
                        placeholder={t("输入模型 ID 后回车添加")}
                        className="min-w-0 flex-1 rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                      />
                    </div>
                    {(item.models ?? []).length ? (
                      <div className="space-y-2">
                        <p className="text-[11px] text-muted">
                          {t("思考强度按模型名自动识别。识别不到可自己填档位，逗号分隔。")}
                        </p>
                        {(item.models ?? []).map((model) => (
                          <label key={model.id} className="block">
                            <span className="mb-1 block text-[11px] text-muted">
                              {model.label || model.id} · {t("自动")}{" "}
                              {detectReasoning(model.id).levels.map((row) => row.id).join("/") || t("无")}
                            </span>
                            <input
                              value={(model.reasoningLevels || []).join(",")}
                              onChange={(event) => {
                                const reasoningLevels = event.target.value
                                  .split(",")
                                  .map((row) => row.trim())
                                  .filter(Boolean);
                                updateEndpoint(item.id, {
                                  models: (item.models ?? []).map((row) =>
                                    row.id === model.id
                                      ? { ...row, reasoningLevels: reasoningLevels.length ? reasoningLevels : undefined }
                                      : row,
                                  ),
                                });
                              }}
                              placeholder={t("留空则自动识别")}
                              className="w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                    </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-accent">{notice}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-canvas disabled:opacity-50"
      >
        {saving ? t("保存中…") : t("保存")}
      </button>
    </div>
  );
}
