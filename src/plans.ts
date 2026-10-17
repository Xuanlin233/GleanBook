import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  D,
  dayIn,
  planEnds,
  rateFor,
  validateLedger,
  type Holding,
  type Ledger,
  type Plan,
  type PlanRun,
} from './domain';

// ---------- Schedule ----------

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// 1 = Monday … 7 = Sunday
export const isoWeekday = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay() || 7;
export const daysInMonth = (day: string) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
function offsetAt(ts: number, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const get = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return (
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) -
    Math.floor(ts / 60000) * 60000
  );
}
// Wall-clock date + HH:mm in a time zone → UTC milliseconds.
export function zonedTime(day: string, time: string, tz: string) {
  const [y, m, d] = day.split('-').map(Number),
    [hh, mm] = time.split(':').map(Number),
    wall = Date.UTC(y, m - 1, d, hh, mm);
  let ts = wall - offsetAt(wall, tz);
  ts = wall - offsetAt(ts, tz);
  return ts;
}
function matches(plan: Plan, day: string) {
  const wd = isoWeekday(day);
  switch (plan.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return wd <= 5;
    case 'weekly':
      return wd === plan.weekday;
    case 'biweekly': {
      if (wd !== plan.weekday) return false;
      let anchor = plan.startDate;
      while (isoWeekday(anchor) !== plan.weekday) anchor = addDays(anchor, 1);
      return ((Date.parse(day) - Date.parse(anchor)) / 86400000 / 7) % 2 === 0;
    }
    case 'monthly':
      return Number(day.slice(8)) === Math.min(plan.monthDay!, daysInMonth(day));
  }
}
// Mainland trading-day check: true / false, or null while that year's holidays are unknown.
export type TradingCalendar = (day: string) => boolean | null;
// Weekends are always closed, so without holiday data only weekdays are uncertain.
export const weekendsOnly: TradingCalendar = (day) => (isoWeekday(day) >= 6 ? false : null);
// Scheduled times strictly after `after` and not later than `until`, oldest first.
// With skipHolidays, closed days produce nothing; an unknown day stops the scan so that
// later periods are generated only once the holiday notice for that year is available.
export function planOccurrences(
  plan: Plan,
  after: number | null,
  until: number,
  limit = 400,
  calendar: TradingCalendar = weekendsOnly,
) {
  const result: number[] = [];
  let day = plan.startDate;
  if (after !== null) {
    const resume = addDays(dayIn(new Date(after), plan.timezone), -1);
    if (resume > day) day = resume;
  }
  const last = dayIn(new Date(until), plan.timezone);
  for (; day <= last && result.length < limit; day = addDays(day, 1)) {
    if (plan.endDate && day > plan.endDate) break;
    if (!matches(plan, day)) continue;
    const ts = zonedTime(day, plan.time, plan.timezone);
    if ((after !== null && ts <= after) || ts > until) continue;
    if (plan.skipHolidays) {
      const open = calendar(day);
      if (open === null) break;
      if (!open) continue;
    }
    result.push(ts);
  }
  return result;
}
export function nextOccurrence(plan: Plan, now = Date.now(), calendar = weekendsOnly) {
  if (!plan.active) return null;
  const after = Math.max(now, plan.cursor ? Date.parse(plan.cursor) : 0);
  const [next] = planOccurrences(plan, after, after + 400 * 86400000, 1, calendar);
  return next ?? null;
}
// Years whose holiday notice a skipping plan needs between its cursor and `until`.
export function holidayYearsNeeded(l: Ledger, until = Date.now()) {
  const years = new Set<number>(),
    last = new Date(until).getUTCFullYear() + 1;
  for (const p of l.plans) {
    if (!p.skipHolidays) continue;
    const from = Number(
      (p.cursor ? dayIn(new Date(p.cursor), p.timezone) : p.startDate).slice(0, 4),
    );
    for (let y = Math.max(from, last - 5); y <= last; y++) years.add(y);
  }
  return [...years];
}

// ---------- Settlement arithmetic ----------

const fiat = ['CNY', 'USD', 'HKD', 'EUR'];
const roundMoney = (v: Decimal, currency: string) =>
  v.toDecimalPlaces(fiat.includes(currency) ? 2 : 8, Decimal.ROUND_HALF_UP);
// Fund platforms truncate shares to 0.01; crypto venues to their lot size (8 dp here).
const roundUnits = (v: Decimal, h: Holding, mode: Decimal.Rounding = Decimal.ROUND_DOWN) =>
  v.toDecimalPlaces(h.kind === 'fund' ? 2 : 8, mode);
const str = (v: Decimal) => v.toFixed();

export function runFx(l: Ledger, sourceCurrency: string, targetCurrency: string) {
  if (sourceCurrency === targetCurrency) return D(1);
  const s = rateFor(l, sourceCurrency),
    t = rateFor(l, targetCurrency);
  return s && t ? s.div(t) : null;
}

// Money known before any price: only for a fixed amount from a cash account.
// Charging it at once mirrors a real subscription, where the bank debits on the trade day.
export function precharge(l: Ledger, run: PlanRun): Partial<PlanRun> {
  if (run.mode !== 'amount' || run.sourceType !== 'account') return {};
  const { target, sourceCurrency } = planEnds(l, run),
    fx = runFx(l, sourceCurrency, target.currency);
  if (!fx) return {};
  const amount = D(run.amount);
  return {
    fxRate: str(fx),
    sourceAmount: str(
      run.amountCurrency === sourceCurrency ? amount : roundMoney(amount.div(fx), sourceCurrency),
    ),
    targetCost: str(
      run.amountCurrency === target.currency ? amount : roundMoney(amount.mul(fx), target.currency),
    ),
  };
}

export function settle(
  l: Ledger,
  run: PlanRun,
  targetPrice: { price: string; note: string },
  sourcePrice?: { price: string; note: string },
): PlanRun {
  const { target, sourceCurrency } = planEnds(l, run);
  const fx = run.fxRate ? D(run.fxRate) : runFx(l, sourceCurrency, target.currency);
  if (!fx) throw new Error(`缺少 ${sourceCurrency}/CNY 或 ${target.currency}/CNY 汇率，无法换算`);
  const T = target.currency,
    S = sourceCurrency,
    price = D(targetPrice.price),
    rate = D(run.feeRate).div(100);
  if (!price.gt(0)) throw new Error('价格无效');
  let grossT: Decimal, grossS: Decimal, fee: Decimal, quantity: Decimal;
  if (run.mode === 'amount') {
    const amount = D(run.amount);
    grossT = run.amountCurrency === T ? amount : roundMoney(amount.mul(fx), T);
    grossS = run.amountCurrency === S ? amount : roundMoney(amount.div(fx), S);
    const net = roundMoney(grossT.div(rate.plus(1)), T);
    fee = grossT.minus(net);
    quantity = roundUnits(net.div(price), target);
  } else {
    quantity = D(run.amount);
    const net = roundMoney(quantity.mul(price), T);
    fee = roundMoney(net.mul(rate), T);
    grossT = net.plus(fee);
    grossS = S === T ? grossT : roundMoney(grossT.div(fx), S);
  }
  if (!quantity.gt(0)) throw new Error('金额不足以买入最小单位');
  let sourceAmount = grossS,
    sourceUnitPrice: string | undefined;
  if (run.sourceType === 'holding') {
    const source = l.holdings.find((h) => h.id === run.sourceId)!;
    if (!sourcePrice) throw new Error('来源持仓缺少价格');
    sourceUnitPrice = sourcePrice.price;
    // Sell enough source units to cover the cost.
    sourceAmount = roundUnits(grossS.div(sourcePrice.price), source, Decimal.ROUND_UP);
  }
  return {
    ...run,
    status: 'confirmed',
    fxRate: str(fx),
    sourceAmount: str(sourceAmount),
    targetQuantity: str(quantity),
    targetCost: str(grossT),
    fee: str(fee),
    targetPrice: targetPrice.price,
    sourcePrice: sourceUnitPrice,
    priceNote: [targetPrice.note, sourcePrice && '来源：' + sourcePrice.note]
      .filter(Boolean)
      .join('；')
      .slice(0, 300),
    waiting: undefined,
  };
}

// ---------- Generation ----------

export function generateRuns(
  l: Ledger,
  now = Date.now(),
  calendar: TradingCalendar = weekendsOnly,
): Ledger {
  let changed = false;
  const runs = [...l.planRuns];
  const plans = l.plans.map((plan) => {
    if (!plan.active) return plan;
    const times = planOccurrences(
      plan,
      plan.cursor ? Date.parse(plan.cursor) : null,
      now,
      400,
      calendar,
    );
    if (!times.length) return plan;
    changed = true;
    for (const ts of times) {
      const run: PlanRun = {
        id: `run-${plan.id}-${ts}`,
        planId: plan.id,
        planName: plan.name,
        scheduledAt: new Date(ts).toISOString(),
        status: 'pending',
        sourceType: plan.sourceType,
        sourceId: plan.sourceId,
        targetId: plan.targetId,
        mode: plan.mode,
        amount: plan.amount,
        amountCurrency: plan.amountCurrency,
        feeRate: plan.feeRate,
        waiting: '等待取得成交价格',
      };
      if (!runs.some((r) => r.id === run.id)) runs.push({ ...run, ...precharge(l, run) });
    }
    return { ...plan, cursor: new Date(times[times.length - 1]).toISOString() };
  });
  return changed ? { ...l, plans, planRuns: runs } : l;
}

// ---------- Prices ----------

export type PriceAnswer = { price: string; note: string } | { wait: string };
export type FundHistory = {
  code: string;
  from: string;
  to: string;
  rows: { navDate: string; value: string }[];
  source: string;
};
export type PriceDeps = {
  fundHistory: (code: string, from: string) => Promise<FundHistory>;
  candle: (instrument: string, at: number) => Promise<{ open: string }>;
  now?: () => number;
};
const shanghai = (ts: number) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const get = (k: string) => p.find((x) => x.type === k)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
};
export const autoPriced = (h: Holding) =>
  h.symbol === h.currency ||
  (h.kind === 'fund' && h.currency === 'CNY' && /^\d{6}$/.test(h.symbol)) ||
  (['crypto', 'earn'].includes(h.kind) &&
    h.currency === 'USDT' &&
    /^[A-Z0-9]{2,12}$/.test(h.symbol));

// One resolver per refresh pass, so a fetched NAV window or minute serves every run it covers.
export function createPriceResolver(deps: PriceDeps) {
  const windows = new Map<string, FundHistory[]>(),
    minutes = new Map<string, Promise<{ open: string }>>();
  const now = deps.now ?? Date.now;
  async function fund(code: string, ts: number): Promise<PriceAnswer> {
    // Orders after the 15:00 cutoff trade at the next trading day's NAV.
    const { day, hour } = shanghai(ts),
      after15 = hour >= 15,
      fits = (r: { navDate: string }) => (after15 ? r.navDate > day : r.navDate >= day);
    const list = windows.get(code) ?? [];
    let hit = list.find((w) => w.from <= day && (w.rows.some(fits) || w.to >= shanghai(now()).day));
    if (!hit) {
      hit = await deps.fundHistory(code, day);
      windows.set(code, [...list, hit]);
    }
    const row = hit.rows.find(fits);
    if (row) return { price: row.value, note: `${row.navDate} 正式净值 · ${hit.source}` };
    if (hit.to < shanghai(now()).day)
      throw new Error(`未找到 ${day} 起两周内的基金净值，请手动确认`);
    return { wait: `等待${after15 ? ' ' + day + ' 之后首个交易日' : ' ' + day + ' '}的净值披露` };
  }
  async function crypto(symbol: string, ts: number): Promise<PriceAnswer> {
    const at = Math.floor(ts / 60000) * 60000;
    if (at + 65000 > now()) return { wait: '等待该分钟收盘' };
    const key = symbol + '@' + at;
    if (!minutes.has(key)) minutes.set(key, deps.candle(symbol + '-USDT', at));
    const { open } = await minutes.get(key)!;
    const label = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
    return { price: open, note: `OKX ${symbol}-USDT ${label}（北京时间）分钟开盘价` };
  }
  return async (h: Holding, ts: number): Promise<PriceAnswer> => {
    if (h.symbol === h.currency) return { price: '1', note: `同币种单位价格 1 ${h.currency}` };
    if (h.kind === 'fund' && h.currency === 'CNY' && /^\d{6}$/.test(h.symbol))
      return fund(h.symbol, ts);
    if (
      ['crypto', 'earn'].includes(h.kind) &&
      h.currency === 'USDT' &&
      /^[A-Z0-9]{2,12}$/.test(h.symbol)
    )
      return crypto(h.symbol, ts);
    throw new Error('此资产无法自动取得历史价格，请手动确认成交');
  };
}

// ---------- Processing ----------

export type RunUpdate = { id: string; run: PlanRun };
// Resolve prices for pending runs, oldest first. Never throws: a failure stays pending with a reason.
export async function resolveRuns(l: Ledger, deps: PriceDeps, budget = 40): Promise<RunUpdate[]> {
  const price = createPriceResolver(deps),
    updates: RunUpdate[] = [];
  const pending = l.planRuns
    .filter((r) => r.status === 'pending' && !r.manual)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, budget);
  for (const run of pending) {
    const ts = Date.parse(run.scheduledAt);
    try {
      const { target } = planEnds(l, run);
      const t = await price(target, ts);
      if ('wait' in t) {
        updates.push({ id: run.id, run: { ...run, waiting: t.wait } });
        continue;
      }
      let s: { price: string; note: string } | undefined;
      if (run.sourceType === 'holding') {
        const source = l.holdings.find((h) => h.id === run.sourceId)!;
        const answer = await price(source, ts);
        if ('wait' in answer) {
          updates.push({ id: run.id, run: { ...run, waiting: '来源' + answer.wait } });
          continue;
        }
        s = answer;
      }
      updates.push({ id: run.id, run: settle(l, run, t, s) });
    } catch (e) {
      const message = e instanceof Error && e.name !== 'ZodError' ? e.message : '价格数据无效';
      updates.push({ id: run.id, run: { ...run, waiting: message.slice(0, 300) } });
    }
  }
  return updates;
}

// Apply updates one at a time; one that would break the ledger (for example selling more
// source units than held) stays pending with the reason instead of blocking the others.
export function applyRunUpdates(l: Ledger, updates: RunUpdate[]): Ledger {
  let current = l;
  for (const u of updates) {
    const candidate = {
      ...current,
      planRuns: current.planRuns.map((r) => (r.id === u.id ? u.run : r)),
    };
    try {
      current = u.run.status === 'confirmed' ? validateLedger(candidate) : candidate;
    } catch (e) {
      const reason = e instanceof Error && e.name !== 'ZodError' ? e.message : '数据校验未通过';
      current = {
        ...current,
        planRuns: current.planRuns.map((r) =>
          r.id === u.id ? { ...r, waiting: ('无法入账：' + reason).slice(0, 300) } : r,
        ),
      };
    }
  }
  return current;
}

// ---------- Browser API clients ----------

const historySchema = z.object({
  code: z.string(),
  from: z.string(),
  to: z.string(),
  rows: z.array(z.object({ navDate: z.string(), value: z.string().regex(/^\d+(\.\d+)?$/) })),
  source: z.string().max(200),
});
async function getJSON(url: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    credentials: 'omit',
    cache: 'no-store',
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      raw && typeof raw.error === 'string' ? raw.error.slice(0, 200) : '后端未运行或请求失败',
    );
  return raw;
}
// ---------- Holiday calendar (browser) ----------

const holidayYearSchema = z.object({
  year: z.number().int(),
  published: z.boolean(),
  closed: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60),
});
type HolidayYear = z.infer<typeof holidayYearSchema>;
const HOLIDAY_KEY = 'shizhang-holidays-cn';
const holidays = new Map<number, HolidayYear>();
try {
  // Published years never change, so they are kept for offline use in this browser.
  for (const y of z
    .array(holidayYearSchema)
    .parse(JSON.parse(localStorage.getItem(HOLIDAY_KEY) ?? '[]')))
    if (y.published) holidays.set(y.year, y);
} catch {
  /* storage unavailable or stale format */
}
export function makeCalendar(years: Iterable<HolidayYear>): TradingCalendar {
  const map = new Map([...years].map((y) => [y.year, y]));
  return (day) => {
    if (isoWeekday(day) >= 6) return false;
    const y = map.get(Number(day.slice(0, 4)));
    return y?.published ? !y.closed.includes(day) : null;
  };
}
export const cachedCalendar: TradingCalendar = (day) => makeCalendar(holidays.values())(day);
export async function loadHolidays(years: number[]) {
  for (const year of years) {
    if (holidays.get(year)?.published) continue;
    try {
      holidays.set(year, holidayYearSchema.parse(await getJSON(`/api/calendar/cn?year=${year}`)));
    } catch {
      /* stays unknown; skipping plans wait for it */
    }
  }
  try {
    localStorage.setItem(
      HOLIDAY_KEY,
      JSON.stringify([...holidays.values()].filter((y) => y.published)),
    );
  } catch {
    /* private mode */
  }
}
export const holidayPublished = (year: number) => holidays.get(year)?.published === true;

export const browserPriceDeps: PriceDeps = {
  fundHistory: async (code, from) =>
    historySchema.parse(
      await getJSON(`/api/funds/history?code=${encodeURIComponent(code)}&from=${from}`),
    ),
  candle: async (instrument, at) =>
    z
      .object({ open: z.string().regex(/^\d+(\.\d+)?$/) })
      .parse(
        await getJSON(`/api/market/candle?instrument=${encodeURIComponent(instrument)}&at=${at}`),
      ),
};
