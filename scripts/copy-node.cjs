const fs = require("fs");
const path = require("path");

const destDir = path.join(__dirname, "..", "packaging");
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, "node.exe");
fs.copyFileSync(process.execPath, dest);
console.log("copied node to", dest);
