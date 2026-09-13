import { listConversations, readConversation } from "./conversations";
import { readDb } from "./store";

export type SearchHit = {
  area: "chat" | "agents" | "studio";
  id: string;
  title: string;
  snippet: string;
  updatedAt: number;
};

function clip(text: string, n = 80) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

function match(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle);
}

export async function searchLocal(query: string): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const conversations = await listConversations();
  for (const summary of conversations.slice(0, 120)) {
    const key = `chat:${summary.id}`;
    if (match(summary.title, needle) || match(summary.preview, needle)) {
      seen.add(key);
      hits.push({
        area: "chat",
        id: summary.id,
        title: summary.title || "未命名",
        snippet: clip(summary.preview || summary.title),
        updatedAt: summary.updatedAt,
      });
      continue;
    }
    const full = await readConversation(summary.id);
    const found = full?.messages.find((item) => match(item.content, needle));
    if (found) {
      seen.add(key);
      hits.push({
        area: "chat",
        id: summary.id,
        title: summary.title || "未命名",
        snippet: clip(found.content),
        updatedAt: summary.updatedAt,
      });
    }
  }

  const db = await readDb();
  for (const conversation of db.studioConversations ?? []) {
    const key = `studio:${conversation.id}`;
    if (match(conversation.title, needle)) {
      seen.add(key);
      hits.push({
        area: "studio",
        id: conversation.id,
        title: conversation.title || "未命名",
        snippet: clip(conversation.title),
        updatedAt: conversation.updatedAt,
      });
    }
  }
  for (const job of db.studioJobs ?? []) {
    const key = `studio:${job.conversationId}`;
    if (!job.prompt || !match(job.prompt, needle) || seen.has(key)) continue;
    const conversation = (db.studioConversations ?? []).find((item) => item.id === job.conversationId);
    seen.add(key);
    hits.push({
      area: "studio",
      id: job.conversationId,
      title: conversation?.title || clip(job.prompt, 24) || "未命名",
      snippet: clip(job.prompt),
      updatedAt: job.createdAt,
    });
  }

  hits.sort((a, b) => b.updatedAt - a.updatedAt);
  return hits.slice(0, 40);
}
