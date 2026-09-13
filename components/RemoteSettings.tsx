"use client";

import { Check, Copy, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { getDesktop } from "@/lib/desktop";
import type { RemoteConfig } from "@/types/desktop";
import { useConfirm } from "./ConfirmDialog";
import { useLang, useT } from "./I18n";
import { useRemoteStatus } from "./useRemoteControl";

/**
 * 设置 → 远程。用手机网页操控电脑上的 AllAi。
 * 中继部署在用户自己的服务器上，手机和电脑之间端到端加密，见 docs/REMOTE.md。
 */

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5 border-b border-line pb-5 last:border-b-0">
      <div className="mb-1.5 text-sm font-medium">{title}</div>
      {hint ? <div className="mb-3 text-xs leading-5 text-muted">{hint}</div> : null}
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="mb-2 flex w-full items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-user/50"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent" : "bg-user"
        }`}
      >
        <span
          className={`size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs leading-5 text-muted">{description}</span>
      </span>
    </button>
  );
}

function when(at: number | undefined, lang: string, neverLabel: string) {
  if (!at) return neverLabel;
  const date = new Date(at);
  if (lang === "en") {
    return date.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

const inputClass =
  "w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm outline-none focus:border-accent";

/** 再切到这一页时先用上次读到的配置画出来，不先闪一下「读取中…」。 */
let cachedConfig: RemoteConfig | null = null;

export function RemoteSettings({ onToast }: { onToast?: (text: string) => void }) {
  const t = useT();
  const lang = useLang();
  const confirm = useConfirm();
  const status = useRemoteStatus();
  const [config, setConfig] = useState<RemoteConfig | null>(cachedConfig);
  const [relayUrl, setRelayUrl] = useState(cachedConfig?.relayUrl ?? "");
  const [token, setToken] = useState("");
  const [name, setName] = useState(cachedConfig?.desktopName ?? "");
  const [saving, setSaving] = useState(false);
  const [pair, setPair] = useState<{ link: string; qr: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<{ at: number; device: string; action: string }[]>([]);
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);

  const apply = useCallback((next: RemoteConfig) => {
    cachedConfig = next;
    setConfig(next);
    setRelayUrl(next.relayUrl);
    setName(next.desktopName);
  }, []);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.remoteConfig) return;
    void desktop.remoteConfig().then(apply);
    void desktop.remoteLog().then(setLog);
    return desktop.onRemotePaired((device) => {
      setPair(null);
      toast(t("「{name}」已配对", { name: device.name }));
      void desktop.remoteConfig().then(apply);
      void desktop.remoteLog().then(setLog);
    });
  }, [apply, t, toast]);

  // 设备上线/下线时刷新一下列表和日志（最近连接时间会变）。
  const sessionKey = status?.sessions.map((item) => item.id).join(",") ?? "";
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.remoteConfig || !sessionKey) return;
    void desktop.remoteConfig().then(apply);
    void desktop.remoteLog().then(setLog);
  }, [apply, sessionKey]);

  useEffect(() => {
    if (!pair) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current > pair.expiresAt) setPair(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pair]);

  const desktop = getDesktop();
  if (!desktop?.remoteConfig) {
    return <div className="p-5 text-sm text-muted">{t("远程控制只能在桌面版 AllAi 里设置。")}</div>;
  }
  if (!config) return <div className="p-5 text-sm text-muted">{t("读取中…")}</div>;

  async function save(patch: Parameters<NonNullable<typeof desktop>["remoteSave"]>[0]) {
    const api = getDesktop();
    if (!api) return false;
    setSaving(true);
    try {
      const result = await api.remoteSave(patch);
      if (!result.ok) {
        toast(t(result.error));
        return false;
      }
      apply(result.config);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function startPair() {
    const api = getDesktop();
    if (!api) return;
    const result = await api.remotePair();
    if (!result.ok) {
      toast(t(result.error));
      return;
    }
    const qr = await QRCode.toDataURL(result.link, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    setPair({ link: result.link, qr, expiresAt: result.expiresAt });
  }

  const online = new Set(status?.sessions.map((item) => item.id) ?? []);
  const state = status?.state ?? "off";
  const stateText =
    state === "online"
      ? `${t("已连上中继")}${status?.sessions.length ? ` · ${t("{n} 台设备在线", { n: status.sessions.length })}` : ""}`
      : state === "connecting"
        ? t(status?.error || "正在连接中继…")
        : state === "error"
          ? t(status?.error || "连接出错")
          : t("未开启");
  const dirty =
    relayUrl.trim().replace(/\/+$/, "") !== config.relayUrl || Boolean(token.trim()) || name.trim() !== config.desktopName;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <Section
        title={t("远程控制")}
        hint={
          <>
            {t("在手机浏览器里操控这台电脑上的 AllAi：聊天、Agent、创作都能用，电脑屏幕上会同步显示。消息经过你自己服务器上的中继转发，")}
            <strong>{t("手机和电脑之间端到端加密")}</strong>
            {t("，服务器只看得到密文。部署方法见项目里的 docs/REMOTE.md。")}
          </>
        }
      >
        <Toggle
          checked={config.enabled}
          onChange={(value) => void save({ enabled: value })}
          label={t("开启远程控制")}
          description={t("开着时 AllAi 会一直连着中继。电脑要保持开机、AllAi 不能退出。")}
        />
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${
              state === "online" ? "bg-emerald-500" : state === "error" ? "bg-danger" : state === "connecting" ? "bg-amber-500" : "bg-muted/40"
            }`}
          />
          <span className={state === "error" ? "text-danger" : "text-muted"}>{stateText}</span>
        </div>
      </Section>

      <Section title={t("中继服务器")} hint={t("填部署好的中继地址（https 开头）和启动中继时设置的 RELAY_TOKEN。")}>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-muted">
            {t("中继地址")}
            <input
              className={inputClass}
              value={relayUrl}
              placeholder="https://allai.example.com"
              onChange={(event) => setRelayUrl(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            {t("中继口令")}
            <input
              className={inputClass}
              type="password"
              value={token}
              placeholder={config.hasToken ? t("已保存（不改就留空）") : "RELAY_TOKEN"}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            {t("这台电脑在手机上显示的名字")}
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={async () => {
                const ok = await save({ relayUrl, token: token.trim() || undefined, desktopName: name });
                if (ok) {
                  setToken("");
                  toast(t("已保存"));
                }
              }}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              {saving ? t("保存中…") : t("保存")}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title={t("配对新设备")}
        hint={t("用手机相机扫码，在打开的网页里点「配对」。二维码 10 分钟内有效、只能用一次。别把它截图发给别人。")}
      >
        {pair ? (
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地生成的 data URL */}
            <img src={pair.qr} alt={t("配对二维码")} className="size-48 rounded-xl bg-white p-2" />
            <div className="min-w-0 flex-1 text-xs text-muted">
              <p className="mb-2">
                {t("还剩 {n} 分钟。扫不了码也可以把链接发到手机上打开。", {
                  n: Math.max(0, Math.ceil((pair.expiresAt - now) / 1000 / 60)),
                })}
              </p>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(pair.link);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 hover:bg-user"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? t("已复制") : t("复制链接")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void getDesktop()?.remoteCancelPair();
                    setPair(null);
                  }}
                  className="rounded-lg border border-line px-2.5 py-1.5 hover:bg-user"
                >
                  {t("作废")}
                </button>
              </div>
              {state !== "online" ? <p className="text-danger">{t("现在还没连上中继，手机扫了也配不上。")}</p> : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!config.relayUrl}
            onClick={() => void startPair()}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm hover:bg-user disabled:opacity-40"
          >
            <Smartphone className="size-4" />
            {t("生成配对二维码")}
          </button>
        )}
      </Section>

      <Section title={t("已配对的设备")} hint={t("移除后那台设备立刻断开，它存的密钥也就作废了，要用得重新扫码。")}>
        {config.devices.length ? (
          <ul className="grid gap-2">
            {config.devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${online.has(device.id) ? "bg-emerald-500" : "bg-muted/40"}`}
                  aria-label={online.has(device.id) ? t("在线") : t("离线")}
                />
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full truncate bg-transparent text-sm outline-none focus:underline"
                    defaultValue={device.name}
                    aria-label={t("设备名字")}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== device.name) {
                        void getDesktop()?.remoteRename(device.id, value).then(apply);
                      }
                    }}
                  />
                  <div className="text-[11px] text-muted">
                    {t("配对于")} {when(device.createdAt, lang, t("从未"))} · {t("最近连接")} {when(device.lastSeen, lang, t("从未"))}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("移除设备")}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("移除「{name}」？", { name: device.name }),
                      detail: t("它会立刻断开，以后要用得重新扫码配对。"),
                      confirmText: t("移除"),
                      danger: true,
                    });
                    if (!ok) return;
                    const next = await getDesktop()?.remoteRevoke(device.id);
                    if (next) apply(next);
                  }}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-user hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{t("还没有配对的设备。")}</p>
        )}
      </Section>

      <Section title={t("远程权限")} hint={t("只影响从手机发起的请求，电脑上自己操作不受影响。「操控电脑」不开放给远程。")}>
        <Toggle
          checked={config.caps.followPermission}
          onChange={(value) => void save({ caps: { followPermission: value } })}
          label={t("Agent 沿用电脑上的权限模式")}
          description={t("关掉后，远程发起的 Agent 任务里「全部放行」会降成「接受编辑」（Codex 降成「自动」）。")}
        />
        <Toggle
          checked={config.caps.allowAdmin}
          onChange={(value) => void save({ caps: { allowAdmin: value } })}
          label={t("允许远程用管理员身份运行")}
          description={t("默认关。打开后，电脑上开着管理员模式时，远程的请求也会以管理员身份跑本机 CLI。")}
        />
      </Section>

      <Section title={t("最近的远程操作")} hint={t("只记哪台设备在什么时候做了哪类操作，不记内容。")}>
        {log.length ? (
          <ul className="grid gap-1 text-xs">
            {log.slice(0, 30).map((item, index) => (
              <li key={`${item.at}-${index}`} className="flex gap-3 text-muted">
                <span className="w-20 shrink-0 tabular-nums">{when(item.at, lang, t("从未"))}</span>
                <span className="w-24 shrink-0 truncate text-ink">{item.device}</span>
                <span>{t(item.action)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{t("暂无。")}</p>
        )}
      </Section>
    </div>
  );
}
