import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { normalizeBalances, signRequest, syncOKX, lastOKXRead } from '../server/okx';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('OKX 只读归一化', () => {
  const at = '2026-10-16T04:00:00.000Z';
  it('资金与交易余额各取一次，赚币总额不叠加分项', () => {
    const rows = normalizeBalances(
      [{ ccy: 'USDT', bal: '100' }],
      [{ details: [{ ccy: 'USDT', cashBal: '200', liab: '0' }] }],
      [{ ccy: 'USDT', amt: '300', loanAmt: '200', pendingAmt: '100', earnings: '.5' }],
      at,
    );
    expect(rows.reduce((v, r) => v + Number(r.quantity), 0)).toBe(600);
    expect(rows.map((x) => x.key)).toEqual(['funding:USDT', 'trading:USDT', 'earn:USDT']);
  });
  it('未返回收益不得强制为零', () => {
    const rows = normalizeBalances([], [], [{ ccy: 'USDC', amt: '200' }], at);
    expect(rows[0].earnings).toBeNull();
  });
  it('赎回中金额无法归属时停止更新', () => {
    expect(() =>
      normalizeBalances([], [], [{ ccy: 'USDT', amt: '100', redemptAmt: '10' }], at),
    ).toThrow('赎回中');
  });
  it('负余额、借贷和重复返回拒绝导入', () => {
    expect(() => normalizeBalances([{ ccy: 'USDT', bal: '-1' }], [], [], at)).toThrow();
    expect(() =>
      normalizeBalances([], [{ details: [{ ccy: 'USDT', cashBal: '20', liab: '5' }] }], [], at),
    ).toThrow('借贷');
    expect(() =>
      normalizeBalances(
        [
          { ccy: 'USDT', bal: '1' },
          { ccy: 'USDT', bal: '2' },
        ],
        [],
        [],
        at,
      ),
    ).toThrow('重复');
  });
  it('签名只使用 GET 与精确请求路径', () => {
    const expected = createHmac('sha256', 'dummy-test-secret')
      .update(at + 'GET/api/v5/account/balance')
      .digest('base64');
    expect(signRequest(at, '/api/v5/account/balance', 'dummy-test-secret')).toBe(expected);
  });
});
describe('私人读取权限与原子应用边界', () => {
  function configure() {
    vi.stubEnv('OKX_API_KEY', 'test-key-not-real');
    vi.stubEnv('OKX_API_SECRET', 'test-secret-not-real');
    vi.stubEnv('OKX_API_PASSPHRASE', 'test-passphrase-not-real');
    vi.stubEnv('OKX_API_ORIGIN', 'https://openapi.okx.com');
  }
  it('API Key 带交易或提币权限时拒绝后续余额读取', async () => {
    configure();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: '0', data: [{ perm: 'read_only,trade', acctLv: '1' }] }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncOKX()).rejects.toThrow('并非仅 Read');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('非现货模式有未平仓仓位时拒绝，并说明模式和仓位类型', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const p = new URL(url).pathname;
        const data = p.endsWith('/config')
          ? [{ perm: 'read_only', acctLv: '3' }]
          : p.endsWith('/positions')
            ? [
                { instType: 'SWAP', pos: '2' },
                { instType: 'MARGIN', pos: '0' },
              ]
            : [];
        return new Response(JSON.stringify({ code: '0', data }));
      }),
    );
    const error = String(await syncOKX().catch((e: Error) => e));
    expect(error).toContain('跨币种保证金模式');
    expect(error).toContain('1 个未平仓仓位（永续合约）');
  });
  it('合约模式无仓位、无借币时正常读取现金余额', async () => {
    configure();
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const p = new URL(url).pathname;
        paths.push(p);
        const data = p.endsWith('/config')
          ? [{ perm: 'read_only', acctLv: '2' }]
          : p === '/api/v5/account/balance'
            ? [{ details: [{ ccy: 'USDT', cashBal: '50', liab: '' }] }]
            : [];
        return new Response(JSON.stringify({ code: '0', data }));
      }),
    );
    const result = await syncOKX();
    expect(paths[1]).toBe('/api/v5/account/positions');
    expect(result.rows).toEqual([expect.objectContaining({ key: 'trading:USDT', quantity: '50' })]);
    expect(result.scope).toContain('合约模式');
  });
  it('三项读取成功才返回快照，所有调用均为 GET', async () => {
    configure();
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(init.method ?? 'GET').toBe('GET');
        const p = new URL(url).pathname;
        paths.push(p);
        const data = p.endsWith('/config')
          ? [{ perm: 'read_only', acctLv: '1' }]
          : p.endsWith('/balances')
            ? [{ ccy: 'USDT', bal: '100' }]
            : p === '/api/v5/account/balance'
              ? [{ details: [{ ccy: 'BTC', cashBal: '0.01', liab: '0' }] }]
              : [{ ccy: 'USDT', amt: '200', loanAmt: '100', pendingAmt: '100', earnings: '0.5' }];
        return new Response(JSON.stringify({ code: '0', data }));
      }),
    );
    const result = await syncOKX();
    expect(result.rows).toHaveLength(3);
    expect(paths).toEqual([
      '/api/v5/account/config',
      '/api/v5/asset/balances',
      '/api/v5/account/balance',
      '/api/v5/finance/savings/balance',
    ]);
    expect(result.rows[2].quantity).toBe('200');
    expect(result.rows[2].earnings).toBe('0.5');
    expect(lastOKXRead()).toBe(result.generatedAt);
  });
  it('上游拒绝某一项时整个同步失败，且不回传上游敏感消息', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              new URL(url).pathname.endsWith('/config')
                ? { code: '0', data: [{ perm: 'read_only', acctLv: '1' }] }
                : { code: '50013', msg: 'upstream private message must not be exposed', data: [] },
            ),
          ),
      ),
    );
    const error = String(await syncOKX().catch((e: Error) => e));
    expect(error).toContain('[50013]');
    expect(error).not.toContain('upstream private message');
  });
});
