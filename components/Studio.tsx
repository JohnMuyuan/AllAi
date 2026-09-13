"use client";

import { Clapperboard, Copy, Download, Frame, ImageIcon, ImagePlus, Maximize2, Plus, UserRound, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyModel } from "@/lib/models";
import { makeModelKey, parseModelKey } from "@/lib/public";
import type {
  AppPrefs,
  ChatAttachment,
  PublicProvider,
  StudioCharacter,
  StudioConversation,
  StudioJob,
} from "@/lib/types";
import { ALLAI_UPLOAD_DRAG, Composer, uploadFile } from "./Composer";
import {
  copyOutput,
  downloadOutput,
  MediaViewer,
  uploadDragPayload,
  type StudioOutput,
} from "./MediaViewer";
import { VideoPlayer } from "./VideoPlayer";
import { TurnRail, turnLabel } from "./TurnRail";
import { useStickToBottom } from "./useStickToBottom";
import { useT } from "./I18n";
import { CompactBadge, modelInfo, SwitchBadge } from "./ModelSwitch";
import { OptionSelect } from "./OptionSelect";

const RATIOS = [
  { value: "auto", label: "自适应", description: "由模型决定构图" },
  { value: "1:1", label: "1:1", description: "方形" },
  { value: "16:9", label: "16:9", description: "横屏" },
  { value: "9:16", label: "9:16", description: "竖屏" },
  { value: "4:3", label: "4:3", description: "传统横图" },
  { value: "3:4", label: "3:4", description: "传统竖图" },
  { value: "3:2", label: "3:2", description: "照片横图" },
  { value: "2:3", label: "2:3", description: "照片竖图" },
];

function GeneratingFrame({ mode }: { mode: "image" | "video" }) {
  const t = useT();
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-elevated">
      <div
        className={`w-full ${mode === "video" ? "aspect-video" : "aspect-[4/3]"} animate-pulse bg-user/70`}
      />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-2 rounded-full border border-line bg-elevated/90 px-3 py-1.5 text-sm text-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <span className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:240ms]" />
          {t(mode === "video" ? "正在生成视频…" : "正在生成图片…")}
        </div>
      </div>
    </div>
  );
}

function StudioMedia({
  output,
  prompt,
  onOpen,
  onUseReference,
  onToast,
}: {
  output: StudioOutput;
  prompt: string;
  onOpen: () => void;
  onUseReference: (item: ChatAttachment) => void;
  onToast: (text: string) => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const src = `/api/uploads/${output.id}`;
  const isVideo = output.mime.startsWith("video/");

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const payload = uploadDragPayload({ ...output, prompt });

  return (
    <div
      className="group relative"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {isVideo ? (
        <VideoPlayer
          src={src}
          className="max-h-[26rem] w-auto max-w-full"
          onDownload={() => void downloadOutput(output, (text) => onToast(t(text)))}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={prompt}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(ALLAI_UPLOAD_DRAG, JSON.stringify(payload));
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={onOpen}
          className="max-h-[26rem] w-auto max-w-full cursor-zoom-in rounded-2xl"
        />
      )}
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        <button
          type="button"
          aria-label={t("放大查看")}
          onClick={onOpen}
          className="grid size-8 place-items-center rounded-lg bg-black/55 text-white hover:bg-black/70"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("下载")}
          onClick={() => void downloadOutput(output, (text) => onToast(t(text)))}
          className="grid size-8 place-items-center rounded-lg bg-black/55 text-white hover:bg-black/70"
        >
          <Download className="size-3.5" />
        </button>
      </div>
      {menu ? (
        <div
          className="fixed z-40 min-w-36 overflow-hidden rounded-xl border border-line bg-elevated py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-user"
            onClick={() => {
              setMenu(null);
              onOpen();
            }}
          >
            <Maximize2 className="size-3.5 text-muted" />
            {t("放大查看")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-user"
            onClick={() => {
              setMenu(null);
              void downloadOutput(output, (text) => onToast(t(text)));
            }}
          >
            <Download className="size-3.5 text-muted" />
            {t("下载")}
          </button>
          {isVideo ? null : (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-user"
              onClick={() => {
                setMenu(null);
                void copyOutput(output, (text) => onToast(t(text)));
              }}
            >
              <Copy className="size-3.5 text-muted" />
              {t("复制图片")}
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-user"
            onClick={() => {
              setMenu(null);
              if (!output.mime.startsWith("image/")) {
                onToast(t("请用图片作参考"));
                return;
              }
              onUseReference(payload);
            }}
          >
            <ImagePlus className="size-3.5 text-muted" />
            {t("用作参考")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 左边是图，右边是短提示词气泡，贴在图的上方。 */
/**
 * 一轮创作 = 我的提示词（右）+ 出来的东西（左），上下排。
 *
 * 以前这里是 `grid-cols-[1fr_16rem]` 把两边并排放在同一行，
 * 于是图片顶边和提示词气泡齐平 —— 那不是聊天，是个两栏表格。
 */
const StudioTurn = memo(function StudioTurn({
  job,
  onOpen,
  onUseReference,
  onToast,
}: {
  job: StudioJob;
  onOpen: (output: StudioOutput) => void;
  onUseReference: (item: ChatAttachment) => void;
  onToast: (text: string) => void;
}) {
  const t = useT();
  const meta = [
    job.mode === "video" ? t("视频") : t("生图"),
    job.aspectRatio && job.aspectRatio !== "auto" ? job.aspectRatio : "",
    // 自动接着上一张改这件事要让用户看见，别当隐形魔法。
    job.basedOnPrevious ? t("接着上一张改") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      {/* 我说的话：右边，和聊天里一模一样 */}
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1 md:max-w-[75%]">
          <div className="whitespace-pre-wrap break-words rounded-3xl bg-user px-4 py-2.5 text-[15px] leading-7 text-ink [overflow-wrap:anywhere]">
            {job.prompt || t("（没有提示词）")}
          </div>
          <div className="pr-1 text-right text-[11px] text-muted">{meta}</div>
        </div>
      </div>

      {/* 出来的东西：左边。
          这里必须给「确定的宽度」（w-full + max-w），不能只写 max-w ——
          只写 max-w 的话这一列会收缩到内容宽度，里面的 w-full 就没有参照，
          正在生成的占位框会塌成 0 高，图也会按原始像素大小乱跳。 */}
      <div className="flex justify-start">
        <div className="w-full min-w-0 max-w-[85%] md:max-w-[75%]">
          {job.status === "error" ? (
            <div className="rounded-2xl border border-danger/40 bg-elevated px-4 py-2.5 text-sm leading-6 text-danger">
              {job.error === "已取消" ? t("已取消") : t("生成失败：{error}", { error: job.error || t("未知原因") })}
            </div>
          ) : job.status === "running" ? (
            <GeneratingFrame mode={job.mode} />
          ) : job.outputs.length ? (
            <div className="flex flex-col gap-2">
              {job.outputs.map((output) => (
                <StudioMedia
                  key={output.id}
                  output={{ ...output, prompt: job.prompt }}
                  prompt={job.prompt}
                  onOpen={() => onOpen({ ...output, prompt: job.prompt })}
                  onUseReference={onUseReference}
                  onToast={onToast}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-elevated px-4 py-2.5 text-sm text-muted">
              {t("没有产出")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});


type Props = {
  onToast: (text: string) => void;
  conversationId: string | null;
  jobs: StudioJob[];
  providers: PublicProvider[];
  prefs: AppPrefs;
  onPrefs: (patch: Partial<AppPrefs>) => void;
  onThreadChanged: (conversationId: string) => Promise<unknown> | void;
  onAddJob?: (job: StudioJob) => void;
  onConversation?: (conversation: StudioConversation) => void;
};

function CharacterPopup({
  characters,
  selected,
  onToggle,
  onAdded,
  onDeleted,
  onToast,
}: {
  characters: StudioCharacter[];
  selected: string[];
  onToggle: (id: string) => void;
  onAdded: () => void;
  onDeleted: (id: string) => void;
  onToast: (text: string) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFromPhotos(files: FileList | File[]) {
    const list = Array.from(files).filter((item) => item.type.startsWith("image/"));
    if (!list.length) {
      onToast(t("请上传人物参考照片"));
      return;
    }
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of list) uploaded.push(await uploadFile(file));
      const name = list[0].name.replace(/\.[^.]+$/, "") || "人物";
      const response = await fetch("/api/studio/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: "",
          imageIds: uploaded.map((item) => item.id),
        }),
      });
      if (!response.ok) throw new Error("保存人物失败");
      onAdded();
    } catch (error) {
      onToast(t(error instanceof Error ? error.message : "保存人物失败"));
    }
  }

  return (
    <div className="absolute bottom-12 left-0 z-30 w-72 rounded-2xl border border-line bg-elevated p-3 shadow-xl">
      <div className="mb-2 text-xs font-medium">{t("人物参考")}</div>
      <p className="mb-2 text-[11px] text-muted">{t("上传照片即可，不必自己描述长相。")}</p>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {characters.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">{t("还没有人物")}</p>
        ) : (
          characters.map((item) => {
            const on = selected.includes(item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-user">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2" onClick={() => onToggle(item.id)}>
                  {item.imageIds[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/uploads/${item.imageIds[0]}`} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-8 place-items-center rounded-full bg-user">
                      <UserRound className="size-4 text-muted" />
                    </span>
                  )}
                  <span className={`min-w-0 truncate text-sm ${on ? "font-medium" : ""}`}>{item.name}</span>
                  {on ? <span className="text-[10px] text-accent">{t("已选")}</span> : null}
                </button>
                <button type="button" aria-label={t("删除人物")} onClick={() => onDeleted(item.id)} className="text-muted hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) void addFromPhotos(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-line px-3 py-2 text-xs hover:bg-user"
      >
        <Plus className="size-3.5" />
        {t("上传参考照片")}
      </button>
    </div>
  );
}

export function Studio({
  onToast,
  conversationId,
  jobs,
  providers,
  prefs,
  onPrefs,
  onThreadChanged,
  onAddJob,
  onConversation,
}: Props) {
  const t = useT();
  const [mode, setMode] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef("");
  const [ratio, setRatio] = useState("auto");
  const [characters, setCharacters] = useState<StudioCharacter[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewer, setViewer] = useState<StudioOutput | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const modelOptions = useMemo(() => {
    const kind = mode === "video" ? "video" : "image";
    return providers.flatMap((provider) =>
      provider.models
        .filter((model) => (model.kind || classifyModel(model.id)) === kind)
        .map((model) => ({
          value: makeModelKey(provider.id, model.id),
          label: model.label || model.id,
          description: provider.name,
        })),
    );
  }, [mode, providers]);

  const modelKey =
    mode === "video"
      ? prefs.studioVideoModelKey || modelOptions[0]?.value || ""
      : prefs.studioImageModelKey || modelOptions[0]?.value || "";

  /** 只改设置；要不要在对话里留一条切换记录交给下面那个 effect 判断。 */
  function pickModel(next: string) {
    if (!next || next === modelKey) return;
    const { modelId } = parseModelKey(next);
    if (classifyModel(modelId) === "video" || mode === "video") {
      onPrefs({ studioVideoModelKey: next });
    } else {
      onPrefs({ studioImageModelKey: next });
    }
  }

  function recordModelSwitch(next: string, from: string) {
    if (!next || !from || next === from) return;
    if (!conversationId) return;
    const job: StudioJob = {
      id: crypto.randomUUID(),
      conversationId,
      kind: "model-switch",
      mode,
      prompt: "",
      aspectRatio: "auto",
      characterIds: [],
      modelKey: next,
      fromModelKey: from,
      status: "done",
      outputs: [],
      createdAt: Date.now(),
    };
    onAddJob?.(job);
    void fetch("/api/studio/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "model-switch",
        id: job.id,
        conversationId,
        mode,
        modelKey: next,
        fromModelKey: from,
      }),
    }).catch(() => undefined);
  }

  /*
   * 生成类型（生图/视频）用的是两个不同的 pref，切类型时有效模型也就换了。
   * 以前只在用户从下拉里选模型时才记切换，所以「改成视频」这种换法
   * 在历史里完全看不出来。这里改成盯着有效 modelKey：只要它变了就记一条。
   */
  const lastModelRef = useRef<{ conversationId: string | null; modelKey: string }>({
    conversationId: null,
    modelKey: "",
  });
  useEffect(() => {
    const last = lastModelRef.current;
    // 换对话或首次进来只同步基准，不算切换。
    if (last.conversationId !== conversationId) {
      lastModelRef.current = { conversationId, modelKey };
      return;
    }
    if (!modelKey || modelKey === last.modelKey) return;
    const from = last.modelKey;
    lastModelRef.current = { conversationId, modelKey };
    if (from) recordModelSwitch(modelKey, from);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只看有效模型和当前对话
  }, [conversationId, modelKey]);

  const reloadChars = useCallback(async () => {
    const data = (await fetch("/api/studio/characters").then((item) => item.json())) as {
      characters: StudioCharacter[];
    };
    setCharacters(data.characters ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void reloadChars();
  }, [reloadChars]);

  const thread = useMemo(() => [...jobs].sort((a, b) => a.createdAt - b.createdAt), [jobs]);
  // 以前这里只管「滚到底」，没记用户有没有往上翻，生成过程中翻看旧图会被一直拽回底部。
  const { ref: scroller, node: scrollNode } = useStickToBottom(thread, conversationId);
  const turns = useMemo(
    () =>
      thread
        .filter((job) => !job.kind)
        .map((job) => ({ id: job.id, label: turnLabel(job.prompt, t("（没有提示词）")) })),
    [thread, t],
  );

  const useReference = useCallback((item: ChatAttachment) => {
    if (item.kind !== "image") {
      onToast(t("请用图片作参考"));
      return;
    }
    setAttachments((current) =>
      current.some((entry) => entry.id === item.id) ? current : [...current, item],
    );
    onToast(t("已加到参考图"));
  }, [onToast, t]);

  function stop() {
    abortRef.current?.abort();
  }

  async function generate() {
    const typed = promptRef.current.trim();
    if (!typed || busy) return;
    if (!modelKey) {
      onToast(mode === "video" ? t("请先在设置里指定视频模型") : t("请先在设置里指定生图模型"));
      return;
    }
    const text = typed;
    const pending: StudioJob = {
      id: `pending-${crypto.randomUUID()}`,
      conversationId: conversationId || "",
      mode,
      prompt: text,
      aspectRatio: ratio,
      characterIds: selected,
      modelKey,
      status: "running",
      outputs: [],
      createdAt: Date.now(),
    };
    onAddJob?.(pending);
    setPrompt("");
    const usedImages = attachments;
    setAttachments([]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/imagine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "studio",
          mode,
          prompt: text,
          aspectRatio: ratio,
          characterIds: selected,
          imageIds: usedImages.map((item) => item.id),
          modelKey,
          conversationId,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        error?: string;
        aborted?: boolean;
        conversation?: StudioConversation;
      };
      if (data.conversation) onConversation?.(data.conversation);
      await onThreadChanged(data.conversation?.id || conversationId || "");
      if (data.aborted) return;
      if (!response.ok && response.status < 500) {
        onToast(t(data.error || "生成失败"));
        setPrompt(text);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        await onThreadChanged(conversationId || "");
        return;
      }
      onToast(t(error instanceof Error ? error.message : "生成失败"));
      await onThreadChanged(conversationId || "");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <div className="@container relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {thread.length === 0 ? (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <ImageIcon className="mx-auto mb-3 size-10 text-muted" />
              <p className="text-lg font-medium">{t("创作")}</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
                {t("在下面描述画面就能出图。同一条创作里可以连续问，点「新创作」再开一条。")}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6">
            {thread.map((job) =>
              job.kind === "compact" ? (
                <CompactBadge key={job.id} text={job.notice || t("已压缩上下文")} />
              ) : job.kind === "model-switch" ? (
                <SwitchBadge
                  key={job.id}
                  from={modelInfo(job.fromModelKey, providers)}
                  to={modelInfo(job.modelKey, providers)}
                />
              ) : (
                <div key={job.id} data-turn={job.id}>
                  <StudioTurn
                    job={job}
                    onOpen={setViewer}
                    onUseReference={useReference}
                    onToast={onToast}
                  />
                </div>
              ),
            )}
          </div>
        )}
      </div>
      <TurnRail turns={turns} container={scrollNode} />
      </div>

      {viewer ? (
        <MediaViewer
          output={viewer}
          onClose={() => setViewer(null)}
          onUseReference={useReference}
          onToast={onToast}
        />
      ) : null}

      <Composer
        value={prompt}
        onChange={(value) => {
          promptRef.current = value;
        }}
        onSend={() => void generate()}
        onStop={stop}
        streaming={busy}
        placeholder={mode === "video" ? t("描述要生成的视频…") : t("描述画面，可粘贴参考图…")}
        attachments={attachments}
        onAttachments={setAttachments}
        onVoiceError={onToast}
        hideHint
        extraLeft={
          <div className="relative">
            <button
              type="button"
              aria-label={t("人物")}
              onClick={() => setPickerOpen((current) => !current)}
              className={`composer-tool grid size-9 place-items-center rounded-xl ${
                selected.length ? "text-accent" : "text-muted hover:bg-user hover:text-ink"
              }`}
            >
              <UserRound className="size-4" />
            </button>
            {pickerOpen ? (
              <CharacterPopup
                characters={characters}
                selected={selected}
                onToggle={(id) =>
                  setSelected((current) =>
                    current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                  )
                }
                onAdded={() => void reloadChars()}
                onDeleted={(id) => {
                  void fetch(`/api/studio/characters/${id}`, { method: "DELETE" }).then(() => {
                    setSelected((current) => current.filter((item) => item !== id));
                    void reloadChars();
                  });
                }}
                onToast={onToast}
              />
            ) : null}
          </div>
        }
        extraTools={
          <>
            <OptionSelect
              label="类型"
              value={mode}
              options={[
                { value: "image", label: "生图", description: "生成静态画面" },
                { value: "video", label: "视频", description: "生成短视频" },
              ]}
              onChange={(value) => setMode(value === "video" ? "video" : "image")}
              disabled={busy}
              icon={
                mode === "video" ? (
                  <Clapperboard className="size-3.5 shrink-0 text-accent" />
                ) : (
                  <ImageIcon className="size-3.5 shrink-0 text-accent" />
                )
              }
              compact
            />
            <OptionSelect
              label="比例"
              value={ratio}
              options={RATIOS}
              onChange={setRatio}
              disabled={busy}
              icon={<Frame className="size-3.5 shrink-0 text-accent" />}
              compact
            />
            <OptionSelect
              label="模型"
              value={modelKey}
              options={modelOptions}
              onChange={pickModel}
              disabled={busy || modelOptions.length === 0}
              compact
            />
          </>
        }
      />
    </div>
  );
}
