import { ArrowLeft, ArrowUp, Download, ImagePlus, LoaderCircle, ScanLine, Square, WifiOff, X } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type Translate } from "../components/I18n";
import type { Attachment, DesktopLink } from "./link";
import { matchSlashCommands } from "../lib/cli-commands";
import { DEFAULT_COMPACT_PERCENT, contextStatus } from "../lib/context-window";
import type { AgentKind } from "../lib/types";

/* ---------------- 电脑推过来的状态（结构见 components/useRemoteControl.ts） ---------------- */

export type ModelOption = { key: string; label: string; group: string };
export type Choice = { value: string; label: string; description?: string };
/**
 * 上下文占用。
 *
 * `level` 只有电脑当前那条工作才带（界面算好的）；手机打开了别的工作时，
 * 主进程只发得出 used/limit 两个数（它引不到 lib/），颜色在这边自己算。
 */
export type ContextInfo = { used: number; limit: number; level?: string };
/** Agent 向用户提问（Claude Code 的 AskUserQuestion）。 */
export type AgentAsk = {
  questions: {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: { label: string; description?: string }[];
  }[];
};

export type Meta = {
  view: "chat" | "agents" | "studio";
  chat: {
    list: { id: string; title: string; updatedAt: number; preview?: string; modelKey: string }[];
    activeId: string | null;
    modelKey: string;
    models: ModelOption[];
    streaming: boolean;
    webSearch?: boolean;
    reasoning?: string;
    reasoningOptions?: Choice[];
    context?: ContextInfo;
  };
  agent: {
    list: {
      id: string;
      title: string;
      agentName: string;
      kind: string;
      cwd: string;
      updatedAt: number;
      running: boolean;
      /** 这条工作自己的型号和窗口上限 —— 手机看的是自己打开的那条，不跟电脑走。 */
      modelKey?: string;
      contextLimit?: number;
    }[];
    activeId: string | null;
    streaming: boolean;
    modelKey: string;
    agents: { id: string; name: string; kind: string; models: ModelOption[] }[];
    folders: string[];
    webSearch?: boolean;
    reasoning?: string;
    reasoningOptions?: Choice[];
    permission: Record<string, string>;
    permissionOptions?: Record<string, Choice[]>;
    context?: ContextInfo;
    compactPercent?: number;
  };
  studio: {
    list: { id: string; title: string; updatedAt: number }[];
    activeId: string | null;
    imageModels: ModelOption[];
    videoModels: ModelOption[];
    imageModelKey: string;
    videoModelKey: string;
  };
};

export type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "notice" | "system";
  content: string;
  reasoning?: string;
  steps?: { kind: "search" | "notice" | "error"; text: string }[];
  modelKey?: string;
  fromModelKey?: string;
  attachments?: Attachment[];
  computerRun?: string;
  computerGoal?: string;
  createdAt: number;
};

export type AgentMsg = {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  trace?: (
    | { type: "thinking"; text: string }
    | { type: "tool"; name: string; detail?: string; ask?: AgentAsk }
  )[];
  modelKey?: string;
  fromModelKey?: string;
  createdAt: number;
};

export type Thread<T> = { id: string | null; messages: T[] };

export type ThreadPatch = {
  area: "chat" | "agent";
  id: string | null;
  reset: boolean;
  order: string[];
  upsert: { id: string }[];
};

export function applyPatch<T extends { id: string }>(prev: Thread<T> | undefined, patch: ThreadPatch): Thread<T> {
  const map = new Map<string, T>(patch.reset || !prev || prev.id !== patch.id ? [] : prev.messages.map((m) => [m.id, m]));
  for (const message of patch.upsert as T[]) map.set(message.id, message);
  return { id: patch.id, messages: patch.order.map((id) => map.get(id)).filter((m): m is T => Boolean(m)) };
}

/* ---------------- 小工具 ---------------- */

export const Notify = createContext<(text: string) => void>(() => undefined);
export const useNotify = () => useContext(Notify);

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function timeAgo(at: number, t: Translate) {
  const diff = Date.now() - at;
  if (diff < 60_000) return t("刚刚");
  if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("{n} 小时前", { n: Math.floor(diff / 3_600_000) });
  const date = new Date(at);
  return t("{m}月{d}日", { m: date.getMonth() + 1, d: date.getDate() });
}

export function baseName(folder: string) {
  return folder.split(/[\\/]/).filter(Boolean).pop() || folder;
}

export function modelLabel(models: ModelOption[], key?: string) {
  if (!key) return "";
  return models.find((item) => item.key === key)?.label || key.slice(key.indexOf("::") + 2);
}

// 打开对话要直接到最新一条：滚动逻辑和桌面端共用一份，见那个文件里的说明。
export { useStickToBottom } from "@/components/useStickToBottom";

/* ---------------- 组件 ---------------- */

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-sidebar px-2">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={t("返回")} className="grid size-10 place-items-center rounded-lg">
          <ArrowLeft className="size-5" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{title}</div>
        {subtitle ? <div className="truncate text-[11px] text-muted">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelOption[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const groups = new Map<string, ModelOption[]>();
  for (const item of models) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const known = models.some((item) => item.key === value);
  return (
    <select
      value={known ? value : ""}
      disabled={disabled || !models.length}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-[60vw] truncate rounded-lg border border-line bg-elevated px-2 py-1 text-[13px]! disabled:opacity-50"
      aria-label={t("模型")}
    >
      {!known ? <option value="">{models.length ? t("选择模型") : t("没有可用模型")}</option> : null}
      {[...groups.entries()].map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function ToolChip({
  pressed,
  label,
  title,
  onClick,
  icon,
}: {
  pressed?: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={Boolean(pressed)}
      aria-label={title || label}
      onClick={onClick}
      className={`grid size-8 shrink-0 place-items-center rounded-lg ${
        pressed ? "bg-user text-ink" : "text-muted"
      }`}
    >
      {icon}
    </button>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sheet-backdrop fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="sheet-panel safe-bottom rounded-t-2xl bg-elevated p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="mb-3 text-base font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  title,
  detail,
  confirmText,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  detail?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet title={title} onClose={onClose}>
      {detail ? <p className="mb-4 text-sm leading-6 text-muted">{detail}</p> : null}
      <button
        type="button"
        onClick={onConfirm}
        className={`w-full rounded-xl py-2.5 text-[15px] font-medium ${
          danger ? "bg-danger text-white" : "bg-accent text-accent-fg"
        }`}
      >
        {confirmText ?? t("确定")}
      </button>
      <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-muted">
        {t("取消")}
      </button>
    </Sheet>
  );
}

export function Composer({
  link,
  busy,
  placeholder,
  onSend,
  onStop,
  files = true,
  top,
  sendLabel,
  agentKind,
}: {
  link: DesktopLink;
  busy: boolean;
  placeholder: string;
  onSend: (text: string, attachments: Attachment[]) => Promise<void>;
  onStop?: () => void;
  files?: boolean;
  top?: React.ReactNode;
  sendLabel?: string;
  /** 传了就有斜杠指令菜单（只给 Agent 用，聊天没有这回事）。 */
  agentKind?: string;
}) {
  const t = useT();
  const notify = useNotify();
  const send = sendLabel ?? t("发送");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  /** 选过 / 关过一次就别再弹，直到重新打出一个新的 `/`。 */
  const [dismissed, setDismissed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      setUploading((count) => count + 1);
      try {
        const item = await link.upload(file);
        setAttachments((current) => [...current, item]);
      } catch (error) {
        notify(t("上传失败：{error}", { error: t(errorText(error)) }));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  async function submit() {
    if (busy) {
      onStop?.();
      return;
    }
    const value = text.trim();
    if ((!value && !attachments.length) || uploading || sending) return;
    setSending(true);
    try {
      await onSend(value, attachments);
      setText("");
      setAttachments([]);
      setDismissed(false);
    } catch (error) {
      notify(t(errorText(error)));
    } finally {
      setSending(false);
    }
  }

  const canSend = busy || ((Boolean(text.trim()) || attachments.length > 0) && !uploading && !sending);
  /*
   * 打 `/` 弹出这家 CLI 认识的指令（和桌面 0.16.31 同一份目录）。
   * 手机上没有键盘方向键，所以只做「点一下填进去」，不做 ↑↓ 选择。
   */
  const slash =
    agentKind && !busy && !dismissed ? matchSlashCommands(agentKind as AgentKind, text) : null;
  return (
    <div className="safe-bottom shrink-0 border-t border-line bg-sidebar px-3 pt-2">
      {slash?.length ? (
        <div className="mb-2 max-h-52 overflow-y-auto rounded-xl border border-line bg-elevated">
          {slash.map((item) => (
            <button
              key={item.insert}
              type="button"
              onClick={() => {
                const next = item.needsArgs ? `${item.insert} ` : item.insert;
                setText(next);
                setDismissed(true);
                area.current?.focus();
              }}
              className="block w-full border-b border-line px-3 py-2 text-left last:border-b-0"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] text-accent">{item.insert}</span>
                <span className="truncate text-[13px] font-medium">{t(item.title)}</span>
              </span>
              <span className="mt-0.5 block text-[12px] leading-5 text-muted">{t(item.usage)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {top ? <div className="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto">{top}</div> : null}
      {attachments.length || uploading ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((item) => (
            <span key={item.id} className="relative">
              {item.kind === "image" ? (
                <RemoteMedia link={link} id={item.id} mime={item.mime} className="size-14 rounded-lg object-cover" />
              ) : (
                <span className="grid h-14 max-w-32 place-items-center truncate rounded-lg bg-user px-2 text-xs">
                  {item.name}
                </span>
              )}
              <button
                type="button"
                aria-label={t("移除")}
                onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-canvas"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {uploading ? (
            <span className="grid size-14 place-items-center rounded-lg bg-user">
              <LoaderCircle className="size-5 animate-spin text-muted" />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mb-2 flex items-end gap-2">
        {files ? (
          <>
            <button
              type="button"
              aria-label={t("添加图片")}
              onClick={() => picker.current?.click()}
              className="grid size-10 shrink-0 place-items-center rounded-xl text-muted"
            >
              <ImagePlus className="size-5" />
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void pick(event.target.files);
                event.target.value = "";
              }}
            />
          </>
        ) : null}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // 重新打出一个新的 `/` 开头就再弹一次
            if (dismissed && !next.startsWith(text)) setDismissed(false);
            else if (dismissed && next.length < text.length) setDismissed(false);
          }}
          className="min-h-10 flex-1 resize-none rounded-2xl border border-line bg-elevated px-3.5 py-2 leading-6 outline-none focus:border-accent"
        />
        <button
          type="button"
          aria-label={busy ? t("停止") : send}
          disabled={!canSend}
          onClick={() => void submit()}
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            busy ? "bg-ink text-canvas" : "bg-accent text-accent-fg"
          } disabled:opacity-35`}
        >
          {sending ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : busy ? (
            <Square className="size-4 fill-current" />
          ) : (
            <ArrowUp className="size-5" />
          )}
        </button>
      </div>
    </div>
  );
}

/** 电脑上的图片/视频：经加密通道取回，本地拼成 blob 显示。 */
export function RemoteMedia({
  link,
  id,
  mime,
  className,
  onOpen,
}: {
  link: DesktopLink;
  id: string;
  mime?: string;
  className?: string;
  onOpen?: (url: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    link
      .fileUrl(id)
      .then((value) => {
        if (alive) setUrl(value);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [link, id]);
  if (failed) return <div className={`grid place-items-center bg-user text-xs text-muted ${className}`}>{t("加载失败")}</div>;
  if (!url) return <div className={`animate-pulse bg-user ${className}`} />;
  if (mime?.startsWith("video/")) {
    return <video src={url} controls playsInline className={className} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 手机网页不是 Next 应用
    <img src={url} alt="" className={className} onClick={() => onOpen?.(url)} />
  );
}

export function Viewer({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose}>
      <div className="safe-top flex justify-end gap-2 p-2">
        <a
          href={url}
          download="allai-image"
          onClick={(event) => event.stopPropagation()}
          className="grid size-10 place-items-center rounded-full bg-white/10 text-white"
          aria-label={t("保存")}
        >
          <Download className="size-5" />
        </a>
        <button type="button" aria-label={t("关闭")} className="grid size-10 place-items-center rounded-full bg-white/10 text-white">
          <X className="size-5" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- 手机网页不是 Next 应用 */}
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

/**
 * 电脑那边的 AllAi 关掉了。
 *
 * 以前这种情况只在顶栏挂一条小字，底下还是上次同步下来的旧界面 —— 看着像好的，
 * 点什么都报错。现在整屏换掉，把「在重连」和「怎么换一台电脑」说清楚。
 */
export function Disconnected({
  name,
  connecting,
  onScan,
  onSwitch,
}: {
  name: string;
  /** 还在连中继（不是明确知道电脑离线），文案要软一点。 */
  connecting?: boolean;
  onScan?: () => void;
  onSwitch?: () => void;
}) {
  const t = useT();
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div className="max-w-sm">
        <WifiOff className={`mx-auto mb-4 size-10 ${connecting ? "text-muted" : "text-danger"}`} />
        <p className="text-base font-medium">
          {connecting ? t("正在连接「{name}」…", { name }) : t("与目标电脑上 AllAi 的连接已断开")}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          {connecting
            ? t("Remote Control 会不断尝试重连。")
            : t("「{name}」上的 AllAi 没有开着，或者它没连上中继。Remote Control 会不断尝试重连，一旦它回来就自动恢复。", { name })}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">{t("若您想配对其他电脑，请扫描二维码进行配对。")}</p>
        <div className="mt-6 grid gap-2">
          {onScan ? (
            <button
              type="button"
              onClick={onScan}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-fg"
            >
              <ScanLine className="size-4" />
              {t("扫码配对其他电脑")}
            </button>
          ) : (
            <p className="text-xs leading-5 text-muted">
              {t("用手机摄像头扫电脑上「设置 → 远程」里的二维码即可配对。")}
            </p>
          )}
          {onSwitch ? (
            <button
              type="button"
              onClick={onSwitch}
              className="w-full rounded-xl border border-line py-2.5 text-sm"
            >
              {t("换一台已配对的电脑")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 上下文占用条。手机上也要看得出来快满了，不然只会突然开始压缩。 */
export function ContextBar({ context, percent }: { context?: ContextInfo; percent?: number }) {
  const t = useT();
  if (!context?.limit) return null;
  const ratio = Math.min(1, context.used / context.limit);
  // 颜色的判定和电脑上同一份（lib/context-window.ts 是纯函数，手机能直接用）。
  const level =
    context.level || contextStatus(context.used, context.limit, percent || DEFAULT_COMPACT_PERCENT).level;
  const tone = level === "over" ? "bg-danger" : level === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={t("上下文占用")}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-line">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
      </span>
      <span className="text-[11px] text-muted">{Math.round(ratio * 100)}%</span>
    </span>
  );
}

export function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div>
        <div className="mx-auto mb-3 grid place-items-center text-muted">{icon}</div>
        <p className="text-base font-medium">{title}</p>
        {hint ? <p className="mt-2 text-sm leading-6 text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Typing() {
  return (
    <span className="inline-flex gap-1 py-2">
      <span className="size-1.5 animate-pulse rounded-full bg-muted" />
      <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
    </span>
  );
}

export function ListButton({
  title,
  subtitle,
  right,
  active,
  onClick,
  onMenu,
  busy,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
  onMenu?: () => void;
}) {
  const t = useT();
  const hold = useRef<number>(0);
  function startHold() {
    if (!onMenu) return;
    hold.current = window.setTimeout(() => {
      hold.current = 0;
      onMenu();
    }, 450);
  }
  function endHold() {
    if (hold.current) window.clearTimeout(hold.current);
    hold.current = 0;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu();
      }}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={endHold}
      className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left ${active ? "bg-user/60" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]">{title || t("未命名")}</div>
        {subtitle ? <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div> : null}
      </div>
      {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" /> : right}
    </button>
  );
}
