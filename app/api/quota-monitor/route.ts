import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { estimateCost } from "@/lib/model-pricing";
import { OFFICIAL_CHATS } from "@/lib/official-chat";
import { dataDir } from "@/lib/paths";
import { ACCOUNT_KINDS, analyzeAccount, type AccountKind, type HourRow, type QuotaSample } from "@/lib/quota-monitor";
import { fullInput } from "@/lib/usage";
import { listUsage } from "@/lib/usage-store";
import { officialHourRows } from "@/lib/usage-rollups";

export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

async function readHistory(): Promise<Record<string, QuotaSample[]>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dataDir(), "quota-history.json"), "utf8")) as {
      version?: number;
      accounts?: Record<string, QuotaSample[]>;
    };
    return parsed?.version === 1 && parsed.accounts ? parsed.accounts : {};
  } catch {
    return {};
  }
}

/**
 * 额度监控的数据：官方额度采样（主进程每 5 分钟记的）+ 走官方账号的用量，按账号算好返回。
 * 用量两处来源：
 * - 本机 CLI 会话里走官方账号的（usage-rollups.json 的 hours，扫描器判断的 official）；
 * - AllAi 自己的「官方登录聊天」（usage.json 里 source 是「Claude 账号」这种的）。
 *   这部分 CLI 会话在 ~/.allai/*-chat 下，扫描器特意跳过了，所以两处不会重复。
 */
export async function GET() {
  const now = Date.now();
  const since = now - 8 * 24 * HOUR;
  const [history, local, events] = await Promise.all([
    readHistory(),
    officialHourRows(since),
    listUsage().catch(() => []),
  ]);

  const rows: Record<AccountKind, HourRow[]> = {
    claude: [...local.claude.rows],
    chatgpt: [...local.chatgpt.rows],
    grok: [...local.grok.rows],
  };
  const kindOfSource = new Map<string, AccountKind>(OFFICIAL_CHATS.map((spec) => [spec.name, spec.kind]));
  for (const event of events) {
    const kind = kindOfSource.get(event.source);
    if (!kind || event.at < since) continue;
    const input = fullInput(event);
    const model = event.modelId || "未知模型";
    rows[kind].push({
      hour: Math.floor(event.at / HOUR) * HOUR,
      model,
      tokens: input + event.output,
      costUsd:
        event.costUsd ||
        estimateCost(model, { input, output: event.output, cacheRead: event.cacheRead, cacheWrite: event.cacheWrite }),
      requests: event.requests || 1,
    });
  }

  // 没采到过额度的账号不显示：没有百分比，就谈不上监控。
  const accounts = ACCOUNT_KINDS.map((kind) =>
    analyzeAccount(kind, Array.isArray(history[kind]) ? history[kind] : [], rows[kind], now),
  ).filter((report) => report.sampleCount > 0);

  return NextResponse.json({
    now,
    accounts,
    sessions: {
      claude: { included: local.claude.included, excluded: local.claude.excluded },
      chatgpt: { included: local.chatgpt.included, excluded: local.chatgpt.excluded },
      grok: { included: local.grok.included, excluded: local.grok.excluded },
    },
  });
}
