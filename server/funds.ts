import { z } from 'zod';
import Decimal from 'decimal.js';
import { fundRefreshInterval } from '../src/navday';

export const FUND_CACHE_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const navSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,12})?$/)
  .refine((v) => new Decimal(v).gt(0));
const products = {
  '000218': { name: '国泰黄金 ETF 联接 A', source: '国泰基金官网正式净值（实验接入）' },
  '110020': { name: '易方达沪深 300 ETF 联接 A', source: '易方达基金官网正式净值（实验接入）' },
} as const;
type OfficialCode = keyof typeof products;
export type FundQuote = {
  code: string;
  name: string | null;
  value: string;
  navDate: string;
  fetchedAt: string;
  currency: 'CNY';
  source: string;
  experimental: true;
};
const hasOfficial = (code: string): code is OfficialCode => Object.hasOwn(products, code);
// Any 6-digit mainland public fund code. Money-market funds are rejected after the fetch,
// because their "NAV" field is income per 10k shares, not a unit price.
export const isSupportedFund = (code: string) => /^\d{6}$/.test(code);
function shanghaiDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
async function requestJSON(
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw new Error('基金数据源网络不可达或请求超时');
    }
    if (response.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    // Do not retry rate limits, access denials or challenges.
    if (!response.ok) throw new Error('基金数据源暂不可用或限制访问');
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('基金净值响应过大');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('基金数据源返回格式已变化');
    }
  }
  throw new Error('基金净值请求失败');
}

type NavRow = { navDate: string; value: string };
const dayWindow = (now: Date, days: number) => {
  const end = shanghaiDay(now);
  return { end, start: new Date(Date.parse(end) - days * 86400000).toISOString().slice(0, 10) };
};
// Free aggregators page at about 20 rows. 20 calendar days hold at most 15 trading days,
// so one page is always complete while still covering the 14-day staleness limit.
const AGGREGATOR_DAYS = 20;

// Endpoint URLs are fixed. No account credentials, website scripts, dynamic URLs or
// intraday estimates are executed or accepted by these adapters.
async function officialRows(code: OfficialCode, start: string, end: string): Promise<NavRow[]> {
  if (code === '000218') {
    const raw = await requestJSON(
      'https://e.gtfund.com/Etrade/Public/cochin/info.fund.nav_history',
      {
        api: 'info.fund.nav_history',
        params: {
          fundCode: code,
          start: `${start}T00:00:00.000+08:00`,
          end: `${end}T23:59:59.999+08:00`,
          dayinc: true,
          order: 'asc',
        },
      },
    );
    return z
      .array(z.object({ date: z.string().datetime({ offset: true }), nav: navSchema }))
      .min(1)
      .max(100)
      .parse(raw)
      .map((r) => ({ navDate: shanghaiDay(new Date(r.date)), value: r.nav }));
  }
  const raw = await requestJSON('https://api.efunds.com.cn/xcowch/front/fund/nav', {
    fundCode: code,
    pageIndex: 0,
    pageSize: 100,
    startDate: start,
    endDate: end,
    siteID: '1',
  });
  const result = z
    .object({
      status: z.literal(1),
      data: z.object({
        pageIndex: z.literal(0),
        total: z.number().int().nonnegative().max(100),
        data: z
          .array(z.object({ navDate: dateSchema, netValue: navSchema, shortName: z.string() }))
          .min(1)
          .max(100),
      }),
    })
    .parse(raw);
  // A 45-day interval fits on one page; refuse truncated/changed pagination.
  if (result.data.total !== result.data.data.length)
    throw new Error('基金历史净值分页不完整，本次未更新');
  if (result.data.data.some((r) => !/易方达.*沪深300.*联接A/.test(r.shortName.replace(/\s/g, ''))))
    throw new Error('基金名称或份额类别与预期不符，本次未更新');
  return result.data.data.map((r) => ({ navDate: r.navDate, value: r.netValue }));
}

class MoneyMarketError extends Error {
  constructor() {
    super('货币基金 / 短期理财按万份收益披露，单位净值固定，请手动记录收益');
  }
}

// Eastmoney (天天基金) F10 history: free, no key, covers all public funds. It only answers
// with the F10 page as Referer. SYType is set for money-market / per-10k-income funds.
async function eastmoneyRows(code: string, start: string, end: string): Promise<NavRow[]> {
  const query = new URLSearchParams({
    fundCode: code,
    pageIndex: '1',
    pageSize: '20',
    startDate: start,
    endDate: end,
  });
  const raw = z
    .object({
      ErrCode: z.literal(0),
      TotalCount: z.number().int().nonnegative(),
      Data: z.object({
        SYType: z.string().nullable(),
        LSJZList: z.array(z.object({ FSRQ: dateSchema, DWJZ: z.string() })).max(20),
      }),
    })
    .parse(
      await requestJSON('https://api.fund.eastmoney.com/f10/lsjz?' + query, undefined, {
        Referer: 'https://fundf10.eastmoney.com/',
      }),
    );
  if (raw.Data.SYType) throw new MoneyMarketError();
  if (raw.TotalCount !== raw.Data.LSJZList.length)
    throw new Error('基金历史净值分页不完整，本次未更新');
  // Newly founded or suspended funds may publish blank NAV rows; skip them, never treat as 0.
  return raw.Data.LSJZList.filter((r) => r.DWJZ !== '').map((r) => ({
    navDate: r.FSRQ,
    value: navSchema.parse(r.DWJZ),
  }));
}

// Sina finance NAV history: free, no key, independent fallback when Eastmoney is down.
async function sinaRows(code: string, start: string, end: string): Promise<NavRow[]> {
  const query = new URLSearchParams({ symbol: code, datefrom: start, dateto: end, page: '1' });
  const raw = z
    .object({
      result: z.object({
        status: z.object({ code: z.literal(0) }),
        data: z.object({
          total_num: z.union([z.string(), z.number()]),
          data: z
            .array(z.object({ fbrq: z.string().regex(/^\d{4}-\d{2}-\d{2}/), jjjz: navSchema }))
            .max(100),
        }),
      }),
    })
    .parse(
      await requestJSON(
        'https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/CaihuiFundInfoService.getNav?' +
          query,
      ),
    );
  const rows = raw.result.data.data;
  if (Number(raw.result.data.total_num) !== rows.length)
    throw new Error('基金历史净值分页不完整，本次未更新');
  return rows.map((r) => ({ navDate: r.fbrq.slice(0, 10), value: r.jjjz }));
}

// Fund name from Eastmoney search, only used to label the quote. Cached per process.
const names = new Map<string, string | null>();
async function fundName(code: string): Promise<string | null> {
  if (hasOfficial(code)) return products[code].name;
  if (names.has(code)) return names.get(code) ?? null;
  try {
    const raw = z
      .object({
        Datas: z.array(
          z.object({ CODE: z.string(), NAME: z.string().max(80), CATEGORY: z.number() }),
        ),
      })
      .parse(
        await requestJSON(
          'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?' +
            new URLSearchParams({ m: '1', key: code }),
        ),
      );
    const name = raw.Datas.find((d) => d.CODE === code && d.CATEGORY === 700)?.NAME ?? null;
    names.set(code, name);
    return name;
  } catch {
    return null;
  }
}

function latestValid(rows: NavRow[], start: string, end: string): NavRow {
  if (!rows.length) throw new Error('数据源没有此基金近期的单位净值，请核对代码');
  checkRows(rows, start, end);
  const latest = [...rows].sort((a, b) => b.navDate.localeCompare(a.navDate))[0];
  if (Date.parse(end) - Date.parse(latest.navDate) > 14 * 86400000)
    throw new Error('最近净值已超过 14 天，保留原值并请手动核对');
  return latest;
}
function checkRows(rows: NavRow[], start: string, end: string) {
  const dates = new Set<string>();
  for (const row of rows) {
    dateSchema.parse(row.navDate);
    navSchema.parse(row.value);
    if (row.navDate > end || row.navDate < start || dates.has(row.navDate))
      throw new Error('基金净值日期越界或重复，本次未更新');
    dates.add(row.navDate);
  }
}

export async function fetchOfficialFund(code: string, now = new Date()): Promise<FundQuote> {
  if (!hasOfficial(code)) throw new Error('尚未验证此基金的官网净值接口');
  const { start, end } = dayWindow(now, 45);
  const latest = latestValid(await officialRows(code, start, end), start, end);
  return {
    code,
    ...products[code],
    ...latest,
    fetchedAt: now.toISOString(),
    currency: 'CNY',
    experimental: true,
  };
}

const sources = [
  { label: '东方财富天天基金历史净值（免费公开查询）', rows: eastmoneyRows },
  { label: '新浪财经基金净值（免费公开查询）', rows: sinaRows },
];
const reason = (error: unknown) =>
  error instanceof Error && error.name !== 'ZodError' ? error.message : '返回格式未通过校验';

// Official site first for the two verified funds, then the free aggregators in order.
// A source that fails validation is skipped; a money-market fund stops immediately.
export async function fetchFund(code: string, now = new Date()): Promise<FundQuote> {
  if (!isSupportedFund(code)) throw new Error('基金代码应为 6 位数字');
  const errors: string[] = [];
  if (hasOfficial(code)) {
    try {
      return await fetchOfficialFund(code, now);
    } catch (error) {
      errors.push('官网：' + reason(error));
    }
  }
  const { start, end } = dayWindow(now, AGGREGATOR_DAYS);
  for (const source of sources) {
    try {
      const latest = latestValid(await source.rows(code, start, end), start, end);
      return {
        code,
        name: await fundName(code),
        ...latest,
        source: source.label,
        fetchedAt: now.toISOString(),
        currency: 'CNY',
        experimental: true,
      };
    } catch (error) {
      if (error instanceof MoneyMarketError) throw error;
      errors.push(source.label.slice(0, 4) + '：' + reason(error));
    }
  }
  throw new Error(`所有免费净值来源均未成功（${errors.join('；')}），原有净值保留`);
}

export const HISTORY_DAYS = 14;
export type FundHistory = {
  code: string;
  from: string;
  to: string;
  rows: NavRow[];
  source: string;
};
// Official NAVs from `from` for up to 14 days (at most 10 trading days: one page everywhere).
// Used to settle 定投 at the NAV of its trade day. An empty list means not yet published.
export async function fetchFundHistory(
  code: string,
  from: string,
  now = new Date(),
): Promise<FundHistory> {
  if (!isSupportedFund(code)) throw new Error('基金代码应为 6 位数字');
  const today = shanghaiDay(now);
  dateSchema.parse(from);
  if (from > today) throw new Error('起始日期不能晚于今天');
  if (Date.parse(today) - Date.parse(from) > 3 * 366 * 86400000)
    throw new Error('仅支持查询近三年的净值');
  const end = new Date(Date.parse(from) + HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const to = end < today ? end : today;
  const loaders: { label: string; rows: (c: string, s: string, e: string) => Promise<NavRow[]> }[] =
    [
      ...(hasOfficial(code)
        ? [
            {
              label: products[code].source,
              rows: (c: string, s: string, e: string) => officialRows(c as OfficialCode, s, e),
            },
          ]
        : []),
      ...sources,
    ];
  const errors: string[] = [];
  let empty: FundHistory | null = null;
  for (const loader of loaders) {
    try {
      const rows = (await loader.rows(code, from, to)).sort((a, b) =>
        a.navDate.localeCompare(b.navDate),
      );
      checkRows(rows, from, to);
      const result = { code, from, to, rows, source: loader.label };
      // A lagging source may be empty while another already has the NAV.
      if (rows.length) return result;
      empty ??= result;
    } catch (error) {
      if (error instanceof MoneyMarketError) throw error;
      errors.push(loader.label.slice(0, 4) + '：' + reason(error));
    }
  }
  if (empty) return empty;
  throw new Error(`所有免费净值来源均未成功（${errors.join('；')}）`);
}
export function createHistoryReader(
  loader: typeof fetchFundHistory = fetchFundHistory,
  clock = () => Date.now(),
) {
  const cache = new Map<string, { at: number; value: FundHistory }>();
  return async (code: string, from: string) => {
    const key = code + '@' + from,
      at = clock(),
      hit = cache.get(key);
    // A closed window never changes; one that reaches today may still gain rows.
    const ttl = (h: FundHistory) =>
      h.to < shanghaiDay(new Date(at)) && h.rows.length ? 7 * 86400000 : 30 * 60000;
    if (hit && at - hit.at < ttl(hit.value)) return hit.value;
    const value = await loader(code, from, new Date(at));
    if (cache.size > 500) cache.clear();
    cache.set(key, { at, value });
    return value;
  };
}

export function createFundReader(loader: typeof fetchFund = fetchFund, clock = () => Date.now()) {
  const cache = new Map<string, { at: number; quote: FundQuote }>();
  const cooldown = new Map<string, number>();
  const pending = new Map<string, Promise<FundQuote>>();
  return async (code: string): Promise<FundQuote> => {
    if (!isSupportedFund(code)) throw new Error('基金代码应为 6 位数字');
    const at = clock(),
      cached = cache.get(code);
    // Until the newest publishable NAV is in, re-check every 30 minutes instead of 6 hours.
    if (
      cached &&
      at - cached.at <
        Math.min(FUND_CACHE_MS, fundRefreshInterval(cached.quote.navDate, new Date(at)))
    )
      return cached.quote;
    if ((cooldown.get(code) ?? 0) > at)
      throw new Error('基金接口上次更新失败，15 分钟后可重试；原有净值保留');
    const running = pending.get(code);
    if (running) return running;
    const task = (async () => {
      try {
        const quote = await loader(code, new Date(at));
        cache.set(code, { at: clock(), quote });
        cooldown.delete(code);
        return quote;
      } catch (error) {
        cooldown.set(code, clock() + RETRY_AFTER_MS);
        if (error instanceof Error && error.name !== 'ZodError') throw error;
        throw new Error('基金净值格式未通过校验，本次未更新');
      } finally {
        pending.delete(code);
      }
    })();
    pending.set(code, task);
    return task;
  };
}
