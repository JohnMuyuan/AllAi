# AllAi 的输入宿主。常驻，从 stdin 一行一条 JSON 命令。
#
# 为什么不用 robotjs / nut.js：那些是原生模块，每次升级 Electron 都要重编译，
# 而这个项目已经被 node-pty 折腾过了。P/Invoke 调 user32 零依赖，实测每个动作 0-5ms。
#
# 这个文件**必须带 UTF-8 BOM**。PowerShell 5.1 读没有 BOM 的 .ps1 时按 ANSI(GBK) 解，
# 中文注释会被解成乱码字节；只要里面凑巧出现一个引号，整个脚本就解析失败（踩过）。
# 保存时别把 BOM 去掉，scripts/copy-electron-assets.cjs 会原样复制。

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AllAiInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const uint LDOWN = 0x0002, LUP = 0x0004, RDOWN = 0x0008, RUP = 0x0010;
  public const uint MDOWN = 0x0020, MUP = 0x0040, WHEEL = 0x0800;

  public static uint ProcessId(IntPtr h) {
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    return pid;
  }

  // SetForegroundWindow 单独调用经常被 Windows 的前台锁静默拒绝。临时把输入队列
  // 接到当前前台线程，再恢复目标窗口，成功率高得多；调用完立即拆开。
  public static bool Activate(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    if (GetForegroundWindow() == h) return true;
    if (IsIconic(h)) ShowWindowAsync(h, 9);
    IntPtr current = GetForegroundWindow();
    uint currentThread = 0;
    uint ignoredCurrent;
    if (current != IntPtr.Zero) currentThread = GetWindowThreadProcessId(current, out ignoredCurrent);
    uint ignoredTarget;
    uint targetThread = GetWindowThreadProcessId(h, out ignoredTarget);
    uint selfThread = GetCurrentThreadId();
    bool attachedCurrent = currentThread != 0 && currentThread != selfThread && AttachThreadInput(selfThread, currentThread, true);
    bool attachedTarget = targetThread != 0 && targetThread != selfThread && targetThread != currentThread && AttachThreadInput(selfThread, targetThread, true);
    bool attachedPair = currentThread != 0 && targetThread != 0 && currentThread != targetThread && AttachThreadInput(currentThread, targetThread, true);
    // 模拟一次无副作用的 Alt 按下/松开，让当前进程获得合法的前台切换资格。
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    BringWindowToTop(h);
    SwitchToThisWindow(h, true);
    SetForegroundWindow(h);
    SetFocus(h);
    if (attachedPair) AttachThreadInput(currentThread, targetThread, false);
    if (attachedTarget) AttachThreadInput(selfThread, targetThread, false);
    if (attachedCurrent) AttachThreadInput(selfThread, currentThread, false);
    IntPtr active = GetForegroundWindow();
    return active == h || ProcessId(active) == ProcessId(h);
  }

  public static bool VisibleRect(IntPtr h, out RECT r) {
    r = new RECT();
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 && r.R > r.L && r.B > r.T) return true;
    return GetWindowRect(h, out r);
  }

  public static string ClassName(IntPtr h) {
    var s = new System.Text.StringBuilder(256);
    GetClassNameW(h, s, 256);
    return s.ToString();
  }
}
'@

# DPI awareness must be set BEFORE WinForms loads. Loading it first locks the
# awareness context and SetProcessDPIAware silently fails, after which
# GetSystemMetrics reports logical size instead of physical pixels.
[AllAiInput]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$script:UiaAvailable = $true
try { Add-Type -AssemblyName UIAutomationClient | Out-Null } catch { $script:UiaAvailable = $false }
$script:Elements = @{}
$script:WshShell = New-Object -ComObject WScript.Shell

function Reply($obj) {
  $hash = @{}
  if ($obj -is [hashtable]) {
    foreach ($key in $obj.Keys) { $hash[$key] = $obj[$key] }
  } else {
    foreach ($prop in $obj.PSObject.Properties) { $hash[$prop.Name] = $prop.Value }
  }
  if ($null -ne $script:CmdId) { $hash.id = $script:CmdId }
  Write-Output ($hash | ConvertTo-Json -Compress -Depth 6)
}

function WindowData([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [AllAiInput]::GetWindowTextW($h, $sb, 512) | Out-Null
  $r = New-Object AllAiInput+RECT
  [AllAiInput]::VisibleRect($h, [ref]$r) | Out-Null
  return @{
    handle = [string]$h.ToInt64()
    pid = [int][AllAiInput]::ProcessId($h)
    title = $sb.ToString()
    cls = [AllAiInput]::ClassName($h)
    x = $r.L
    y = $r.T
    w = ($r.R - $r.L)
    h = ($r.B - $r.T)
  }
}

function ClickAt([int]$x, [int]$y, [string]$button, [bool]$double) {
  [AllAiInput]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 30
  $down = [AllAiInput]::LDOWN; $up = [AllAiInput]::LUP
  if ($button -eq "right") { $down = [AllAiInput]::RDOWN; $up = [AllAiInput]::RUP }
  if ($button -eq "middle") { $down = [AllAiInput]::MDOWN; $up = [AllAiInput]::MUP }
  $n = 1
  if ($double) { $n = 2 }
  for ($i = 0; $i -lt $n; $i++) {
    [AllAiInput]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
    [AllAiInput]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
    if ($i -lt $n - 1) { Start-Sleep -Milliseconds 60 }
  }
}

Reply @{ ok = $true; ready = $true; uia = $script:UiaAvailable; capture = $true; width = [AllAiInput]::GetSystemMetrics(0); height = [AllAiInput]::GetSystemMetrics(1) }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq "quit") { break }
  if ($line.Trim() -eq "") { continue }
  $script:CmdId = $null
  try {
    $c = $line | ConvertFrom-Json
    $script:CmdId = $c.id
    switch ($c.op) {
      "move" {
        [AllAiInput]::SetCursorPos([int]$c.x, [int]$c.y) | Out-Null
        Reply @{ ok = $true }
      }
      "click" {
        ClickAt ([int]$c.x) ([int]$c.y) ([string]$c.button) ([bool]$c.double)
        Reply @{ ok = $true }
      }
      "drag" {
        [AllAiInput]::SetCursorPos([int]$c.x, [int]$c.y) | Out-Null
        Start-Sleep -Milliseconds 30
        [AllAiInput]::mouse_event([AllAiInput]::LDOWN, 0, 0, 0, [IntPtr]::Zero)
        # 一步跳到终点很多程序识别不了拖拽，分几步走。
        $steps = 12
        for ($i = 1; $i -le $steps; $i++) {
          $nx = [int]([int]$c.x + ([int]$c.toX - [int]$c.x) * $i / $steps)
          $ny = [int]([int]$c.y + ([int]$c.toY - [int]$c.y) * $i / $steps)
          [AllAiInput]::SetCursorPos($nx, $ny) | Out-Null
          Start-Sleep -Milliseconds 15
        }
        [AllAiInput]::mouse_event([AllAiInput]::LUP, 0, 0, 0, [IntPtr]::Zero)
        Reply @{ ok = $true }
      }
      "scroll" {
        if ($c.x -ne $null) { [AllAiInput]::SetCursorPos([int]$c.x, [int]$c.y) | Out-Null; Start-Sleep -Milliseconds 20 }
        # 一格是 120，正数向上。
        [AllAiInput]::mouse_event([AllAiInput]::WHEEL, 0, 0, [uint32]([int]$c.amount * 120), [IntPtr]::Zero)
        Reply @{ ok = $true }
      }
      "text" {
        # 带坐标时把“定位输入框 + 输入 + 可选提交”合成一次动作，少跑一到两轮模型。
        if ($c.element -ne $null -and $script:Elements.ContainsKey([int]$c.element)) {
          $script:Elements[[int]$c.element].SetFocus()
          Start-Sleep -Milliseconds 40
        } elseif ($c.x -ne $null -and $c.y -ne $null) {
          ClickAt ([int]$c.x) ([int]$c.y) "left" $false
        }
        # 走剪贴板而不是 SendKeys：SendKeys 处理不了中文，而且 {}()+^%~[] 都要转义。
        # 先存下原剪贴板，粘完还回去 —— 不然会把用户复制的东西冲掉。
        $old = $null
        try { $old = [System.Windows.Forms.Clipboard]::GetText() } catch {}
        # Text arrives base64-encoded: PowerShell 5.1 reads stdin using the console
        # codepage (GBK here), so raw UTF-8 Chinese turns into garbage. Keeping the
        # JSON line pure ASCII sidesteps the codepage entirely.
        $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$c.b64))
        [System.Windows.Forms.Clipboard]::SetText($decoded)
        Start-Sleep -Milliseconds 40
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 120
        if ($c.submit) {
          [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
          Start-Sleep -Milliseconds 80
        }
        try { if ($old) { [System.Windows.Forms.Clipboard]::SetText($old) } else { [System.Windows.Forms.Clipboard]::Clear() } } catch {}
        Reply @{ ok = $true }
      }
      "key" {
        # SendKeys 的写法：^=Ctrl %=Alt +=Shift，{ENTER} {TAB} {ESC} {F5} 等。
        [System.Windows.Forms.SendKeys]::SendWait([string]$c.keys)
        Reply @{ ok = $true }
      }
      "foreground" {
        # 当前前台窗口是谁。**动手之前必须问一次** —— 盲点击会打进用户正开着的
        # 别的窗口里（实测把一段文字打进了一个存着 SSH 凭据的记事本标签页）。
        $data = WindowData ([AllAiInput]::GetForegroundWindow())
        $data.ok = $true
        Reply $data
      }
      "windows" {
        $rows = New-Object System.Collections.ArrayList
        $seen = @{}
        foreach ($process in (Get-Process -ErrorAction SilentlyContinue)) {
          try {
            $h = [IntPtr]$process.MainWindowHandle
            if ($h -eq [IntPtr]::Zero) { continue }
            $key = [string]$h.ToInt64()
            if ($seen.ContainsKey($key)) { continue }
            $data = WindowData $h
            if ([string]::IsNullOrWhiteSpace($data.title) -or $data.w -le 1 -or $data.h -le 1) { continue }
            $data.ok = $true
            $seen[$key] = $true
            [void]$rows.Add($data)
          } catch {}
        }
        Reply @{ ok = $true; windows = @($rows) }
      }
      "focus" {
        $wanted = [IntPtr]([long]([string]$c.handle))
        # Windows 的前台锁可能在别的应用刚抢到焦点时短暂拒绝一次。每次都重新执行
        # 完整的线程连接与核对，最多约 400ms；比直接宣告整项任务失败可靠得多。
        $activated = $false
        for ($attempt = 0; $attempt -lt 4; $attempt++) {
          # AppActivate 走 Windows Shell 自己的前台授权路径；P/Invoke 再负责精确核对 HWND。
          try { $script:WshShell.AppActivate([int]$c.pid) | Out-Null } catch {}
          $activated = [AllAiInput]::Activate($wanted)
          if ($activated) { break }
          Start-Sleep -Milliseconds (50 + $attempt * 50)
        }
        Start-Sleep -Milliseconds 50
        $active = [AllAiInput]::GetForegroundWindow()
        $data = WindowData $active
        $sameProcess = $data.pid -eq [int]$c.pid
        $data.ok = $sameProcess
        if (-not $sameProcess) { $data.error = "无法激活目标窗口" }
        Reply $data
      }
      "inspect" {
        if (-not $script:UiaAvailable) {
          Reply @{ ok = $true; controls = @() }
          continue
        }
        $script:Elements = @{}
        $rows = New-Object System.Collections.ArrayList
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]([string]$c.handle)))
        if ($root -ne $null) {
          $controlTypes = @(
            [System.Windows.Automation.ControlType]::Button,
            [System.Windows.Automation.ControlType]::Edit,
            [System.Windows.Automation.ControlType]::ComboBox,
            [System.Windows.Automation.ControlType]::ListItem,
            [System.Windows.Automation.ControlType]::MenuItem,
            [System.Windows.Automation.ControlType]::CheckBox,
            [System.Windows.Automation.ControlType]::RadioButton,
            [System.Windows.Automation.ControlType]::TabItem,
            [System.Windows.Automation.ControlType]::Hyperlink,
            [System.Windows.Automation.ControlType]::TreeItem,
            [System.Windows.Automation.ControlType]::DataItem,
            [System.Windows.Automation.ControlType]::Slider,
            [System.Windows.Automation.ControlType]::Spinner
          )
          $typeConds = foreach ($ct in $controlTypes) {
            New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
          }
          $filter = if ($typeConds.Count -eq 1) { $typeConds[0] } else { New-Object System.Windows.Automation.OrCondition([System.Windows.Automation.Condition[]]$typeConds) }
          $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $filter)
          $allowed = @("Button", "Edit", "ComboBox", "ListItem", "MenuItem", "CheckBox", "RadioButton", "TabItem", "Hyperlink", "TreeItem", "DataItem", "Slider", "Spinner")
          foreach ($el in $all) {
            if ($rows.Count -ge 120) { break }
            try {
              $cur = $el.Current
              if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
              $type = ([string]$cur.ControlType.ProgrammaticName).Replace("ControlType.", "")
              if ($allowed -notcontains $type) { continue }
              $r = $cur.BoundingRectangle
              if ($r.Width -le 1 -or $r.Height -le 1) { continue }
              $name = [string]$cur.Name
              if ([string]::IsNullOrWhiteSpace($name)) { $name = [string]$cur.AutomationId }
              $id = $rows.Count
              $script:Elements[$id] = $el
              [void]$rows.Add(@{
                id = $id
                type = $type
                name = $name
                x = [int][Math]::Round($r.X)
                y = [int][Math]::Round($r.Y)
                w = [int][Math]::Round($r.Width)
                h = [int][Math]::Round($r.Height)
              })
            } catch {}
          }
        }
        Reply @{ ok = $true; controls = @($rows) }
      }
      "element" {
        $id = [int]$c.id
        if (-not $script:Elements.ContainsKey($id)) {
          Reply @{ ok = $false; error = "控件编号已失效，需要重新截图" }
          continue
        }
        $el = $script:Elements[$id]
        $mode = [string]$c.action
        $pattern = $null
        $handled = $false
        if ($mode -eq "focus") {
          $el.SetFocus()
          $handled = $true
        } elseif ($mode -eq "toggle" -and $el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
          ([System.Windows.Automation.TogglePattern]$pattern).Toggle()
          $handled = $true
        } elseif ($mode -eq "expand" -and $el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
          ([System.Windows.Automation.ExpandCollapsePattern]$pattern).Expand()
          $handled = $true
        } elseif ($mode -eq "select" -and $el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
          ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
          $handled = $true
        } elseif ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
          ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
          $handled = $true
        }
        if (-not $handled) {
          # 没有对应 pattern 的自绘控件，退回它的可访问边界中心点。
          $r = $el.Current.BoundingRectangle
          ClickAt ([int][Math]::Round($r.X + $r.Width / 2)) ([int][Math]::Round($r.Y + $r.Height / 2)) "left" $false
        }
        Reply @{ ok = $true }
      }
      "capture" {
        $wanted = [IntPtr]([long]([string]$c.handle))
        # 主进程在 capture 前已经 focusTarget 并核对过进程。这里再抢一次前台会撞上
        # Windows 的 foreground lock，明明目标有效却报截图失败；按已验证 HWND 取矩形即可。
        $windowData = WindowData $wanted
        if ($windowData.pid -ne [int]$c.pid -or $windowData.w -le 0 -or $windowData.h -le 0) {
          Reply @{ ok = $false; error = "目标窗口已经关闭或句柄已失效" }
          continue
        }
        $bitmap = $null
        $output = $null
        $graphics = $null
        $outputGraphics = $null
        $stream = $null
        try {
          $bitmap = [System.Drawing.Bitmap]::new([int]$windowData.w, [int]$windowData.h)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen(
            [int]$windowData.x,
            [int]$windowData.y,
            0,
            0,
            $bitmap.Size,
            [System.Drawing.CopyPixelOperation]::SourceCopy
          )
          $scale = [Math]::Min(1.0, [Math]::Min([double]$c.maxWidth / $bitmap.Width, [double]$c.maxHeight / $bitmap.Height))
          $outWidth = [Math]::Max(1, [int][Math]::Round($bitmap.Width * $scale))
          $outHeight = [Math]::Max(1, [int][Math]::Round($bitmap.Height * $scale))
          if ($outWidth -eq $bitmap.Width -and $outHeight -eq $bitmap.Height) {
            $output = $bitmap
          } else {
            $output = [System.Drawing.Bitmap]::new($outWidth, $outHeight)
            $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
            $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $outputGraphics.DrawImage($bitmap, 0, 0, $outWidth, $outHeight)
          }
          $stream = [System.IO.MemoryStream]::new()
          $output.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
          $windowData.ok = $true
          $windowData.width = $outWidth
          $windowData.height = $outHeight
          $windowData.data = [Convert]::ToBase64String($stream.ToArray())
          Reply $windowData
        } finally {
          if ($stream -ne $null) { $stream.Dispose() }
          if ($outputGraphics -ne $null) { $outputGraphics.Dispose() }
          if ($output -ne $null -and $output -ne $bitmap) { $output.Dispose() }
          if ($graphics -ne $null) { $graphics.Dispose() }
          if ($bitmap -ne $null) { $bitmap.Dispose() }
        }
      }
      "cursor" {
        $p = New-Object AllAiInput+POINT
        [AllAiInput]::GetCursorPos([ref]$p) | Out-Null
        Reply @{ ok = $true; x = $p.X; y = $p.Y }
      }
      default { Reply @{ ok = $false; error = "unknown op: $($c.op)" } }
    }
  } catch {
    Reply @{ ok = $false; error = $_.Exception.Message }
  }
}
