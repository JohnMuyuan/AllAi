#!/usr/bin/env node
/* tsc 只编译 .ts，electron/ 下的非 TS 资源要自己搬到 electron-dist/。 */
const fs = require("fs");
const path = require("path");

const from = path.join(__dirname, "..", "electron");
const to = path.join(__dirname, "..", "electron-dist");
const assets = ["computer.ps1", "official-models.json"];

fs.mkdirSync(to, { recursive: true });
let copied = 0;
for (const name of assets) {
  const src = path.join(from, name);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(to, name));
  copied++;
}
console.log(`electron assets copied: ${copied}`);
