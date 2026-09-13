"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { getDesktop } from "@/lib/desktop";
import "@xterm/xterm/css/xterm.css";

export function AgentTerminal({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = getDesktop();
    const host = hostRef.current;
    if (!desktop || !host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily:
        'Consolas, "Cascadia Mono", "Sarasa Term SC", "Microsoft YaHei Mono", ui-monospace, monospace',
      theme: {
        background: "#09090b",
        foreground: "#f4f4f5",
        cursor: "#818cf8",
        selectionBackground: "#4f46e580",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const applySize = () => {
      try {
        fit.fit();
        desktop.resize(sessionId, term.cols, term.rows);
      } catch {
        // container may be hidden
      }
    };

    const observer = new ResizeObserver(() => applySize());
    observer.observe(host);

    let offData = () => {};
    let offExit = () => {};

    desktop.attach(sessionId).then(({ history }) => {
      if (history) term.write(history);
      applySize();
      term.focus();
    });

    offData = desktop.onData((id, data) => {
      if (id === sessionId) term.write(data);
    });
    offExit = desktop.onExit((id, code) => {
      if (id === sessionId) {
        term.write(`\r\n\x1b[90m进程已结束（${code}）\x1b[0m\r\n`);
      }
    });
    const input = term.onData((data) => desktop.write(sessionId, data));

    host.addEventListener("mousedown", () => term.focus());

    return () => {
      offData();
      offExit();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden bg-[#09090b]" />;
}
