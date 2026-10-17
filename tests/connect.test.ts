import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeProxy, parseWindowsProxy } from '../server/proxy';
import { allowedOrigins } from '../server/origin';
import { describeOKXCode, minuteCandle, publicTicker, syncOKX } from '../server/okx';
import { fetchFund, fetchFundHistory } from '../server/funds';
import { fetchHolidayYear } from '../server/calendar';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('出站代理解析', () => {
  it('解析 Windows 系统代理的单值与分协议格式，未启用时忽略', () => {
    const reg = (enable: string, server: string) =>
      `    ProxyEnable    REG_DWORD    ${enable}\r\n    ProxyServer    REG_SZ    ${server}\r\n`;
    expect(parseWindowsProxy(reg('0x1', '127.0.0.1:7897'))).toBe('http://127.0.0.1:7897/');
    expect(parseWindowsProxy(reg('0x1', 'http=127.0.0.1:7890;https=127.0.0.1:7891'))).toBe(
      'http://127.0.0.1:7891/',
    );
    expect(parseWindowsProxy(reg('0x0', '127.0.0.1:7897'))).toBeNull();
    expect(parseWindowsProxy(reg('0x1', 'socks=127.0.0.1:1080'))).toBeNull();
  });
  it('只接受带端口的 http(s) 代理', () => {
    expect(normalizeProxy('127.0.0.1:7890')).toBe('http://127.0.0.1:7890/');
    expect(normalizeProxy('socks5://127.0.0.1:1080')).toBeNull();
    expect(normalizeProxy('http://127.0.0.1')).toBeNull();
  });
});

describe('本机 Origin 别名', () => {
  it('localhost 与 127.0.0.1 同端口互认，不放行其他端口或公网域名', () => {
    const set = allowedOrigins('http://localhost:8787');
    expect(set.has('http://127.0.0.1:8787')).toBe(true);
    expect(set.has('http://[::1]:8787')).toBe(true);
    expect(set.has('http://127.0.0.1:5173')).toBe(false);
    const remote = allowedOrigins('https://money.example.com, http://localhost:5173');
    expect(remote.has('https://money.example.com')).toBe(true);
    expect(remote.has('http://127.0.0.1:5173')).toBe(true);
    expect(remote.has('http://money.example.com')).toBe(false);
  });
});

describe('OKX 错误码', () => {
  function configure() {
    vi.stubEnv('OKX_API_KEY', 'test-key-not-real');
    vi.stubEnv('OKX_API_SECRET', 'test-secret-not-real');
    vi.stubEnv('OKX_API_PASSPHRASE', 'test-passphrase-not-real');
    vi.stubEnv('OKX_API_ORIGIN', 'https://openapi.okx.com');
  }
  it('HTTP 401 携带的错误码给出具体原因，而不是误报网络或地区问题', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ code: '50110', msg: 'Your IP 1.2.3.4 is not included', data: [] }, 401),
      ),
    );
    const error = await syncOKX().catch((e: Error) => e);
    expect(String(error)).toContain('白名单');
    expect(String(error)).toContain('[50110]');
    expect(String(error)).not.toContain('1.2.3.4');
  });
  it('时间戳过期时向 OKX 校准时钟并只重试一次', async () => {
    configure();
    const stamps: string[] = [];
    let rejected = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const p = new URL(url).pathname;
        if (p === '/api/v5/public/time')
          return json({ code: '0', data: [{ ts: String(Date.now() + 120000) }] });
        stamps.push((init.headers as Record<string, string>)['OK-ACCESS-TIMESTAMP']);
        if (!rejected) {
          rejected = true;
          return json({ code: '50102', msg: 'Timestamp request expired', data: [] }, 401);
        }
        return json({ code: '0', data: [{ perm: 'read_only,trade', acctLv: '1' }] });
      }),
    );
    await expect(syncOKX()).rejects.toThrow('并非仅 Read');
    expect(stamps).toHaveLength(2);
    expect(Date.parse(stamps[1]) - Date.parse(stamps[0])).toBeGreaterThan(100000);
  });
  it('未知错误码只显示数字，公共行情不存在时保留原提示', async () => {
    expect(describeOKXCode('59999', true)).toContain('[59999]');
    expect(describeOKXCode('<script>', true)).not.toContain('script');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ code: '51001', msg: 'Instrument ID does not exist', data: [] }, 400),
      ),
    );
    await expect(publicTicker('NOPE-USDT')).rejects.toThrow('暂无可用的官方现货行情');
  });
});

describe('基金免费净值多来源', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  const em = (rows: { FSRQ: string; DWJZ: string }[], sy: string | null = null) => ({
    ErrCode: 0,
    TotalCount: rows.length,
    Data: { SYType: sy, LSJZList: rows },
  });
  it('任意基金走东方财富，带 Referer，跳过空净值行，并取名称', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes('fundsuggest'))
          return json({
            Datas: [{ CODE: '161725', NAME: '招商中证白酒指数(LOF)A', CATEGORY: 700 }],
          });
        expect(url).toContain('api.fund.eastmoney.com/f10/lsjz');
        expect((init.headers as Record<string, string>).Referer).toContain('eastmoney.com');
        return json(
          em([
            { FSRQ: '2026-10-16', DWJZ: '' },
            { FSRQ: '2026-10-15', DWJZ: '0.5397' },
          ]),
        );
      }),
    );
    expect(await fetchFund('161725', now)).toMatchObject({
      name: '招商中证白酒指数(LOF)A',
      navDate: '2026-10-15',
      value: '0.5397',
      source: expect.stringContaining('东方财富'),
    });
  });
  it('东方财富失败时降级新浪；官网失败的两只基金也会降级', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('sina.com.cn'))
          return json({
            result: {
              status: { code: 0 },
              data: { total_num: '1', data: [{ fbrq: '2026-10-16 00:00:00', jjjz: '1.7219' }] },
            },
          });
        if (url.includes('fundsuggest')) return json({ Datas: [] });
        return json({}, 503);
      }),
    );
    expect(await fetchFund('110020', now)).toMatchObject({
      value: '1.7219',
      navDate: '2026-10-16',
      name: '易方达沪深 300 ETF 联接 A',
      source: expect.stringContaining('新浪'),
    });
  });
  it('货币基金拒绝，非 6 位代码不发请求，全部失败时说明各来源原因', async () => {
    const f = vi.fn(async () => json(em([{ FSRQ: '2026-10-16', DWJZ: '0.2207' }], '每万份收益')));
    vi.stubGlobal('fetch', f);
    await expect(fetchFund('000198', now)).rejects.toThrow('货币基金');
    expect(f).toHaveBeenCalledTimes(1);
    await expect(fetchFund('12345', now)).rejects.toThrow('6 位');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 403)),
    );
    await expect(fetchFund('161725', now)).rejects.toThrow(/所有免费净值来源.*东方财富.*新浪/);
  });
});

describe('定投历史价格接口', () => {
  const at = Date.UTC(2026, 9, 12, 1, 30);
  const candle = (ts: number, confirm = '1') =>
    json({
      code: '0',
      data: [[String(ts), '83798.3', '1', '1', '83747.9', '1', '1', '1', confirm]],
    });
  it('只接受时间戳完全吻合且已收盘的分钟 K 线', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain(`after=${at + 60000}`);
        return candle(at);
      }),
    );
    expect(await minuteCandle('BTC-USDT', at, at + 120000)).toMatchObject({ open: '83798.3' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => candle(at - 60000)),
    );
    await expect(minuteCandle('BTC-USDT', at, at + 120000)).rejects.toThrow('没有已收盘');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => candle(at, '0')),
    );
    await expect(minuteCandle('BTC-USDT', at, at + 120000)).rejects.toThrow('没有已收盘');
    await expect(minuteCandle('BTC-USDT', at + 1, at + 120000)).rejects.toThrow('整分钟');
    await expect(minuteCandle('BTC-USDT', at, at + 30000)).rejects.toThrow('尚未结束');
  });
  it('基金历史窗口在净值未披露时返回空列表，不当作错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('eastmoney')
          ? json({ ErrCode: 0, TotalCount: 0, Data: { SYType: null, LSJZList: [] } })
          : json({ result: { status: { code: 0 }, data: { total_num: '0', data: [] } } }),
      ),
    );
    const now = new Date('2026-10-16T03:00:00.000Z');
    expect(await fetchFundHistory('161725', '2026-10-16', now)).toMatchObject({
      rows: [],
      to: '2026-10-16',
    });
    await expect(fetchFundHistory('161725', '2026-10-17', now)).rejects.toThrow('晚于今天');
  });
});

describe('节假日数据', () => {
  it('只保留工作日休市日，调休上班日不算交易日来源；未公布年份标记为未公布', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          year: 2026,
          papers: ['https://www.gov.cn/x'],
          days: [
            { name: '国庆节', date: '2026-10-01', isOffDay: true },
            { name: '国庆节', date: '2026-10-03', isOffDay: true },
            { name: '国庆节', date: '2026-10-10', isOffDay: false },
          ],
        }),
      ),
    );
    expect(await fetchHolidayYear(2026)).toMatchObject({ published: true, closed: ['2026-10-01'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ year: 2027, papers: [], days: [] })),
    );
    expect(await fetchHolidayYear(2027)).toMatchObject({ published: false, closed: [] });
  });
});

describe('网站登录会话', () => {
  it('30 天内有效、后端重启后仍有效；换口令、过期或被篡改即失效', async () => {
    const { issueSession, verifySession } = await import('../server/session');
    const secret = 'a'.repeat(40),
      now = Date.UTC(2026, 9, 17);
    const token = issueSession(secret, now);
    expect(verifySession(token, secret, now + 29 * 86400000)).toBe(true);
    expect(verifySession(token, secret, now + 31 * 86400000)).toBe(false);
    expect(verifySession(token, 'b'.repeat(40), now)).toBe(false);
    expect(verifySession(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), secret, now)).toBe(
      false,
    );
    expect(verifySession(token, undefined, now)).toBe(false);
    expect(verifySession(token, 'short', now)).toBe(false);
  });
});
