const fs = require("fs");
const path = require("path");

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

const root = path.join(__dirname, "..");

const ptyHost = path.join(root, "packaging", "pty-host");
fs.rmSync(ptyHost, { recursive: true, force: true });
copyDir(path.join(root, "electron-dist"), ptyHost);
copyDir(
  path.join(root, "node_modules", "node-pty"),
  path.join(ptyHost, "node_modules", "node-pty"),
);

const standaloneSrc = path.join(root, ".next", "standalone");
const standaloneDest = path.join(root, "packaging", "standalone");
if (!fs.existsSync(path.join(standaloneSrc, "server.js"))) {
  throw new Error("找不到 .next/standalone，请先运行 next build 再 prepare-runtime");
}
fs.rmSync(standaloneDest, { recursive: true, force: true });
copyDir(standaloneSrc, standaloneDest);
const staticSrc = path.join(root, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyDir(staticSrc, path.join(standaloneDest, ".next", "static"));
}
const publicSrc = path.join(root, "public");
if (fs.existsSync(publicSrc)) {
  copyDir(publicSrc, path.join(standaloneDest, "public"));
}

console.log("prepared", ptyHost);
console.log("prepared", standaloneDest);
