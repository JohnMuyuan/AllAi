/**
 * 把 Agent 改文件的工具调用变成能显示的差异：改了哪个文件、加了哪些行、删了哪些行。
 *
 * 各家会话文件里的原料不一样：
 * - Claude：Edit / MultiEdit 给 old_string、new_string，Write 给整个文件内容；
 * - Grok Build：search_replace 给 old_string、new_string，create_file 给内容；
 * - Codex：FileChange 直接带 unified_diff；老格式是 apply_patch 的补丁文本。
 *
 * 放在 electron/ 是因为这个 tsconfig 用 rootDir:"."，引不到 lib/。界面只负责画。
 */

import fs from "fs";

export type FileDiff = {
  path: string;
  kind: "add" | "update" | "delete" | "write";
  /** 每行第一个字符是 "+"（加）、"-"（删）、" "（上下文）或 "@"（省略了中间一段，后面可以跟 hunk 头）。 */
  lines: string[];
  added: number;
  removed: number;
  truncated?: boolean;
  /** 较早的改动只留统计、不留内容，见 elideOldDiffs。 */
  elided?: boolean;
  /**
   * 只在主进程里临时用：改动前后的原文，用来去当前文件里找行号（Grok 的记录不带行号）。
   * elideOldDiffs 会把它去掉，不会发给界面。
   */
  anchor?: { oldText: string; newText: string };
};

/** 一个文件最多留这么多行。整文件 Write 几千行，全塞进会话列表会把界面拖慢。 */
const MAX_LINES = 400;
const MAX_LINE_CHARS = 400;
/** 改动前后各留几行上下文。 */
const CONTEXT = 2;
/** 逐行对比的规模上限（行数相乘）。超了就不细算，直接「整段删、整段加」。 */
const LCS_LIMIT = 250_000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = str(fields[key]).trim();
    if (value) return value;
  }
  return "";
}

function splitLines(text: string) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function clip(line: string) {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

function finish(path: string, kind: FileDiff["kind"], lines: string[]): FileDiff {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line[0] === "+") added += 1;
    else if (line[0] === "-") removed += 1;
  }
  const truncated = lines.length > MAX_LINES;
  const diff: FileDiff = {
    path,
    kind,
    lines: (truncated ? lines.slice(0, MAX_LINES) : lines).map(clip),
    added,
    removed,
  };
  if (truncated) diff.truncated = true;
  return diff;
}

/**
 * 只留改动前后各 CONTEXT 行。
 * 知道这段在原文件里从第几行开始时，每一段前面放一个 hunk 头（"@@@ -旧行,行数 +新行,行数 @@"，
 * 界面据此算出每一行的行号）；不知道就只用一行 "@" 隔开，不编行号。
 */
function withContext(full: string[], startOld?: number, startNew?: number) {
  const keep = new Array<boolean>(full.length).fill(false);
  full.forEach((line, index) => {
    if (line[0] === " ") return;
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(full.length - 1, index + CONTEXT); k++) keep[k] = true;
  });
  const numbered = startOld !== undefined && startNew !== undefined;
  let oldNo = startOld ?? 0;
  let newNo = startNew ?? 0;
  const out: string[] = [];
  let skipped = false;
  let index = 0;
  while (index < full.length) {
    if (!keep[index]) {
      if (full[index][0] !== "+") oldNo += 1;
      if (full[index][0] !== "-") newNo += 1;
      skipped = true;
      index += 1;
      continue;
    }
    let end = index;
    let oldCount = 0;
    let newCount = 0;
    while (end < full.length && keep[end]) {
      if (full[end][0] !== "+") oldCount += 1;
      if (full[end][0] !== "-") newCount += 1;
      end += 1;
    }
    if (numbered) out.push(`@@@ -${oldNo},${oldCount} +${newNo},${newCount} @@`);
    else if (skipped && out.length) out.push("@");
    for (let k = index; k < end; k++) out.push(full[k]);
    oldNo += oldCount;
    newNo += newCount;
    skipped = false;
    index = end;
  }
  return out;
}

/** 逐行对比（最长公共子序列）。先去掉相同的头尾，只对中间那段算。 */
function lineDiff(a: string[], b: string[], startOld?: number, startNew?: number) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const body: string[] = [];
  if (midA.length * midB.length > LCS_LIMIT) {
    for (const line of midA) body.push(`-${line}`);
    for (const line of midB) body.push(`+${line}`);
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        body.push(` ${midA[i]}`);
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        body.push(`-${midA[i]}`);
        i += 1;
      } else {
        body.push(`+${midB[j]}`);
        j += 1;
      }
    }
    for (; i < n; i++) body.push(`-${midA[i]}`);
    for (; j < m; j++) body.push(`+${midB[j]}`);
  }
  const full = [
    ...a.slice(0, start).map((line) => ` ${line}`),
    ...body,
    ...a.slice(endA).map((line) => ` ${line}`),
  ];
  return withContext(full, startOld, startNew);
}

/** start：这段原文在文件里从第几行开始（知道才传）。替换前后开头那一行是同一行。 */
export function diffFromReplace(path: string, oldText: string, newText: string, start?: number): FileDiff {
  return finish(path, "update", lineDiff(splitLines(oldText), splitLines(newText), start, start));
}

export function diffFromWrite(path: string, content: string, kind: "add" | "write" = "write"): FileDiff {
  const lines = splitLines(content);
  // 写的是整个文件，新文件的行号就是从 1 开始。
  return finish(path, kind, lines.length ? [`@@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)] : []);
}

/** Claude 工具结果里的 structuredPatch：每一段带原文件、新文件的起始行号，最准。 */
export function diffFromHunks(path: string, kind: FileDiff["kind"], hunks: unknown[]): FileDiff {
  const lines: string[] = [];
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  for (const raw of hunks) {
    const hunk = asRecord(raw);
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    lines.push(`@@@ -${num(hunk.oldStart)},${num(hunk.oldLines)} +${num(hunk.newStart)},${num(hunk.newLines)} @@`);
    for (const line of hunk.lines) {
      if (typeof line !== "string" || line.startsWith("\\ No newline")) continue;
      lines.push(line[0] === "+" || line[0] === "-" || line[0] === " " ? line : ` ${line}`);
    }
  }
  return finish(path, kind, lines);
}

/** unified diff 文本（Codex 的 FileChange 就是这个）。开头的 ---/+++ 文件头去掉。 */
export function diffFromUnified(path: string, text: string, kind: FileDiff["kind"] = "update"): FileDiff {
  const lines: string[] = [];
  let seenHunk = false;
  for (const line of splitLines(text)) {
    if (line.startsWith("@@")) {
      seenHunk = true;
      lines.push(`@${line}`);
      continue;
    }
    // 文件头只可能出现在第一个 @@ 之前；之后以 --- 开头的是被删的行（比如 SQL 注释）。
    if (!seenHunk && (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("index "))) {
      continue;
    }
    if (line.startsWith("\\ No newline")) continue;
    lines.push(line[0] === "+" || line[0] === "-" || line[0] === " " ? line : ` ${line}`);
  }
  return finish(path, kind, lines);
}

/** Codex 老格式的 apply_patch：*** Begin Patch / *** Update File: 路径 / @@ / +- 行。 */
export function diffsFromApplyPatch(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let current: { path: string; kind: FileDiff["kind"]; lines: string[] } | null = null;
  const flush = () => {
    if (current) out.push(finish(current.path, current.kind, current.lines));
    current = null;
  };
  for (const line of splitLines(text)) {
    const head = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (head) {
      flush();
      current = {
        path: head[2].trim(),
        kind: head[1] === "Add" ? "add" : head[1] === "Delete" ? "delete" : "update",
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("*** Move to: ")) {
      current.path = line.slice("*** Move to: ".length).trim();
      continue;
    }
    if (line.startsWith("***")) continue;
    if (line.startsWith("@@")) {
      current.lines.push(`@${line}`);
      continue;
    }
    if (line[0] === "+" || line[0] === "-" || line[0] === " ") current.lines.push(line);
  }
  flush();
  return out;
}

/**
 * Codex 的 FileChange.changes。
 * 会话文件里是 { 路径: { type:"update", unified_diff } | { type:"add", content } | { type:"delete" } }；
 * `codex exec --json` 流里是 [{ path, kind }]，没有具体内容，只能列出文件名。
 */
export function diffsFromCodexChanges(changes: unknown): FileDiff[] {
  const out: FileDiff[] = [];
  const push = (path: string, value: Record<string, unknown>) => {
    const type = str(value.type) || str(value.kind);
    const target = str(value.move_path) || path;
    if (typeof value.unified_diff === "string") {
      out.push(diffFromUnified(target, value.unified_diff, "update"));
    } else if (typeof value.diff === "string") {
      out.push(diffFromUnified(target, value.diff, "update"));
    } else if (typeof value.content === "string") {
      out.push(
        type === "delete"
          ? finish(target, "delete", splitLines(value.content).map((line) => `-${line}`))
          : diffFromWrite(target, value.content, "add"),
      );
    } else {
      out.push(finish(target, type === "delete" ? "delete" : type === "add" ? "add" : "update", []));
    }
  };
  if (Array.isArray(changes)) {
    for (const row of changes) {
      const rec = asRecord(row);
      const path = rec ? str(rec.path) : "";
      if (rec && path) push(path, rec);
    }
    return out;
  }
  const rec = asRecord(changes);
  if (!rec) return out;
  for (const [path, value] of Object.entries(rec)) push(path, asRecord(value) ?? {});
  return out;
}

/**
 * 长会话里改文件的差异加起来有上万行，会话大小能翻一倍；盯文件时每次变动都整份发给界面，
 * 打字会跟着卡（0.16.5 / 0.16.6 花力气去掉的那种卡）。所以只给最近 keepLast 条消息
 * 留具体内容，更早的只留文件名和 +N −M。实测 Grok 一条长会话 1476KB → 接近不带差异的 603KB。
 */
export function elideOldDiffs<T extends { trace?: { type: string; diff?: FileDiff[] }[] }>(
  messages: T[],
  keepLast = 40,
): T[] {
  const cut = messages.length - keepLast;
  // 同一次读会话里，同一个文件只读一遍。
  const files = new Map<string, string | null>();
  const read = (file: string) => {
    if (!files.has(file)) {
      try {
        files.set(file, fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n"));
      } catch {
        files.set(file, null);
      }
    }
    return files.get(file) ?? null;
  };
  messages.forEach((message, index) => {
    for (const item of message.trace ?? []) {
      if (!item.diff) continue;
      item.diff = item.diff.map(({ anchor, ...diff }) => {
        if (index < cut) return diff.lines.length ? { ...diff, lines: [], elided: true, truncated: undefined } : diff;
        if (!anchor || diff.lines.some((line) => line.startsWith("@@@ -"))) return diff;
        /*
         * 记录里没有行号（Grok 的 search_replace）：去当前文件里找改完之后的那段。
         * 找不到（后来又被改过）或者不止一处，就不猜，宁可不显示行号也别标错。
         */
        const text = read(diff.path);
        const needle = anchor.newText.replace(/\r\n?/g, "\n");
        if (!text || !needle) return diff;
        const at = text.indexOf(needle);
        if (at < 0 || text.indexOf(needle, at + 1) >= 0) return diff;
        const line = text.slice(0, at).split("\n").length;
        return diffFromReplace(diff.path, anchor.oldText, anchor.newText, line);
      });
    }
  });
  return messages;
}

/**
 * 按工具名和参数认出改文件的调用，返回差异；不是改文件的工具返回 undefined。
 * name 用各家原始工具名（Edit / search_replace / apply_patch…），不是翻译后的中文。
 */
export function diffsForTool(name: string, input: unknown, withAnchor = false): FileDiff[] | undefined {
  const key = (name || "").trim().toLowerCase().replace(/[:：]\s*$/, "");
  let fields = asRecord(input);
  if (!fields && typeof input === "string" && input.trim().startsWith("{")) {
    try {
      fields = asRecord(JSON.parse(input));
    } catch {
      fields = null;
    }
  }

  if (key === "apply_patch") {
    const text = typeof input === "string" && !fields ? input : str(fields?.input) || str(fields?.patch);
    const list = diffsFromApplyPatch(text);
    return list.length ? list : undefined;
  }
  if (!fields) return undefined;
  const path = firstString(fields, ["file_path", "path", "filePath", "target_file", "file"]);
  if (!path) return undefined;

  if (key === "edit" || key === "search_replace" || key === "str_replace" || key === "str_replace_based_edit_tool") {
    const oldText = str(fields.old_string ?? fields.old_str ?? fields.oldText);
    const newText = str(fields.new_string ?? fields.new_str ?? fields.newText);
    if (!oldText && !newText) return undefined;
    const diff = diffFromReplace(path, oldText, newText);
    // 读会话历史时带上原文，稍后去当前文件里找行号；实时流里不带（会原样发给界面）。
    if (withAnchor && newText) diff.anchor = { oldText, newText };
    return [diff];
  }
  if (key === "multiedit") {
    const edits = Array.isArray(fields.edits) ? fields.edits : [];
    const lines: string[] = [];
    for (const edit of edits) {
      const rec = asRecord(edit);
      if (!rec) continue;
      const part = lineDiff(splitLines(str(rec.old_string)), splitLines(str(rec.new_string)));
      if (lines.length && part.length) lines.push("@");
      lines.push(...part);
    }
    return lines.length ? [finish(path, "update", lines)] : undefined;
  }
  if (key === "write" || key === "create_file" || key === "create") {
    const content = str(fields.content ?? fields.file_text ?? fields.contents ?? fields.text);
    return [diffFromWrite(path, content, key === "write" ? "write" : "add")];
  }
  if (key === "delete_file") return [finish(path, "delete", [])];
  return undefined;
}
