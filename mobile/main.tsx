import { createRoot } from "react-dom/client";
import { LangProvider } from "../components/I18n";
import { App } from "./App";

// 深浅色跟着手机系统走（桌面端是手动切换，手机上没这个必要）。
const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.classList.toggle("dark", media.matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", media.matches ? "#09090b" : "#f4f4f5");
};
applyTheme();
media.addEventListener("change", applyTheme);

/** 打包时由 scripts/build-remote.cjs 注入的编号。 */
declare const __ALLAI_BUILD__: string;

/**
 * iPhone 主屏幕 App 会一直用缓存里的旧版本（服务器说了 no-cache 也不管用）。
 * 启动时、以及从后台切回来时问一下服务器现在是哪一版，对不上就带着新编号刷新一次。
 * 同一个编号只刷一次：万一刷完还是旧的，别陷进无限刷新。
 */
async function checkForUpdate() {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const { build } = (await response.json()) as { build?: string };
    if (!build || build === __ALLAI_BUILD__) return;
    if (sessionStorage.getItem("allai-reload-for") === build) return;
    sessionStorage.setItem("allai-reload-for", build);
    const url = new URL(location.href);
    url.searchParams.set("v", build);
    location.replace(url.toString());
  } catch {
    // 离线、无痕模式写不了 sessionStorage 之类，照常用当前版本
  }
}

void checkForUpdate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkForUpdate();
});

createRoot(document.getElementById("root")!).render(
  <LangProvider>
    <App />
  </LangProvider>,
);
