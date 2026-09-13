const fs = require("fs");
const path = require("path");

/*
 * electron-builder 会把 extraResources 里的 node_modules 过滤掉，所以 packaging/ 下
 * 准备好的依赖到不了 resources/。standalone 一直是在这儿补回去的；pty-host 漏了 ——
 * 它 require("node-pty")，少了就一启动就挂，界面上只剩一句「无法联系终端宿主」。
 *
 * 在开发机上看不出来：resources/pty-host 就在仓库里面，require 会一路往上找到
 * 仓库自己的 node_modules。换台机器（也就是真正装安装包的人）直接废掉。
 */
const NEEDS_MODULES = ["standalone", "pty-host"];

exports.default = async function afterPack(context) {
  for (const name of NEEDS_MODULES) {
    const src = path.join(__dirname, "..", "packaging", name, "node_modules");
    const dest = path.join(context.appOutDir, "resources", name, "node_modules");
    if (!fs.existsSync(src)) {
      throw new Error(`${name} node_modules missing; run prepare-runtime first`);
    }
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`copied ${name} node_modules ->`, dest);
  }
};
