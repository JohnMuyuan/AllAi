"use client";

import { useState, type DragEvent } from "react";

/**
 * 列表拖拽排序。
 *
 * 用法：手柄挂 `handleProps(index)`，整行挂 `rowProps(index)`。
 * 拖拽只从手柄发起（`draggable` 放在手柄上），行里的输入框才能正常选中文字 ——
 * 整行 draggable 的话，在备注框里划词会变成拖行。
 *
 * 键盘用不了拖拽，所以调用方要另外保留上移/下移按钮（见 OrderButtons）。
 */
export function useDragOrder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function finish() {
    setDragging(null);
    setOver(null);
  }

  function handleProps(index: number) {
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setDragging(index);
        event.dataTransfer.effectAllowed = "move";
        // Firefox 不设 data 就不触发后续事件
        event.dataTransfer.setData("text/plain", String(index));
      },
      onDragEnd: finish,
    };
  }

  function rowProps(index: number) {
    return {
      onDragOver: (event: DragEvent) => {
        if (dragging === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (over !== index) setOver(index);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        const raw = Number(event.dataTransfer.getData("text/plain"));
        const from = dragging ?? (Number.isFinite(raw) ? raw : null);
        finish();
        if (from != null && from !== index) onMove(from, index);
      },
      onDragLeave: () => {
        if (over === index) setOver(null);
      },
    };
  }

  /** 拖起来的那一行变淡，正在悬停的那一行画一条落点线。 */
  function rowClass(index: number) {
    if (dragging === index) return "opacity-40";
    if (over === index && dragging !== null) return "ring-1 ring-accent";
    return "";
  }

  return { handleProps, rowProps, rowClass, dragging };
}

/** 把 from 挪到 to（其余保持相对次序）。 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
