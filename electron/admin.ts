import fs from "fs";
import path from "path";
import { app } from "electron";

/**
 * 管理员宿主脚本的位置。
 *
 * 只有主进程算得出来（要用 app / process.resourcesPath），但真正拉起管理员宿主、
 * 往里面派 CLI 的是**终端宿主**（本机 CLI 都在那个进程里 spawn）。所以这里只负责
 * 算路径，通过环境变量交给终端宿主，其余逻辑在 admin-client.ts。
 *
 * 以前是主进程拉起管理员宿主、终端宿主去连 —— 两个进程各自拿 pid 拼管道名，
 * 拼出来的名字不一样，永远连不上（0.15.4 修的）。
 *
 * 必须是磁盘上的真实文件：app.asar 里那份 node 打不开（产品约定 40）。
 */
export function adminHostScript() {
  const candidates = [
    path.join(process.resourcesPath || "", "admin-host.js"),
    path.join(app.getAppPath(), "electron-dist", "admin-host.js"),
    path.join(__dirname, "admin-host.js"),
  ];
  for (const file of candidates) {
    if (!file || file.includes(".asar")) continue;
    if (fs.existsSync(file)) return file;
  }
  return "";
}
