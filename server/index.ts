import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { publicTicker, syncOKX, lastOKXRead, minuteCandle } from './okx';
import { createFundReader, createHistoryReader, isSupportedFund } from './funds';
import { allowedOrigins } from './origin';
import { issueSession, SESSION_DAYS, verifySession } from './session';
import { createHolidayReader } from './calendar';
import { createRateReader } from './rates';
import { createLedgerStore } from './ledger-store';
import { z } from 'zod';
import { configureOutboundProxy, outboundProxyMode, proxyModeLabel } from './proxy';
const readFund = createFundReader(),
  readHistory = createHistoryReader(),
  readHolidays = createHolidayReader(),
  readRates = createRateReader(),
  ledgerStore = createLedgerStore(),
  candles = new Map<string, Awaited<ReturnType<typeof minuteCandle>>>();
try {
  process.loadEnvFile();
} catch {
  /* environment configuration is optional */
}
configureOutboundProxy();
const host = process.env.HOST || '127.0.0.1',
  port = Number(process.env.PORT || 8787),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const limits = new Map<string, { count: number; end: number }>(),
  market = new Map<string, { at: number; data: unknown[] }>();
const equal = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
function throttle(key: string, max: number, window = 60000) {
  const now = Date.now();
  let row = limits.get(key);
  if (!row || row.end < now) {
    row = { count: 0, end: now + window };
    limits.set(key, row);
  }
  if (limits.size > 10000) {
    for (const [k, r] of limits) if (r.end < now) limits.delete(k);
    if (limits.size > 10000) return false;
  }
  return ++row.count <= max;
}
function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function body(req: http.IncomingMessage, limit = 2048) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) throw new Error('请求过大');
  }
  return JSON.parse(text || '{}') as Record<string, unknown>;
}
function validOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin;
  const configured = allowedOrigins();
  return (
    !!origin &&
    (configured.has(origin) || (configured.size === 0 && origin === `http://${req.headers.host}`))
  );
}
function session(req: http.IncomingMessage) {
  const token = req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('sz_session='))
    ?.slice(11);
  return token && verifySession(token, process.env.GLEANBOOK_ACCESS_TOKEN) ? token : null;
}
const syncOp = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('put'),
    key: z.string().max(300),
    at: z.string().datetime(),
    value: z.unknown(),
  }),
  z.object({ kind: z.literal('delete'), key: z.string().max(300), at: z.string().datetime() }),
]);
const syncRequest = z.object({
  revision: z.number().int().nonnegative().nullable(),
  ops: z.array(syncOp).max(200000),
});
const configured = () =>
  !!(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`),
    ip = req.socket.remoteAddress ?? 'unknown';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (url.pathname.startsWith('/api/')) {
    if (!throttle(ip + ':api', 80)) {
      json(res, 429, { error: '操作较频繁，请稍后再试' });
      return;
    }
    if (req.method !== 'GET' && !validOrigin(req)) {
      json(res, 403, { error: '请求来源不受信任，请核对 APP_ORIGIN' });
      return;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, {
          service: 'gleanbook',
          storage: 'device-with-pc-master',
          cloudSync: false,
          pcSync: true,
          scheduler: false,
          outbound: outboundProxyMode(),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/market') {
        const instrument = url.searchParams.get('instrument') ?? '';
        if (!/^[A-Z0-9]{2,12}-USDT$/.test(instrument)) {
          json(res, 400, { error: '产品标识无效' });
          return;
        }
        if (!throttle(ip + ':market', 30)) {
          json(res, 429, { error: '行情请求过于频繁' });
          return;
        }
        const cached = market.get(instrument),
          data =
            cached && Date.now() - cached.at < 15000 ? cached.data : await publicTicker(instrument);
        if (!cached || cached.data !== data) {
          if (market.size > 200) market.clear();
          market.set(instrument, { at: Date.now(), data });
        }
        json(res, 200, { code: '0', data });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/market/candle') {
        const instrument = url.searchParams.get('instrument') ?? '',
          at = Number(url.searchParams.get('at'));
        if (!/^[A-Z0-9]{2,12}-USDT$/.test(instrument) || !Number.isSafeInteger(at)) {
          json(res, 400, { error: '产品标识或时间无效' });
          return;
        }
        const key = instrument + '@' + at,
          hit = candles.get(key);
        if (hit) {
          json(res, 200, hit);
          return;
        }
        if (!throttle(ip + ':candle', 60)) {
          json(res, 429, { error: '历史价格请求过于频繁，稍后自动重试' });
          return;
        }
        // Closed minutes never change, so they are cached for the process lifetime.
        const data = await minuteCandle(instrument, at);
        if (candles.size > 5000) candles.clear();
        candles.set(key, data);
        json(res, 200, data);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/rates') {
        if (!throttle(ip + ':rates', 10)) {
          json(res, 429, { error: '汇率请求过于频繁' });
          return;
        }
        json(res, 200, { rates: await readRates() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/calendar/cn') {
        const year = Number(url.searchParams.get('year'));
        if (!Number.isInteger(year)) {
          json(res, 400, { error: '年份无效' });
          return;
        }
        if (!throttle(ip + ':calendar', 20)) {
          json(res, 429, { error: '节假日数据请求过于频繁' });
          return;
        }
        json(res, 200, await readHolidays(year));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/funds/history') {
        const code = url.searchParams.get('code') ?? '',
          from = url.searchParams.get('from') ?? '';
        if (!isSupportedFund(code) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
          json(res, 400, { error: '基金代码或日期无效' });
          return;
        }
        if (!throttle(ip + ':funds', 30)) {
          json(res, 429, { error: '基金净值请求过于频繁，稍后自动重试' });
          return;
        }
        json(res, 200, await readHistory(code, from));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/funds/nav') {
        const code = url.searchParams.get('code') ?? '';
        if (!isSupportedFund(code)) {
          json(res, 400, { error: '基金代码应为 6 位数字' });
          return;
        }
        if (!throttle(ip + ':funds', 30)) {
          json(res, 429, { error: '基金净值无需频繁刷新，请稍后重试' });
          return;
        }
        json(res, 200, await readFund(code));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        if (!throttle(ip + ':login', 8, 15 * 60000)) {
          json(res, 429, { error: '验证次数过多，请 15 分钟后重试' });
          return;
        }
        const input = await body(req),
          token = process.env.GLEANBOOK_ACCESS_TOKEN;
        if (!token || token.length < 32) {
          json(res, 503, { error: '后端访问口令尚未安全配置' });
          return;
        }
        if (typeof input.token !== 'string' || !equal(input.token, token)) {
          json(res, 401, { error: '后端访问口令不正确' });
          return;
        }
        res.setHeader(
          'Set-Cookie',
          `sz_session=${issueSession(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_DAYS * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
        );
        json(res, 200, { authenticated: true });
        return;
      }
      if (req.method === 'DELETE' && url.pathname === '/api/session') {
        res.setHeader('Set-Cookie', 'sz_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
        json(res, 200, { authenticated: false, localLedgerRetained: true });
        return;
      }
      if (!session(req)) {
        json(res, 401, { error: '后端未鉴权；私人接口不可匿名访问' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sync') {
        if (!throttle(ip + ':ledger-sync', 120)) {
          json(res, 429, { error: '同步过于频繁，稍后自动重试' });
          return;
        }
        const input = syncRequest.safeParse(await body(req, 30 * 1024 * 1024));
        if (!input.success) {
          json(res, 400, { error: '同步请求格式不正确' });
          return;
        }
        json(res, 200, await ledgerStore.sync(input.data.revision, input.data.ops));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/okx/status') {
        json(res, 200, {
          authenticated: true,
          configured: configured(),
          liveVerified: !!lastOKXRead(),
          lastVerifiedAt: lastOKXRead(),
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/okx/sync') {
        if (!throttle(ip + ':sync', 1, 60000)) {
          json(res, 429, { error: '持仓最多每分钟同步一次' });
          return;
        }
        json(res, 200, await syncOKX());
        return;
      }
      json(res, 404, { error: '接口不存在' });
      return;
    } catch (e) {
      const message =
        e instanceof Error && e.name !== 'ZodError' ? e.message : '上游数据格式异常，本次未更新';
      json(res, 502, { error: message });
      return;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = path.resolve(root, '.' + decoded);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let selected = file;
    try {
      if (!(await stat(selected)).isFile()) selected = path.join(root, 'index.html');
    } catch {
      if (path.extname(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      selected = path.join(root, 'index.html');
    }
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webmanifest': 'application/manifest+json',
    };
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    res.setHeader('Content-Type', mime[path.extname(selected)] ?? 'application/octet-stream');
    res.setHeader(
      'Cache-Control',
      selected.includes(path.sep + 'assets' + path.sep)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    const content = await readFile(selected);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404);
    res.end('请先运行 npm run build');
  }
});
server.listen(port, host, () => {
  const first = process.env.APP_ORIGIN?.split(',')[0]?.trim();
  const shown = first || `http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`;
  console.log(`拾账本地服务：${shown}（仅设备账本，云同步未启用）`);
  console.log(`外部接口网络：${proxyModeLabel[outboundProxyMode()]}`);
});
