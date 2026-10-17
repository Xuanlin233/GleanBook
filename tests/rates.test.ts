import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLedger, holdingValue, type Ledger } from '../src/domain';
import { mergeAutoRates, ratesNeeded, type AutoRate } from '../src/rates';
import { fetchRates } from '../server/rates';
afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

const auto = (currency: AutoRate['currency'], value: string): AutoRate => ({
  currency,
  value,
  source: '测试自动源',
  asOf: '2026-10-16T01:15:00.000Z',
});
function ledger(): Ledger {
  const l = emptyLedger();
  l.holdings = [
    {
      id: 'okx-btc',
      name: 'BTC',
      kind: 'crypto',
      symbol: 'BTC',
      currency: 'USDT',
      quantity: '0.01',
      cost: null,
      source: 'manual',
      location: 'OKX',
      price: {
        value: '80000',
        currency: 'USDT',
        asOf: '2026-10-16T01:00:00.000Z',
        fetchedAt: '2026-10-16T01:00:00.000Z',
        source: 'OKX',
        mode: 'market',
      },
    },
  ];
  l.accounts = [
    { id: 'usd', name: '美元', kind: 'bank', currency: 'USD', opening: '1', source: 'manual' },
  ];
  return l;
}

describe('自动汇率合并', () => {
  it('只补账本用到的币种，补齐后 OKX 持仓即可估值', () => {
    const l = ledger();
    expect(ratesNeeded(l).sort()).toEqual(['USD', 'USDT']);
    expect(holdingValue(l, l.holdings[0])).toBeNull();
    const next = mergeAutoRates(l, [
      auto('USD', '6.722'),
      auto('USDT', '6.71'),
      auto('EUR', '7.5'),
    ]);
    expect(next.rates.map((r) => r.currency).sort()).toEqual(['USD', 'USDT']);
    expect(next.rates.every((r) => r.auto)).toBe(true);
    expect(holdingValue(next, next.holdings[0])!.toFixed()).toBe('5368');
  });
  it('手动汇率不被覆盖；自动汇率会更新；无变化时返回同一对象', () => {
    const l = ledger();
    l.rates = [
      { currency: 'USD', value: '7', source: '我的银行', asOf: '2026-10-01T00:00:00.000Z' },
      { ...auto('USDT', '6.6'), auto: true },
    ];
    const next = mergeAutoRates(l, [auto('USD', '6.722'), auto('USDT', '6.71')]);
    expect(next.rates.find((r) => r.currency === 'USD')!.value).toBe('7');
    expect(next.rates.find((r) => r.currency === 'USDT')!.value).toBe('6.71');
    expect(mergeAutoRates(next, [auto('USD', '6.722'), auto('USDT', '6.71')])).toBe(next);
  });
});

describe('自动汇率数据源', () => {
  const okx = (instId: string, last: string) =>
    json({ code: '0', data: [{ instId, last, ts: '1792113940602' }] });
  it('中间价可用时采用中间价，USDT 与 USDC 按 OKX 价格折算，不当作 1 美元', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('chinamoney'))
          return json({
            data: { lastDate: '2026-10-16 9:15' },
            records: [
              { vrtEName: 'USD/CNY', price: '6.7220' },
              { vrtEName: 'EUR/CNY', price: '7.5228' },
              { vrtEName: 'HKD/CNY', price: '0.85658' },
            ],
          });
        if (url.includes('USDT-USD')) return okx('USDT-USD', '0.9988');
        if (url.includes('USDC-USDT')) return okx('USDC-USDT', '1.001');
        throw new Error('unexpected ' + url);
      }),
    );
    const rates = await fetchRates();
    expect(rates.find((r) => r.currency === 'USD')).toMatchObject({
      value: '6.7220',
      asOf: '2026-10-16T01:15:00.000Z',
    });
    expect(rates.find((r) => r.currency === 'USDT')!.value).toBe('6.713934');
    expect(rates.find((r) => r.currency === 'USDC')!.value).toBe('6.720648');
  });
  it('中间价失败时改用欧洲央行参考汇率', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('chinamoney')) return json({}, 503);
        if (url.includes('frankfurter'))
          return json({ date: '2026-10-16', rates: { CNY: 6.7, EUR: 0.9, HKD: 7.8 } });
        if (url.includes('USDT-USD')) return okx('USDT-USD', '1');
        return okx('USDC-USDT', '1');
      }),
    );
    const rates = await fetchRates();
    expect(rates.find((r) => r.currency === 'USD')).toMatchObject({
      value: '6.7',
      source: expect.stringContaining('欧洲央行'),
    });
    expect(rates.find((r) => r.currency === 'HKD')!.value).toBe('0.858974');
  });
});
