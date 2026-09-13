/**
 * 外观：日间 / 夜间 / 跟随系统。
 *
 * 存的是**模式**（`allai-theme`: light / dark / system），不是最终颜色 ——
 * 选了「跟随系统」之后，用户在 Windows 里改深浅色，AllAi 要当场跟着变，
 * 所以真正的深浅是每次现算的（`resolveTheme`），并且订阅 `prefers-color-scheme`。
 *
 * 纯函数 + 浏览器 API，界面和 app/layout.tsx 里那段防闪烁脚本共用同一套键名。
 */

import { getDesktop } from "./desktop";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_KEY = "allai-theme";

export const THEME_MODES: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "light", label: "日间", hint: "一直用浅色" },
  { value: "dark", label: "夜间", hint: "一直用深色" },
  { value: "system", label: "跟随系统", hint: "跟着系统的深浅色走" },
];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** 读存下来的模式。**0.16.37 之前只存 light / dark**，老值照旧认。 */
export function readThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // 无痕模式等读不到，按默认来
  }
  return "system";
}

export function systemPrefersDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // 拿不到就按深色 —— AllAi 一直是深色起家的
    return true;
  }
}

/** 模式 → 这一刻到底该深还是浅。 */
export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "light" || mode === "dark") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  getDesktop()?.setTheme?.(resolved);
  return resolved;
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // 存不下就只在这次会话里生效
  }
}

/**
 * 订阅系统深浅色变化。只有「跟随系统」时才需要，别的模式返回一个空函数。
 * 返回取消订阅的函数。
 */
export function watchSystemTheme(onChange: () => void) {
  try {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}
