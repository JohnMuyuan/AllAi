"use client";

import { ChevronRight, FileMinus, FilePen, FilePlus } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { AgentTraceItem, FileDiff } from "@/lib/types";
import { useT, type Translate } from "./I18n";

/**
 * Agent 这一轮改了哪些文件：文件名 + 加了几行 / 删了几行，点开看具体改动。
 * 原料是主进程从各家会话文件里解析出来的（electron/diff.ts），这里只负责画。
 * 放在执行过程外面，不用展开「执行过程」也能一眼看到改了什么。
 */

/** 同一个文件在一轮里改了好几次，合成一条：计数相加，改动按先后接起来。 */
function collect(items: AgentTraceItem[]): FileDiff[] {
  const map = new Map<string, FileDiff>();
  for (const item of items) {
    if (item.type !== "tool" || !item.diff) continue;
    for (const diff of item.diff) {
      const prev = map.get(diff.path);
      if (!prev) {
        map.set(diff.path, { ...diff, lines: [...diff.lines] });
        continue;
      }
      map.set(diff.path, {
        ...prev,
        kind: prev.kind === "add" ? "add" : diff.kind === "delete" ? "delete" : prev.kind,
        lines: prev.lines.length && diff.lines.length ? [...prev.lines, "@", ...diff.lines] : [...prev.lines, ...diff.lines],
        added: prev.added + diff.added,
        removed: prev.removed + diff.removed,
        truncated: prev.truncated || diff.truncated,
      });
    }
  }
  return [...map.values()];
}

/** 只留最后三段路径，绝对路径太长。 */
function shortPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 3 ? parts.join("/") : `…/${parts.slice(-3).join("/")}`;
}

export const FileChanges = memo(function FileChanges({ items }: { items: AgentTraceItem[] }) {
  const t = useT();
  const files = useMemo(() => collect(items), [items]);
  if (!files.length) return null;
  const added = files.reduce((sum, item) => sum + item.added, 0);
  const removed = files.reduce((sum, item) => sum + item.removed, 0);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-elevated text-sm">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted">
        <FilePen className="size-3.5 shrink-0" />
        <span>{t("改了 {n} 个文件", { n: files.length })}</span>
        <span className="font-mono text-emerald-500">+{added}</span>
        <span className="font-mono text-danger">−{removed}</span>
      </div>
      <div className="border-t border-line">
        {files.map((file) => (
          <FileRow key={file.path} diff={file} />
        ))}
      </div>
    </div>
  );
});

function FileRow({ diff }: { diff: FileDiff }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = diff.kind === "delete" ? FileMinus : diff.kind === "add" ? FilePlus : FilePen;
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-user/60"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={diff.path}>
          {shortPath(diff.path)}
        </span>
        {diff.kind === "add" ? <span className="shrink-0 text-[11px] text-emerald-500">{t("新建")}</span> : null}
        {diff.kind === "delete" ? <span className="shrink-0 text-[11px] text-danger">{t("删除")}</span> : null}
        <span className="shrink-0 font-mono text-[11px] text-emerald-500">+{diff.added}</span>
        <span className="shrink-0 font-mono text-[11px] text-danger">−{diff.removed}</span>
      </button>
      {open ? <DiffView diff={diff} /> : null}
    </div>
  );
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

type Row = { line: string; oldNo: number | null; newNo: number | null };

/**
 * 按 hunk 头（"@@ -旧行,行数 +新行,行数 @@"）算出每一行在原文件、新文件里是第几行。
 * 删掉的行只有原文件行号，新加的行只有新文件行号，没动的上下文两边都有。
 * 没有 hunk 头的段（只知道片段、不知道在文件哪里）就不显示行号，不编。
 */
function numberLines(lines: string[]): Row[] {
  let oldNo = 0;
  let newNo = 0;
  let known = false;
  return lines.map((line) => {
    if (line[0] === "@") {
      const head = HUNK.exec(line.slice(1));
      known = Boolean(head);
      if (head) {
        oldNo = Number(head[1]);
        newNo = Number(head[2]);
      }
      return { line, oldNo: null, newNo: null };
    }
    if (!known) return { line, oldNo: null, newNo: null };
    if (line[0] === "+") return { line, oldNo: null, newNo: newNo++ };
    if (line[0] === "-") return { line, oldNo: oldNo++, newNo: null };
    return { line, oldNo: oldNo++, newNo: newNo++ };
  });
}

function hunkLabel(line: string, t: Translate) {
  const head = HUNK.exec(line.slice(1));
  return head ? t("第 {n} 行起", { n: head[2] === "0" ? head[1] : head[2] }) : "⋯";
}

function DiffView({ diff }: { diff: FileDiff }) {
  const t = useT();
  if (!diff.lines.length) {
    return (
      <div className="px-9 pb-2 text-[11px] text-muted">
        {diff.elided
          ? t("这是比较早的改动，为了不拖慢界面只保留了统计，没有加载具体内容。")
          : t("会话记录里没有这次改动的具体内容。")}
      </div>
    );
  }
  const rows = numberLines(diff.lines);
  return (
    <div className="max-h-96 overflow-auto border-t border-line bg-code font-mono text-[12px] leading-5">
      <div className="min-w-max py-1">
        {rows.map(({ line, oldNo, newNo }, index) =>
          line[0] === "@" ? (
            <div key={index} className="select-none bg-user/40 px-3 py-0.5 text-[11px] text-muted/80">
              {hunkLabel(line, t)}
            </div>
          ) : (
            <div
              key={index}
              className={`flex whitespace-pre pr-4 ${
                line[0] === "+"
                  ? "bg-emerald-500/12 text-emerald-600"
                  : line[0] === "-"
                    ? "bg-danger/10 text-danger"
                    : "text-muted"
              }`}
            >
              {/* 左边是原文件的行号，右边是改完后的行号 */}
              <span className="w-10 shrink-0 select-none pr-1 text-right opacity-50">{oldNo ?? ""}</span>
              <span className="w-10 shrink-0 select-none pr-1 text-right opacity-50">{newNo ?? ""}</span>
              <span className="w-5 shrink-0 select-none text-center opacity-70">
                {line[0] === " " ? "" : line[0] === "-" ? "−" : "+"}
              </span>
              <span>{line.slice(1)}</span>
            </div>
          ),
        )}
        {diff.truncated ? <div className="px-3 py-1 text-[11px] text-muted">{t("…太长了，后面的没有显示")}</div> : null}
      </div>
    </div>
  );
}
