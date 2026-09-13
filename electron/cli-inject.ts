import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 把一段文字打进用户已经开着的 CLI 窗口（PowerShell / Windows Terminal 里的
 * claude / grok）。用会话登记表里的 pid，不扫进程名。
 *
 * 先激活那个窗口，再按键。TUI 正在忙时可能接不住，调用方失败就退回 AllAi 自己 spawn。
 */
export function injectConsoleText(pid: number, text: string): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  const file = path.join(os.tmpdir(), `allai-inject-${pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$targetPid = ${pid}
$file = ${JSON.stringify(file)}
if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { exit 1 }
[void][Microsoft.VisualBasic.Interaction]::AppActivate($targetPid)
Start-Sleep -Milliseconds 250
$raw = [IO.File]::ReadAllText($file)
foreach ($ch in $raw.ToCharArray()) {
  if ($ch -eq [char]10) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); continue }
  if ($ch -eq [char]9) { [System.Windows.Forms.SendKeys]::SendWait('{TAB}'); continue }
  $s = [string]$ch
  if ('+^%~(){}[]'.Contains($s)) { $s = '{' + $s + '}' }
  [System.Windows.Forms.SendKeys]::SendWait($s)
}
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
exit 0
`;
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 已经结束
      }
      cleanup();
      resolve(false);
    }, 20000);
    const cleanup = () => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(file);
      } catch {
        // 临时文件
      }
    };
    child.on("exit", (code) => {
      cleanup();
      resolve(code === 0);
    });
    child.on("error", () => {
      cleanup();
      resolve(false);
    });
  });
}
