import { createHmac } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { safeNetworkError } from './network-error';
import { configureOutboundProxy } from './proxy';
export const allowedOrigins = [
  'https://openapi.okx.com',
  'https://www.okx.com',
  'https://us.okx.com',
  'https://eea.okx.com',
];
const amount = z
  .string()
  .max(48)
  .regex(/^-?\d+(\.\d+)?$/)
  .refine((s) => new Decimal(s).isFinite());
const ccy = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/);
const fundingSchema = z.array(z.object({ ccy, bal: amount }));
const tradingSchema = z.array(
  z.object({
    details: z.array(
      z.object({
        ccy,
        cashBal: amount,
        liab: z.string().optional(),
        spotIsoBal: z.string().optional(),
      }),
    ),
  }),
);
const savingsSchema = z.array(
  z.object({
    ccy,
    amt: amount,
    earnings: z.string().optional(),
    loanAmt: z.string().optional(),
    pendingAmt: z.string().optional(),
    redemptAmt: z.string().optional(),
  }),
);
export type BalanceRow = {
  key: string;
  location: 'funding' | 'trading' | 'earn';
  currency: string;
  quantity: string;
  earnings: string | null;
  at: string;
};
export function normalizeBalances(
  funding: unknown,
  trading: unknown,
  savings: unknown,
  at: string,
): BalanceRow[] {
  const rows: BalanceRow[] = [];
  const add = (
    location: BalanceRow['location'],
    currency: string,
    quantity: string,
    earnings: string | null = null,
  ) => {
    if (new Decimal(quantity).lt(0)) throw new Error('不支持负余额或借贷账户，请手动核对');
    rows.push({ key: `${location}:${currency}`, location, currency, quantity, earnings, at });
  };
  for (const f of fundingSchema.parse(funding)) add('funding', f.ccy, f.bal);
  const tradingData = tradingSchema.parse(trading);
  if (tradingData.length > 1) throw new Error('交易账户快照格式不受支持');
  for (const t of tradingData[0]?.details ?? []) {
    if (
      (t.liab && t.liab !== '' && !new Decimal(t.liab).eq(0)) ||
      (t.spotIsoBal && t.spotIsoBal !== '' && !new Decimal(t.spotIsoBal).eq(0))
    )
      throw new Error('存在借贷或隔离仓位，已停止同步，请手动维护');
    add('trading', t.ccy, t.cashBal);
  }
  for (const s of savingsSchema.parse(savings)) {
    // amt is the total. loanAmt / pendingAmt are breakdowns, never add them again.
    if (s.redemptAmt && s.redemptAmt !== '' && !new Decimal(s.redemptAmt).eq(0))
      throw new Error('发现赎回中资产，归属尚需核对，本次不覆盖旧快照');
    const earnings = s.earnings && amount.safeParse(s.earnings).success ? s.earnings : null;
    add('earn', s.ccy, s.amt, earnings);
  }
  if (new Set(rows.map((x) => x.key)).size !== rows.length)
    throw new Error('接口返回重复资产标识，已停止同步');
  return rows;
}
export function signRequest(timestamp: string, path: string, secret: string) {
  return createHmac('sha256', secret)
    .update(timestamp + 'GET' + path)
    .digest('base64');
}
export async function publicTicker(instrument: string) {
  if (!/^[A-Z0-9]{2,12}-USDT$/.test(instrument) || instrument === 'USDT-USDT')
    throw new Error('不支持的产品标识');
  return okxRequest('/api/v5/market/ticker?instId=' + encodeURIComponent(instrument), false);
}
// Stablecoin legs for automatic CNY rates. Fixed list: not a general ticker proxy.
export async function rateTicker(instrument: 'USDT-USD' | 'USDC-USDT') {
  if (!['USDT-USD', 'USDC-USDT'].includes(instrument)) throw new Error('不支持的汇率交易对');
  return okxRequest('/api/v5/market/ticker?instId=' + instrument, false);
}
// Price at an exact minute for 定投: the open of that 1-minute candle (price at hh:mm:00).
// OKX `after` returns candles older than the given time, so after=at+60s yields the candle at `at`.
export async function minuteCandle(instrument: string, at: number, now = Date.now()) {
  if (!/^[A-Z0-9]{2,12}-USDT$/.test(instrument) || instrument === 'USDT-USDT')
    throw new Error('不支持的产品标识');
  if (!Number.isSafeInteger(at) || at % 60000 !== 0) throw new Error('时间需精确到整分钟');
  if (at + 60000 > now) throw new Error('该分钟尚未结束');
  if (now - at > 4 * 366 * 86400000) throw new Error('仅支持查询近四年的分钟价格');
  const raw = await okxRequest(
    `/api/v5/market/history-candles?instId=${encodeURIComponent(instrument)}&bar=1m&after=${at + 60000}&limit=1`,
    false,
  );
  const row = z
    .array(z.array(z.string()).min(9))
    .parse(raw)
    .find((r) => r[0] === String(at));
  if (!row || row[8] !== '1') throw new Error('该分钟没有已收盘的成交记录');
  const open = amount.parse(row[1]),
    close = amount.parse(row[4]);
  if (!new Decimal(open).gt(0)) throw new Error('分钟价格无效');
  return { instrument, at: new Date(at).toISOString(), open, close };
}
export async function checkOKXNetwork() {
  const raw = await okxRequest('/api/v5/public/time', false);
  const time = z
    .array(z.object({ ts: z.string().regex(/^\d{13}$/) }))
    .min(1)
    .parse(raw);
  return { reachable: true, serverTime: new Date(Number(time[0].ts)).toISOString() };
}
// OKX error codes are public documentation values and safe to show; upstream msg is not
// (it can echo the caller IP or key details).
const okxErrors: Record<string, string> = {
  '50100': 'API Key 已被冻结，请在 OKX 检查 Key 状态',
  '50101': 'API Key 与当前环境不匹配（可能是模拟盘 Key），请使用实盘只读 Key',
  '50102': '请求时间戳过期：本机时间与 OKX 相差超过 30 秒，请在 Windows 设置中立即同步时间',
  '50105': 'Passphrase 不正确。它是创建 API Key 时自设的口令，不是登录密码或资金密码',
  '50110':
    'IP 不在此 API Key 的白名单内。开启代理 / TUN 时出口 IP 是代理节点 IP，请把当前出口 IP 加入白名单或固定代理节点',
  '50111': 'API Key 无效，请核对是否完整复制（不含空格或换行）',
  '50113': '签名无效，通常是 Secret 复制错误或与 API Key 不属于同一组',
  '50114': '授权无效，请核对 API Key、Secret 与 Passphrase 是否属于同一组',
  '50119': 'API Key 不存在：可能已删除，或接口域名与账号注册地区不符',
  '50120': '此 API Key 没有读取权限',
  '50121': '拒绝当前网络出口 IP 访问，请更换网络出口',
  '50011': '触发限频，请稍后再试',
  '50061': '触发限频，请稍后再试',
  '50001': '服务暂不可用，请稍后再试',
  '50013': '系统繁忙，请稍后再试',
  '50026': '系统错误，请稍后再试',
};
export function describeOKXCode(code: string, privateCall: boolean) {
  const known = okxErrors[code];
  if (known) return `OKX：${known} [${code}]`;
  const safe = /^\d{1,6}$/.test(code) ? ` [${code}]` : '';
  return privateCall
    ? `OKX 拒绝请求，请核对权限、IP 白名单、地区和服务器时间${safe}`
    : `此产品暂无可用的官方现货行情${safe}`;
}
// Local clock correction learned from /api/v5/public/time after a 50102 rejection.
let clockOffset = 0;
async function syncClock() {
  const before = Date.now();
  const raw = await okxRequest('/api/v5/public/time', false);
  const ts = z
    .array(z.object({ ts: z.string().regex(/^\d{13}$/) }))
    .min(1)
    .parse(raw)[0].ts;
  clockOffset = Number(ts) - Math.round((before + Date.now()) / 2);
}
export const privatePaths = [
  '/api/v5/account/config',
  '/api/v5/asset/balances',
  '/api/v5/account/balance',
  '/api/v5/finance/savings/balance',
  '/api/v5/account/positions',
];
// Signed read-only headers. Throws before any network call when credentials are absent or malformed.
function privateHeaders(path: string, timestamp: string): Record<string, string> {
  const key = process.env.OKX_API_KEY,
    secret = process.env.OKX_API_SECRET,
    pass = process.env.OKX_API_PASSPHRASE;
  if (!key || !secret || !pass) throw new Error('OKX 未连接，请在后端配置只读凭证');
  if (![key, secret].every((v) => /^[\x21-\x7e]+$/.test(v)) || !/^[\x20-\x7e]+$/.test(pass))
    throw new Error('OKX 凭证包含无效字符，请核对是否误粘贴了标签、换行或中文；这不是网络超时');
  return {
    Accept: 'application/json',
    'OK-ACCESS-KEY': key,
    'OK-ACCESS-SIGN': signRequest(timestamp, path, secret),
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': pass,
  };
}
// Private account endpoints can take several seconds with real data (positions especially);
// public market data is expected to be quick.
const PRIVATE_TIMEOUT_MS = 20000,
  PUBLIC_TIMEOUT_MS = 8000;
// Diagnostics: one signed GET, reporting only HTTP status, OKX code and duration — never data.
export async function probePrivateEndpoint(path: string) {
  if (!privatePaths.includes(path)) throw new Error('请求不在只读允许列表');
  const origin = process.env.OKX_API_ORIGIN || 'https://openapi.okx.com';
  const start = Date.now();
  try {
    const res = await fetch(origin + path, {
      headers: privateHeaders(path, new Date(Date.now() + clockOffset).toISOString()),
      signal: AbortSignal.timeout(PRIVATE_TIMEOUT_MS),
      redirect: 'error',
    });
    const raw = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return {
      path,
      status: res.status,
      code: raw && typeof raw.code === 'string' && /^\d{1,6}$/.test(raw.code) ? raw.code : null,
      ms: Date.now() - start,
    };
  } catch (error) {
    return { path, status: null, code: safeNetworkError(error).code, ms: Date.now() - start };
  }
}
async function okxRequest(
  path: string,
  privateCall = true,
  clockRetried = false,
): Promise<unknown[]> {
  const origin = process.env.OKX_API_ORIGIN || 'https://openapi.okx.com';
  if (!allowedOrigins.includes(origin)) throw new Error('请配置正确的官方地区接口域名');
  if (privateCall && !privatePaths.includes(path)) throw new Error('请求不在只读允许列表');
  for (let attempt = 0; attempt < 2; attempt++) {
    const timestamp = new Date(Date.now() + clockOffset).toISOString();
    const headers: Record<string, string> = privateCall
      ? privateHeaders(path, timestamp)
      : { Accept: 'application/json' };
    let res: Response;
    try {
      res = await fetch(origin + path, {
        headers,
        signal: AbortSignal.timeout(privateCall ? PRIVATE_TIMEOUT_MS : PUBLIC_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const failure = safeNetworkError(error);
      const scope = privateCall ? '只读接口' : '公共接口';
      // Code only: never the message, headers or URL, which may carry credentials.
      console.warn(`[OKX] ${scope}第 ${attempt + 1} 次请求失败：${failure.code}`);
      // The proxy may have come up, or switched between TUN and system-proxy mode, since this
      // process started: pick up the current setting before trying again.
      try {
        configureOutboundProxy();
      } catch {
        /* an invalid OKX_PROXY was already reported at startup */
      }
      if (attempt === 0 && failure.retryable) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`OKX ${scope}：${failure.message} [${failure.code}]。已保留旧数据`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    // Auth failures arrive as HTTP 401 with a JSON code; read it before judging the status,
    // otherwise a wrong Secret looks like a network or region problem.
    const raw = (await res.json().catch(() => null)) as { code?: unknown; data?: unknown } | null;
    const code = raw && typeof raw.code === 'string' ? raw.code : null;
    if (code === '50102' && privateCall && !clockRetried) {
      await syncClock();
      return okxRequest(path, privateCall, true);
    }
    if (code && code !== '0') throw new Error(describeOKXCode(code, privateCall));
    if (!res.ok) throw new Error(`OKX 服务返回 HTTP ${res.status}，请核对网络和账号适用地区`);
    if (!raw || code !== '0' || !Array.isArray(raw.data))
      throw new Error('OKX 响应格式无效，本次未更新');
    return raw.data;
  }
  throw new Error('请求失败');
}
const accountModes: Record<string, string> = {
  '1': '现货模式',
  '2': '合约模式',
  '3': '跨币种保证金模式',
  '4': '组合保证金模式',
};
const positionKinds: Record<string, string> = {
  MARGIN: '杠杆',
  SWAP: '永续合约',
  FUTURES: '交割合约',
  OPTION: '期权',
};
let activeSync = false;
let lastSuccessfulRead: string | null = null;
export const lastOKXRead = () => lastSuccessfulRead;
export async function syncOKX() {
  if (activeSync) throw new Error('已有同步正在进行，请稍后重试');
  activeSync = true;
  try {
    const config = z
      .array(z.object({ perm: z.string(), acctLv: z.string() }))
      .min(1)
      .parse(await okxRequest('/api/v5/account/config'));
    const perms = config[0].perm.split(',').map((s) => s.trim());
    if (perms.length !== 1 || perms[0] !== 'read_only')
      throw new Error('此 API Key 并非仅 Read 权限，已拒绝连接。请撤销交易和提币权限');
    const mode = accountModes[config[0].acctLv];
    if (!mode) throw new Error('无法识别的 OKX 账户模式，请手动维护');
    // Non-spot modes are fine for a cash snapshot as long as nothing is open: with open
    // margin / swap / futures / option positions, cash balances omit unrealized PnL and
    // margin, so the snapshot would be wrong. Borrowing is rejected later via liab.
    if (config[0].acctLv !== '1') {
      const open = z
        .array(z.object({ instType: z.string().max(20), pos: z.string().max(48) }))
        .max(1000)
        .parse(await okxRequest('/api/v5/account/positions'))
        .filter((p) => p.pos !== '' && !new Decimal(p.pos).eq(0));
      if (open.length) {
        const kinds = [...new Set(open.map((p) => positionKinds[p.instType] ?? p.instType))];
        throw new Error(
          `当前为${mode}，有 ${open.length} 个未平仓仓位（${kinds.join('、')}）。现金余额不含其未实现盈亏和保证金，快照会不准确，本次不读取；平仓后再试，或手动维护这些资产`,
        );
      }
    }
    const start = Date.now();
    // All three reads must succeed. A partial result never replaces a saved snapshot.
    const funding = await okxRequest('/api/v5/asset/balances'),
      fundingAt = new Date().toISOString();
    const trading = await okxRequest('/api/v5/account/balance'),
      tradingAt = new Date().toISOString();
    const earn = await okxRequest('/api/v5/finance/savings/balance'),
      earnAt = new Date().toISOString();
    if (Date.now() - start > 30000) throw new Error('各账户快照时间差过大，本次不更新，请稍后重试');
    const rows = normalizeBalances(funding, trading, earn, new Date().toISOString()).map((r) => ({
      ...r,
      at: r.location === 'funding' ? fundingAt : r.location === 'trading' ? tradingAt : earnAt,
    }));
    const generatedAt = new Date().toISOString();
    lastSuccessfulRead = generatedAt;
    return {
      rows,
      generatedAt,
      permissions: 'read_only',
      scope: `账户模式：${mode}（读取时无未平仓仓位、无借币）。仅现金余额、资金余额、简单赚币活期；非原子快照；不含全量交易历史、定期赚币、Web3 钱包或保证覆盖所有 xStock。`,
    };
  } finally {
    activeSync = false;
  }
}
