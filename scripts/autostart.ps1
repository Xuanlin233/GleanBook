# Turn "start the website after signing in to Windows" on or off for the current user.
#   npm run autostart:on    creates a minimized shortcut in the Startup folder
#   npm run autostart:off   removes it
# The shortcut runs scripts\start-at-login.cmd, which waits for a proxy if one is configured
# and then runs `npm run start:private` with the saved, encrypted credentials.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
# Only ever touches its own shortcut, never other startup entries.
$link = Join-Path $startup '拾账 Gleanbook 网站后端.lnk'
if ($Remove) {
  if (Test-Path -LiteralPath $link) {
    Remove-Item -LiteralPath $link
    Write-Host '已关闭拾账开机自动启动'
  }
  else { Write-Host '尚未设置开机自动启动，无需关闭' }
  exit 0
}
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw '未找到 Node.js，请先安装 Node.js 24 或以上' }
if (-not (Test-Path (Join-Path $root 'dist\index.html'))) { throw '缺少构建文件，请先运行 npm run build' }
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = "$env:SystemRoot\System32\cmd.exe"
$s.Arguments = '/c "' + (Join-Path $root 'scripts\start-at-login.cmd') + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = '登录 Windows 后自动启动拾账网站后端（npm run start:private）'
$s.IconLocation = "$node,0"
$s.Save()
Write-Host "已开启开机自动启动：$link"
Write-Host '请先运行一次 npm run start:private 保存凭证，之后开机即可自动运行。'
