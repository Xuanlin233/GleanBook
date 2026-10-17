import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFundReader,
  fetchOfficialFund,
  FUND_CACHE_MS,
  type FundQuote,
} from '../server/funds';
import { fetchPrice } from '../src/market';
import type { Holding } from '../src/domain';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const now = new Date('2026-10-16T12:00:00.000Z');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const quote: FundQuote = {
  code: '000218',
  name: '测试',
  value: '3.2186',
  navDate: '2026-10-15',
  fetchedAt: now.toISOString(),
  currency: 'CNY',
  source: '官网实验接入',
  experimental: true,
};
const h: Holding = {
  id: 'fund',
  name: '测试基金',
  kind: 'fund',
  symbol: '000218',
  currency: 'CNY',
  quantity: '10',
  cost: '20',
  source: 'manual',
  location: '支付宝',
  price: null,
};
const ef = (rows: unknown[], total = rows.length) => ({
  status: 1,
  data: { pageIndex: 0, total, data: rows },
});
const efRow = {
  navDate: '2026-10-15',
  shortName: '易方达沪深300ETF发起式联接A',
  netValue: '1.7196',
  totalNetValue: '999.9999',
};

describe('基金官网正式净值校验', () => {
  it('国泰按上海日期解释 UTC 时间，只使用单位净值并选择最新日', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        expect(url).toBe('https://e.gtfund.com/Etrade/Public/cochin/info.fund.nav_history');
        expect(JSON.parse(init.body).params.fundCode).toBe('000218');
        expect(init.redirect).toBe('error');
        return json([
          { date: '2026-10-14T16:00:00Z', nav: '3.2186', anav: '99.9' },
          { date: '2026-10-13T16:00:00Z', nav: '3.2256' },
        ]);
      }),
    );
    expect(await fetchOfficialFund('000218', now)).toMatchObject({
      navDate: '2026-10-15',
      value: '3.2186',
      currency: 'CNY',
      experimental: true,
    });
  });
  it('易方达使用单位净值，不使用累计净值或涨跌幅', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(ef([efRow]))),
    );
    expect(await fetchOfficialFund('110020', now)).toMatchObject({
      value: '1.7196',
      navDate: '2026-10-15',
    });
  });
  it('份额类别、截断分页、重复日期、未来日期、旧数据和零净值都拒绝', async () => {
    const cases = [
      ef([{ ...efRow, shortName: '易方达沪深300ETF联接C' }]),
      ef([efRow], 2),
      ef([efRow, efRow]),
      ef([{ ...efRow, navDate: '2026-10-17' }]),
      ef([{ ...efRow, navDate: '2026-09-01' }]),
      ef([{ ...efRow, netValue: '0' }]),
    ];
    for (const raw of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(raw)),
      );
      await expect(fetchOfficialFund('110020', now)).rejects.toThrow();
    }
  });
  it('不支持的代码不发起请求，访问受限不重复尝试', async () => {
    const f = vi.fn(async () => json({}, 403));
    vi.stubGlobal('fetch', f);
    await expect(fetchOfficialFund('000219', now)).rejects.toThrow('尚未验证');
    expect(f).not.toHaveBeenCalled();
    await expect(fetchOfficialFund('000218', now)).rejects.toThrow('限制访问');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('六小时内复用公开净值，多个请求合并；失败后暂停十五分钟', async () => {
    let clock = now.getTime();
    const loader = vi.fn(async () => quote);
    const read = createFundReader(loader, () => clock);
    expect(await Promise.all([read('000218'), read('000218')])).toEqual([quote, quote]);
    await read('000218');
    expect(loader).toHaveBeenCalledTimes(1);
    clock += FUND_CACHE_MS;
    loader.mockRejectedValueOnce(new Error('上游不可用'));
    await expect(read('000218')).rejects.toThrow('上游不可用');
    await expect(read('000218')).rejects.toThrow('15 分钟');
    expect(loader).toHaveBeenCalledTimes(2);
    clock += 15 * 60000;
    expect(await read('000218')).toEqual(quote);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});

describe('基金前端不会制造当日价格', () => {
  it('保留正式净值日与真正获取时间，不把昨天改成今天', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        expect(init.credentials).toBe('omit');
        expect(init.cache).toBe('no-store');
        return json(quote);
      }),
    );
    expect(await fetchPrice(h)).toMatchObject({
      navDate: '2026-10-15',
      asOf: '2026-10-14T16:00:00.000Z',
      fetchedAt: now.toISOString(),
      mode: 'official',
      change24h: null,
    });
  });
  it('请求失败、错误基金或日期倒退均不修改已有净值', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const saved: Holding = {
      ...h,
      price: {
        value: '3.25',
        navDate: '2026-10-16',
        asOf: '2026-10-15T16:00:00Z',
        fetchedAt: now.toISOString(),
        currency: 'CNY',
        source: '已保存',
        mode: 'official',
      },
    };
    const before = structuredClone(saved);
    for (const response of [
      () => json({}, 503),
      () => json({ ...quote, code: '110020' }),
      () => json(quote),
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response()),
      );
      await expect(fetchPrice(saved)).rejects.toThrow();
      expect(saved).toEqual(before);
    }
  });
});
