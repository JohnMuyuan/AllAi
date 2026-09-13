import fs from "fs";
import os from "os";
import path from "path";

import { putImport, type DayBuckets, type UsageBucket } from "./usage-scan";

// node:sqlite 在这套 tsconfig 里没有类型声明，和 electron/history.ts 一样用 require 引。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sqlite = require("node:sqlite") as {
  DatabaseSync: new (
    file: string,
    opts?: { readOnly?: boolean },
  ) => { prepare: (sql: string) => { all: () => unknown[] }; close: () => void };
};

/**
 * 把 CC Switch 的历史用量导进来。
 *
 * 它把账记在 `~/.cc-switch/cc-switch.db` 的 `usage_daily_rollups` 里（每天 × 应用 × 供应商 × 型号），
 * 数据有两个来源，看 `provider_id` 就能分辨：
 *   - `_session` / `_codex_session` / `_grok_session` / `_opencode_session`
 *     —— 扫各家 CLI 会话文件得来的，占绝大多数（实测 35020 次请求里有 34689 次）；
 *   - 其它 UUID —— 走它自己那个本地代理的请求日志。
 * 两边它用 `session_usage_dedup` 按 request_id 去重。我们只读汇总表，不用管这个。
 *
 * **只读**：整个过程不碰 CC Switch 的库（`readOnly: true`），也不动它任何文件。
 */

type Row = {
  date: string;
  app_type: string;
  provider_id: string;
  model: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: string;
};

/** CC Switch 的 app_type → AllAi 统计页上显示的来源名。 */
const SOURCES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  grokbuild: "Grok Build",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
  hermes: "Hermes",
};

export function ccSwitchDbPath() {
  return path.join(os.homedir(), ".cc-switch", "cc-switch.db");
}

export type CcSwitchPreview = {
  found: boolean;
  path: string;
  days: number;
  requests: number;
  tokens: number;
  costUsd: number;
  from: string;
  to: string;
  bySource: { source: string; requests: number; costUsd: number }[];
};

function readRows(): Row[] {
  const file = ccSwitchDbPath();
  if (!fs.existsSync(file)) return [];
  // 只读打开：CC Switch 正开着也不会互相干扰。
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT date, app_type, provider_id, model, request_count,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd
           FROM usage_daily_rollups`,
      )
      .all() as unknown as Row[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function toBuckets(rows: Row[]) {
  const days: DayBuckets = {};
  for (const row of rows) {
    const day = String(row.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const source = SOURCES[row.app_type] || row.app_type || "未知来源";
    const model = String(row.model || "") || "未知模型";
    const bySource = (days[day] ??= {});
    const byModel = (bySource[source] ??= {});
    const bucket: UsageBucket = (byModel[model] ??= {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      costUsd: 0,
      requests: 0,
    });
    /*
     * 口径对齐：AllAi 这边 `input` 一律表示「送进去的全部输入」，缓存读写是其中的明细
     * （见 electron/usage-scan.ts）。CC Switch 存的是**纯新增输入**，缓存另算 ——
     * 验证过：codex 2026-08-12 那天 2.183M×$5 + 0.261M×$30 + 79.23M×$0.5 = $58.3，
     * 和它自己记的 total_cost_usd $58.36 对得上，说明它的 input 确实不含缓存。
     * 不补齐的话，同一张统计表里导入的行和扫描的行两种意思，合计根本没法看。
     */
    const cacheRead = Number(row.cache_read_tokens) || 0;
    const cacheWrite = Number(row.cache_creation_tokens) || 0;
    bucket.input += (Number(row.input_tokens) || 0) + cacheRead + cacheWrite;
    bucket.output += Number(row.output_tokens) || 0;
    bucket.cacheRead += cacheRead;
    bucket.cacheWrite += cacheWrite;
    bucket.costUsd += Number(row.total_cost_usd) || 0;
    bucket.requests += Number(row.request_count) || 0;
  }
  return days;
}

/** 看看有什么可导的，不写任何东西。 */
export function previewCcSwitch(): CcSwitchPreview {
  const file = ccSwitchDbPath();
  const rows = readRows();
  const empty: CcSwitchPreview = {
    found: fs.existsSync(file),
    path: file,
    days: 0,
    requests: 0,
    tokens: 0,
    costUsd: 0,
    from: "",
    to: "",
    bySource: [],
  };
  if (!rows.length) return empty;
  const days = toBuckets(rows);
  const dates = Object.keys(days).sort();
  const bySource = new Map<string, { requests: number; costUsd: number }>();
  let requests = 0;
  let tokens = 0;
  let costUsd = 0;
  for (const row of Object.values(days)) {
    for (const [source, byModel] of Object.entries(row)) {
      for (const bucket of Object.values(byModel)) {
        const hit = bySource.get(source) ?? { requests: 0, costUsd: 0 };
        hit.requests += bucket.requests;
        hit.costUsd += bucket.costUsd;
        bySource.set(source, hit);
        requests += bucket.requests;
        // 合计口径和统计页一致：输入 + 输出（缓存读算在输入里，不重复计）。
        tokens += bucket.input + bucket.output;
        costUsd += bucket.costUsd;
      }
    }
  }
  return {
    found: true,
    path: file,
    days: dates.length,
    requests,
    tokens,
    costUsd,
    from: dates[0] || "",
    to: dates.at(-1) || "",
    bySource: [...bySource]
      .map(([source, value]) => ({ source, ...value }))
      .sort((a, b) => b.requests - a.requests),
  };
}

/** 真的导进来。整份替换，重复点不会翻倍。 */
export function importCcSwitch(): CcSwitchPreview {
  const preview = previewCcSwitch();
  if (!preview.days) return preview;
  putImport("cc-switch", toBuckets(readRows()));
  return preview;
}
