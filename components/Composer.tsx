"use client";

import { ArrowUp, Brain, Globe, MonitorCog, Paperclip, Shield, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { matchSlashCommands, type SlashCommandHint } from "@/lib/cli-commands";
import type { AgentKind, ChatAttachment } from "@/lib/types";
import { OptionSelect } from "./OptionSelect";
import { useT } from "./I18n";
import { SlashCommandMenu } from "./SlashCommandMenu";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
  attachments?: ChatAttachment[];
  onAttachments?: (files: ChatAttachment[]) => void;
  reasoning?: string;
  onReasoning?: (value: string) => void;
  reasoningOptions?: { value: string; label: string; description?: string }[];
  permission?: string;
  onPermission?: (value: string) => void;
  permissionOptions?: { value: string; label: string; description?: string }[];
  extraLeft?: ReactNode;
  extraTools?: ReactNode;
  hideHint?: boolean;
  onVoiceError?: (message: string) => void;
  /** 联网搜索开关。不传就不显示这个按钮。 */
  webSearch?: boolean;
  /** 「操控电脑」开关。开着时发消息会进入截图→动作循环。 */
  computerUse?: boolean;
  onComputerUse?: (value: boolean) => void;
  /** 当前模型不支持时置灰（官方登录那条路收不到图）。 */
  computerUseDisabled?: boolean;
  computerUseHint?: string;
  onWebSearch?: (value: boolean) => void;
  /** 本机 CLI 以管理员权限运行。不传就不显示。 */
  cliAdmin?: boolean;
  onCliAdmin?: (value: boolean) => void;
  cliAdminHint?: string;
  /** Agent 输入框：打 / 弹出这家 CLI 的指令列表。聊天和创作不要传。 */
  agentKind?: AgentKind;
};

export const ALLAI_UPLOAD_DRAG = "application/x-allai-upload";

export async function uploadFile(file: File): Promise<ChatAttachment> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", data }),
  });
  const json = (await response.json()) as { error?: string; file?: ChatAttachment };
  if (!response.ok || !json.file) throw new Error(json.error || "上传失败");
  return json.file;
}

function filesFromClipboard(event: React.ClipboardEvent) {
  const files: File[] = [];
  if (event.clipboardData.files?.length) files.push(...Array.from(event.clipboardData.files));
  for (const item of Array.from(event.clipboardData.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && !files.some((entry) => entry.name === file.name && entry.size === file.size)) {
      files.push(file);
    }
  }
  return files;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  attachments = [],
  onAttachments,
  reasoning = "medium",
  onReasoning,
  reasoningOptions = [],
  permission = "",
  onPermission,
  permissionOptions = [],
  extraLeft,
  extraTools,
  hideHint,
  onVoiceError,
  webSearch,
  computerUse,
  onComputerUse,
  computerUseDisabled,
  computerUseHint,
  onWebSearch,
  cliAdmin,
  onCliAdmin,
  cliAdminHint,
  agentKind,
}: Props) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const slashListId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashFor, setSlashFor] = useState("");
  const [slashDismissed, setSlashDismissed] = useState("");
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  const slashItems = useMemo(
    () => (agentKind && text !== slashDismissed ? matchSlashCommands(agentKind, text) : null),
    [agentKind, text, slashDismissed],
  );
  const slashOpen = Boolean(slashItems) && !disabled && !streaming;
  if (slashOpen && slashFor !== text) {
    setSlashFor(text);
    setSlashIndex(0);
  }
  const slashActive = slashItems?.length ? Math.min(slashIndex, slashItems.length - 1) : 0;

  /*
   * 输入框跟着内容长高。
   *
   * 原来每次输入都「先把 height 设成 0，再读 scrollHeight」—— 读 scrollHeight 会
   * 强制整个文档同步重排，而文档里可能有上百段渲染好的 Markdown。实测这一下
   * 占了输入延迟的 13%。现在优先交给 CSS 的 `field-sizing: content`（Chromium 123+
   * 原生支持，Electron 44 有），一行 JS 都不用跑；只有不支持时才退回老办法。
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 支持 field-sizing 的浏览器已经由 CSS 管好高度了，不要再碰。
    if (CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!slashOpen) return;
    function outside(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setSlashDismissed(text);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [slashOpen, text]);

  function fillSlash(item: SlashCommandHint, sendIfReady = false) {
    const typed = text.replace(/^[/／]/, "").toLowerCase();
    const name = item.insert.slice(1).toLowerCase();
    if (sendIfReady && typed === name && !item.needsArgs) {
      onChange(item.insert);
      onSend();
      setText("");
      onChange("");
      return;
    }
    const next = item.needsArgs ? `${item.insert} ` : item.insert;
    setText(next);
    setSlashDismissed(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文输入法选词时的回车属于输入法，不是发送。
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (slashOpen) {
      const count = slashItems?.length ?? 0;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (count) setSlashIndex((index) => (index + 1) % count);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (count) setSlashIndex((index) => (index - 1 + count) % count);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(text);
        return;
      }
      if (event.key === "Tab" && count) {
        event.preventDefault();
        fillSlash(slashItems![slashActive]);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (count) fillSlash(slashItems![slashActive], true);
        else if (!streaming && !disabled) fireSend();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!streaming && !disabled) fireSend();
    }
  }

  function fireSend() {
    onChange(text);
    onSend();
    setText("");
    onChange("");
  }

  async function addFiles(list: FileList | File[]) {
    if (!onAttachments) return;
    const files = Array.from(list);
    if (!files.length) return;
    setBusy(true);
    try {
      const uploaded = await Promise.all(files.map(uploadFile));
      onAttachments([...attachments, ...uploaded]);
    } catch (error) {
      onVoiceError?.(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  const canSend = !disabled && !streaming && (Boolean(text.trim()) || attachments.length > 0);

  return (
    <div
      className="mx-auto w-full max-w-3xl px-3 pb-4 pt-2 md:px-4"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const raw = event.dataTransfer.getData(ALLAI_UPLOAD_DRAG);
        if (raw && onAttachments) {
          try {
            const item = JSON.parse(raw) as ChatAttachment;
            if (item.id && !attachments.some((entry) => entry.id === item.id)) {
              onAttachments([...attachments, item]);
              return;
            }
          } catch {
            // 不是我们自己拖的
          }
        }
        if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
      }}
    >
      <div ref={wrapRef} className="relative">
      {slashOpen ? (
        <SlashCommandMenu
          id={slashListId}
          items={slashItems!}
          active={slashActive}
          onActive={setSlashIndex}
          onPick={(item) => fillSlash(item)}
        />
      ) : null}
      <div
        className={`composer-surface rounded-[24px] border bg-elevated focus-within:border-accent/50 ${
          dragOver ? "border-accent" : "border-line"
        }`}
      >
        {attachments.length ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px]"
              >
                {item.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/${item.id}`}
                    alt=""
                    className="size-5 rounded object-cover"
                  />
                ) : null}
                <span className="max-w-[140px] truncate">{item.name}</span>
                <button
                  type="button"
                  aria-label={t("移除 {name}", { name: item.name })}
                  onClick={() => onAttachments?.(attachments.filter((entry) => entry.id !== item.id))}
                  className="text-muted hover:text-ink"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (slashDismissed && next !== slashDismissed) setSlashDismissed("");
          }}
          onKeyDown={onKeyDown}
          role={slashOpen ? "combobox" : undefined}
          aria-expanded={slashOpen || undefined}
          aria-autocomplete={slashOpen ? "list" : undefined}
          aria-controls={slashOpen ? slashListId : undefined}
          aria-activedescendant={slashOpen && slashItems?.length ? `${slashListId}-${slashActive}` : undefined}
          onPaste={(event) => {
            const files = filesFromClipboard(event);
            if (!files.length) return;
            event.preventDefault();
            void addFiles(files);
          }}
          placeholder={dragOver ? t("放开即可添加文件") : placeholder}
          className="block max-h-[200px] min-h-[52px] [field-sizing:content] w-full resize-none bg-transparent px-5 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.csv,.zip"
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {extraLeft}
          <button
            type="button"
            aria-label={t("添加文件")}
            disabled={disabled || !onAttachments}
            onClick={() => fileRef.current?.click()}
            className="composer-tool grid size-9 place-items-center rounded-xl text-muted hover:bg-user hover:text-ink disabled:opacity-40"
          >
            <Paperclip className="size-4" />
          </button>
          {extraTools}
          {onWebSearch ? (
            <button
              type="button"
              aria-pressed={Boolean(webSearch)}
              aria-label={webSearch ? t("联网搜索：开") : t("联网搜索：关")}
              data-tip={
                webSearch
                  ? t("联网搜索：开。模型可以查最新信息")
                  : t("联网搜索：关。模型只用自己的知识")
              }
              disabled={disabled}
              onClick={() => onWebSearch(!webSearch)}
              className={`composer-tool grid size-9 place-items-center rounded-xl hover:bg-user disabled:opacity-40 ${
                webSearch ? "bg-user text-ink" : "text-muted hover:text-ink"
              }`}
            >
              <Globe className={`size-4 ${webSearch ? "text-accent" : ""}`} />
            </button>
          ) : null}
          {onCliAdmin ? (
            <button
              type="button"
              aria-pressed={Boolean(cliAdmin)}
              aria-label={cliAdmin ? t("管理员权限：开") : t("管理员权限：关")}
              data-tip={
                cliAdminHint ||
                (cliAdmin
                  ? t("管理员：开。本机 CLI 以管理员权限运行")
                  : t("管理员：关。本机 CLI 以当前用户权限运行，打开时会弹一次系统确认"))
              }
              disabled={disabled}
              onClick={() => onCliAdmin(!cliAdmin)}
              className={`composer-tool grid size-9 place-items-center rounded-xl hover:bg-user disabled:opacity-40 ${
                cliAdmin ? "bg-user text-ink" : "text-muted hover:text-ink"
              }`}
            >
              <ShieldCheck className={`size-4 ${cliAdmin ? "text-accent" : ""}`} />
            </button>
          ) : null}
          {onComputerUse ? (
            <button
              type="button"
              aria-pressed={Boolean(computerUse)}
              aria-label={computerUse ? t("操控电脑：开") : t("操控电脑：关")}
              data-tip={
                computerUseHint ||
                (computerUse
                  ? t("操控电脑：开。发消息后 AI 会截屏并操作鼠标键盘，截图会发到你配置的接口")
                  : t("操控电脑：关"))
              }
              disabled={disabled || computerUseDisabled}
              onClick={() => onComputerUse(!computerUse)}
              className={`composer-tool grid size-9 place-items-center rounded-xl hover:bg-user disabled:opacity-40 ${
                computerUse ? "bg-user text-ink" : "text-muted hover:text-ink"
              }`}
            >
              <MonitorCog className={`size-4 ${computerUse ? "text-accent" : ""}`} />
            </button>
          ) : null}
          {onReasoning && reasoningOptions.length > 0 ? (
            <OptionSelect
              label={t("推理")}
              value={reasoning}
              options={reasoningOptions}
              onChange={(value) => onReasoning(value)}
              disabled={disabled}
              icon={<Brain className="size-3.5 shrink-0 text-accent" />}
              compact
            />
          ) : null}
          {onPermission && permissionOptions.length > 0 ? (
            <OptionSelect
              label={t("权限")}
              value={permission}
              options={permissionOptions}
              onChange={(value) => onPermission(value)}
              disabled={disabled}
              icon={<Shield className="size-3.5 shrink-0 text-accent" />}
              compact
            />
          ) : null}
          <span className="ml-auto hidden text-xs text-muted sm:inline">
            {busy ? t("上传中…") : hideHint ? "" : agentKind ? t("Enter 发送 · / 看指令") : t("Enter 发送 · 可粘贴/拖入文件")}
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t("停止生成")}
              className="ml-2 grid size-9 place-items-center rounded-full bg-ink text-canvas"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={fireSend}
              disabled={!canSend}
              aria-label={t("发送")}
              className="ml-2 grid size-9 place-items-center rounded-full bg-ink text-canvas disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
