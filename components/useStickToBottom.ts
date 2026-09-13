"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * 消息列表的滚动，桌面三个专区和手机网页共用：
 * - 打开一条对话、或者换一条对话时，直接到最新一条（不管上一条翻到了哪儿）；
 * - 用户往上翻着看时，新内容进来不把他拽回底部；
 * - 图片、代码块晚一点才撑高时，只要原本在底部就继续跟住。
 *
 * 用回调 ref 而不是在挂载时绑一次：滚动区经常是后来才出现的（手机上先是列表、点进去才有对话；
 * Agent 没消息时根本不渲染滚动区），只在挂载时绑一次就会绑空，打开对话停在最上面（0.16.x 的 BUG）。
 *
 * `threadKey` 是当前对话的编号，变了就当成新打开的一条。
 */
export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(
  dep: unknown,
  threadKey: unknown,
  threshold = 96,
) {
  const node = useRef<T | null>(null);
  const stick = useRef(true);
  const cleanup = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = null;
      node.current = el;
      if (!el) return;
      const toBottom = () => {
        el.scrollTop = el.scrollHeight;
      };
      const onScroll = () => {
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      };
      // 内容晚到的撑高也要跟住：盯住滚动区里每一个直接子元素的尺寸。
      const resize = new ResizeObserver(() => {
        if (stick.current) toBottom();
      });
      const observeChildren = () => {
        resize.disconnect();
        for (const child of Array.from(el.children)) resize.observe(child);
      };
      const mutation = new MutationObserver(observeChildren);
      observeChildren();
      mutation.observe(el, { childList: true });
      el.addEventListener("scroll", onScroll, { passive: true });
      stick.current = true;
      toBottom();
      cleanup.current = () => {
        el.removeEventListener("scroll", onScroll);
        resize.disconnect();
        mutation.disconnect();
      };
    },
    [threshold],
  );

  // 换了一条对话：这一条从最新开始看。要在下面那个滚动的 effect 之前把 stick 摆回来。
  useLayoutEffect(() => {
    stick.current = true;
  }, [threadKey]);

  useLayoutEffect(() => {
    const el = node.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep, threadKey]);

  return { ref, node };
}
