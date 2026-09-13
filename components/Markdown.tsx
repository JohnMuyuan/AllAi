"use client";

import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDesktop } from "@/lib/desktop";
import { useT } from "./I18n";

function CodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const language = /language-([\w-]+)/.exec(className || "")?.[1] ?? "";
  const text = String(children).replace(/\n$/, "");

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-muted">
        <span className="font-mono">{language || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted transition-colors duration-150 hover:bg-elevated hover:text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t("已复制") : t("复制")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-6">
        <code className="font-mono text-ink">{text}</code>
      </pre>
    </div>
  );
}

function looksLocal(href?: string) {
  if (!href) return false;
  const raw = href.trim();
  if (raw.startsWith("file:")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return true;
  if (raw.startsWith("\\\\")) return true;
  if (raw.startsWith("./") || raw.startsWith("../")) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return false;
  return Boolean(raw);
}

/**
 * 渲染一段 Markdown。**必须 memo** —— micromark 解析很贵，一条长对话里有上百段，
 * 不 memo 的话在输入框里敲一个字就会把它们全部重新解析一遍（实测占了输入延迟的一半）。
 */
export const Markdown = memo(function Markdown({
  children,
  cwd,
}: {
  children: string;
  cwd?: string;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!looksLocal(href)) return;
                event.preventDefault();
                void getDesktop()
                  ?.revealPath(href || "", cwd)
                  .then((ok) => {
                    if (!ok && href) window.open(href, "_blank", "noreferrer");
                  });
              }}
            >
              {label}
            </a>
          ),
          pre: ({ children: code }) => <>{code}</>,
          code: ({ className, children: code }) => {
            const isBlock = Boolean(className) || String(code).includes("\n");
            if (isBlock) return <CodeBlock className={className}>{code}</CodeBlock>;
            return <code className="inline-code">{code}</code>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
