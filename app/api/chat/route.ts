import { applyCompaction, compactIfNeeded, compactNotice } from "@/lib/compact";
import { computerSystemPrompt } from "@/lib/computer-use";
import { DEFAULT_COMPACT_PERCENT, contextLimit } from "@/lib/context-window";
import { downloadBinary, generateImages } from "@/lib/imagine";
import { isChatModel, withModelKind } from "@/lib/models";
import { isOfficialChat, OFFICIAL_CHATS, officialSpecForProvider } from "@/lib/official-chat";
import { brandFromModel } from "@/lib/brand";
import { parseModelKey, titleFrom } from "@/lib/public";
import { summarizeTitle } from "@/lib/title";
import { applyReasoning, detectReasoning, resolveReasoningLevel } from "@/lib/reasoning";
import {
  patchConversation,
  readConversation,
  writeConversation,
} from "@/lib/conversations";
import { readDb, updateDb } from "@/lib/store";
import type { ChatAttachment, ChatMessage, ChatSseEvent, ChatStep, Conversation } from "@/lib/types";
import { readUpload, saveUpload } from "@/lib/uploads";
import { deltaFromChunk, iterateSse, joinUrl, providerHeaders, usageFromChunk } from "@/lib/upstream";
import { normalizeUsage } from "@/lib/usage";
import { ResponsesError, streamResponses, toResponsesInput } from "@/lib/responses-api";
import { recordUsage } from "@/lib/usage-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encode(event: ChatSseEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function modelUnavailableMessage(providerName: string, modelId: string, status: number, text: string) {
  const raw = text.trim();
  if (/model_not_found|not supported by any configured account|model .* is not supported/i.test(raw)) {
    return `${providerName} 不支持 ${modelId}。Claude 账号只能聊 Claude；Grok 请接到提供这个模型的服务。`;
  }
  if (raw) return `模型接口 ${status}：${raw.slice(0, 400)}`;
  return `模型接口返回 ${status}`;
}

async function messageContent(message: ChatMessage) {
  if (!message.attachments?.length) return message.content;
  const parts: unknown[] = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const attachment of message.attachments) {
    const file = await readUpload(attachment.id);
    if (!file) continue;
    if (attachment.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${file.mime};base64,${file.data.toString("base64")}` },
      });
    } else {
      parts.push({
        type: "text",
        text: `用户上传了文件「${attachment.name}」（${attachment.mime}）。`,
      });
    }
  }
  return parts.length ? parts : message.content;
}

const IMAGE_TOOL = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "当用户要求画图、生成图片、做海报、出图、设计画面时调用。普通问答不要调用。",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "给生图模型的画面描述" },
        aspect_ratio: { type: "string", description: "如 1:1、16:9" },
      },
      required: ["prompt"],
    },
  },
};

/** 建/续对话并把这一轮的用户消息写进去。对话已经不在 db.json 里了。 */
async function prepareConversation(opts: {
  conversationId: string | null;
  mode: "send" | "regenerate";
  modelKey: string;
  incoming: string;
  attachments: ChatAttachment[];
  userMessageId: string;
  requestedEffort: string;
  computerRun?: string;
  computerGoal?: string;
}): Promise<{ error: string } | { conversation: Conversation }> {
  const existing = opts.conversationId ? await readConversation(opts.conversationId) : null;

  if (opts.mode === "regenerate") {
    if (!existing) return { error: "对话不存在" };
    const updated = await patchConversation(existing.id, (current) => {
      if (current.messages.at(-1)?.role === "assistant") current.messages.pop();
      current.modelKey = opts.modelKey;
      current.reasoningEffort = opts.requestedEffort;
      if (!isOfficialChat(opts.modelKey)) current.cliSessionId = undefined;
    });
    if (!updated) return { error: "对话不存在" };
    if (!updated.messages.some((item) => item.role === "user")) {
      return { error: "没有可重新生成的消息" };
    }
    return { conversation: updated };
  }

  if (!opts.incoming && !opts.attachments.length) return { error: "请输入内容或添加文件" };

  const message: ChatMessage = {
    id: opts.userMessageId,
    role: "user",
    content:
      opts.incoming || (opts.attachments.length ? `（${opts.attachments.length} 个附件）` : ""),
    attachments: opts.attachments.length ? opts.attachments : undefined,
    computerRun: opts.computerRun,
    computerGoal: opts.computerGoal,
    createdAt: Date.now(),
  };
  // 操控电脑时发给模型的是程序拼的「目标：…已锁定窗口…」，标题要用用户原话。
  const titleSource = opts.computerGoal || opts.incoming;

  if (existing) {
    const updated = await patchConversation(existing.id, (current) => {
      current.messages.push(message);
      if (current.title === "新对话") current.title = titleFrom(titleSource);
      current.modelKey = opts.modelKey;
      current.reasoningEffort = opts.requestedEffort;
      if (!isOfficialChat(opts.modelKey)) current.cliSessionId = undefined;
    });
    if (!updated) return { error: "对话不存在" };
    return { conversation: updated };
  }

  const now = Date.now();
  const created: Conversation = {
    id: crypto.randomUUID(),
    title: titleFrom(titleSource || opts.attachments[0]?.name || "新对话"),
    messages: [message],
    modelKey: opts.modelKey,
    reasoningEffort: opts.requestedEffort,
    createdAt: now,
    updatedAt: now,
  };
  await writeConversation(created);
  return { conversation: created };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId?: string | null;
    modelKey?: string;
    message?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    mode?: "send" | "regenerate";
    attachments?: ChatAttachment[];
    reasoningEffort?: string;
    webSearch?: boolean;
    /** 操控电脑的一轮任务编号，和这一轮里用户真正说的话（只在第一条上有）。 */
    computerRun?: string;
    computerGoal?: string;
    /** 开了「操控电脑」时带上截图尺寸，用来生成动作协议说明。 */
    computerUse?: {
      width: number;
      height: number;
      targetTitle?: string;
      changedRatio?: number;
      controls?: {
        id: number;
        type: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
      windows?: { id: string; title: string }[];
    };
  };

  const mode = body.mode === "regenerate" ? "regenerate" : "send";
  const modelKey = body.modelKey?.trim() ?? "";
  const { providerId, modelId } = parseModelKey(modelKey);
  if (!providerId || !modelId) {
    return Response.json({ error: "请先选择一个模型" }, { status: 400 });
  }

  const userMessageId = body.userMessageId || crypto.randomUUID();
  const assistantMessageId = body.assistantMessageId || crypto.randomUUID();
  const incoming = body.message?.trim() ?? "";
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const requestedEffort = (body.reasoningEffort || "medium").trim();

  const snapshot = await readDb();
  const provider = snapshot.providers.find((item) => item.id === providerId);
  if (!provider) {
    return Response.json({ error: "所选服务不存在，请重新接入" }, { status: 400 });
  }
  if (!provider.apiKey) {
    return Response.json({ error: "这个服务还没有填写 API Key" }, { status: 400 });
  }
  const selected = provider.models.find((model) => model.id === modelId);
  if (!selected) {
    return Response.json({ error: "所选模型不在列表里，请到设置里添加" }, { status: 400 });
  }
  if (!isChatModel(withModelKind(selected))) {
    return Response.json({ error: "普通聊天不能使用生图或视频模型，请到创作页" }, { status: 400 });
  }

  const prepared = await prepareConversation({
    conversationId: body.conversationId ?? null,
    mode,
    modelKey,
    incoming,
    attachments,
    userMessageId,
    requestedEffort,
    computerRun: typeof body.computerRun === "string" ? body.computerRun.slice(0, 64) : undefined,
    computerGoal: typeof body.computerGoal === "string" ? body.computerGoal.slice(0, 4000) : undefined,
  });
  if ("error" in prepared) {
    return Response.json({ error: prepared.error }, { status: 400 });
  }

  const active = prepared.conversation;
  const modelRef = provider.models.find((item) => item.id === modelId);
  const reasoningProfile = detectReasoning(modelId, modelRef?.reasoningLevels);
  const effort = resolveReasoningLevel(reasoningProfile, requestedEffort);
  const imageModelKey = snapshot.prefs.chatImageModelKey;

  /*
   * 上下文压缩。这条路每一轮都把**整段历史**重新发一遍，所以它是最先撑爆的。
   * 到模型上限的 prefs.compactPercent 就把早期内容折成一段摘要 —— 和三家 CLI
   * 自己在 83%–85% 干的事一样，只是这里由我们来做，因为发出去的那份是我们拼的。
   *
   * 压缩结果存在对话上，下一轮直接复用，不会每轮重新摘要一遍。
   */
  const limit = contextLimit(modelId, snapshot.prefs.contextLimits);
  const compactPercent = snapshot.prefs.compactPercent || DEFAULT_COMPACT_PERCENT;
  let compaction = active.compaction;
  let compactedNow = "";
  if (snapshot.prefs.autoCompact !== false) {
    const turns = active.messages
      .filter(
        (item) =>
          (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
      )
      .map((item) => ({
        role: item.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: item.content,
      }));
    const result = await compactIfNeeded({
      turns,
      modelId,
      limitTokens: limit.tokens,
      percent: compactPercent,
      previous: compaction,
      signal: request.signal,
    }).catch(() => null);
    if (result?.compacted) {
      compaction = result.compaction;
      compactedNow = compactNotice(result.compaction, limit.tokens);
      await patchConversation(active.id, (current) => {
        current.compaction = result.compaction;
      });
    }
  }

  // compaction.folded 是按“有正文的 user/assistant”计数的。这里必须用同一口径，
  // 否则一条只有错误步骤的空助手消息就会让切片偏一位，误删真正的上下文。
  const systemMessages = active.messages.filter((item) => item.role === "system");
  const conversational = active.messages.filter(
    (item) =>
      (item.role === "user" || item.role === "assistant") && Boolean(item.content.trim()),
  );
  const folded = applyCompaction(conversational, compaction);
  const payloadMessages: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[] = [];
  // 操控电脑：动作协议作为 system 放最前面。屏幕尺寸每轮都可能变，所以现拼。
  if (body.computerUse?.width && body.computerUse?.height) {
    payloadMessages.push({ role: "system", content: computerSystemPrompt(body.computerUse) });
  }
  for (const item of systemMessages) {
    payloadMessages.push({ role: item.role, content: item.content });
  }
  for (const turn of folded.head) {
    payloadMessages.push({ role: turn.role, content: turn.content });
  }
  /*
   * 操控电脑时，每一轮都会往对话里塞一张截图。历史截图必须**从发给模型的那份里剔掉**，
   * 只留最新一张 —— 不然第 N 轮要发 N 张图，一次 15 步的任务光图就上万 token，
   * 又慢又贵，还会把上下文顶爆（实测第 4 轮已经在发 4 张）。
   * 对话记录里那些图仍然留着，用户要能回看 AI 当时到底看到了什么。
   */
  const lastIndex = folded.rest.length - 1;
  for (const [index, item] of folded.rest.entries()) {
    const dropImages = Boolean(body.computerUse) && index !== lastIndex;
    payloadMessages.push({
      role: item.role,
      content: dropImages
        ? [item.content, item.attachments?.length ? "（这一步的截图已省略，只保留最新一张）" : ""]
            .filter(Boolean)
            .join("\n")
        : await messageContent(item),
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const steps: ChatStep[] = [];
      const send = (event: ChatSseEvent) => {
        // notice / error 也要留在这条消息里，刷新之后还看得到。
        if (event.type === "notice") {
          steps.push({ kind: event.kind ?? "notice", text: event.message, at: Date.now() });
        }
        if (event.type === "error") {
          steps.push({ kind: "error", text: event.message, at: Date.now() });
        }
        controller.enqueue(encoder.encode(encode(event)));
      };
      send({
        type: "meta",
        conversationId: active.id,
        title: active.title,
        userMessageId,
        assistantMessageId,
        // 压过就带回去，界面的上下文进度条要跟着降下来。
        compaction: compactedNow ? compaction : undefined,
      });

      if (compactedNow) send({ type: "notice", kind: "notice", message: compactedNow });

      let content = "";
      let reasoning = "";
      let aborted = false;
      let usageRaw: unknown = null;
      let dropWebSearch = false;
      let webSearchWorked = false;
      let failed = false;
      const startedAt = Date.now();
      // 这个模型之前就拒过联网参数，直接别带。
      if (provider.webSearchUnsupported?.includes(modelId)) dropWebSearch = true;

      try {
        const messages = [...payloadMessages];

        if (Boolean(body.webSearch) && dropWebSearch) {
          send({
            type: "notice",
            message: `${modelId} 此前已明确拒绝联网工具，这次按不联网回答。更换接口地址或重新同步模型后会再次尝试。`,
          });
        }

        // 联网走 Responses API：Grok 的搜索只在那个端点上，
        // chat/completions 那边 xAI 已经把 Live Search 下线了。
        if (Boolean(body.webSearch) && !dropWebSearch) {
          try {
            let searching = false;
            let searched = false;
            for await (const event of streamResponses({
              provider,
              model: modelId,
              input: toResponsesInput(messages),
              webSearch: true,
              signal: request.signal,
            })) {
              if (event.type === "delta") {
                content += event.text;
                send({ type: "delta", content: event.text });
              } else if (event.type === "reasoning") {
                reasoning += event.text;
                send({ type: "reasoning", content: event.text });
              } else if (event.type === "search") {
                searched = true;
                if (event.stage === "start" && !searching) {
                  searching = true;
                  send({ type: "notice", kind: "search", message: "联网搜索" });
                }
              } else if (event.type === "usage") {
                usageRaw = event.usage;
              }
            }
            webSearchWorked = true;
            // 请求成功了但一次搜索都没发生：多半是这个接口没真接上搜索工具。
            // 用户以为答案查过网，其实没有 —— 得说一声。
            if (!searched) {
              send({
                type: "notice",
                message: `${modelId} 这次没有真的联网（接口接受了参数但没执行搜索），答案来自模型自己的知识。`,
              });
            }
          } catch (error) {
            if (request.signal.aborted) throw error;
            const status = error instanceof ResponsesError ? error.status : 0;
            const partial = Boolean(content || reasoning);
            // 只有明确表示“这个端点/参数不支持”的状态才长期记住。
            // 超时、断网、401、429、5xx 都可能是暂时的，不能一次失败就永久关掉联网。
            const unsupported = [400, 404, 405, 410, 415, 422, 501].includes(status);
            dropWebSearch = unsupported;
            if (partial) {
              send({
                type: "error",
                message: `联网回答在输出过程中中断${status ? `（${status}）` : ""}，已保留收到的内容。`,
              });
              // 已经给用户输出过内容，不能再走 chat/completions 生成第二份答案拼在后面。
              webSearchWorked = true;
              failed = true;
            } else {
              // 这个牌子如果有官方登录，直接告诉用户去哪能真的联网。
              const brand = brandFromModel(modelId);
              const spec = OFFICIAL_CHATS.find(
                (item) =>
                  (brand === "anthropic" && item.kind === "claude") ||
                  (brand === "xai" && item.kind === "grok") ||
                  (brand === "openai" && item.kind === "chatgpt"),
              );
              const added =
                spec &&
                snapshot.providers.some(
                  (row) => officialSpecForProvider(row)?.kind === spec.kind,
                );
              const hint = spec
                ? added
                  ? `想让它联网，改用「${spec.name}」那个服务。`
                  : `想联网可以在设置里添加「${spec.name}」，它走本机命令行。`
                : "换一个支持 /responses 的服务才行。";
              send({
                type: "notice",
                message: unsupported
                  ? `${modelId} 不支持联网搜索（${status}），这次按不联网回答。${hint}`
                  : `联网搜索暂时失败${status ? `（${status}）` : ""}，这次按不联网回答。`,
              });
              if (unsupported) {
                await updateDb((db) => {
                  const item = db.providers.find((row) => row.id === provider.id);
                  if (!item) return;
                  const list = (item.webSearchUnsupported ??= []);
                  if (!list.includes(modelId)) list.push(modelId);
                }).catch(() => undefined);
              }
            }
          }
        }

        for (let round = 0; round < 3 && !webSearchWorked; round++) {
          const requestBody: Record<string, unknown> = {
            model: modelId,
            messages,
            stream: true,
            // 不开这个，多数网关的流式响应不会带 usage。
            stream_options: { include_usage: true },
          };
          applyReasoning(requestBody, reasoningProfile, effort);
          const tools: unknown[] = [];
          if (imageModelKey) tools.push(IMAGE_TOOL);
          // 这条路不带联网参数：联网一律走上面的 Responses API。
          if (tools.length) requestBody.tools = tools;

          const response = await fetch(joinUrl(provider.baseUrl, "chat/completions"), {
            method: "POST",
            headers: providerHeaders(provider),
            body: JSON.stringify(requestBody),
            signal: request.signal,
          });

          if (!response.ok || !response.body) {
            const text = await response.text().catch(() => "");
            send({
              type: "error",
              message: modelUnavailableMessage(provider.name, modelId, response.status, text),
            });
            // 不要在这里 return —— 那会跳过落库，刷新之后这条报错就没了。
            // 记下来，后面照常保存这条（只有 steps 的）助手消息。
            failed = true;
            break;
          }

          const calls: { id: string; name: string; arguments: string }[] = [];
          for await (const chunk of iterateSse(response.body, request.signal)) {
            const chunkUsage = usageFromChunk(chunk);
            if (chunkUsage) usageRaw = chunkUsage;
            const delta = deltaFromChunk(chunk);
            if (delta.reasoning) {
              reasoning += delta.reasoning;
              send({ type: "reasoning", content: delta.reasoning });
            }
            if (delta.content) {
              content += delta.content;
              send({ type: "delta", content: delta.content });
            }
            for (const item of delta.toolCalls) {
              const index = item.index ?? 0;
              if (!calls[index]) calls[index] = { id: "", name: "", arguments: "" };
              if (item.id) calls[index].id = item.id;
              if (item.function?.name) calls[index].name += item.function.name;
              if (item.function?.arguments) calls[index].arguments += item.function.arguments;
            }
          }

          const usable = calls.filter((item) => item?.name === "generate_image");
          if (!usable.length) break;

          messages.push({
            role: "assistant",
            content: content || "",
            tool_calls: usable.map((item, index) => ({
              id: item.id || `call_${index}`,
              type: "function",
              function: { name: item.name, arguments: item.arguments || "{}" },
            })),
          });

          for (const call of usable) {
            let prompt = "";
            let aspect = "1:1";
            try {
              const args = JSON.parse(call.arguments || "{}") as {
                prompt?: string;
                aspect_ratio?: string;
              };
              prompt = args.prompt || "";
              aspect = args.aspect_ratio || "1:1";
            } catch {
              prompt = call.arguments;
            }
            let resultText = "生图失败";
            try {
              const { providerId: imageProviderId, modelId: imageModelId } =
                parseModelKey(imageModelKey);
              const imageProvider = snapshot.providers.find((item) => item.id === imageProviderId);
              if (!imageProvider || !imageModelId) throw new Error("未配置聊天生图模型");
              const imageStartedAt = Date.now();
              const rows = await generateImages({
                provider: imageProvider,
                modelId: imageModelId,
                prompt,
                aspectRatio: aspect,
                signal: request.signal,
              });
              const parts: string[] = [];
              for (const [index, row] of rows.entries()) {
                const data = row.b64_json
                  ? Buffer.from(row.b64_json, "base64")
                  : row.url
                    ? await downloadBinary(row.url, request.signal, imageProvider)
                    : null;
                if (!data) continue;
                const saved = await saveUpload({
                  name: `chat-image-${index + 1}.png`,
                  mime: "image/png",
                  data,
                });
                parts.push(`![生成图](/api/uploads/${saved.id})`);
              }
              if (parts.length) {
                await recordUsage({
                  area: "chat",
                  conversationId: active.id,
                  source: imageProvider.name,
                  modelId: imageModelId,
                  images: parts.length,
                  durationMs: Date.now() - imageStartedAt,
                }).catch(() => undefined);
              }
              resultText = parts.join("\n") || "生图接口没有返回图片";
            } catch (error) {
              resultText = error instanceof Error ? error.message : "生图失败";
            }
            send({ type: "delta", content: `\n${resultText}\n` });
            content += `\n${resultText}\n`;
            messages.push({
              role: "tool",
              tool_call_id: call.id || "call_0",
              content: resultText,
            });
          }
        }
      } catch (error) {
        aborted =
          request.signal.aborted || (error instanceof Error && error.name === "AbortError");
        if (!aborted) {
          let message = error instanceof Error ? error.message : "请求失败";
          if (message === "fetch failed") {
            message = "连不上这个接口，请检查地址、密钥或网络";
          }
          send({ type: "error", message });
        }
      }

      const assistant: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content,
        reasoning: reasoning || undefined,
        steps: steps.length ? steps : undefined,
        modelKey,
        computerRun: typeof body.computerRun === "string" ? body.computerRun.slice(0, 64) : undefined,
        createdAt: Date.now(),
      };

      const usage = normalizeUsage(usageRaw);
      if (usage) {
        await recordUsage({
          area: "chat",
          conversationId: active.id,
          source: provider.name,
          modelId,
          ...usage,
          // OpenAI 口径的 prompt_tokens 已经含缓存读，窗口占用就是它，别再加一次。
          contextTokens: usage.input,
          durationMs: Date.now() - startedAt,
        }).catch(() => undefined);
      }

      if (content || reasoning || steps.length) {
        await patchConversation(active.id, (current) => {
          current.messages.push(assistant);
          current.modelKey = modelKey;
        });
      }

      const userTurns = active.messages.filter((item) => item.role === "user").length;
      if (!failed && !aborted && content && mode === "send" && userTurns <= 1) {
        const lastUser = [...active.messages].reverse().find((item) => item.role === "user");
        try {
          const title = await summarizeTitle(
            provider,
            modelId,
            lastUser?.content || incoming,
            content,
            request.signal,
          );
          if (title) {
            await patchConversation(active.id, (current) => {
              current.title = title;
            });
            send({
              type: "meta",
              conversationId: active.id,
              title,
              userMessageId,
              assistantMessageId,
            });
          }
        } catch {
          // keep the first-line title
        }
      }

      send({ type: "done", aborted });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
