/**
 * 本机 CLI 用量扫描。跑法（先 npm run electron:compile）：
 *
 *   node scripts/test-usage-scan.cjs
 *
 * 这是「统计电脑上所有 Agent 消耗」的底子，和 CC Switch 一个路子：增量读各家 CLI
 * 自己的会话文件。三家的字段名都不一样，而且有两个特别容易搞错的口径：
 *   - Codex 的 `input_tokens` **已经含**缓存读，不能再加一次；
 *   - Grok 的 `turn_completed.usage` 是**一轮里所有模型调用的总和** ——
 *     算「上下文占用」时用它会虚高好几倍（约定里写死了不许用），但算**用量**要的正是它。
 *
 * 还盯两件只有跑起来才暴露的事：追加写之后只读新增那一段（不重算），
 * 以及文件被重写/截断时不会把旧账重复计进去。
 *
 * 用临时 HOME + 临时 ALLAI_DATA_DIR，不碰你真的 ~/.claude、~/.allai。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "allai-usage-home-"));
const data = fs.mkdtempSync(path.join(os.tmpdir(), "allai-usage-data-"));
process.env.ALLAI_DATA_DIR = data;

const realHome = os.homedir;
os.homedir = () => home;
const { scanLocalUsage, readRollups } = require(path.join(ROOT, "electron-dist", "usage-scan.js"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

function write(file, lines, append = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = lines.map((item) => JSON.stringify(item)).join("\n") + "\n";
  if (append) fs.appendFileSync(file, text);
  else fs.writeFileSync(file, text);
}

const DAY = "2026-09-11T10:00:00.000Z";
const claudeFile = path.join(home, ".claude", "projects", "proj", "s1.jsonl");
const claudeChatFile = path.join(home, ".claude", "projects", "C--Users-x--allai-claude-chat", "s9.jsonl");
const codexFile = path.join(home, ".codex", "sessions", "2026", "rollout-a_b.jsonl");
const grokFile = path.join(home, ".grok", "sessions", "enc", "s2", "updates.jsonl");

const claudeLine = (input, output, cr, cw, id) => ({
  type: "assistant",
  timestamp: DAY,
  requestId: id || `req_${Math.random()}`,
  message: {
    model: "claude-opus-5",
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cr,
      cache_creation_input_tokens: cw,
      output_tokens_details: { thinking_tokens: 7 },
    },
  },
});

/** 把所有文件的账加起来（正式代码里是 lib/usage-rollups.ts 干这活）。 */
function total() {
  const out = {};
  for (const file of Object.values(readRollups().files)) {
    for (const [day, bySource] of Object.entries(file.days)) {
      for (const [source, byModel] of Object.entries(bySource)) {
        for (const [model, b] of Object.entries(byModel)) {
          const key = `${day}|${source}|${model}`;
          const hit = (out[key] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, costUsd: 0, requests: 0 });
          for (const k of Object.keys(hit)) hit[k] += b[k] || 0;
        }
      }
    }
  }
  return out;
}

try {
  // ---- Claude ----
  // 第 2、3 行是同一次响应被拆成的两行（同一个 requestId、同一份 usage）——
  // Claude Code 真的会这么写，实测这台机器 11003 行里有 5009 行是这种。
  write(claudeFile, [
    claudeLine(10, 20, 30, 40),
    { type: "user", content: "x" },
    claudeLine(1, 2, 3, 4, "req_same"),
    claudeLine(1, 2, 3, 4, "req_same"),
  ]);
  // AllAi 自己的官方登录聊天跑在 ~/.allai/*-chat 里，那部分按「聊天」记过账了，必须跳过
  write(claudeChatFile, [claudeLine(999, 999, 999, 999)]);
  // ---- Codex ----
  write(codexFile, [
    { type: "event_msg", timestamp: DAY, payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-6-astra" } } },
    {
      type: "token_usage_record",
      timestamp: DAY,
      payload: { response_id: "resp_1", usage: { input_tokens: 100, cached_input_tokens: 80, cache_write_input_tokens: 5, output_tokens: 9, reasoning_output_tokens: 3 } },
    },
  ]);
  // ---- Grok ----
  write(grokFile, [
    {
      timestamp: Math.floor(Date.parse(DAY) / 1000),
      params: {
        update: {
          sessionUpdate: "turn_completed",
          usage: {
            inputTokens: 500, outputTokens: 50, cachedReadTokens: 400, cacheCreationTokens: 0,
            reasoningTokens: 11, modelCalls: 3, costUsdTicks: 128479200,
            modelUsage: {
              "grok-4.6": { inputTokens: 500, outputTokens: 50, cachedReadTokens: 400, cacheCreationTokens: 0, reasoningTokens: 11, modelCalls: 3, costUsdTicks: 128479200 },
            },
          },
        },
      },
    },
  ]);

  scanLocalUsage();
  let all = total();
  const claude = all["2026-09-11|Claude Code|claude-opus-5"];
  check("Claude：同一次响应拆成的多行只算一次", claude?.requests === 2, JSON.stringify(claude));
  // 口径：input 一律含缓存读和缓存写。(10+30+40) + (1+3+4) = 88
  check(
    "Claude：input 补齐成「全部输入」（含缓存读写）",
    claude?.input === 88 && claude?.output === 22 && claude?.cacheRead === 33 && claude?.cacheWrite === 44,
    JSON.stringify(claude),
  );
  check("Claude：思考 token 记进 reasoning", claude?.reasoning === 14, String(claude?.reasoning));
  check(
    "AllAi 自己的官方聊天会话不算进 Agent 用量",
    !Object.keys(all).some((k) => all[k].input >= 999),
    Object.keys(all).join(" / "),
  );

  const codex = all["2026-09-11|Codex CLI|gpt-6-astra"];
  check("Codex：型号取自前面的 thread_settings_applied", Boolean(codex), Object.keys(all).join(" / "));
  check(
    "Codex：input 已含缓存读，不另外相加",
    codex?.input === 100 && codex?.cacheRead === 80,
    JSON.stringify(codex),
  );

  const grok = all["2026-09-11|Grok Build|grok-4.6"];
  check("Grok：按 modelUsage 拆到型号上", Boolean(grok), Object.keys(all).join(" / "));
  check("Grok：一轮里的多次调用都算请求数", grok?.requests === 3, String(grok?.requests));
  check("Grok：用它自己报的花费（tick / 1e9）", Math.abs((grok?.costUsd ?? 0) - 0.1284792) < 1e-6, String(grok?.costUsd));

  // ---- 增量：追加之后只读新增那一段 ----
  write(claudeFile, [claudeLine(1000, 1, 0, 0)], true);
  scanLocalUsage();
  all = total();
  check(
    "追加写：只加新增的那条，旧的不重算",
    all["2026-09-11|Claude Code|claude-opus-5"].requests === 3 &&
      all["2026-09-11|Claude Code|claude-opus-5"].input === 1088,
    JSON.stringify(all["2026-09-11|Claude Code|claude-opus-5"]),
  );

  // 没有变化时不该再动账
  const before = JSON.stringify(total());
  scanLocalUsage();
  check("没变化时再扫一次，账不变", JSON.stringify(total()) === before);

  // ---- 文件被重写（变短）：那份账整份重算，不能叠加 ----
  write(claudeFile, [claudeLine(7, 7, 0, 0)]);
  scanLocalUsage();
  all = total();
  check(
    "文件被重写：这个文件的账整份重算，不重复计",
    all["2026-09-11|Claude Code|claude-opus-5"].requests === 1 &&
      all["2026-09-11|Claude Code|claude-opus-5"].input === 7,
    JSON.stringify(all["2026-09-11|Claude Code|claude-opus-5"]),
  );
} finally {
  os.homedir = realHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} 通过`);
assert.equal(passed, results.length, "usage scan regression failed");
