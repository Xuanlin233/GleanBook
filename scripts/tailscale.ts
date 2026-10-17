// Find this PC's private Tailscale HTTPS address (https://<machine>.<tailnet>.ts.net), so the
// phone's origin is trusted for sign-in and sync. Read-only: never changes Tailscale settings.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// `tailscale` on PATH, or next to the installed service (it can live outside Program Files,
// e.g. a custom install folder on another drive).
function candidates() {
  const list = ['tailscale'];
  // The macOS app (App Store or standalone) ships its CLI inside the bundle.
  if (process.platform === 'darwin')
    list.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  if (process.platform !== 'win32') return list;
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tailscale', '/v', 'ImagePath'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const image = /ImagePath\s+REG_\w+\s+"?([^"\r\n]+?\.exe)/i.exec(out)?.[1];
    if (image) list.push(path.join(path.dirname(image), 'tailscale.exe'));
  } catch {
    /* service not installed */
  }
  list.push('C:\\Program Files\\Tailscale\\tailscale.exe');
  return list;
}

export type TailscaleState = { origin: string | null; state: string | null };
export function tailscaleState(): TailscaleState {
  const configured = process.env.GLEANBOOK_PUBLIC_ORIGIN?.trim();
  if (configured)
    return {
      origin: /^https:\/\/[a-z0-9.-]+$/i.test(configured) ? configured : null,
      state: 'configured',
    };
  for (const exe of candidates()) {
    try {
      const out = execFileSync(exe, ['status', '--json'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const s = JSON.parse(out) as { BackendState?: string; Self?: { DNSName?: string } };
      const host = (s.Self?.DNSName ?? '').replace(/\.$/, '');
      return {
        origin: /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(host) ? `https://${host}` : null,
        state: s.BackendState ?? null,
      };
    } catch {
      /* try the next location */
    }
  }
  return { origin: null, state: null };
}
export const tailscaleOrigin = () => tailscaleState().origin;
