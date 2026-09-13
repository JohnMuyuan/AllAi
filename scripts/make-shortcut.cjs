const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// PowerShell literal strings preserve Windows paths (JSON escaping doubles slashes).
const psQuote = (value) => "'" + value.replace(/'/g, "''") + "'";

const exe = path.join(__dirname, "..", "dist", "win-unpacked", "AllAi.exe");
const icon = path.join(__dirname, "..", "packaging", "icon.ico");
if (!fs.existsSync(exe)) {
  console.error("AllAi.exe not found:", exe);
  process.exit(1);
}

const desktop = path.join(os.homedir(), "Desktop", "AllAi.lnk");
const startMenu = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "AllAi.lnk",
);

const ps = `
$exe = ${psQuote(exe)}
$wd = ${psQuote(path.dirname(exe))}
function Make-Shortcut($path) {
  $dir = Split-Path $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $wd
  $s.Description = "AllAi"
  $s.IconLocation = ${psQuote(icon + ",0")}
  $s.Save()
}
Make-Shortcut ${psQuote(desktop)}
Make-Shortcut ${psQuote(startMenu)}
Write-Output "shortcuts ready"
`;

const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
  encoding: "utf8",
});
if (result.status !== 0) {
  console.error(result.stdout, result.stderr);
  process.exit(result.status || 1);
}
console.log(result.stdout.trim());
console.log("Desktop shortcut:", desktop);
