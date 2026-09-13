"use client";

import { useState } from "react";
import { useT } from "./I18n";

export const FOLD_LIMIT = 2000;

export function Foldable({
  text,
  children,
  align = "start",
}: {
  text: string;
  children: (shown: string) => React.ReactNode;
  align?: "start" | "end";
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > FOLD_LIMIT;
  const shown = long && !expanded ? `${text.slice(0, FOLD_LIMIT)}\n…` : text;

  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] ${
        align === "end" ? "flex flex-col items-end" : ""
      }`}
    >
      {children(shown)}
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-xs text-accent hover:underline"
        >
          {expanded ? t("收起") : t("展开全部（{n} 字）", { n: text.length.toLocaleString() })}
        </button>
      ) : null}
    </div>
  );
}
