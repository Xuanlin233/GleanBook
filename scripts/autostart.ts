// Turn "start the website after signing in" on or off for the current user.
//   npm run autostart:on     npm run autostart:off
// Windows  a minimized shortcut in the Startup folder (scripts/autostart.ps1)
// macOS    a LaunchAgent in ~/Library/LaunchAgents, log in ~/Library/Logs/Gleanbook
// Linux    a systemd user service, log via `journalctl --user -u gleanbook`
// Each runs `start:private --wait-network` with the credentials saved by a first manual run.
// Only ever touches its own entry, never other startup items.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LABEL = 'io.github.gleanbook';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Run through tsx's CLI with an absolute node path: login sessions have a minimal PATH.
// macOS and Linux only, hence POSIX paths.
export function launchCommand(projectRoot: string, node = process.execPath) {
  return [
    node,
    path.posix.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.posix.join(projectRoot, 'scripts', 'start-private.ts'),
    '--wait-network',
  ];
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function launchAgentPlist(
  projectRoot: string,
  node = process.execPath,
  home = os.homedir(),
) {
  const log = path.posix.join(home, 'Library', 'Logs', 'Gleanbook', 'launcher.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${launchCommand(projectRoot, node)
  .map((a) => `    <string>${xml(a)}</string>`)
  .join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

// systemd unquotes "…" with C-style escapes and expands % specifiers.
const unitArg = (s: string) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
export function systemdUnit(projectRoot: string, node = process.execPath) {
  return `[Unit]
Description=Gleanbook (拾账) personal finance website
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${unitArg(projectRoot)}
ExecStart=${launchCommand(projectRoot, node).map(unitArg).join(' ')}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
}

function requireBuild() {
  if (!existsSync(path.join(root, 'dist', 'index.html')))
    throw new Error('缺少构建文件，请先运行 npm run build');
}
const sh = (cmd: string, args: string[], quiet = false) =>
  execFileSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' });

function mac(on: boolean) {
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
    domain = `gui/${process.getuid?.()}`;
  try {
    sh('launchctl', ['bootout', domain, plist], true);
  } catch {
    /* not loaded */
  }
  if (!on) {
    rmSync(plist, { force: true });
    console.log('已关闭拾账开机自动启动');
    return;
  }
  requireBuild();
  mkdirSync(path.dirname(plist), { recursive: true });
  mkdirSync(path.join(os.homedir(), 'Library', 'Logs', 'Gleanbook'), { recursive: true });
  writeFileSync(plist, launchAgentPlist(root));
  sh('launchctl', ['bootstrap', domain, plist]);
  console.log(`已开启开机自动启动：${plist}`);
  console.log('日志：~/Library/Logs/Gleanbook/launcher.log');
}

function linux(on: boolean) {
  const unit = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'systemd',
    'user',
    'gleanbook.service',
  );
  if (!on) {
    try {
      sh('systemctl', ['--user', 'disable', '--now', 'gleanbook.service'], true);
    } catch {
      /* not installed */
    }
    rmSync(unit, { force: true });
    sh('systemctl', ['--user', 'daemon-reload'], true);
    console.log('已关闭拾账开机自动启动');
    return;
  }
  requireBuild();
  mkdirSync(path.dirname(unit), { recursive: true });
  writeFileSync(unit, systemdUnit(root));
  sh('systemctl', ['--user', 'daemon-reload']);
  sh('systemctl', ['--user', 'enable', '--now', 'gleanbook.service']);
  console.log(`已开启开机自动启动：${unit}`);
  console.log('查看日志：journalctl --user -u gleanbook -f');
  console.log(
    '登录桌面后才会启动；想在未登录时也运行，执行 loginctl enable-linger（此时系统密钥环可能未解锁，无法读取已保存的 OKX 凭证）。',
  );
}

function windows(on: boolean) {
  sh('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'scripts', 'autostart.ps1'),
    ...(on ? [] : ['-Remove']),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const on = process.argv[2] !== 'off';
  try {
    if (process.platform === 'win32') windows(on);
    else if (process.platform === 'darwin') mac(on);
    else if (process.platform === 'linux') linux(on);
    else throw new Error(`暂不支持 ${process.platform} 的开机自动启动`);
    if (on && process.platform !== 'win32')
      console.log('请先在终端手动运行一次 npm run start:private 保存凭证，之后开机即可自动运行。');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
