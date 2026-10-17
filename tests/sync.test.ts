import { describe, expect, it } from 'vitest';
import { emptyLedger, validateLedger, type Account, type Holding } from '../src/domain';
import { applySync } from '../src/sync';

const at = '2026-10-16T04:00:00.000Z';
type SyncResult = Parameters<typeof applySync>[1];
const row = (
  location: 'funding' | 'trading' | 'earn',
  currency: string,
  quantity: string,
): SyncResult['rows'][number] => ({
  key: `${location}:${currency}`,
  location,
  currency,
  quantity,
  earnings: null,
  at,
});
const snapshot = (...rows: SyncResult['rows']): SyncResult => ({
  rows,
  generatedAt: at,
  permissions: 'read_only',
  scope: '测试只读快照',
});
const externalAccount = (changes: Partial<Account> = {}): Account => ({
  id: 'okx-funding_USD',
  name: 'OKX 资金美元',
  source: 'external',
  kind: 'manual',
  currency: 'USD',
  opening: '0',
  externalBalance: '25',
  externalKey: 'funding:USD',
  updatedAt: at,
  ...changes,
});
const holding = (changes: Partial<Holding> = {}): Holding => ({
  id: 'okx-trading_BTC',
  name: 'BTC',
  kind: 'crypto',
  source: 'okx',
  symbol: 'BTC',
  currency: 'USDT',
  quantity: '1',
  cost: null,
  location: 'OKX 交易',
  externalKey: 'trading:BTC',
  updatedAt: at,
  price: {
    value: '80000',
    currency: 'USDT',
    source: '测试行情',
    asOf: at,
    fetchedAt: at,
    mode: 'market',
  },
  ...changes,
});

describe('OKX 快照覆盖保护', () => {
  it('新快照缺少旧持仓时拒绝整体覆盖，原账本保持不变', () => {
    const l = emptyLedger();
    l.accounts = [externalAccount()];
    l.holdings = [holding()];
    const original = structuredClone(l);
    expect(() => applySync(l, snapshot(row('funding', 'USD', '50')))).toThrow(
      /持仓 BTC（trading:BTC）.*本次未覆盖任何数据/,
    );
    expect(l).toEqual(original);
  });

  it('无账单引用的旧账户缺失也拒绝覆盖，并列出所有需核对项目', () => {
    const l = emptyLedger();
    l.accounts = [externalAccount()];
    l.holdings = [holding()];
    const original = structuredClone(l);
    expect(() => applySync(l, snapshot())).toThrow(
      /账户 OKX 资金美元（funding:USD）.*持仓 BTC（trading:BTC）/,
    );
    expect(l).toEqual(original);
  });

  it('明确返回零数量时更新为零，保留原资产 ID 和已有行情', () => {
    const l = emptyLedger();
    l.accounts = [externalAccount()];
    l.holdings = [holding()];
    const original = structuredClone(l);
    const next = applySync(l, snapshot(row('funding', 'USD', '0'), row('trading', 'BTC', '0')));
    validateLedger(next);
    expect(next.accounts[0]).toMatchObject({ id: l.accounts[0].id, externalBalance: '0' });
    expect(next.holdings[0]).toMatchObject({
      id: l.holdings[0].id,
      quantity: '0',
      price: l.holdings[0].price,
    });
    expect(l).toEqual(original);
  });

  it('保留其他外部来源，匹配账户时同时校验 OKX ID 和位置标识', () => {
    const l = emptyLedger();
    l.accounts = [
      externalAccount({ id: 'bank-dollar', name: '其他来源美元' }),
      externalAccount({ id: 'okx-custom-source', externalKey: 'bank:USD', name: '其他位置' }),
    ];
    const next = applySync(l, snapshot(row('funding', 'USD', '10')));
    validateLedger(next);
    expect(next.accounts).toHaveLength(3);
    expect(next.accounts[0]).toBe(l.accounts[0]);
    expect(next.accounts[1]).toBe(l.accounts[1]);
    expect(next.accounts[2]).toMatchObject({
      id: 'okx-funding_USD',
      externalBalance: '10',
    });
  });

  it('正常资金、交易和赚币覆盖保持位置独立，多次导入不重复', () => {
    const l = emptyLedger();
    l.accounts = [
      { id: 'cash', name: '现金', source: 'manual', kind: 'cash', currency: 'CNY', opening: '100' },
    ];
    l.holdings = [
      holding({ id: 'manual-btc', source: 'manual', externalKey: undefined, location: '手动账户' }),
    ];
    const first = applySync(
      l,
      snapshot(
        row('funding', 'USD', '25'),
        row('funding', 'USDT', '100'),
        row('trading', 'USDT', '200'),
        row('earn', 'USDT', '300'),
      ),
    );
    const next = applySync(
      first,
      snapshot(
        row('funding', 'USD', '30'),
        row('funding', 'USDT', '110'),
        row('trading', 'USDT', '210'),
        row('earn', 'USDT', '310'),
      ),
    );
    const repeated = applySync(
      next,
      snapshot(
        row('funding', 'USD', '30'),
        row('funding', 'USDT', '110'),
        row('trading', 'USDT', '210'),
        row('earn', 'USDT', '310'),
      ),
    );
    validateLedger(repeated);
    expect(repeated).toEqual(next);
    expect(next.accounts).toHaveLength(2);
    expect(next.holdings).toHaveLength(4);
    expect(next.accounts[0]).toBe(l.accounts[0]);
    expect(next.holdings[0]).toBe(l.holdings[0]);
    expect(next.holdings.slice(1).map((h) => [h.externalKey, h.quantity])).toEqual([
      ['funding:USDT', '110'],
      ['trading:USDT', '210'],
      ['earn:USDT', '310'],
    ]);
    expect(next.accounts[1].externalBalance).toBe('30');
  });
});
