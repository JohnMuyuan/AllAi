import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans-loaded",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-loaded",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AllAi",
  description: "接入你自己的 AI 模型，随时切换，对话不断档。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            // 首屏防闪烁：在 React 跑起来之前先把深浅定下来。三种模式要和 lib/theme.ts 一致，
            // 「跟随系统」和没存过都看 prefers-color-scheme。
            __html: `(function(){try{var t=localStorage.getItem("allai-theme");var d=t==="dark"||(t!=="light"&&(!window.matchMedia||window.matchMedia("(prefers-color-scheme: dark)").matches));document.documentElement.classList.toggle("dark",d);}catch(e){document.documentElement.classList.add("dark");}})();`,
          }}
        />
      </head>
      <body className="h-full overflow-hidden bg-canvas font-sans text-ink">
        {children}
      </body>
    </html>
  );
}
