import { describe, expect, it } from 'vitest';
import { launchAgentPlist, launchCommand, systemdUnit } from '../scripts/autostart';

describe('开机自动启动配置', () => {
  it('使用绝对路径启动，不依赖登录时的 PATH', () => {
    const cmd = launchCommand('/home/me/gleanbook', '/usr/local/bin/node');
    expect(cmd[0]).toBe('/usr/local/bin/node');
    expect(
      cmd.slice(1).every((a) => a.startsWith('/home/me/gleanbook') || a.startsWith('--')),
    ).toBe(true);
    expect(cmd.at(-1)).toBe('--wait-network');
  });
  it('macOS LaunchAgent 转义路径中的 XML 特殊字符', () => {
    const plist = launchAgentPlist(
      '/Users/a&b/<gleanbook>',
      '/opt/homebrew/bin/node',
      '/Users/a&b',
    );
    expect(plist).toContain('<string>/Users/a&amp;b/&lt;gleanbook&gt;</string>');
    expect(plist).not.toMatch(/a&b/);
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
  });
  it('systemd 服务给带空格、%、引号的路径加引号并转义', () => {
    const unit = systemdUnit('/home/me/my "100%" app', '/usr/bin/node');
    expect(unit).toContain('WorkingDirectory="/home/me/my \\"100%%\\" app"');
    expect(unit).toMatch(/^ExecStart="\/usr\/bin\/node" "\/home\/me\/my \\"100%%\\" app\//m);
    expect(unit).toContain('WantedBy=default.target');
  });
});
