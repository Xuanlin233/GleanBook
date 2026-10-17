import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyLedger, type Ledger, type Transaction } from '../src/domain';
import {
  applyOps,
  diffLedgers,
  mergeIntoMaster,
  pendingOps,
  rebaseOnMaster,
  type SyncOp,
} from '../src/sync-core';
import { createLedgerStore } from '../server/ledger-store';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'shizhang-master-'));
  dirs.push(d);
  return d;
};
const T = (m: number) => new Date(Date.UTC(2026, 9, 17, 0, m)).toISOString();
const expense = (id: string, amount: string, at = T(0)): Transaction => ({
  id,
  kind: 'expense',
  amount,
  accountId: 'card',
  fee: '0',
  categoryId: 'food',
  occurredAt: at,
  note: '',
  cnyRate: '1',
});
function pcLedger(): Ledger {
  const l = emptyLedger();
  l.accounts = [
    {
      id: 'card',
      name: '招行卡',
      kind: 'bank',
      currency: 'CNY',
      opening: '1000',
      source: 'manual',
    },
  ];
  l.transactions = [expense('t1', '20')];
  return l;
}
// A device: local ledger plus its last view of the master.
type Device = { local: Ledger; base: Ledger | null; revision: number | null };
async function syncDevice(store: ReturnType<typeof createLedgerStore>, d: Device, now: string) {
  const ops = pendingOps(d.base, d.local, {}, now);
  const res = await store.sync(d.revision, ops);
  if (res.unchanged) return { ...d, revision: res.revision };
  const { ledger } = rebaseOnMaster(res.ledger, d.local, d.local, {}, now);
  return { local: ledger, base: res.ledger, revision: res.revision };
}

describe('记录级差异', () => {
  it('差异应用后与目标一致；主题、本机分时曲线不参与同步', () => {
    const a = pcLedger(),
      b = structuredClone(a);
    b.transactions.push(expense('t2', '5'));
    b.transactions[0].note = '改了备注';
    b.accounts = [];
    b.transactions = b.transactions.map((t) => ({ ...t, accountId: 'card' }));
    b.accounts = a.accounts;
    b.rates = [{ currency: 'USD', value: '7', source: 's', asOf: T(0) }];
    b.settings = { ...b.settings, theme: 'dark', hideAmounts: true };
    b.intraday = [{ at: T(1), net: '1', complete: true }];
    const ops = diffLedgers(a, b, () => T(2));
    expect(ops.map((o) => o.key).sort()).toEqual([
      'rates:USD',
      'settings:',
      'transactions:t1',
      'transactions:t2',
    ]);
    const { ledger } = applyOps(a, ops);
    expect(ledger.transactions).toEqual(b.transactions);
    expect(ledger.settings.hideAmounts).toBe(true);
    expect(ledger.settings.theme).toBe('system');
    expect(ledger.intraday).toEqual([]);
  });
});

describe('电脑主库合并规则', () => {
  const put = (key: string, value: unknown, at: string): SyncOp => ({
    kind: 'put',
    key,
    value,
    at,
  });
  it('同一记录以后修改的为准，删除优先于修改，非法修改被拒绝而其余照常写入', () => {
    const master = pcLedger();
    let r = mergeIntoMaster(master, {}, [put('transactions:t1', expense('t1', '30'), T(5))]);
    expect(r.ledger.transactions[0].amount).toBe('30');
    r = mergeIntoMaster(r.ledger, r.meta, [put('transactions:t1', expense('t1', '99'), T(3))]);
    expect(r.ledger.transactions[0].amount).toBe('30');
    r = mergeIntoMaster(r.ledger, r.meta, [{ kind: 'delete', key: 'transactions:t1', at: T(4) }]);
    expect(r.ledger.transactions).toHaveLength(0);
    r = mergeIntoMaster(r.ledger, r.meta, [put('transactions:t1', expense('t1', '50'), T(9))]);
    expect(r.ledger.transactions).toHaveLength(0);
    r = mergeIntoMaster(r.ledger, r.meta, [
      put('transactions:bad', { ...expense('bad', '1'), accountId: 'missing' }, T(10)),
      put('transactions:ok', expense('ok', '2'), T(10)),
    ]);
    expect(r.ledger.transactions.map((t) => t.id)).toEqual(['ok']);
    expect(r.rejected).toEqual([{ key: 'transactions:bad', reason: '记录引用的账户不存在' }]);
  });
  it('同步途中新记的账会在主库结果上重放，不会丢', () => {
    const master = pcLedger(),
      sent = pcLedger(),
      current = structuredClone(sent);
    current.transactions.push(expense('typed-during-sync', '8'));
    const { ledger, touched } = rebaseOnMaster(master, sent, current, {}, T(1));
    expect(ledger.transactions.map((t) => t.id)).toEqual(['t1', 'typed-during-sync']);
    expect(Object.keys(touched)).toContain('transactions:typed-during-sync');
  });
});

describe('电脑主库文件', () => {
  it('首次同步把电脑账本上传；手机首次同步拿到同一本；双方离线各记一笔后合并成一本', async () => {
    const dir = tmp(),
      store = createLedgerStore(dir);
    let pc: Device = { local: pcLedger(), base: null, revision: null };
    let phone: Device = { local: emptyLedger(), base: null, revision: null };
    pc = await syncDevice(store, pc, T(1));
    phone = await syncDevice(store, phone, T(2));
    expect(phone.local.transactions.map((t) => t.id)).toEqual(['t1']);
    phone.local = {
      ...phone.local,
      transactions: [...phone.local.transactions, expense('phone', '12')],
    };
    pc.local = { ...pc.local, transactions: [...pc.local.transactions, expense('pc', '7')] };
    phone = await syncDevice(store, phone, T(3));
    pc = await syncDevice(store, pc, T(4));
    phone = await syncDevice(store, phone, T(5));
    const ids = (l: Ledger) => l.transactions.map((t) => t.id).sort();
    expect(ids(pc.local)).toEqual(['pc', 'phone', 't1']);
    expect(ids(phone.local)).toEqual(['pc', 'phone', 't1']);
    // Persisted and reloadable by a fresh process.
    const again = await createLedgerStore(dir).sync(null, []);
    expect(again.unchanged ? [] : ids(again.ledger)).toEqual(['pc', 'phone', 't1']);
    expect(readdirSync(dir).sort()).toEqual(['backups', 'ledger.json', 'ledger.prev.json']);
    expect(readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
  });
  it('版本未变时只回复“无变化”，不传整本账', async () => {
    const store = createLedgerStore(tmp());
    const first = await store.sync(null, pendingOps(null, pcLedger(), {}, T(1)));
    expect(first.unchanged).toBe(false);
    expect(await store.sync(first.revision, [])).toMatchObject({ unchanged: true });
  });
});
