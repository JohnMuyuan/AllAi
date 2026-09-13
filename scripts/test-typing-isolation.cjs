#!/usr/bin/env node
/**
 * 打字卡顿回归：输入框每敲一个字不能把 Markdown / 远程快照整份重算。
 * 0.13.0 聊天已经靠 MessageList memo 挡住了；Agent / 创作漏了同样的隔离。
 */
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const agent = fs.readFileSync(path.join(root, "components/AgentWorkspace.tsx"), "utf8");
const chat = fs.readFileSync(path.join(root, "components/ChatApp.tsx"), "utf8");
const studio = fs.readFileSync(path.join(root, "components/Studio.tsx"), "utf8");
const messages = fs.readFileSync(path.join(root, "components/MessageList.tsx"), "utf8");

assert.match(agent, /memo\(function AgentBubble/, "Agent 气泡必须 memo，否则按键会重解析 Markdown");
assert.match(agent, /memo\(function AgentMessageList/, "Agent 消息列表必须 memo");
assert.match(messages, /memo\(function MessageList/, "聊天 MessageList 必须 memo");
assert.match(studio, /memo\(function StudioTurn/, "创作每一轮必须 memo");
assert.match(chat, /const remoteSnapshot = useMemo/, "远程快照必须 memo，不能每次按键重算");
assert.doesNotMatch(
  chat,
  /useRemoteBridge\([^)]*snapshotNow\(\)/,
  "useRemoteBridge 不能每次渲染都调用 snapshotNow()",
);
assert.match(chat, /return current;/, "scanWorks 合并结果没变化时应交回原数组，避免 4 秒一次无意义重渲染");
assert.match(
  fs.readFileSync(path.join(root, "components/Composer.tsx"), "utf8"),
  /const \[text, setText\] = useState\(value\)/,
  "输入框必须自己持有文字，不能每敲一个字 setState 到 ChatApp",
);
assert.doesNotMatch(
  fs.readFileSync(path.join(root, "electron/history.ts"), "utf8"),
  /execFileSync\(\s*["']tasklist["']/,
  "scanHistory 不能同步跑 tasklist，否则主进程每 4 秒卡住 400ms+",
);

console.log("PASS: typing isolation guards for chat, agent and studio");
