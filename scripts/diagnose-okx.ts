// Public, credential-free diagnostics. Do not load credentials or serialize environment values.
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { allowedOrigins, checkOKXNetwork, privatePaths, probePrivateEndpoint } from '../server/okx';
import { loadCredentials } from './credential-store';
import { safeNetworkError } from '../server/network-error';
import { configureOutboundProxy, proxyModeLabel } from '../server/proxy';

console.log('拾账 OKX 网络诊断：不读取或发送密钥，不读取账本，不修改系统网络设置。');
// Only OKX_PROXY is taken from .env; credentials are never loaded here.
if (!process.env.OKX_PROXY) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*OKX_PROXY\s*=/.test(l));
    if (line)
      process.env.OKX_PROXY = line
        .replace(/^\s*OKX_PROXY\s*=\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim();
  } catch {
    /* no .env */
  }
}
console.log(`Node 版本：${process.version}`);
const origin = process.env.OKX_API_ORIGIN || 'https://openapi.okx.com';
if (!allowedOrigins.includes(origin)) {
  console.error('OKX_API_ORIGIN 不属于允许的官方域名。请核对配置；未发起请求。');
  process.exitCode = 1;
} else if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.error('当前进程关闭了 TLS 证书校验，诊断已停止。请移除此设置后重试。');
  process.exitCode = 1;
} else {
  console.log(`官方域名：${origin}`);
  let mode;
  try {
    mode = configureOutboundProxy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'OKX_PROXY 无效');
    process.exit(1);
  }
  console.log(`外部接口网络：${proxyModeLabel[mode]}（不输出代理地址）`);
  console.log('TUN 路由由系统和代理软件控制，本命令不推断它是否实际接管 Node。');
  const originalOrder = getDefaultResultOrder();
  let reachable = false;
  for (const order of [originalOrder, 'ipv4first'] as const) {
    const start = Date.now();
    try {
      setDefaultResultOrder(order);
      await checkOKXNetwork();
      console.log(`公共连接通过：DNS 顺序 ${order}，耗时 ${Date.now() - start} ms。`);
      reachable = true;
      break;
    } catch (error) {
      console.log(
        `公共连接未通过（DNS 顺序 ${order}）：${error instanceof Error && error.name !== 'ZodError' ? error.message : '响应未通过数据校验'}`,
      );
    }
    if (originalOrder === 'ipv4first') break;
  }
  setDefaultResultOrder(originalOrder);
  if (reachable) {
    // An intentional unsigned request checks the protected route's connectivity.
    // 401 / 50103 is expected here and is not a private connection success.
    try {
      const response = await fetch(origin + '/api/v5/account/config', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      let raw: unknown = null;
      try {
        raw = await response.json();
      } catch {
        /* Do not print upstream bodies. */
      }
      const code =
        raw &&
        typeof raw === 'object' &&
        'code' in raw &&
        typeof raw.code === 'string' &&
        /^\d{1,5}$/.test(raw.code)
          ? raw.code
          : '未提供';
      console.log(`未带凭证的账户路径：HTTP ${response.status}，OKX 状态码 ${code}。`);
      console.log(
        '此处 401 / 50103 是未提供凭证的预期拒绝，仅说明路径可达；没有验证你的 API Key。',
      );
    } catch (error) {
      const safe = safeNetworkError(error);
      console.log(`账户路径连接未完成：${safe.message} [${safe.code}]。`);
      process.exitCode = 1;
    }
  } else {
    process.exitCode = 1;
    // Look for a local proxy (Clash / Mihomo / v2rayN) the user can point OKX_PROXY at.
    const ports = [7897, 7890, 7891, 7892, 10809, 10808, 1080, 8889];
    const open: number[] = [];
    for (const p of ports) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port: p, timeout: 500 });
        socket.once('connect', () => (socket.destroy(), resolve(true)));
        socket.once('timeout', () => (socket.destroy(), resolve(false)));
        socket.once('error', () => resolve(false));
      });
      if (ok) open.push(p);
    }
    for (const p of open) {
      try {
        configureOutboundProxy({ OKX_PROXY: `http://127.0.0.1:${p}` });
        await checkOKXNetwork();
        console.log(`经本机代理端口 ${p} 可连接 OKX。请在项目根目录 .env 加入一行：`);
        console.log(`  OKX_PROXY=http://127.0.0.1:${p}`);
        console.log('然后重新运行 npm start 或 npm run start:private。');
        break;
      } catch {
        console.log(`本机端口 ${p} 有服务监听，但不能作为 HTTP 代理连接 OKX。`);
      }
    }
    if (!open.length)
      console.log('未发现常见本机代理端口。请确认代理软件已运行，或开启其 TUN 模式。');
  }
  // --private: time each signed read-only endpoint with the saved, encrypted credentials.
  // Prints only HTTP status, OKX code and duration; never keys, balances or response bodies.
  if (process.argv.includes('--private') && process.exitCode !== 1) {
    let saved = null;
    try {
      saved = loadCredentials();
    } catch {
      console.log('已保存的凭证无法解密，跳过带密钥的检测。');
    }
    if (!saved)
      console.log('本机没有已保存的 OKX 凭证，跳过带密钥的检测（先运行 npm run start:private）。');
    else {
      process.env.OKX_API_KEY = saved.key;
      process.env.OKX_API_SECRET = saved.secret;
      process.env.OKX_API_PASSPHRASE = saved.passphrase;
      console.log('带密钥的只读接口（仅显示状态与耗时，不显示任何余额）：');
      for (const p of privatePaths) {
        const r = await probePrivateEndpoint(p);
        console.log(
          `  ${p.padEnd(34)} ${r.status === null ? '无响应' : 'HTTP ' + r.status}  ${r.code ? 'OKX ' + r.code : ''}  ${r.ms} ms`,
        );
      }
      for (const k of ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_API_PASSPHRASE'])
        delete process.env[k];
    }
  }
  console.log('请仅反馈以上诊断结果；不要发送任何密钥或口令。');
}
