# 把远程控制中继部署到你的 Linux 服务器。在项目根目录执行：
#   npm run remote:deploy                           # 部署 / 更新（第一次会顺带配好免密登录）
#   .\scripts\relay-push.ps1 status                 # 容器状态 + 健康检查
#   .\scripts\relay-push.ps1 logs                   # 看中继日志（Ctrl+C 退出）
#   .\scripts\relay-push.ps1 token                  # 再看一次中继口令
#   .\scripts\relay-push.ps1 restart | down         # 重启 / 停止
#   .\scripts\relay-push.ps1 key                    # 只配置免密登录
#
# 配置在 scripts\relay-deploy.env（从 relay-deploy.env.example 复制）。
# 服务器上只需要 Docker（1Panel 自带）。反向代理和 HTTPS 你在 1Panel 里自己配，
# 代理地址填 http://127.0.0.1:30778。
#
# 关于密码：脚本不存服务器密码，用 SSH 公钥登录 —— 第一次输一次密码把公钥装上，
# 之后都不再需要。私钥留在本机 ~\.ssh 下，在服务器 authorized_keys 里删掉那一行即可吊销。
param(
  [ValidateSet('deploy', 'key', 'status', 'logs', 'token', 'restart', 'down')]
  [string]$Command = 'deploy'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

<#
  跑外部命令（ssh / scp / tar / npm），只看退出码判断成败。
  PowerShell 5.1 会把外部程序写到 stderr 的每一行包成 ErrorRecord，docker build
  的进度全走 stderr，不放开 ErrorActionPreference 的话第一行进度就会被当成失败。
#>
function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$Exe,
    [Parameter(Mandatory)][string[]]$Arguments,
    [string]$FailMessage = 'command failed'
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments }
  finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "$FailMessage ($LASTEXITCODE)" }
}

# 配置不对时给一句人话，不抛一大段 PowerShell 异常
function Stop-Config {
  param([Parameter(Mandatory)][string]$Message)
  Write-Host $Message -ForegroundColor Yellow
  exit 1
}

$envFile = Join-Path $PSScriptRoot 'relay-deploy.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $PSScriptRoot 'relay-deploy.env.example') $envFile
  Write-Host '已生成 scripts\relay-deploy.env，请填好 HOST（和 SSH_PORT）后再运行一次。'
  exit 1
}

$cfg = @{}
Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $eq = $line.IndexOf('=')
  if ($eq -lt 1) { return }
  $cfg[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
}

$Target = $cfg['HOST']
$RemoteDir = $cfg['REMOTE_DIR']
if (-not $RemoteDir) { $RemoteDir = '/opt/allai-relay' }
$SshPort = '22'
if ($cfg['SSH_PORT']) { $SshPort = $cfg['SSH_PORT'] }
$RelayPort = '30778'
if ($cfg['RELAY_PORT']) { $RelayPort = $cfg['RELAY_PORT'] }
if (-not $Target -or $Target -eq 'root@192.168.1.10') {
  Stop-Config 'scripts\relay-deploy.env 里的 HOST 还没填（格式：用户@服务器IP，例如 root@1.2.3.4）'
}
if ($RelayPort -notmatch '^\d{1,5}$') { Stop-Config "RELAY_PORT 不是有效端口：$RelayPort" }
if ($RemoteDir -notmatch '^/[A-Za-z0-9._/-]+$') { Stop-Config "REMOTE_DIR 只能是绝对路径（字母数字 . _ - /）：$RemoteDir" }

$KeyPath = Join-Path $env:USERPROFILE '.ssh\allai_relay_deploy'
if ($cfg['SSH_KEY']) { $KeyPath = [Environment]::ExpandEnvironmentVariables($cfg['SSH_KEY']) }

# 发给 bash 的脚本必须是 LF：这个 .ps1 是 CRLF，here-string 会把 \r 带过去，
# bash 会报 "invalid option"、"unexpected end of file"。
function ConvertTo-BashScript {
  param([Parameter(Mandatory)][string]$Text)
  return $Text.Replace("`r", '')
}

# IdentitiesOnly=yes：不加的话 ssh 会把本机每一把钥匙都试一遍，
# 钥匙一多先撞上服务器的 MaxAuthTries，明明配好了还是回落到问密码。
function Get-SshArgs {
  param([switch]$Scp)
  $portFlag = '-p'
  if ($Scp) { $portFlag = '-P' }
  $a = @($portFlag, $SshPort)
  if (Test-Path -LiteralPath $KeyPath) { $a += @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes') }
  return $a
}

$script:LastSshError = ''

# BatchMode=yes：需要交互时直接失败，退出码就是「能不能免密进去」。
function Test-Passwordless {
  $a = Get-SshArgs
  $a += @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', $Target, 'exit 0')
  $errFile = [IO.Path]::GetTempFileName()
  try {
    $proc = Start-Process -FilePath 'ssh' -ArgumentList $a -NoNewWindow -Wait -PassThru -RedirectStandardError $errFile
    $script:LastSshError = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue
    if ($null -eq $script:LastSshError) { $script:LastSshError = '' }
    return ($proc.ExitCode -eq 0)
  }
  finally {
    Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Install-DeployKey {
  if (-not (Test-Path -LiteralPath $KeyPath)) {
    Write-Host "==> 生成部署专用密钥 $KeyPath"
    New-Item -ItemType Directory -Force (Split-Path -Parent $KeyPath) | Out-Null
    # -N '""' 在 PowerShell 5.1 里传给 ssh-keygen 的是空口令
    Invoke-Native ssh-keygen @('-t', 'ed25519', '-f', $KeyPath, '-N', '""', '-C', 'allai-relay-deploy', '-q') '生成密钥失败'
  }
  else {
    Write-Host "==> 复用已有密钥 $KeyPath"
  }
  # OpenSSH 拒绝「别人也能读」的私钥，关掉继承、只留当前用户
  try { & icacls $KeyPath /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null } catch {}

  $pubPath = "$KeyPath.pub"
  if (-not (Test-Path -LiteralPath $pubPath)) { throw "找不到公钥 $pubPath" }
  $pub = (Get-Content -LiteralPath $pubPath -Raw).Trim()
  if ($pub -match "['`r`n]") { throw '公钥内容异常，含有引号或换行' }
  if ($pub -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+') { throw "公钥格式不对：$pubPath" }

  Write-Host ''
  Write-Host "==> 把公钥装到 $Target"
  Write-Host '    这是唯一一次需要输服务器密码。'
  Write-Host ''
  $remote = @"
set -e
umask 077
mkdir -p ~/.ssh
touch ~/.ssh/authorized_keys
if ! grep -qxF '$pub' ~/.ssh/authorized_keys; then
  echo '$pub' >> ~/.ssh/authorized_keys
  echo '  公钥已写入 authorized_keys'
else
  echo '  公钥已经在 authorized_keys 里了'
fi
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
"@
  # 这一次故意不带 -i / BatchMode：走密码认证
  Invoke-Native ssh @('-p', $SshPort, $Target, (ConvertTo-BashScript $remote)) '安装公钥失败'

  Write-Host ''
  Write-Host '==> 验证免密登录'
  if (-not (Test-Passwordless)) {
    Write-Host '公钥装上了，但免密登录仍然不通。'
    if ($script:LastSshError -match 'Authentications that can continue:\s*([^\r\n]+)') {
      Write-Host "    服务器允许的认证方式：$($Matches[1].Trim())"
    }
    Write-Host '    常见原因：sshd 关了公钥登录（PubkeyAuthentication）、~/.ssh 权限过宽、PermitRootLogin 限制。'
    Write-Host '    服务器上 journalctl -u ssh -n 30 会给出被拒的原因。'
    throw '免密登录验证失败'
  }
  Write-Host '    好了，之后的部署不会再问密码。'
}

if ($Command -eq 'key') {
  Install-DeployKey
  exit 0
}

Write-Host '==> 检查免密登录'
if (Test-Passwordless) {
  Write-Host '    ok'
}
else {
  Write-Host '    还没配好，先做一次性配置（下面输一次服务器密码）'
  try { Install-DeployKey }
  catch {
    Write-Host ''
    Write-Host "配置免密登录失败：$_"
    Write-Host "先确认能连上： ssh -p $SshPort $Target"
    exit 1
  }
}

function Invoke-Remote {
  param([Parameter(Mandatory)][string]$RemoteCmd)
  $a = Get-SshArgs
  $a += @($Target, (ConvertTo-BashScript $RemoteCmd))
  Invoke-Native ssh $a '服务器上执行失败'
}

if ($Command -ne 'deploy') {
  Invoke-Remote "cd $RemoteDir 2>/dev/null || { echo '服务器上还没部署过（$RemoteDir 不存在）'; exit 1; }; bash deploy.sh $Command"
  exit 0
}

Write-Host '==> 打包中继和手机网页'
Invoke-Native npm @('run', 'remote:build') '打包失败'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tarName = "allai-relay-$stamp.tgz"
$tarPath = Join-Path $env:TEMP $tarName
if (Test-Path $tarPath) { Remove-Item -LiteralPath $tarPath -Force }
# 用 Windows 自带的 tar（bsdtar）。PATH 里要是 Git 的 GNU tar 排在前面，
# 它会把 C:\... 里的冒号当成远程主机名，直接报 "Cannot connect to C"。
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
Invoke-Native $tarExe @('-czf', $tarPath, '-C', 'relay', 'Dockerfile', 'docker-compose.yml', 'deploy.sh', 'dist') '压缩失败'

Write-Host "==> 上传 $tarName"
$scpArgs = Get-SshArgs -Scp
$scpArgs += @($tarPath, "${Target}:/tmp/$tarName")
Invoke-Native scp $scpArgs '上传失败'
Remove-Item -LiteralPath $tarPath -Force

# 新版本先解到临时目录，保留服务器上的 .env（里面有口令），再整体替换
$remote = @'
set -e
tmp=$(mktemp -d)
tar -xzf /tmp/__TAR__ -C "$tmp"
rm -f /tmp/__TAR__
if [ -f __REMOTE__/.env ]; then cp -p __REMOTE__/.env "$tmp/.env"; fi
rm -rf __REMOTE__.old
if [ -d __REMOTE__ ]; then mv __REMOTE__ __REMOTE__.old; fi
mkdir -p "$(dirname __REMOTE__)"
mv "$tmp" __REMOTE__
chmod 755 __REMOTE__
cd __REMOTE__
sed -i 's/\r$//' deploy.sh
RELAY_PORT=__PORT__ bash deploy.sh up
'@
$remote = $remote.Replace('__REMOTE__', $RemoteDir).Replace('__TAR__', $tarName).Replace('__PORT__', $RelayPort)

Write-Host "==> 在服务器上部署（端口 $RelayPort）"
Invoke-Remote $remote
Write-Host ''
Write-Host '完成。接下来：1Panel 里把你的域名反代到 http://127.0.0.1:' -NoNewline
Write-Host $RelayPort
Write-Host '然后在 AllAi「设置 → 远程」里填 https://你的域名 和上面那串口令。'
