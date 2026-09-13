"use client";

import { Copy, Minus, Smartphone, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getDesktop } from "@/lib/desktop";
import { Logo } from "./Logo";
import { useT } from "./I18n";
import { useRemoteStatus } from "./useRemoteControl";

/**
 * 自己的标题栏。窗口开了 `frame: false`，系统那条会跟着 Windows 主题色变，
 * 和软件皮肤对不上。
 *
 * 拖动靠 CSS 的 `-webkit-app-region`：整条可拖，按钮上要显式设回 no-drag，
 * 否则点不动。
 */
export function TitleBar({ version }: { version: string }) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const [ready, setReady] = useState(false);
  const remote = useRemoteStatus();

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.windowState) return;
    // 等 IPC 回了再 setReady：在 effect 体里同步 setState 会多跑一轮渲染。
    // 失败也要显示 —— 桌面端的 API 都在，只是这一次问不到最大化状态，
    // 不该因此整条标题栏消失（那样窗口就没有关闭按钮了）。
    void desktop
      .windowState()
      .then((state) => setMaximized(state.maximized))
      .catch(() => undefined)
      .finally(() => setReady(true));
    return desktop.onWindowState?.((state) => setMaximized(state.maximized));
  }, []);

  // 网页里跑的时候没有窗口按钮可言，整条都不显示。
  if (!ready) return null;

  const desktop = getDesktop();
  return (
    <div className="titlebar flex h-9 shrink-0 items-center gap-2 border-b border-line bg-sidebar pl-3 select-none">
      <Logo className="size-4" />
      <span className="text-[11px] font-medium tracking-tight text-muted">AllAi</span>
      <span className="text-[11px] text-muted/70">v{version}</span>
      <div className="ml-auto flex h-full titlebar-buttons">
        {remote && remote.state !== "off" ? (
          <button
            type="button"
            aria-label={t("远程控制")}
            title={
              remote.sessions.length
                ? t("远程控制：{names} 正连着", { names: remote.sessions.map((item) => item.name).join(", ") })
                : remote.state === "online"
                  ? t("远程控制已开启，没有设备连着")
                  : remote.error || t("远程控制正在连接中继")
            }
            onClick={() => window.dispatchEvent(new CustomEvent("allai:open-settings", { detail: "remote" }))}
            className={`mr-1 flex items-center gap-1 self-center rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-user ${
              remote.sessions.length ? "text-emerald-500" : remote.state === "error" ? "text-danger" : "text-muted"
            }`}
          >
            <Smartphone className="size-3.5" />
            {remote.sessions.length ? remote.sessions.length : null}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t("最小化")}
          onClick={() => void desktop?.windowMinimize?.()}
          className="grid h-full w-11 place-items-center text-muted transition-colors hover:bg-user hover:text-ink"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={maximized ? t("还原") : t("最大化")}
          onClick={() => void desktop?.windowToggleMaximize?.()}
          className="grid h-full w-11 place-items-center text-muted transition-colors hover:bg-user hover:text-ink"
        >
          {maximized ? <Copy className="size-3 scale-x-[-1]" /> : <Square className="size-3" />}
        </button>
        <button
          type="button"
          aria-label={t("关闭")}
          onClick={() => void desktop?.windowClose?.()}
          className="grid h-full w-11 place-items-center text-muted transition-colors hover:bg-danger hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
