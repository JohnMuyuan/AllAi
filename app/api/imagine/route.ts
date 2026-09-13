import { NextResponse } from "next/server";
import { compactIfNeeded, compactNotice } from "@/lib/compact";
import { contextLimit, estimateTokens } from "@/lib/context-window";
import { downloadBinary, generateImages, generateVideo } from "@/lib/imagine";
import { recordUsage } from "@/lib/usage-store";
import { parseModelKey } from "@/lib/public";
import { readDb, updateDb } from "@/lib/store";
import { studioTitle } from "@/lib/studio";
import { summarizeWithAnyProvider } from "@/lib/title";
import { saveUpload, readUpload } from "@/lib/uploads";
import type { StudioConversation, StudioJob } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function resolveModel(modelKey: string) {
  const db = await readDb();
  const { providerId, modelId } = parseModelKey(modelKey);
  const provider = db.providers.find((item) => item.id === providerId);
  if (!provider || !modelId) return null;
  return { provider, modelId, db };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    scope?: "chat" | "agent" | "studio";
    mode?: "image" | "video";
    prompt?: string;
    aspectRatio?: string;
    characterIds?: string[];
    imageIds?: string[];
    modelKey?: string;
    conversationId?: string;
  };
  const prompt = body.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "请填写提示词" }, { status: 400 });
  const db = await readDb();
  const mode = body.mode === "video" ? "video" : "image";
  const modelKey =
    body.modelKey ||
    (body.scope === "agent"
      ? db.prefs.agentImageModelKey
      : body.scope === "studio"
        ? mode === "video"
          ? db.prefs.studioVideoModelKey || db.prefs.studioImageModelKey
          : db.prefs.studioImageModelKey
        : db.prefs.chatImageModelKey);
  if (!modelKey) {
    return NextResponse.json(
      { error: "请先在设置里为这一侧指定生图/视频模型" },
      { status: 400 },
    );
  }
  const resolved = await resolveModel(modelKey);
  if (!resolved) {
    return NextResponse.json({ error: "找不到指定的生图模型" }, { status: 400 });
  }

  const characterIds = body.characterIds ?? [];
  const characters = db.characters.filter((item) => characterIds.includes(item.id));
  const imageIds = [
    ...(body.imageIds ?? []),
    ...characters.flatMap((item) => item.imageIds),
  ];
  const references = [];
  for (const id of imageIds) {
    const file = await readUpload(id);
    if (file) references.push({ mime: file.mime, data: file.data });
  }
  const characterNote = characters
    .map((item) => `${item.name}${item.description ? `：${item.description}` : ""}`)
    .join("；");

  /*
   * 创作的「上下文」和聊天不一样：生图接口是无状态的，没有 session 可以续。
   * 所以「再来一张，换成夜晚」这种话，模型必须同时拿到
   *   1. 这条创作里之前说过什么（文字），和
   *   2. 上一张图本身（视觉），否则它根本不知道要改哪张。
   * 换模型自然也就不丢 —— 上下文本来就是每次现拼的。
   */
  const priorJobs = body.conversationId
    ? db.studioJobs
        .filter(
          (item) =>
            item.conversationId === body.conversationId &&
            item.kind !== "model-switch" &&
            item.kind !== "compact" &&
            item.status === "done",
        )
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  /*
   * 创作的上下文也会撑爆：一条创作里连着改几十轮，光提示词就能堆到几万 token，
   * 而生图接口能吃的提示词比聊天短得多。所以这里同样按模型上限算，
   * 到量就把更早的提示词压成一段摘要（存在这条创作上，下次直接复用）。
   */
  const studioLimit = contextLimit(resolved.modelId, db.prefs.contextLimits);
  // 留给上下文的预算：生图提示词本来就短，别拿整个窗口去撑。
  const studioBudget = Math.min(6_000, Math.floor(studioLimit.tokens * 0.15));
  let studioCompaction = body.conversationId
    ? db.studioConversations.find((item) => item.id === body.conversationId)?.compaction
    : undefined;
  let studioCompactedNow = "";
  const allPrompts = priorJobs.map((item) => item.prompt).filter(Boolean);
  const livePrompts = allPrompts.slice(studioCompaction?.folded ?? 0);
  if (
    db.prefs.autoCompact !== false &&
    estimateTokens(livePrompts.join("\n")) + estimateTokens(studioCompaction?.summary || "") >
      studioBudget
  ) {
    const budgetAsLimit = Math.round(studioBudget / 0.8);
    const result = await compactIfNeeded({
      turns: allPrompts.map((item) => ({ role: "user" as const, content: item })),
      modelId: resolved.modelId,
      // 这里的「上限」是留给上下文的那点预算，不是模型的整个窗口。
      limitTokens: budgetAsLimit,
      percent: 80,
      previous: studioCompaction,
      signal: request.signal,
    }).catch(() => null);
    if (result?.compacted) {
      studioCompaction = result.compaction;
      studioCompactedNow = compactNotice(result.compaction, budgetAsLimit);
      const saved = result.compaction;
      await updateDb((current) => {
        const thread = current.studioConversations.find((item) => item.id === body.conversationId);
        if (thread) thread.compaction = saved;
      });
    }
  }
  const priorPrompts = allPrompts.slice(studioCompaction?.folded ?? 0).slice(-8);

  // 用户没自己给参考图时，默认接着上一张改。
  let basedOnPrevious = false;
  if (!references.length && priorJobs.length) {
    for (let i = priorJobs.length - 1; i >= 0; i--) {
      const output = priorJobs[i].outputs.find((row) => row.mime.startsWith("image/"));
      if (!output) continue;
      const file = await readUpload(output.id);
      if (!file) continue;
      references.push({ mime: file.mime, data: file.data });
      basedOnPrevious = true;
      break;
    }
  }

  const contextLines = [
    "【这条创作此前的要求，供你理解「再来一张」「换成…」指的是什么】",
    studioCompaction?.summary ? `更早的要求（已压缩）：${studioCompaction.summary}` : "",
    ...priorPrompts.map((item, index) => `${index + 1}. ${item}`),
    basedOnPrevious ? "（附的参考图就是上一张的成品，在它基础上改）" : "",
    "",
    "【这次要做的】",
    "",
  ].filter((line, index) => line !== "" || index > 0);
  const contextNote =
    priorPrompts.length || studioCompaction?.summary ? contextLines.join("\n") : "";

  const fullPrompt = [
    contextNote,
    characterNote ? `保持这些人物外观稳定、可辨认：${characterNote}。场景：` : "",
    prompt,
  ].join("");

  const started = await updateDb((current) => {
    let conversation = body.conversationId
      ? current.studioConversations.find((item) => item.id === body.conversationId)
      : undefined;
    if (!conversation) {
      conversation = {
        id: crypto.randomUUID(),
        title: "新创作",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      current.studioConversations.unshift(conversation);
    }
    const created: StudioJob = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      mode,
      // 只存用户原话。存 fullPrompt 的话，下一轮又把它当历史读回去，
      // 上下文会一轮比一轮长，界面气泡里也会显示整段提示工程。
      prompt,
      basedOnPrevious: basedOnPrevious || undefined,
      aspectRatio: body.aspectRatio || "auto",
      characterIds,
      modelKey,
      status: "running",
      outputs: [],
      createdAt: Date.now(),
    };
    // 压缩说明作为一条内联记录摆进历史，和换模型那条一样 —— 不弹窗。
    if (studioCompactedNow) {
      current.studioJobs.unshift({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        mode,
        prompt: "",
        kind: "compact",
        notice: studioCompactedNow,
        aspectRatio: "auto",
        characterIds: [],
        modelKey,
        status: "done",
        outputs: [],
        createdAt: Date.now() - 1,
      });
    }
    current.studioJobs.unshift(created);
    conversation.updatedAt = Date.now();
    return { job: created, conversation };
  });
  const job = started.job;
  let conversation: StudioConversation = started.conversation;

  const startedAt = Date.now();
  const signal = request.signal;
  try {
    const outputs: { id: string; mime: string }[] = [];
    if (mode === "video") {
      const result = await generateVideo({
        provider: resolved.provider,
        modelId: resolved.modelId,
        prompt: fullPrompt,
        aspectRatio: body.aspectRatio,
        image: references[0],
        signal,
      });
      const data = result.b64
        ? Buffer.from(result.b64, "base64")
        : await downloadBinary(result.url, signal, resolved.provider);
      const saved = await saveUpload({
        name: `video-${job.id}.mp4`,
        mime: "video/mp4",
        data,
      });
      outputs.push({ id: saved.id, mime: saved.mime });
    } else {
      const rows = await generateImages({
        provider: resolved.provider,
        modelId: resolved.modelId,
        prompt: fullPrompt,
        aspectRatio: body.aspectRatio,
        references,
        signal,
      });
      for (const [index, row] of rows.entries()) {
        const data = row.b64_json
          ? Buffer.from(row.b64_json, "base64")
          : row.url
            ? await downloadBinary(row.url, signal, resolved.provider)
            : null;
        if (!data) continue;
        const saved = await saveUpload({
          name: `image-${job.id}-${index + 1}.png`,
          mime: "image/png",
          data,
        });
        outputs.push({ id: saved.id, mime: saved.mime });
      }
    }
    if (!outputs.length) throw new Error("没有生成结果");
    // 生图接口一般不报 token，记请求数和产出数，创作页至少能看到用了多少次。
    await recordUsage({
      area: "studio",
      source: resolved.provider.name,
      modelId: resolved.modelId,
      images: outputs.length,
      durationMs: Date.now() - startedAt,
    }).catch(() => undefined);
    const done = await updateDb((current) => {
      const item = current.studioJobs.find((entry) => entry.id === job.id);
      const thread = current.studioConversations.find((entry) => entry.id === job.conversationId);
      let firstTurn = false;
      if (item) {
        item.status = "done";
        item.outputs = outputs;
        item.title = studioTitle(prompt, mode);
      }
      if (thread) {
        const turns = current.studioJobs.filter(
          (entry) =>
            entry.conversationId === thread.id &&
            entry.kind !== "model-switch" &&
            entry.kind !== "compact",
        ).length;
        firstTurn = turns <= 1;
        if (firstTurn) thread.title = studioTitle(prompt, mode);
        thread.updatedAt = Date.now();
        conversation = thread;
      }
      return { job: item ?? job, firstTurn };
    });
    if (done.firstTurn) {
      const summarized = await summarizeWithAnyProvider(
        prompt,
        mode === "video" ? "已生成视频" : "已生成图片",
        request.signal,
      ).catch(() => "");
      if (summarized) {
        conversation = (await updateDb((current) => {
          const thread = current.studioConversations.find((entry) => entry.id === job.conversationId);
          if (thread) thread.title = summarized;
          return thread ?? conversation;
        })) as StudioConversation;
      }
    }
    return NextResponse.json({
      job: done.job,
      conversation,
      markdown: outputs
        .map((item) =>
          item.mime.startsWith("video/")
            ? `[视频](/api/uploads/${item.id})`
            : `![生成图](/api/uploads/${item.id})`,
        )
        .join("\n"),
    });
  } catch (error) {
    const aborted =
      signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.message === "已取消"));
    const message = aborted ? "已取消" : error instanceof Error ? error.message : "生成失败";
    await updateDb((current) => {
      const item = current.studioJobs.find((entry) => entry.id === job.id);
      if (item) {
        item.status = "error";
        item.error = message;
      }
    });
    return NextResponse.json({ error: message, aborted }, { status: aborted ? 200 : 502 });
  }
}
