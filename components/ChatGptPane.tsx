"use client";

import { useEffect, useRef } from "react";
import { getDesktop } from "@/lib/desktop";
import type { AllAiDesktop } from "@/types/desktop";

type Props = {
  active: boolean;
};

export function ChatGptPane({ active }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const api: AllAiDesktop = desktop;
    if (!active) {
      void api.hideChatGpt();
      return;
    }

    function report() {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      void api.showChatGpt({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    report();
    const node = ref.current;
    const observer = new ResizeObserver(() => report());
    if (node) observer.observe(node);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      void api.hideChatGpt();
    };
  }, [active, desktop]);

  if (!desktop?.showChatGpt) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">ChatGPT 网页额度</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted">
          ChatGPT 的网页聊天额度和 API / Codex 额度是分开的。OpenAI 没有把 Plus
          聊天额度做成公开接口，桌面版 AllAi 会在这里打开官方 chatgpt.com，登录一次后走网页额度。请用桌面版打开。
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-2 text-xs text-muted">
        官方 ChatGPT 网页 · 走 Plus 聊天额度，不影响 Codex
      </div>
      <div ref={ref} className="min-h-0 min-w-0 flex-1 bg-canvas" />
    </div>
  );
}
