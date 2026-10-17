import { describe, expect, it } from 'vitest';
import { accountBalance, emptyLedger, monthly, validateLedger, type Ledger } from '../src/domain';
import { transferQuote } from '../src/transfer';

function ledger(): Ledger {
  const l = emptyLedger();
  l.accounts = [
    {
      id: 'card',
      name: '招行卡',
      kind: 'bank',
      currency: 'CNY',
      opening: '5000',
      source: 'manual',
    },
    {
      id: 'appstore',
      name: 'App Store 美区余额',
      kind: 'manual',
      currency: 'USD',
      opening: '0',
      source: 'manual',
    },
  ];
  l.rates = [
    { currency: 'USD', value: '6.722', source: '中间价', asOf: '2026-10-16T01:15:00.000Z' },
  ];
  return l;
}

describe('跨币种转账（人民币买美区礼品卡）', () => {
  it('显示实际汇率、相对参考汇率的溢价，并可把溢价拆成手续费', () => {
    const q = transferQuote(ledger(), 'CNY', 'USD', '1000', '130')!;
    expect(q.actual).toBe('7.6923');
    expect(q.reference).toBe('1 USD = 6.722 CNY');
    expect(q.premiumText).toBe('溢价 14.43%');
    expect(q.extra).toEqual({ amount: '126.14', principal: '873.86' });
  });
  it('与参考汇率一致或缺少汇率时不建议拆分', () => {
    expect(transferQuote(ledger(), 'CNY', 'USD', '672.2', '100')!.extra).toBeNull();
    const noRate = { ...ledger(), rates: [] };
    expect(transferQuote(noRate, 'CNY', 'USD', '1000', '130')).toMatchObject({
      actual: '7.6923',
      reference: null,
      extra: null,
    });
    expect(transferQuote(ledger(), 'CNY', 'USD', '', '130')).toBeNull();
  });
  it('转出扣人民币、转入加美元；溢价记为手续费后计入当月支出，账户总扣款不变', () => {
    const l = ledger();
    const base = {
      kind: 'transfer' as const,
      accountId: 'card',
      toAccountId: 'appstore',
      received: '130',
      occurredAt: '2026-10-17T02:00:00.000Z',
      note: '美区礼品卡',
      cnyRate: '1',
    };
    const plain = validateLedger({
      ...l,
      transactions: [{ ...base, id: 't', amount: '1000', fee: '0' }],
    });
    expect(accountBalance(plain, plain.accounts[0]).toFixed()).toBe('4000');
    expect(accountBalance(plain, plain.accounts[1]).toFixed()).toBe('130');
    expect(monthly(plain, '2026-10').expense.toFixed()).toBe('0');
    const split = validateLedger({
      ...l,
      transactions: [{ ...base, id: 't', amount: '873.86', fee: '126.14' }],
    });
    expect(accountBalance(split, split.accounts[0]).toFixed()).toBe('4000');
    expect(monthly(split, '2026-10').expense.toFixed()).toBe('126.14');
  });
});
