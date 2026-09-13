#!/usr/bin/env node
/**
 * Feedback loop: disk sessions vs scanHistory/loadMessages/scanLive.
 * Asserts the user-facing symptoms: missing CLI history, empty messages, stale running.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { scanHistory, loadMessages, looksRunning } = require("../electron-dist/history.js");
const { scanLive, mergeWorks } = require("../electron-dist/live.js");

const home = os.homedir();
const now = Date.now();

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function firstTypes(file, n = 12) {
  if (!exists(file)) return { error: "missing" };
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(96 * 1024);
  const read = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const types = [];
  for (const line of buf.slice(0, read).toString("utf8").split(/\n/).filter(Boolean).slice(0, n)) {
    try {
      const o = JSON.parse(line);
      const payload = o.payload || {};
      types.push({
        type: o.type || o.role || o.sessionUpdate || payload.type || payload.item?.type,
        keys: Object.keys(o).slice(0, 8).join(","),
        itemType: payload.item?.type,
        payloadType: payload.type,
        thread_source: payload.thread_source,
        cwd: payload.cwd || o.cwd,
      });
    } catch {
      types.push({ type: "PARSE_FAIL", sample: line.slice(0, 80) });
    }
  }
  return types;
}

function grokDirs() {
  const root = path.join(home, ".grok", "sessions");
  const rows = [];
  if (!exists(root)) return rows;
  for (const enc of fs.readdirSync(root)) {
    const dir = path.join(root, enc);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const id of fs.readdirSync(dir)) {
      const sess = path.join(dir, id);
      if (!fs.statSync(sess).isDirectory()) continue;
      const summary = exists(path.join(sess, "summary.json"));
      const updates = path.join(sess, "updates.jsonl");
      let mtime = 0;
      let size = 0;
      try {
        const st = fs.statSync(updates);
        mtime = st.mtimeMs;
        size = st.size;
      } catch {}
      rows.push({
        cwdEnc: enc,
        id,
        summary,
        updates: exists(updates),
        mtime,
        size,
        ageMin: mtime ? Math.round((now - mtime) / 60000) : null,
      });
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
}

function claudeFiles() {
  const root = path.join(home, ".claude", "projects");
  const rows = [];
  if (!exists(root)) return rows;
  for (const project of fs.readdirSync(root)) {
    const dir = path.join(root, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      rows.push({
        project,
        id: name.replace(/\.jsonl$/, ""),
        file,
        size: st.size,
        mtime: st.mtimeMs,
        ageMin: Math.round((now - st.mtimeMs) / 60000),
        looksChat: /allai-(claude|grok|chatgpt)-chat/i.test(project),
      });
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
}

function codexFiles() {
  const root = path.join(home, ".codex", "sessions");
  const rows = [];
  const stack = [root];
  if (!exists(root)) return rows;
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!name.endsWith(".jsonl")) continue;
      rows.push({
        name,
        file: full,
        size: st.size,
        mtime: st.mtimeMs,
        ageMin: Math.round((now - st.mtimeMs) / 60000),
        twoIds: name.includes("_01"),
      });
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
}

async function main() {
  const history = scanHistory(400);
  const live = await scanLive();
  const merged = mergeWorks(history, live);
  const byKind = (arr) => {
    const out = {};
    for (const item of arr) {
      out[item.kind] = (out[item.kind] || 0) + 1;
    }
    return out;
  };
  const grokDisk = grokDirs();
  const claudeDisk = claudeFiles();
  const codexDisk = codexFiles();
  const grokScanned = history.filter((w) => w.kind === "grok-build");
  const claudeScanned = history.filter((w) => w.kind === "claude-code");
  const codexScanned = history.filter((w) => w.kind === "codex");
  const grokMissingSummary = grokDisk.filter((r) => !r.summary);
  const grokWithSummary = grokDisk.filter((r) => r.summary);
  const claudeNonChat = claudeDisk.filter((r) => !r.looksChat);

  const newest = {
    grok: grokDisk[0],
    claude: claudeNonChat[0] || claudeDisk[0],
    codex: codexDisk[0],
  };

  function sampleMessages(kind, file, id) {
    if (!file) return { error: "no file" };
    const work = {
      id: `${kind}:${id || "x"}`,
      kind,
      agentName: kind,
      title: "",
      cwd: "",
      cliSessionId: id || "x",
      running: false,
      createdAt: 0,
      updatedAt: 0,
      preview: "",
      source: "history",
      messagesFile: file,
    };
    const msgs = loadMessages(work);
    return {
      count: msgs.length,
      users: msgs.filter((m) => m.role === "user").length,
      assistants: msgs.filter((m) => m.role === "assistant").length,
      firstUser: msgs.find((m) => m.role === "user")?.content?.slice(0, 80) || "",
      lastRole: msgs.at(-1)?.role,
      lastPreview: (msgs.at(-1)?.content || "").slice(0, 80),
    };
  }

  const result = {
    now: new Date(now).toISOString(),
    disk: {
      grokSessions: grokDisk.length,
      grokWithSummary: grokWithSummary.length,
      grokMissingSummary: grokMissingSummary.length,
      claudeJsonl: claudeDisk.length,
      claudeNonChat: claudeNonChat.length,
      claudeChat: claudeDisk.length - claudeNonChat.length,
      codexJsonl: codexDisk.length,
      codexTwoIdNames: codexDisk.filter((r) => r.twoIds).length,
    },
    scanned: {
      total: history.length,
      byKind: byKind(history),
      running: history.filter((w) => w.running).map((w) => ({
        kind: w.kind,
        title: w.title.slice(0, 40),
        ageMin: Math.round((now - w.updatedAt) / 60000),
      })),
      live: live.map((w) => ({ kind: w.kind, title: w.title, pid: w.pid })),
      mergedRunning: merged.filter((w) => w.running).length,
    },
    gaps: {
      grokDiskWithSummaryVsScanned: grokWithSummary.length - grokScanned.length,
      claudeNonChatVsScanned: claudeNonChat.length - claudeScanned.length,
      codexDiskVsScanned: codexDisk.length - codexScanned.length,
    },
    newestOnDisk: {
      grok: newest.grok && {
        ...newest.grok,
        looksRunning: looksRunning(newest.grok.mtime),
        scanned: grokScanned.some((w) => w.cliSessionId === newest.grok.id),
        messages: sampleMessages(
          "grok-build",
          path.join(home, ".grok", "sessions", newest.grok.cwdEnc, newest.grok.id, "updates.jsonl"),
          newest.grok.id,
        ),
      },
      claude: newest.claude && {
        project: newest.claude.project,
        id: newest.claude.id,
        ageMin: newest.claude.ageMin,
        looksRunning: looksRunning(newest.claude.mtime),
        scanned: claudeScanned.some((w) => w.cliSessionId === newest.claude.id),
        types: firstTypes(newest.claude.file, 8),
        messages: sampleMessages("claude-code", newest.claude.file, newest.claude.id),
      },
      codex: newest.codex && {
        name: newest.codex.name,
        ageMin: newest.codex.ageMin,
        size: newest.codex.size,
        twoIds: newest.codex.twoIds,
        looksRunning: looksRunning(newest.codex.mtime),
        scanned: codexScanned.some((w) => newest.codex.file.includes(w.cliSessionId) || w.messagesFile === newest.codex.file),
        types: firstTypes(newest.codex.file, 14),
        messages: sampleMessages("codex", newest.codex.file, newest.codex.name),
      },
    },
    recentCodexNotScanned: codexDisk.slice(0, 15).map((row) => {
      const hit = codexScanned.find((w) => w.messagesFile === row.file);
      return {
        name: row.name,
        ageMin: row.ageMin,
        size: row.size,
        twoIds: row.twoIds,
        scanned: Boolean(hit),
        scannedTitle: hit?.title?.slice(0, 40),
        scannedId: hit?.cliSessionId,
        hiddenGuess: !hit,
      };
    }),
    recentGrok: grokDisk.slice(0, 8).map((row) => ({
      id: row.id.slice(0, 12),
      cwdEnc: row.cwdEnc.slice(0, 40),
      summary: row.summary,
      ageMin: row.ageMin,
      scanned: grokScanned.some((w) => w.cliSessionId === row.id),
    })),
    recentClaude: claudeDisk.slice(0, 8).map((row) => ({
      project: row.project,
      id: row.id.slice(0, 12),
      ageMin: row.ageMin,
      looksChat: row.looksChat,
      scanned: claudeScanned.some((w) => w.cliSessionId === row.id),
    })),
  };

  console.log(JSON.stringify(result, null, 2));

  const failures = [];
  if (codexDisk.length > 0 && codexScanned.length === 0) failures.push("NO_CODEX_HISTORY");
  if (grokWithSummary.length > 0 && grokScanned.length === 0) failures.push("NO_GROK_HISTORY");
  if (claudeNonChat.length > 0 && claudeScanned.length === 0) failures.push("NO_CLAUDE_HISTORY");
  if (newest.codex && result.newestOnDisk.codex.messages.count === 0) failures.push("CODEX_EMPTY_MESSAGES");
  if (newest.codex && !result.newestOnDisk.codex.scanned) failures.push("NEWEST_CODEX_NOT_IN_LIST");
  if (newest.grok && newest.grok.summary && !result.newestOnDisk.grok.scanned) failures.push("NEWEST_GROK_NOT_IN_LIST");
  if (newest.claude && !newest.claude.looksChat && !result.newestOnDisk.claude.scanned) failures.push("NEWEST_CLAUDE_NOT_IN_LIST");
  const liveId = "01a08fe1-2aed-7130-a057-142bf07a9220";
  const splitSession = history.filter((w) => w.kind === "codex" && w.cliSessionId === liveId);
  if (splitSession.length > 1) failures.push("CODEX_DUPLICATE_SESSION_ROWS");
  if (splitSession[0]) {
    const msgs = require("../electron-dist/history.js").loadMessages(splitSession[0]);
    const users = msgs.filter((m) => m.role === "user").map((m) => m.content);
    if (!users.some((text) => text.startsWith("HIHI"))) failures.push("CODEX_MISSING_FIRST_ROLLOUT");
    if ((splitSession[0].messagesFiles || []).length < 2) failures.push("CODEX_MISSING_ROLLOUT_FILES");
  }
  const codexIds = history.filter((w) => w.kind === "codex").map((w) => w.id);
  if (codexIds.length !== new Set(codexIds).size) failures.push("CODEX_DUPLICATE_IDS");
  if (failures.length) {
    console.error("FAIL", failures.join(","));
    process.exitCode = 1;
  } else {
    console.error("PASS scan produced history for all three CLIs and newest sessions loaded messages");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
