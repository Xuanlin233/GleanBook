import http from 'node:http';
import { execFileSync } from 'node:child_process';

// Node fetch ignores the Windows system proxy and, without NODE_USE_ENV_PROXY,
// also ignores HTTPS_PROXY. Browsers can reach OKX while this process cannot.
// Domestic fund sites always go direct so a remote proxy never slows them down.
const NO_PROXY = [
  'localhost',
  '127.0.0.1',
  '::1',
  '.eastmoney.com',
  '.sina.com.cn',
  '.gtfund.com',
  '.efunds.com.cn',
].join(',');

export type ProxyMode = 'explicit' | 'env' | 'system' | 'direct';
export const proxyModeLabel: Record<ProxyMode, string> = {
  explicit: '使用 OKX_PROXY 指定的代理',
  env: '使用 HTTPS_PROXY 环境变量代理',
  system: '使用 Windows 系统代理',
  direct: '直连（如开启 TUN 由系统接管）',
};

export function normalizeProxy(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'http://' + text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || !url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Registry value is either "host:port" or "http=host:port;https=host:port;socks=host:port".
export function parseWindowsProxy(output: string): string | null {
  if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(output)) return null;
  const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(output)?.[1];
  if (!server) return null;
  const parts = server.split(';').filter(Boolean);
  const pick =
    parts.find((p) => p.startsWith('https=')) ??
    parts.find((p) => p.startsWith('http=')) ??
    (parts.length === 1 && !parts[0].includes('=') ? parts[0] : null);
  return pick ? normalizeProxy(pick.replace(/^https?=/, '')) : null;
}

function windowsSystemProxy(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return parseWindowsProxy(output);
  } catch {
    return null;
  }
}

let applied: ProxyMode = 'direct';
export const outboundProxyMode = () => applied;

// Priority: OKX_PROXY (or "off") > HTTPS_PROXY / HTTP_PROXY > Windows system proxy > direct.
// Never log the proxy URL: it can carry credentials.
export function configureOutboundProxy(env: NodeJS.ProcessEnv = process.env): ProxyMode {
  const explicit = env.OKX_PROXY?.trim();
  const fromEnv = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  let mode: ProxyMode = 'direct',
    proxy: string | null = null;
  if (explicit && explicit.toLowerCase() !== 'off') {
    proxy = normalizeProxy(explicit);
    if (!proxy) throw new Error('OKX_PROXY 仅支持 http://主机:端口 形式的 HTTP 代理地址');
    mode = 'explicit';
  } else if (!explicit && fromEnv) {
    proxy = normalizeProxy(fromEnv);
    if (proxy) mode = 'env';
  } else if (!explicit) {
    proxy = windowsSystemProxy();
    if (proxy) mode = 'system';
  }
  // Older Node 24 releases lack this API; fall back to direct instead of crashing.
  if (typeof http.setGlobalProxyFromEnv !== 'function') {
    if (proxy) console.warn('当前 Node 版本不支持运行时代理，请升级到最新 Node 24 LTS；将直连');
    applied = 'direct';
    return applied;
  }
  http.setGlobalProxyFromEnv(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY } : {});
  applied = proxy ? mode : 'direct';
  return applied;
}
