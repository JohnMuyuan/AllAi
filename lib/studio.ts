import type { ConversationSummary, Database, StudioConversation, StudioJob } from "./types";

export function studioTitle(prompt: string, mode: "image" | "video") {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return mode === "video" ? "未命名视频" : "未命名作品";
  const stop = text.search(/[。，、!！?？;；,.]|\s—|\s-\s/);
  const head = stop > 4 ? text.slice(0, stop) : text;
  return head.length > 24 ? `${head.slice(0, 24)}…` : head;
}

export function studioPreview(jobs: StudioJob[]) {
  const last = [...jobs].reverse().find((item) => item.kind !== "model-switch");
  return (last?.prompt || "").replace(/\s+/g, " ").slice(0, 80);
}

export function toStudioSummary(conversation: StudioConversation, jobs: StudioJob[]): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    modelKey: "",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    preview: studioPreview(jobs),
  };
}

/** 旧数据里一次生成就是侧栏一条。给没有 conversationId 的 job 各开一条对话。 */
export function migrateStudioConversations(db: Database) {
  let changed = false;
  if (!db.studioConversations) {
    db.studioConversations = [];
    changed = true;
  }
  const known = new Set(db.studioConversations.map((item) => item.id));
  const sorted = [...db.studioJobs].sort((a, b) => a.createdAt - b.createdAt);
  let lastId = "";
  for (const job of sorted) {
    if (job.conversationId && known.has(job.conversationId)) {
      lastId = job.conversationId;
      continue;
    }
    if (job.kind === "model-switch" && lastId) {
      job.conversationId = lastId;
      changed = true;
      continue;
    }
    const id = crypto.randomUUID();
    db.studioConversations.push({
      id,
      title: (job.title || studioTitle(job.prompt, job.mode)).slice(0, 60),
      createdAt: job.createdAt,
      updatedAt: job.createdAt,
    });
    known.add(id);
    job.conversationId = id;
    lastId = id;
    changed = true;
  }
  return changed;
}
