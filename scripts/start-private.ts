// Interactive local launcher. Verified read-only credentials are saved once in the system's
// secret store (DPAPI / Keychain / Secret Service, see credential-store.ts) and reused until
// OKX rejects them. Without a terminal (autostart on macOS / Linux) it never asks: it starts
// the website with whatever is saved, or without OKX.
// Never run this helper through a captured tool session or redirect its input.
import { emitKeypressEvents } from 'node:readline';
import { access } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { syncOKX, checkOKXNetwork } from '../server/okx';
import { configureOutboundProxy, proxyModeLabel } from '../server/proxy';
import { defaultDataDir } from '../server/ledger-store';
import { tailscaleState } from './tailscale';
import {
  canSaveCredentials,
  credentialLocation,
  forgetCredentials,
  loadCredentials,
  saveCredentials,
  type SavedCredentials,
} from './credential-store';

async function secret(label: string, minLength = 1): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('请在你自己的交互终端运行，不要通过聊天、日志捕获或管道输入密钥。');
  process.stdout.write(label + '（输入不回显，Enter 确认，Ctrl+C 取消）：');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (
      text: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) => {
      if (key.ctrl && key.name === 'c') {
        value = '';
        finish();
        reject(new Error('已取消，未保存密钥。'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        if (value.length < minLength) {
          value = '';
          reject(new Error(`${label} 长度不足，请重新运行。`));
        } else resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
const okxKeys = ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_API_PASSPHRASE'] as const;
function apply(c: SavedCredentials) {
  process.env.OKX_API_KEY = c.key;
  process.env.OKX_API_SECRET = c.secret;
  process.env.OKX_API_PASSPHRASE = c.passphrase;
  process.env.GLEANBOOK_ACCESS_TOKEN = c.accessToken;
}
async function ask(accessToken: string | null): Promise<SavedCredentials> {
  console.log(`请在本机输入你创建的仅 Read 权限凭证。接口域名 ${process.env.OKX_API_ORIGIN}。`);
  const key = await secret('OKX API Key'),
    secretValue = await secret('OKX API Secret'),
    passphrase = await secret('OKX Passphrase');
  // Keep the website password when only the OKX key changed, so the browser stays signed in.
  return {
    key,
    secret: secretValue,
    passphrase,
    accessToken:
      accessToken ??
      (await secret('自行设置后端访问口令（至少 32 字符，稍后在网站设置页输入一次）', 32)),
  };
}
// Errors that mean the key itself is wrong or unusable. Anything else (network, open
// positions, rate limits) keeps the saved key and still starts the website.
const credentialError = (message: string) =>
  /\[(50100|50101|50105|50111|50113|50114|50119|50120)\]|并非仅 Read|凭证包含无效字符/.test(
    message,
  );
const errorText = (error: unknown) =>
  error instanceof Error && error.name !== 'ZodError' && !('code' in error)
    ? error.message
    : '响应未通过数据校验';

try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  await access(path.join(root, 'dist/index.html')).catch(() => {
    throw new Error('缺少构建文件，请先运行 npm run build。');
  });
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('当前进程关闭了 TLS 证书校验，已停止连接。请移除此设置后重试。');
  // Check availability before asking for secrets. This launcher only binds localhost.
  // GLEANBOOK_LAUNCH_PORT exists for tests that must not collide with a running site.
  const port = Number(process.env.GLEANBOOK_LAUNCH_PORT || 8787);
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(new Error(`${port} 端口已占用，请先关闭之前启动的拾账服务。`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
  console.log('拾账 · 本机只读连接');
  try {
    process.loadEnvFile();
  } catch {
    /* .env is optional (OKX_PROXY, OKX_API_ORIGIN, GLEANBOOK_DATA_DIR …) */
  }
  // Global accounts use openapi.okx.com; US / AU and EEA accounts set OKX_API_ORIGIN in .env.
  process.env.OKX_API_ORIGIN ||= 'https://openapi.okx.com';
  console.log(`Node ${process.version}。外部接口网络：${proxyModeLabel[configureOutboundProxy()]}`);

  let creds: SavedCredentials | null = null,
    fromSaved = false;
  try {
    creds = loadCredentials();
    fromSaved = !!creds;
    if (creds) console.log(`使用已加密保存的凭证（${credentialLocation()}）。`);
  } catch {
    forgetCredentials();
    console.log('已保存的凭证无法解密（可能来自其他电脑或系统用户，或已损坏），已删除。');
  }

  // At sign-in the proxy may still be starting: with --wait-network, keep trying for up to two
  // minutes (re-reading the proxy settings each time) before giving up on OKX for now.
  let online = false,
    lastError: unknown = null;
  const deadline = Date.now() + (process.argv.includes('--wait-network') ? 120000 : 0);
  for (let attempt = 1; ; attempt++) {
    try {
      await checkOKXNetwork();
      online = true;
      if (attempt > 1) console.log('OKX 已连通。');
      break;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      if (attempt === 1)
        console.log('OKX 暂时连不上，可能代理还在启动，每 5 秒重试一次（最多 2 分钟）…');
      await new Promise((r) => setTimeout(r, 5000));
      configureOutboundProxy();
    }
  }
  if (!online)
    console.log(
      `${errorText(lastError)}\nOKX 暂时连不上：网站照常启动，记账、基金、定投可用；网络恢复后在网站设置里读取持仓即可。`,
    );

  let verified = false,
    rejected = false,
    accessToken = creds?.accessToken ?? null;
  for (let attempt = 0; attempt < 3 && online; attempt++) {
    if (!creds && !interactive) {
      console.log(
        '没有可用的已保存凭证，且当前不是交互终端：网站照常启动但不读取 OKX 持仓。\n请在终端手动运行一次 npm run start:private 输入并保存凭证。',
      );
      break;
    }
    creds ??= await ask(accessToken);
    accessToken = creds.accessToken;
    apply(creds);
    console.log('正在验证仅 Read 权限与各账户余额…');
    try {
      const result = await syncOKX();
      verified = true;
      rejected = false;
      console.log(`只读接口读取通过：返回 ${result.rows.length} 项，时间 ${result.generatedAt}。`);
      break;
    } catch (error) {
      const message = errorText(error);
      console.log(message);
      if (!credentialError(message)) {
        console.log('这不是密钥问题：已保留凭证，网站照常启动，稍后可在网站设置里重试读取。');
        break;
      }
      rejected = true;
      if (fromSaved) {
        forgetCredentials();
        console.log('已保存的 OKX 密钥失效，已从本机删除，请重新输入。');
      }
      creds = null;
      fromSaved = false;
    }
  }
  if (creds && !online) apply(creds);
  if (rejected) {
    // Three wrong keys: start without OKX, but keep the website password so sign-in works.
    for (const key of okxKeys) delete process.env[key];
    if (accessToken) process.env.GLEANBOOK_ACCESS_TOKEN = accessToken;
    console.log('OKX 密钥多次验证未通过：网站照常启动但不读取持仓。核对密钥后重启即可。');
  }
  if (verified && creds && !fromSaved) {
    if (canSaveCredentials()) {
      try {
        const where = saveCredentials(creds);
        console.log(
          `凭证已加密保存到 ${where}，只有当前系统用户能读取。\n下次启动无需再输入；要清除请运行 npm run forget:okx。`,
        );
      } catch (error) {
        console.log(`${errorText(error)}。本次照常运行，下次启动仍需输入。`);
      }
    } else
      console.log(
        process.platform === 'linux'
          ? '未找到 secret-tool，无法加密保存，下次启动仍需输入。安装 libsecret-tools（Debian / Ubuntu）或 libsecret（Fedora / Arch）后即可保存。'
          : '当前系统不支持加密保存，下次启动仍需输入。',
      );
  }

  // Phones reach the site through Tailscale Serve over HTTPS; trust that origin as well.
  const tailscale = tailscaleState(),
    phoneOrigin = tailscale.origin;
  process.env.APP_ORIGIN = [`http://localhost:${port}`, phoneOrigin].filter(Boolean).join(',');
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'development';
  await import('../server/index');
  console.log(`电脑浏览器打开 http://localhost:${port}`);
  console.log(
    phoneOrigin
      ? `手机（已连 Tailscale）打开 ${phoneOrigin}`
      : tailscale.state === 'NeedsLogin' || tailscale.state === 'Stopped'
        ? 'Tailscale 已安装但未登录：先运行 tailscale up 登录，再运行 tailscale serve --bg 8787（详见 docs/IPHONE.md）'
        : '未检测到 Tailscale：手机访问请按 docs/IPHONE.md 安装并运行 tailscale serve --bg 8787',
  );
  console.log(
    `电脑主库：${path.join(defaultDataDir(), 'ledger.json')}。关闭网站请在此窗口按 Ctrl+C。`,
  );
} catch (error) {
  for (const key of [...okxKeys, 'GLEANBOOK_ACCESS_TOKEN']) delete process.env[key];
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  console.error(errorText(error));
  // Without this, an open browser tab keeps serving the cached page and only reports
  // "Failed to fetch" on the next API call.
  console.error(
    '\n网站后端未启动，密钥已从内存清除。浏览器里仍能打开的页面只是离线缓存，无法连接后端。\n修正后重新运行 npm run start:private；只用账本、基金和定投可运行 npm start。',
  );
  process.exitCode = 1;
}
