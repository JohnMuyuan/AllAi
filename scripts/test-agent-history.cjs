#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadMessages, scanHistory } = require("../electron-dist/history.js");

function line(type, payload, timestamp) {
  return `${JSON.stringify({ timestamp, ordinal: 0, type, payload })}\n`;
}

function userLine(text, timestamp) {
  return line(
    "event_msg",
    { type: "item_completed", item: { type: "UserMessage", content: [{ type: "input_text", text }] } },
    timestamp,
  );
}

function agentLine(text, timestamp) {
  return line(
    "event_msg",
    { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "output_text", text }] } },
    timestamp,
  );
}

function metaLine(id, timestamp) {
  return line("session_meta", { id, session_id: id, cwd: "D:\\tmp\\proj", thread_source: "user" }, timestamp);
}

function workFor(file, sessionId, extras) {
  return {
    id: `codex:${sessionId}`,
    kind: "codex",
    agentName: "Codex CLI",
    title: "",
    cwd: "D:\\tmp\\proj",
    cliSessionId: sessionId,
    running: false,
    createdAt: 0,
    updatedAt: 0,
    preview: "",
    source: "history",
    messagesFile: file,
    ...extras,
  };
}

function users(messages) {
  return messages.filter((item) => item.role === "user").map((item) => item.content.trim());
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allai-codex-hist-"));
const sessionId = "01aaaaaaaa-bbbb-7ccc-dddd-eeeeeeeeeeee";
const parent = path.join(dir, `rollout-2026-09-11T00-00-00-${sessionId}.jsonl`);
const child = path.join(
  dir,
  `rollout-2026-09-11T00-10-00-${sessionId}_01bbbbbb-cccc-7ddd-eeee-ffffffffffff.jsonl`,
);
fs.writeFileSync(
  parent,
  metaLine(sessionId, "2026-09-11T00:00:00.000Z") +
    userLine("第一句任务", "2026-09-11T00:00:01.000Z") +
    agentLine("先做这一半", "2026-09-11T00:00:02.000Z") +
    userLine("请继续后半段", "2026-09-11T00:09:00.000Z"),
);
fs.writeFileSync(
  child,
  metaLine(sessionId, "2026-09-11T00:10:00.000Z") +
    userLine("请继续后半段", "2026-09-11T00:10:01.000Z") +
    agentLine("后半段做完了", "2026-09-11T00:10:02.000Z") +
    userLine("再改一处", "2026-09-11T00:11:00.000Z") +
    agentLine("改好了", "2026-09-11T00:11:01.000Z"),
);
fs.utimesSync(parent, new Date("2026-09-11T00:09:00Z"), new Date("2026-09-11T00:09:00Z"));
fs.utimesSync(child, new Date("2026-09-11T00:11:01Z"), new Date("2026-09-11T00:11:01Z"));

const parentOnly = loadMessages(workFor(parent, sessionId, { messagesFiles: [parent] }));
assert.deepEqual(users(parentOnly), ["第一句任务", "请继续后半段"], "parent file alone must keep its own turns");

const merged = loadMessages(workFor(parent, sessionId));
const mergedUsers = users(merged);
assert.equal(mergedUsers.includes("第一句任务"), true, "merged history must keep the first user turn");
assert.equal(mergedUsers.includes("再改一处"), true, "merged history must keep the later rollout turns");
assert.equal(mergedUsers.filter((text) => text === "请继续后半段").length, 1, "overlapping user turn must not duplicate");
assert.equal(merged.some((item) => item.role === "assistant" && item.content.includes("后半段做完了")), true);

const history = scanHistory(400);
const codex = history.filter((item) => item.kind === "codex");
const ids = codex.map((item) => item.id);
assert.equal(ids.length, new Set(ids).size, "Codex list must have one row per session id");

const liveId = "01a08fe1-2aed-7130-a057-142bf07a9220";
const live = codex.find((item) => item.cliSessionId === liveId);
if (live) {
  const messages = loadMessages(live);
  const texts = users(messages);
  assert.equal(texts.some((text) => text.startsWith("HIHI")), true, "live Codex session must include the first rollout");
  assert.equal(
    texts.some((text) => text.includes("继续晚上Remote Control") || text.includes("写好交接文档")),
    true,
    "live Codex session must include later rollout turns",
  );
  assert.equal((live.messagesFiles || []).length >= 2, true, "live Codex session must remember both rollout files");
}

// 从别的 Agent 导入到 Codex 的会话：带标记的工具调用 / 输出不能当成回复正文（0.16.10）。
const importedId = "01cccccccc-dddd-7eee-ffff-000000000000";
const imported = path.join(dir, `rollout-2026-09-11T01-00-00-${importedId}.jsonl`);
fs.writeFileSync(
  imported,
  metaLine(importedId, "2026-09-11T01:00:00.000Z") +
    userLine("做个值班表", "2026-09-11T01:00:01.000Z") +
    agentLine("我先看一下材料。", "2026-09-11T01:00:02.000Z") +
    agentLine(
      '[external_agent_tool_call: Bash]\ndescription: List files\ncommand: cd "D:/x" && python -c "\nfile: not a field\nprint(1)"\n[/external_agent_tool_call]',
      "2026-09-11T01:00:03.000Z",
    ) +
    agentLine("[external_agent_tool_result]\n===== \ufffd\ufffd\u0461\ufffd\ufffd.xlsx\r\nok\n[/external_agent_tool_result]", "2026-09-11T01:00:04.000Z") +
    agentLine("[external_agent_tool_result: error]\nExit code 2\n[/external_agent_tool_result]", "2026-09-11T01:00:05.000Z") +
    agentLine("[external_agent_tool_call: Edit]\nfile: D:/x/build.py\n[/external_agent_tool_call]", "2026-09-11T01:00:06.000Z") +
    agentLine("做好了。", "2026-09-11T01:00:07.000Z"),
);
const importedMessages = loadMessages(workFor(imported, importedId, { messagesFiles: [imported] }));
const importedReply = importedMessages.find((item) => item.role === "assistant");
assert.ok(importedReply, "imported session must have an assistant reply");
assert.equal(importedReply.content.includes("external_agent"), false, "markers must not leak into the reply");
assert.equal(importedReply.content.includes("Exit code"), false, "tool output must not show as reply text");
assert.equal(importedReply.content.includes("\ufffd"), false, "garbled tool output must be dropped");
assert.equal(
  importedReply.content.includes("我先看一下材料。") && importedReply.content.includes("做好了。"),
  true,
  "the real reply text must stay",
);
const importedTools = (importedReply.trace || []).filter((item) => item.type === "tool");
assert.deepEqual(importedTools.map((item) => item.name), ["运行命令", "改文件"], "calls must become tool rows");
assert.equal(importedTools[0].detail.includes("python -c"), true, "a multi-line command keeps its body");
assert.equal(importedTools[0].detail.includes("not a field"), true, "code lines inside a command are not new fields");
assert.equal(
  (importedReply.trace || []).some((item) => item.type === "thinking" && item.text.includes("external_agent")),
  false,
  "markers must not leak into the thinking trace",
);
console.log("PASS: imported Codex session hides tool markers and output");

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS: Codex split rollouts merge into one session history");
