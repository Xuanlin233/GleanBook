@echo off
rem Started minimized from the Windows Startup folder after you sign in to Windows.
rem Runs the private launcher with the saved, encrypted OKX credentials. Keep this window open:
rem closing it stops the website (phones can still record offline and sync later).
chcp 65001 >nul
title 拾账 · 网站后端（关闭此窗口会停止网站）
cd /d "%~dp0.."
if defined GLEANBOOK_SKIP_DELAY goto start
rem For Clash Verge / Mihomo users: the proxy starts from the same Startup folder, in no fixed
rem order. Wait until its TUN adapter (named Mihomo) is up or the Windows system proxy is on,
rem at most 3 minutes, before any network lookup, so OKX is never resolved outside the proxy
rem and cached that way. Without Clash Verge installed there is nothing to wait for.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$clash = (Get-Service clash_verge_service -ErrorAction SilentlyContinue) -or (Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'clash|mihomo' }); if (-not $clash) { Write-Host '未检测到 Clash Verge，直接启动'; exit 0 }; Write-Host '等待 Clash 代理就绪（最多 3 分钟）…'; $end=(Get-Date).AddMinutes(3); do { $tun=(Get-NetAdapter -Name Mihomo -ErrorAction SilentlyContinue).Status -eq 'Up'; $sys=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue).ProxyEnable -eq 1; if ($tun -or $sys) { Write-Host '代理已就绪'; Start-Sleep 5; exit 0 }; Start-Sleep 2 } while ((Get-Date) -lt $end); Write-Host '3 分钟内未检测到代理，继续启动（记账与同步不受影响）'"
:start
call npm run start:private -- --wait-network
echo.
echo 网站已停止。按任意键关闭此窗口；重新启动请运行 npm run start:private
pause >nul
