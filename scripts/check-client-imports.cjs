#!/usr/bin/env node
/*
 * 防止客户端组件引到服务端专用模块。
 *
 * 起因：ChatApp.tsx 引了 lib/compact.ts 拿一个纯函数，而那个文件的依赖链上
 * 挂着 `fs`（compact → store → scan-suppliers → fs），结果整个浏览器包起不来。
 * tsc 和 eslint 都发现不了，只有真跑起来才报 "Can't resolve 'fs'"。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// 这些模块只能在服务端用（API 路由、其它服务端模块）。
const SERVER_ONLY = ["lib/store", "lib/compact", "lib/conversations", "lib/uploads",
  "lib/usage-store", "lib/scan-suppliers", "lib/paths", "lib/title", "lib/chat-context",
  "lib/model-trace/store", "lib/model-trace/probe"];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const bad = [];
for (const file of walk(path.join(ROOT, "components"))) {
  const src = fs.readFileSync(file, "utf8");
  for (const hit of src.matchAll(/from\s+"(@\/lib\/[\w-]+(?:\/[\w-]+)*)"/g)) {
    const mod = hit[1].replace("@/", "");
    // `import type` 只是类型，编译后会被抹掉，不进包。
    const line = src.slice(0, hit.index).split("\n").pop() || "";
    const stmt = src.slice(src.lastIndexOf("import", hit.index), hit.index);
    if (/\btype\b/.test(stmt) && !/\{[^}]*\b(?!type)\w+\s*,/.test(stmt)) continue;
    if (line.includes("import type") || stmt.startsWith("import type")) continue;
    if (SERVER_ONLY.includes(mod)) {
      bad.push(`${path.relative(ROOT, file)} → ${mod}`);
    }
  }
}

if (bad.length) {
  console.error("客户端组件引到了服务端专用模块：");
  for (const row of bad) console.error("  " + row);
  console.error("\n把要用的纯函数搬到 lib/context-window.ts 这类不碰 fs/fetch 的模块里。");
  process.exit(1);
}
console.log(`client import check OK (${SERVER_ONLY.length} server-only modules)`);
