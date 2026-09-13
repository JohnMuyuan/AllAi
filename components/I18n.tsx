"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  readLangMode,
  resolveLang,
  saveLangMode,
  translate,
  type Lang,
  type LangMode,
} from "@/lib/i18n";

/**
 * 界面语言的上下文。
 *
 * 语言一变整棵树重渲染 —— 这正是我们要的，而且只在用户手动切语言时发生，
 * 不影响约定 38 关心的打字性能（那条路上语言不会变）。
 */
export const LangContext = createContext<Lang>("zh");

type LangApi = {
  lang: Lang;
  langMode: LangMode;
  setLangMode: (mode: LangMode) => void;
};

const LangApiContext = createContext<LangApi>({
  lang: "zh",
  langMode: "system",
  setLangMode: () => undefined,
});

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** `const t = useT();` 然后 `t("新对话")`、`t("共 {n} 段", { n })`。 */
export function useT(): Translate {
  const lang = useContext(LangContext);
  return useCallback(
    (text: string, vars?: Record<string, string | number>) => translate(text, lang, vars),
    [lang],
  );
}

export function useLang() {
  return useContext(LangContext);
}

export function useLangState() {
  return useContext(LangApiContext);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [langMode, setMode] = useState<LangMode>("system");
  const [lang, setLang] = useState<Lang>("zh");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 挂载时从 localStorage 读语言 */
    const mode = readLangMode();
    setMode(mode);
    setLang(resolveLang(mode));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  }, [lang]);

  const setLangMode = useCallback((mode: LangMode) => {
    setMode(mode);
    saveLangMode(mode);
    setLang(resolveLang(mode));
  }, []);

  return (
    <LangApiContext.Provider value={{ lang, langMode, setLangMode }}>
      <LangContext.Provider value={lang}>{children}</LangContext.Provider>
    </LangApiContext.Provider>
  );
}
