import { describe, expect, it, vi } from 'vitest';
import {
  accountBalance,
  emptyLedger,
  holdingPosition,
  validateLedger,
  type Ledger,
  type Plan,
} from '../src/domain';
import {
  applyRunUpdates,
  generateRuns,
  makeCalendar,
  nextOccurrence,
  planOccurrences,
  resolveRuns,
  settle,
  zonedTime,
  type PriceDeps,
} from '../src/plans';
import { expectedNavDate, fundRefreshInterval } from '../src/navday';

const cst = (s: string) => Date.parse(s + '+08:00');
function ledger(): Ledger {
  const l = emptyLedger();
  l.accounts = [
    {
      id: 'bank',
      name: '招行卡',
      kind: 'bank',
      currency: 'CNY',
      opening: '10000',
      source: 'manual',
    },
    { id: 'usd', name: '美元卡', kind: 'bank', currency: 'USD', opening: '1000', source: 'manual' },
  ];
  const base = {
    quantity: '0',
    cost: '0',
    source: 'manual' as const,
    location: '测试',
    price: null,
  };
  l.holdings = [
    {
      ...base,
      id: 'fund',
      name: '易方达沪深300联接A',
      kind: 'fund',
      symbol: '110020',
      currency: 'CNY',
    },
    { ...base, id: 'btc', name: 'BTC', kind: 'crypto', symbol: 'BTC', currency: 'USDT' },
    {
      ...base,
      id: 'usdt',
      name: 'USDT',
      kind: 'crypto',
      symbol: 'USDT',
      currency: 'USDT',
      quantity: '100',
      cost: '100',
    },
  ];
  l.rates = [{ currency: 'USD', value: '7.1', source: '测试', asOf: '2026-10-01T00:00:00.000Z' }];
  return l;
}
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1',
  name: '沪深300月投',
  sourceType: 'account',
  sourceId: 'bank',
  targetId: 'fund',
  mode: 'amount',
  amount: '500',
  amountCurrency: 'CNY',
  feeRate: '0.15',
  frequency: 'monthly',
  monthDay: 15,
  time: '09:30',
  timezone: 'Asia/Shanghai',
  startDate: '2026-08-01',
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  note: '',
  ...over,
});

describe('定投排期', () => {
  it('按计划时区换算整分钟时间，含夏令时', () => {
    expect(zonedTime('2026-10-12', '09:30', 'Asia/Shanghai')).toBe(Date.UTC(2026, 9, 12, 1, 30));
    expect(zonedTime('2026-07-01', '09:30', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 30));
    expect(zonedTime('2026-12-01', '09:30', 'America/New_York')).toBe(
      Date.UTC(2026, 11, 1, 14, 30),
    );
  });
  it('每月 31 日在小月取月末，结束日期之后不再生成', () => {
    const days = planOccurrences(
      plan({ monthDay: 31, startDate: '2026-01-01', endDate: '2026-04-30' }),
      null,
      cst('2026-12-31T00:00:00'),
    ).map((t) => new Date(t + 8 * 3600000).toISOString().slice(0, 10));
    expect(days).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('工作日、每周、每两周', () => {
    const until = cst('2026-10-25T23:59:00'),
      start = '2026-10-12';
    const count = (p: Partial<Plan>) =>
      planOccurrences(plan({ startDate: start, ...p }), null, until).length;
    expect(count({ frequency: 'weekdays' })).toBe(10);
    expect(count({ frequency: 'daily' })).toBe(14);
    expect(count({ frequency: 'weekly', weekday: 3 })).toBe(2);
    expect(count({ frequency: 'biweekly', weekday: 3 })).toBe(1);
  });
  it('游标之后才生成新期数；下次时间从现在算起', () => {
    const p = plan({ cursor: new Date(cst('2026-09-15T09:30:00')).toISOString() });
    expect(planOccurrences(p, Date.parse(p.cursor!), cst('2026-10-20T00:00:00'))).toEqual([
      cst('2026-10-15T09:30:00'),
    ]);
    expect(nextOccurrence(p, cst('2026-10-16T00:00:00'))).toBe(cst('2026-11-15T09:30:00'));
    expect(nextOccurrence({ ...p, active: false })).toBeNull();
  });
});

describe('定投生成与预扣款', () => {
  it('补记过去各期，定额现金来源立即扣款并计入待确认本金，重复运行不重复生成', () => {
    let l = ledger();
    l.plans = [plan()];
    l = validateLedger(generateRuns(l, cst('2026-10-16T10:00:00')));
    expect(l.planRuns.map((r) => r.scheduledAt)).toEqual([
      '2026-08-15T01:30:00.000Z',
      '2026-09-15T01:30:00.000Z',
      '2026-10-15T01:30:00.000Z',
    ]);
    expect(l.plans[0].cursor).toBe('2026-10-15T01:30:00.000Z');
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('8500');
    expect(holdingPosition(l, l.holdings[0]).pending.toFixed()).toBe('1500');
    expect(generateRuns(l, cst('2026-10-16T10:00:00'))).toBe(l);
  });
  it('定份额或持仓来源在价格确定前不影响余额', () => {
    let l = ledger();
    l.plans = [
      plan({
        id: 'q',
        sourceType: 'holding',
        sourceId: 'usdt',
        targetId: 'btc',
        mode: 'quantity',
        amount: '0.001',
        amountCurrency: 'USDT',
        frequency: 'daily',
        startDate: '2026-10-16',
      }),
    ];
    l = validateLedger(generateRuns(l, cst('2026-10-16T10:00:00')));
    expect(l.planRuns).toHaveLength(1);
    expect(l.planRuns[0].sourceAmount).toBeUndefined();
    expect(holdingPosition(l, l.holdings[2]).quantity.toFixed()).toBe('100');
  });
});

describe('定投结算', () => {
  it('定额：外扣法手续费，基金份额截断到 0.01', () => {
    const l = ledger();
    l.plans = [plan()];
    const run = generateRuns(l, cst('2026-08-16T00:00:00')).planRuns[0];
    const done = settle(l, run, { price: '1.7219', note: '净值' });
    expect(done).toMatchObject({
      status: 'confirmed',
      sourceAmount: '500',
      targetCost: '500',
      fee: '0.75',
      targetQuantity: '289.94',
    });
  });
  it('定份额：按分钟价计算 USDT 成本与费用，从 USDT 持仓卖出', () => {
    const l = ledger();
    l.plans = [
      plan({
        sourceType: 'holding',
        sourceId: 'usdt',
        targetId: 'btc',
        mode: 'quantity',
        amount: '0.001',
        amountCurrency: 'USDT',
        feeRate: '0.1',
      }),
    ];
    const run = generateRuns(l, cst('2026-08-16T00:00:00')).planRuns[0];
    const done = settle(l, run, { price: '83798.3', note: '分钟价' }, { price: '1', note: '单位' });
    expect(done).toMatchObject({
      targetQuantity: '0.001',
      targetCost: '83.8820983',
      fee: '0.0837983',
      sourceAmount: '83.8820983',
      sourcePrice: '1',
    });
    const after = validateLedger({ ...l, planRuns: [done] });
    expect(holdingPosition(after, after.holdings[2]).quantity.toFixed()).toBe('16.1179017');
    expect(holdingPosition(after, after.holdings[1]).quantity.toFixed()).toBe('0.001');
  });
  it('跨币种：美元账户定额投人民币基金，锁定汇率', () => {
    const l = ledger();
    l.plans = [plan({ sourceId: 'usd', amount: '100', amountCurrency: 'USD', feeRate: '0' })];
    const run = generateRuns(l, cst('2026-08-16T00:00:00')).planRuns[0];
    expect(run).toMatchObject({ sourceAmount: '100', targetCost: '710', fxRate: '7.1' });
    l.rates = [{ ...l.rates[0], value: '7.3' }];
    expect(settle(l, run, { price: '2', note: '' })).toMatchObject({
      targetCost: '710',
      targetQuantity: '355',
    });
  });
  it('缺少汇率时拒绝结算', () => {
    const l = ledger();
    l.rates = [];
    l.plans = [plan({ sourceId: 'usd', amount: '100', amountCurrency: 'USD' })];
    const run = generateRuns(l, cst('2026-08-16T00:00:00')).planRuns[0];
    expect(run.sourceAmount).toBeUndefined();
    expect(() => settle(l, run, { price: '2', note: '' })).toThrow('汇率');
  });
});

describe('定投取价', () => {
  const history = (rows: [string, string][], from = '2026-10-15', to = '2026-10-17') => ({
    code: '110020',
    from,
    to,
    rows: rows.map(([navDate, value]) => ({ navDate, value })),
    source: '测试源',
  });
  it('15:00 前用当日净值，之后用下一交易日；未披露时等待', async () => {
    const l = ledger();
    l.plans = [
      plan({ id: 'a', frequency: 'daily', time: '14:59', startDate: '2026-10-16' }),
      plan({ id: 'b', frequency: 'daily', time: '15:00', startDate: '2026-10-16' }),
    ];
    const g = generateRuns(l, cst('2026-10-16T16:00:00'));
    const fundHistory = vi.fn(async () => history([['2026-10-16', '1.7219']]));
    const deps: PriceDeps = { fundHistory, candle: vi.fn(), now: () => cst('2026-10-17T10:00:00') };
    const updates = await resolveRuns(g, deps);
    expect(fundHistory).toHaveBeenCalledTimes(1);
    expect(updates.find((u) => u.run.planId === 'a')!.run).toMatchObject({
      status: 'confirmed',
      targetPrice: '1.7219',
    });
    expect(updates.find((u) => u.run.planId === 'b')!.run).toMatchObject({
      status: 'pending',
      waiting: expect.stringContaining('之后首个交易日'),
    });
  });
  it('加密资产按计划那一分钟取价，分钟未收盘时等待', async () => {
    const l = ledger();
    l.accounts.push({
      id: 'okx',
      name: 'OKX USDT',
      kind: 'manual',
      currency: 'USDT',
      opening: '1000',
      source: 'manual',
    });
    l.plans = [
      plan({
        sourceId: 'okx',
        targetId: 'btc',
        amount: '100',
        amountCurrency: 'USDT',
        feeRate: '0',
        frequency: 'daily',
        time: '09:30',
        startDate: '2026-10-12',
      }),
    ];
    const g = generateRuns(l, cst('2026-10-12T09:30:30'));
    const candle = vi.fn(async () => ({ open: '80000' }));
    const early = await resolveRuns(g, {
      fundHistory: vi.fn(),
      candle,
      now: () => cst('2026-10-12T09:30:30'),
    });
    expect(early[0].run.waiting).toContain('收盘');
    expect(candle).not.toHaveBeenCalled();
    const late = await resolveRuns(g, {
      fundHistory: vi.fn(),
      candle,
      now: () => cst('2026-10-12T09:32:00'),
    });
    expect(candle).toHaveBeenCalledWith('BTC-USDT', Date.UTC(2026, 9, 12, 1, 30));
    expect(late[0].run).toMatchObject({ status: 'confirmed', targetQuantity: '0.00125' });
  });
  it('来源持仓不足时该期保持待处理并说明原因，其他期不受影响', () => {
    const l = ledger();
    l.plans = [
      plan({
        sourceType: 'holding',
        sourceId: 'usdt',
        targetId: 'btc',
        mode: 'quantity',
        amount: '0.002',
        amountCurrency: 'USDT',
        feeRate: '0',
        frequency: 'daily',
        startDate: '2026-10-12',
      }),
    ];
    const g = generateRuns(l, cst('2026-10-12T23:00:00'));
    const run = settle(g, g.planRuns[0], { price: '80000', note: '' }, { price: '1', note: '' });
    const out = applyRunUpdates(g, [{ id: run.id, run }]);
    expect(out.planRuns[0]).toMatchObject({
      status: 'pending',
      waiting: expect.stringContaining('无法入账'),
    });
  });
});

describe('净值刷新节奏', () => {
  it('18 点前、周末的最新应披露日是上一个工作日', () => {
    expect(expectedNavDate(new Date(cst('2026-10-16T17:59:00')))).toBe('2026-10-15');
    expect(expectedNavDate(new Date(cst('2026-10-16T18:00:00')))).toBe('2026-10-16');
    expect(expectedNavDate(new Date(cst('2026-10-18T20:00:00')))).toBe('2026-10-16');
    expect(expectedNavDate(new Date(cst('2026-10-19T09:00:00')))).toBe('2026-10-16');
  });
  it('净值落后时 30 分钟检查一次，已最新则 6 小时', () => {
    const evening = new Date(cst('2026-10-16T21:00:00'));
    expect(fundRefreshInterval('2026-10-15', evening)).toBe(30 * 60000);
    expect(fundRefreshInterval('2026-10-16', evening)).toBe(6 * 3600000);
    expect(fundRefreshInterval(undefined, evening)).toBe(30 * 60000);
  });
});

describe('节假日不扣款', () => {
  const y2026 = {
    year: 2026,
    published: true,
    closed: ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'],
  };
  const days = (ts: number[]) =>
    ts.map((t) => new Date(t + 8 * 3600000).toISOString().slice(0, 10));
  it('跳过周末、法定节假日和调休周六，不顺延', () => {
    const p = plan({ frequency: 'daily', startDate: '2026-09-28', skipHolidays: true });
    expect(
      days(planOccurrences(p, null, cst('2026-10-12T23:00:00'), 400, makeCalendar([y2026]))),
    ).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-08', '2026-10-09', '2026-10-12']);
  });
  it('每月执行日遇节假日时当月跳过；未勾选则照常生成', () => {
    const p = plan({ monthDay: 1, startDate: '2026-09-01' });
    const until = cst('2026-11-02T00:00:00'),
      cal = makeCalendar([y2026]);
    // 10-01 is a holiday and 11-01 a Sunday: both months are skipped, not moved.
    expect(days(planOccurrences({ ...p, skipHolidays: true }, null, until, 400, cal))).toEqual([
      '2026-09-01',
    ]);
    expect(days(planOccurrences(p, null, until, 400, cal))).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
  });
  it('下一年节假日未公布时暂停在年底，公布后从游标继续', () => {
    let l = ledger();
    l.plans = [plan({ frequency: 'weekdays', startDate: '2026-12-30', skipHolidays: true })];
    l = generateRuns(l, cst('2027-01-06T12:00:00'), makeCalendar([y2026]));
    expect(days(l.planRuns.map((r) => Date.parse(r.scheduledAt)))).toEqual([
      '2026-12-30',
      '2026-12-31',
    ]);
    const y2027 = { year: 2027, published: true, closed: ['2027-01-01'] };
    l = generateRuns(l, cst('2027-01-06T12:00:00'), makeCalendar([y2026, y2027]));
    expect(days(l.planRuns.map((r) => Date.parse(r.scheduledAt)))).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
    ]);
  });
});
