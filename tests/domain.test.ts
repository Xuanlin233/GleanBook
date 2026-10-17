import { describe, expect, it } from 'vitest';
import {
  D,
  emptyLedger,
  validateLedger,
  accountBalance,
  monthly,
  totals,
  money,
  holdingPosition,
  holdingValue,
  captureSnapshot,
  mergeBackup,
  parseBackup,
  csvExport,
  dayIn,
  type Ledger,
  type Transaction,
  type Holding,
  type Investment,
} from '../src/domain';
const at = '2026-10-16T04:00:00.000Z';
function base() {
  const l = emptyLedger();
  l.accounts = [
    { id: 'a', name: '银行卡', kind: 'bank', currency: 'CNY', opening: '1000', source: 'manual' },
    { id: 'b', name: '微信', kind: 'wechat', currency: 'CNY', opening: '100', source: 'manual' },
  ];
  return l;
}
const tx = (changes: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  kind: 'expense',
  amount: '20',
  fee: '0',
  categoryId: 'food',
  accountId: 'a',
  occurredAt: at,
  note: '午餐',
  cnyRate: '1',
  ...changes,
});
const fund = (changes: Partial<Holding> = {}): Holding => ({
  id: 'h',
  name: '测试基金',
  kind: 'fund',
  symbol: '000218',
  quantity: '100',
  cost: '100',
  currency: 'CNY',
  source: 'manual',
  location: '支付宝',
  price: {
    value: '1',
    currency: 'CNY',
    asOf: at,
    fetchedAt: at,
    source: '测试净值',
    mode: 'manual',
  },
  ...changes,
});
const event = (changes: Partial<Investment> = {}): Investment => ({
  id: 'e',
  holdingId: 'h',
  kind: 'buy',
  status: 'confirmed',
  quantity: '100',
  cash: '100',
  fee: '0',
  accountId: 'a',
  occurredAt: at,
  note: '',
  ...changes,
});
describe('日常账本与余额', () => {
  it('期初余额不计收入', () => {
    const l = base();
    expect(monthly(l, '2026-10').income.toFixed()).toBe('0');
    expect(totals(l).assets.toFixed()).toBe('1100');
  });
  it('收入与支出重算余额', () => {
    const l = base();
    l.transactions = [
      tx(),
      tx({ id: 'income', kind: 'income', categoryId: 'salary', amount: '200' }),
    ];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('1180');
    const m = monthly(l, '2026-10');
    expect(m.income.toFixed()).toBe('200');
    expect(m.expense.toFixed()).toBe('20');
    expect(m.balance.toFixed()).toBe('180');
  });
  it('转账本金不增加收入消费或资产', () => {
    const l = base();
    l.transactions = [
      tx({
        kind: 'transfer',
        amount: '100',
        categoryId: undefined,
        toAccountId: 'b',
        received: '100',
      }),
    ];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('900');
    expect(accountBalance(l, l.accounts[1]).toFixed()).toBe('200');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('0');
    expect(monthly(l, '2026-10').income.toFixed()).toBe('0');
    expect(totals(l).net.toFixed()).toBe('1100');
  });
  it('跨币种转账明确转入额和独立手续费', () => {
    const l = base();
    l.accounts[1].currency = 'USD';
    l.accounts[1].opening = '0';
    l.rates = [{ currency: 'USD', value: '7.2', source: '测试', asOf: at }];
    l.transactions = [
      tx({
        kind: 'transfer',
        amount: '720',
        fee: '5',
        categoryId: undefined,
        toAccountId: 'b',
        received: '100',
      }),
    ];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('275');
    expect(accountBalance(l, l.accounts[1]).toFixed()).toBe('100');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('5');
    expect(totals(l).net.toFixed()).toBe('995');
  });
  it('同币种转账拒绝不同转入金额', () => {
    const l = base();
    l.transactions = [tx({ kind: 'transfer', toAccountId: 'b', received: '19' })];
    expect(() => validateLedger(l)).toThrow('同币种');
  });
  it('修改和删除历史记录后自动重算', () => {
    const l = base();
    l.transactions = [tx()];
    l.transactions[0].amount = '30.5';
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('969.5');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('30.5');
    l.transactions = [];
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('1000');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('0');
  });
  it('退款关联原消费并拒绝超额', () => {
    const l = base();
    l.transactions = [tx(), tx({ id: 'r', kind: 'refund', amount: '10', refundOf: 't1' })];
    validateLedger(l);
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('10');
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('990');
    l.transactions[1].amount = '21';
    expect(() => validateLedger(l)).toThrow('累计退款');
  });
  it('删除原支出留下退款将校验失败', () => {
    const l = base();
    l.transactions = [tx({ kind: 'refund', refundOf: 'missing' })];
    expect(() => validateLedger(l)).toThrow('关联');
  });
  it('信用卡还款使用转账，不再计消费', () => {
    const l = base();
    l.accounts[1].kind = 'liability';
    l.accounts[1].opening = '-300';
    l.transactions = [tx({ kind: 'transfer', toAccountId: 'b', received: '100', amount: '100' })];
    validateLedger(l);
    expect(totals(l).assets.toFixed()).toBe('900');
    expect(totals(l).liabilities.toFixed()).toBe('200');
    expect(totals(l).net.toFixed()).toBe('700');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('0');
  });
  it('同步余额不会再次扣减本地账单', () => {
    const l = base();
    l.accounts[0] = {
      ...l.accounts[0],
      source: 'external',
      externalBalance: '500',
      externalKey: 'funding:CNY',
      updatedAt: at,
    };
    l.transactions = [tx()];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('500');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('20');
    l.transactions = [tx({ kind: 'transfer', toAccountId: 'b', received: '20' })];
    expect(() => validateLedger(l)).toThrow('外部快照');
  });
  it('统计时区改变午夜账单所属月份', () => {
    const l = base();
    l.transactions = [tx({ occurredAt: '2026-09-30T17:00:00.000Z' })];
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('20');
    l.settings.timezone = 'America/New_York';
    expect(monthly(l, '2026-09').expense.toFixed()).toBe('20');
    expect(dayIn(at, 'Asia/Shanghai')).toBe('2026-10-16');
  });
});
describe('投资与估值', () => {
  it('申购从现金转为持仓，资产不重复统计', () => {
    const l = base();
    l.holdings = [fund({ quantity: '0', cost: '0' })];
    l.investments = [event()];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('900');
    expect(holdingValue(l, l.holdings[0])!.toFixed()).toBe('100');
    expect(totals(l).assets.toFixed()).toBe('1100');
    expect(monthly(l, '2026-10').expense.toFixed()).toBe('0');
  });
  it('待确认申购扣现金，等额本金记作待确认资产', () => {
    const l = base();
    l.holdings = [fund({ quantity: '0', cost: '0' })];
    l.investments = [event({ status: 'pending' })];
    validateLedger(l);
    expect(holdingPosition(l, l.holdings[0]).quantity.toFixed()).toBe('0');
    expect(holdingValue(l, l.holdings[0])!.toFixed()).toBe('100');
    expect(totals(l).net.toFixed()).toBe('1100');
    l.investments[0].status = 'confirmed';
    expect(holdingPosition(l, l.holdings[0]).quantity.toFixed()).toBe('100');
    expect(totals(l).net.toFixed()).toBe('1100');
  });
  it('待赎回不提前增现金或减少持仓', () => {
    const l = base();
    l.holdings = [fund()];
    l.investments = [event({ kind: 'sell', status: 'pending', quantity: '50', cash: '55' })];
    validateLedger(l);
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('1000');
    expect(holdingPosition(l, l.holdings[0]).quantity.toFixed()).toBe('100');
    l.investments[0].status = 'confirmed';
    expect(accountBalance(l, l.accounts[0]).toFixed()).toBe('1055');
    expect(holdingPosition(l, l.holdings[0]).quantity.toFixed()).toBe('50');
  });
  it('移动加权平均成本、手续费及已实现收益', () => {
    const l = base();
    l.holdings = [fund()];
    l.investments = [
      event({ quantity: '100', cash: '120', fee: '2' }),
      event({
        id: 'sell',
        kind: 'sell',
        quantity: '50',
        cash: '65',
        fee: '1',
        occurredAt: '2026-10-17T04:00:00.000Z',
      }),
    ];
    validateLedger(l);
    const p = holdingPosition(l, l.holdings[0]);
    expect(p.cost!.toFixed()).toBe('166.5');
    expect(p.realized!.toFixed()).toBe('8.5');
    expect(p.quantity.toFixed()).toBe('150');
  });
  it('分红与利息不当作新增本金或生活收入', () => {
    const l = base();
    l.holdings = [fund()];
    l.investments = [
      event({ kind: 'dividend', quantity: '0', cash: '3' }),
      event({ id: 'interest', kind: 'interest', quantity: '1', cash: '0', accountId: undefined }),
    ];
    validateLedger(l);
    const p = holdingPosition(l, l.holdings[0]);
    expect(p.realized!.toFixed()).toBe('3');
    expect(p.interest.toFixed()).toBe('1');
    expect(p.cost!.toFixed()).toBe('100');
    expect(monthly(l, '2026-10').income.toFixed()).toBe('0');
  });
  it('份额调整保留总成本，超量赎回拒绝', () => {
    const l = base();
    l.holdings = [fund()];
    l.investments = [event({ kind: 'adjust', quantity: '100', cash: '0', accountId: undefined })];
    validateLedger(l);
    expect(holdingPosition(l, l.holdings[0]).cost!.toFixed()).toBe('100');
    l.investments.push(event({ id: 'sell', kind: 'sell', quantity: '250', cash: '250' }));
    expect(() => validateLedger(l)).toThrow('份额不足');
  });
  it('未知成本显示不可计算', () => {
    const l = base();
    l.holdings = [fund({ cost: null })];
    const p = holdingPosition(l, l.holdings[0]);
    expect(p.cost).toBeNull();
    expect(p.realized).toBeNull();
  });
  it('精确份额乘以净值，人民币换算不假设稳定币平价', () => {
    const l = emptyLedger();
    l.holdings = [
      fund({
        kind: 'crypto',
        currency: 'USDT',
        quantity: '0.123456789012345678',
        price: {
          value: '82154.9',
          currency: 'USDT',
          asOf: at,
          fetchedAt: at,
          source: '测试',
          mode: 'market',
        },
      }),
    ];
    l.rates = [{ currency: 'USDT', value: '7.13', source: '实际换算口径', asOf: at }];
    validateLedger(l);
    expect(totals(l).assets.eq(D('0.123456789012345678').mul('82154.9').mul('7.13'))).toBe(true);
  });
  it('缺少价格或汇率不伪装成完整零元资产', () => {
    const l = base();
    l.holdings = [fund({ price: null })];
    const t = totals(l);
    expect(t.complete).toBe(false);
    expect(t.missing).toHaveLength(1);
    expect(holdingValue(l, l.holdings[0])).toBeNull();
    l.holdings[0].currency = 'USDT';
    expect(totals(l).complete).toBe(false);
  });
  it('小数相加与显示采用统一四舍五入，显示大数不丢精度', () => {
    expect(D('.1').plus('.2').toFixed()).toBe('0.3');
    expect(money('1.005')).toBe('¥ 1.01');
    expect(money('123456789012345678901234.56')).toBe('¥ 123,456,789,012,345,678,901,234.56');
    expect(money('12', true)).toBe('••••••');
  });
});
describe('备份、历史快照与校验', () => {
  it('备份恢复包含全部原始记录', () => {
    const l = base();
    l.transactions = [tx()];
    l.holdings = [fund()];
    l.investments = [event()];
    l.budgets = [{ month: '2026-10', categoryId: null, amount: '500' }];
    const text = JSON.stringify({
      format: 'shizhang-backup',
      version: 1,
      exportedAt: at,
      ledger: l,
    });
    expect(parseBackup(text)).toEqual(l);
  });
  it('重复导入按 ID 去重', () => {
    const l = base();
    l.transactions = [tx()];
    const m = mergeBackup(l, structuredClone(l));
    expect(m.added).toBe(0);
    expect(m.conflicts).toHaveLength(0);
    expect(m.ledger.transactions).toHaveLength(1);
  });
  it('合并冲突不会改动当前账本', () => {
    const l = base();
    l.transactions = [tx()];
    const copy = structuredClone(l);
    copy.transactions[0].amount = '25';
    const result = mergeBackup(l, copy);
    expect(result.conflicts).toHaveLength(1);
    expect(l.transactions[0].amount).toBe('20');
  });
  it('校验破损引用、重复 ID、非法字段和不支持的数据版本', () => {
    const l = base();
    l.transactions = [tx({ accountId: 'missing' })];
    expect(() => validateLedger(l)).toThrow();
    expect(() => validateLedger({ ...base(), apiSecret: 'never-allowed' })).toThrow();
    expect(() => validateLedger({ ...base(), schemaVersion: 2 })).toThrow();
    expect(() => parseBackup('{}')).toThrow();
  });
  it('导入保留名称 ID 不会破坏分类统计', () => {
    const l = base();
    l.categories.push({ id: '__proto__', name: '异常分类', kind: 'expense', icon: 'dots' });
    l.transactions = [tx({ categoryId: '__proto__' })];
    expect(() => validateLedger(l)).toThrow();
  });
  it('同统计日覆盖快照，无中间虚构日期', () => {
    const l = captureSnapshot(base(), at);
    const next = captureSnapshot(l, '2026-10-16T08:00:00.000Z');
    expect(next.snapshots).toHaveLength(1);
    const later = captureSnapshot(next, '2026-10-19T04:00:00.000Z');
    expect(later.snapshots.map((s) => s.day)).toEqual(['2026-10-16', '2026-10-19']);
  });
  it('未知价格保留为不完整快照', () => {
    const l = base();
    l.holdings = [fund({ price: null })];
    expect(captureSnapshot(l, at).snapshots[0].complete).toBe(false);
  });
  it('精确计算超过输入小数位的快照可以校验和恢复', () => {
    const l = base();
    l.holdings = [
      fund({
        quantity: '0.123456789012345678',
        currency: 'USDT',
        price: {
          value: '82154.9',
          currency: 'USDT',
          source: '测试',
          mode: 'market',
          asOf: at,
          fetchedAt: at,
        },
      }),
    ];
    l.rates = [{ currency: 'USDT', value: '7.13', source: '测试', asOf: at }];
    const snap = captureSnapshot(l, at);
    expect(() => validateLedger(snap)).not.toThrow();
    expect(D(snap.snapshots[0].net).eq(totals(l).net)).toBe(true);
  });
  it('CSV 防止备注触发表格公式，保留换行和引号', () => {
    const l = base();
    l.transactions = [tx({ note: '=HYPERLINK("x")\n文字' })];
    const out = csvExport(l);
    expect(out).toContain("'=HYPERLINK");
    expect(out).toContain('""x""');
  });
});

describe('今日净资产曲线', () => {
  it('每次净资产变化记一点，同一分钟内只留最后一次，未变化不重复，超过 48 小时丢弃', async () => {
    const { captureSnapshot, emptyLedger } = await import('../src/domain');
    let l = emptyLedger();
    l.accounts = [
      { id: 'a', name: '现金', kind: 'cash', currency: 'CNY', opening: '100', source: 'manual' },
    ];
    l.intraday = [{ at: '2026-10-14T00:00:00.000Z', net: '1', complete: true }];
    l = captureSnapshot(l, '2026-10-17T01:00:00.000Z');
    expect(l.intraday).toEqual([{ at: '2026-10-17T01:00:00.000Z', net: '100', complete: true }]);
    l = captureSnapshot(l, '2026-10-17T01:05:00.000Z');
    expect(l.intraday).toHaveLength(1);
    l.accounts[0].opening = '150';
    l = captureSnapshot(l, '2026-10-17T01:05:20.000Z');
    l.accounts[0].opening = '160';
    l = captureSnapshot(l, '2026-10-17T01:05:40.000Z');
    expect(l.intraday.map((p) => p.net)).toEqual(['100', '160']);
    l.accounts[0].opening = '90';
    l = captureSnapshot(l, '2026-10-17T02:00:00.000Z');
    expect(l.intraday.map((p) => p.net)).toEqual(['100', '160', '90']);
    expect(l.snapshots).toHaveLength(1);
  });
});
