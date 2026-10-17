import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPrice } from '../src/market';
import type { Holding } from '../src/domain';
afterEach(() => vi.unstubAllGlobals());
const holding: Holding = {
  id: 'test',
  name: 'Bitcoin',
  kind: 'crypto',
  symbol: 'BTC',
  quantity: '0.1',
  cost: null,
  currency: 'USDT',
  source: 'manual',
  location: '测试',
  price: null,
};
describe('公共行情校验', () => {
  it('区分报价币种和 24 小时市场涨跌', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.credentials).toBe('omit');
      expect(init.cache).toBe('no-store');
      return new Response(
        JSON.stringify({
          code: '0',
          data: [{ instId: 'BTC-USDT', last: '105', open24h: '100', ts: String(Date.now()) }],
        }),
      );
    });
    vi.stubGlobal('fetch', f);
    const p = await fetchPrice(holding);
    expect(p.currency).toBe('USDT');
    expect(p.change24h).toBe('5.000000000000');
    expect(p.source).toContain('OKX');
  });
  it('接口失败不修改传入的旧持仓与价格', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    const before = structuredClone(holding);
    await expect(fetchPrice(holding)).rejects.toThrow('失败');
    expect(holding).toEqual(before);
  });
  it('过期、错误产品或零价格不进入估值', async () => {
    for (const data of [
      { instId: 'BTC-USDT', last: '100', open24h: '99', ts: '1' },
      { instId: 'ETH-USDT', last: '100', open24h: '99', ts: String(Date.now()) },
      { instId: 'BTC-USDT', last: '0', open24h: '99', ts: String(Date.now()) },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ code: '0', data: [data] }))),
      );
      await expect(fetchPrice(holding)).rejects.toThrow();
    }
  });
});
