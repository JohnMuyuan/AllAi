import type { ConversationSummary } from "./types";

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupConversations(items: ConversationSummary[]) {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86400000;
  const week = today - 86400000 * 6;

  const buckets: { label: string; items: ConversationSummary[] }[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "过去 7 天", items: [] },
    { label: "更早", items: [] },
  ];

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const item of sorted) {
    if (item.updatedAt >= today) buckets[0].items.push(item);
    else if (item.updatedAt >= yesterday) buckets[1].items.push(item);
    else if (item.updatedAt >= week) buckets[2].items.push(item);
    else buckets[3].items.push(item);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}
