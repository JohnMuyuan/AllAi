import { isChatModel, withModelKind } from "./models";
import { isOfficialProvider } from "./official-chat";
import { readDb } from "./store";
import type { Provider } from "./types";
import { joinUrl, providerHeaders } from "./upstream";

export async function summarizeTitle(
  provider: Provider,
  modelId: string,
  userText: string,
  assistantText: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(joinUrl(provider.baseUrl, "chat/completions"), {
    method: "POST",
    headers: providerHeaders(provider),
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: "system",
          content: "为这段对话起一个不超过16个字的中文标题。只输出标题，不要引号、句号或解释。",
        },
        {
          role: "user",
          content: `用户：${userText.slice(0, 400)}\n助手：${assistantText.slice(0, 400)}`,
        },
      ],
    }),
    // 标题只是锦上添花，不能因为某个失效接口让整次生图/聊天一直转圈。
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 200));
  const parsed = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
  };
  const title = (parsed.choices?.[0]?.message?.content || "")
    .replace(/\s+/g, " ")
    .replace(/^["「『]|["」』]$/g, "")
    .trim();
  if (!title || title.length > 40) return "";
  return title.slice(0, 28);
}

/** 借任意一个有 Key 的聊天服务起标题。生图模型自己不会写标题。 */
export async function summarizeWithAnyProvider(
  userText: string,
  assistantText: string,
  signal?: AbortSignal,
) {
  const db = await readDb();
  const deadline = AbortSignal.timeout(12_000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (const provider of db.providers) {
    if (!provider.apiKey || isOfficialProvider(provider)) continue;
    const model = provider.models.find((item) => isChatModel(withModelKind(item)));
    if (!model) continue;
    try {
      const title = await summarizeTitle(provider, model.id, userText, assistantText, bounded);
      if (title) return title;
    } catch {
      // 换下一个服务
    }
  }
  return "";
}
