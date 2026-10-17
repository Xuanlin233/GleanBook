import { z } from 'zod';
import { D, dayIn, type Holding, type Price } from './domain';
import { fundRefreshInterval } from './navday';
import { tr } from './i18n';
export function canRefreshPrice(h: Holding) {
  return (
    (h.kind === 'fund' && h.currency === 'CNY' && /^\d{6}$/.test(h.symbol)) ||
    (['crypto', 'earn'].includes(h.kind) &&
      h.currency === 'USDT' &&
      /^[A-Z0-9]{2,12}$/.test(h.symbol) &&
      h.symbol !== 'USDT')
  );
}
export const priceRefreshInterval = (h: Holding) =>
  h.kind === 'fund' ? fundRefreshInterval(h.price?.navDate) : 5 * 60000;
const fundQuoteSchema = z.object({
  code: z.string(),
  value: z.string().regex(/^\d{1,12}(\.\d{1,12})?$/),
  navDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fetchedAt: z.string().datetime(),
  currency: z.literal('CNY'),
  source: z.string().min(1).max(200),
  experimental: z.literal(true),
});
async function fetchFund(h: Holding): Promise<Price> {
  if (!canRefreshPrice(h)) throw new Error(tr('仅支持 6 位数字代码的人民币公募基金，请手动更新'));
  const res = await fetch(`/api/funds/nav?code=${encodeURIComponent(h.symbol)}`, {
    signal: AbortSignal.timeout(25000),
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((r: { error?: unknown }) => (typeof r.error === 'string' ? r.error.slice(0, 200) : ''))
      .catch(() => '');
    throw new Error(detail || tr('基金净值暂未更新，请稍后重试；原有数据保留'));
  }
  const q = fundQuoteSchema.parse(await res.json());
  const today = dayIn(new Date().toISOString(), 'Asia/Shanghai');
  if (
    q.code !== h.symbol ||
    !D(q.value).gt(0) ||
    isNaN(Date.parse(q.navDate)) ||
    new Date(q.navDate).toISOString().slice(0, 10) !== q.navDate ||
    q.navDate > today ||
    Date.parse(today) - Date.parse(q.navDate) > 14 * 86400000 ||
    Date.parse(q.fetchedAt) > Date.now() + 300000
  )
    throw new Error(tr('基金代码、日期或净值无效，原有数据保留'));
  const previousDay = h.price && (h.price.navDate ?? dayIn(h.price.asOf, 'Asia/Shanghai'));
  if (previousDay && previousDay > q.navDate)
    throw new Error(tr('接口净值日期早于已保存记录，本次不覆盖'));
  return {
    value: q.value,
    currency: 'CNY',
    navDate: q.navDate,
    asOf: new Date(`${q.navDate}T00:00:00+08:00`).toISOString(),
    fetchedAt: q.fetchedAt,
    source: q.source,
    mode: 'official',
    change24h: null,
  };
}
const tickerSchema = z.object({
  code: z.literal('0'),
  data: z
    .array(z.object({ instId: z.string(), last: z.string(), open24h: z.string(), ts: z.string() }))
    .min(1),
});
export async function fetchPrice(h: Holding): Promise<Price> {
  if (h.kind === 'fund') return fetchFund(h);
  if (
    !['crypto', 'earn'].includes(h.kind) ||
    h.currency !== 'USDT' ||
    !/^[A-Z0-9]{2,12}$/.test(h.symbol) ||
    h.symbol === 'USDT'
  )
    throw new Error(tr('此持仓暂无已验证的自动行情路径，请手动更新'));
  const instId = h.symbol + '-USDT';
  // Public market data only; no credential or private balance is sent to this path.
  const res = await fetch(`/api/market?instrument=${encodeURIComponent(instId)}`, {
    signal: AbortSignal.timeout(10000),
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(tr('公共行情请求失败，请检查后端或手动录入价格'));
  const result = tickerSchema.parse(await res.json()),
    t = result.data.find((x) => x.instId === instId);
  if (!t || !D(t.last).isFinite() || !D(t.last).gt(0))
    throw new Error(tr('行情数据无效，保留上次价格'));
  const asOf = new Date(Number(t.ts)).toISOString();
  if (Date.parse(asOf) > Date.now() + 300000 || Date.parse(asOf) < Date.now() - 86400000)
    throw new Error(tr('行情时间异常，保留上次价格'));
  return {
    value: t.last,
    currency: 'USDT',
    asOf,
    fetchedAt: new Date().toISOString(),
    source: tr('OKX 官方现货 {instId}', { instId }),
    mode: 'market',
    change24h:
      D(t.open24h).isFinite() && D(t.open24h).gt(0)
        ? D(t.last).minus(t.open24h).div(t.open24h).mul(100).toFixed(12)
        : null,
  };
}
