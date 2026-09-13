#!/usr/bin/env node
/*
 * 打包远程控制的中继服务和手机网页，输出到 relay/dist/：
 *   server.cjs      中继服务（ws 已经打进去了，服务器上只要有 Node，不用 npm install）
 *   public/         手机网页：index.html、app.js、app.css、图标
 *
 * 部署时只要把 relay/dist 整个目录（或者 relay/ 连同 Dockerfile）传到服务器。
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");

const root = path.join(__dirname, "..");
const out = path.join(root, "relay", "dist");
const pub = path.join(out, "public");

async function main() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(pub, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(root, "relay", "server.ts")],
    outfile: path.join(out, "server.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // ws 的可选原生加速包，没装就走纯 JS，打包时别去找它们。
    external: ["bufferutil", "utf-8-validate"],
    logLevel: "warning",
  });

  // 每次打包一个新编号。iPhone 主屏幕 App 会无视 no-cache 一直用旧的 app.js，
  // 所以 index.html 里的资源地址带上 ?v=编号（地址变了缓存就不作数），
  // 手机网页启动时也会拿 version.json 对一下，旧了就自己刷新一次。
  const build = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  await esbuild.build({
    entryPoints: [path.join(root, "mobile", "main.tsx")],
    outfile: path.join(pub, "app.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2022", "safari16", "chrome110"],
    minify: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', __ALLAI_BUILD__: JSON.stringify(build) },
    tsconfig: path.join(root, "tsconfig.json"),
    logLevel: "warning",
  });

  // 样式和桌面端同一套（颜色、深浅色主题），Tailwind 额外扫一遍 mobile/ 目录。
  const cssEntry = path.join(root, "mobile", "app.css");
  const css = await postcss([tailwind({ base: root })]).process(fs.readFileSync(cssEntry, "utf8"), {
    from: cssEntry,
    to: path.join(pub, "app.css"),
  });
  fs.writeFileSync(path.join(pub, "app.css"), css.css);

  const html = fs
    .readFileSync(path.join(root, "mobile", "index.html"), "utf8")
    .replace('src="./app.js"', `src="./app.js?v=${build}"`)
    .replace('href="./app.css"', `href="./app.css?v=${build}"`);
  if (!html.includes(`app.js?v=${build}`) || !html.includes(`app.css?v=${build}`)) {
    throw new Error("index.html 里找不到 app.js / app.css 的引用，版本号没加上");
  }
  fs.writeFileSync(path.join(pub, "index.html"), html);
  fs.writeFileSync(path.join(pub, "version.json"), JSON.stringify({ build }));
  fs.copyFileSync(path.join(root, "mobile", "manifest.webmanifest"), path.join(pub, "manifest.webmanifest"));
  fs.copyFileSync(path.join(root, "public", "logo.png"), path.join(pub, "icon.png"));
  fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ private: true, type: "commonjs" }, null, 2));

  const size = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)}KB`;
  console.log(
    `remote built ${build}: server.cjs ${size(path.join(out, "server.cjs"))}, app.js ${size(path.join(pub, "app.js"))}, app.css ${size(path.join(pub, "app.css"))}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
