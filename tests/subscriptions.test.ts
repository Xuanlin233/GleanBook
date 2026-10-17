import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  emptyLedger,
  monthly,
  validateLedger,
  type Ledger,
  type Subscription,
} from '../src/domain';
import {
  SUBSCRIPTION_CATEGORY,
  billingTimes,
  chargeSubscriptions,
  monthlyEquivalent,
  monthlyTotal,
  nextBilling,
} from '../src/subscriptions';

const cst = (s: string) => Date.parse(s + '+08:00');
const day = (ts: number) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
function ledger(): Ledger {
  const l = emptyLedger();
  l.categories.push(SUBSCRIPTION_CATEGORY);
  l.accounts = [
    {
      id: 'card',
      name: '招行卡',
      kind: 'bank',
      currency: 'CNY',
      opening: '1000',
      source: 'manual',
    },
    { id: 'usd', name: '美元卡', kind: 'bank', currency: 'USD', opening: '100', source: 'manual' },
  ];
  return l;
}
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1',
  name: 'iCloud+',
  amount: '21',
  accountId: 'card',
  categoryId: 'subscription',
  cycle: 'monthly',
  day: 15,
  startDate: '2026-08-01',
  active: true,
  timezone: 'Asia/Shanghai',
  note: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('订阅扣款日', () => {
  it('每月 31 日在小月取月末；每年按月日；每周按星期', () => {
    const until = cst('2026-12-31T23:00:00');
    expect(billingTimes(sub({ day: 31, startDate: '2026-09-01' }), null, until).map(day)).toEqual([
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
    expect(
      billingTimes(
        sub({ cycle: 'yearly', month: 2, day: 29, startDate: '2026-01-01' }),
        null,
        cst('2028-12-31T00:00:00'),
      ).map(day),
    ).toEqual(['2026-02-28', '2027-02-28', '2028-02-29']);
    expect(
      billingTimes(
        sub({ cycle: 'weekly', weekday: 1, day: undefined, startDate: '2026-10-01' }),
        null,
        cst('2026-10-20T00:00:00'),
      ).map(day),
    ).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
  });
  it('扣款日当天 0 点起即到期；下次扣款从当前时间与游标中较晚者算起', () => {
    const s = sub();
    expect(billingTimes(s, null, cst('2026-10-15T00:00:00')).map(day).at(-1)).toBe('2026-10-15');
    expect(billingTimes(s, null, cst('2026-10-14T23:59:00')).map(day).at(-1)).toBe('2026-09-15');
    expect(
      day(
        nextBilling(
          { ...s, cursor: new Date(cst('2026-10-15T00:00:00')).toISOString() },
          cst('2026-10-16T00:00:00'),
        )!,
      ),
    ).toBe('2026-11-15');
    expect(nextBilling({ ...s, active: false })).toBeNull();
  });
});

describe('自动扣款', () => {
  it('补记到期各期为支出，扣减设定账户并计入当月消费；重复执行不重复扣', () => {
    let l = ledger();
    l.subscriptions = [sub()];
    const r = chargeSubscriptions(l, cst('2026-10-16T09:00:00'));
    l = validateLedger(r.ledger);
    expect(r.charged).toBe(3);
    expect(l.transactions.map((t) => t.occurredAt)).toEqual([
      '2026-08-14T16:00:00.000Z',
      '2026-09-14T16:00:00.000Z',
      '2026-10-14T16:00:00.000Z',
    ]);
    expect(l.transactions[0]).toMatchObject({
      kind: 'expense',
      amount: '21',
      categoryId: 'subscription',
      subscriptionId: 's1',
      cnyRate: '1',
    });
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('937');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('21');
    expect(chargeSubscriptions(l, cst('2026-10-16T09:00:00')).ledger).toBe(l);
  });
  it('删除某一笔扣款后不会被补回；暂停的订阅不扣款', () => {
    let l = ledger();
    l.subscriptions = [sub()];
    l = chargeSubscriptions(l, cst('2026-10-16T09:00:00')).ledger;
    l = { ...l, transactions: l.transactions.slice(1) };
    expect(chargeSubscriptions(l, cst('2026-10-20T09:00:00')).charged).toBe(0);
    const paused = { ...ledger(), subscriptions: [sub({ active: false })] };
    expect(chargeSubscriptions(paused, cst('2026-10-16T09:00:00')).charged).toBe(0);
  });
  it('外币账户缺汇率时暂缓且不推进游标，补齐汇率后按当时汇率扣款', () => {
    let l = ledger();
    l.subscriptions = [sub({ accountId: 'usd', amount: '20', startDate: '2026-10-01' })];
    const waiting = chargeSubscriptions(l, cst('2026-10-16T09:00:00'));
    expect(waiting.charged).toBe(0);
    expect(waiting.blocked[0]).toContain('USD/CNY');
    expect(waiting.ledger).toBe(l);
    l.rates = [
      { currency: 'USD', value: '6.722', source: '测试', asOf: '2026-10-16T01:15:00.000Z' },
    ];
    l = validateLedger(chargeSubscriptions(l, cst('2026-10-16T09:00:00')).ledger);
    expect(l.transactions[0]).toMatchObject({ amount: '20', cnyRate: '6.722' });
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('134.44');
  });
  it('每月等效费用：年付除以 12，周付按 52 周折算；外币按汇率折人民币', () => {
    expect(monthlyEquivalent(sub({ cycle: 'yearly', month: 1, amount: '120' })).toFixed()).toBe(
      '10',
    );
    expect(monthlyEquivalent(sub({ cycle: 'weekly', weekday: 1, amount: '3' })).toFixed()).toBe(
      '13',
    );
    const l = ledger();
    l.subscriptions = [sub(), sub({ id: 's2', accountId: 'usd', amount: '20' })];
    expect(monthlyTotal(l)).toMatchObject({ missing: ['USD'] });
    expect(monthlyTotal(l).total.toFixed()).toBe('21');
  });
});
