import Decimal from 'decimal.js';
import {
  D,
  dayIn,
  exact,
  rateFor,
  type Category,
  type Ledger,
  type Subscription,
  type Transaction,
} from './domain';
import { addDays, daysInMonth, isoWeekday, zonedTime } from './plans';

// Charges are booked at the start of the billing day in the subscription's time zone, so
// opening the site any time that day books it.
export const BILLING_TIME = '00:00';
export const SUBSCRIPTION_CATEGORY: Category = {
  id: 'subscription',
  name: '订阅服务',
  kind: 'expense',
  icon: 'calendar',
};

function bills(s: Subscription, day: string) {
  const dom = Number(day.slice(8)),
    target = Math.min(s.day ?? 1, daysInMonth(day));
  switch (s.cycle) {
    case 'monthly':
      return dom === target;
    case 'yearly':
      return Number(day.slice(5, 7)) === s.month && dom === target;
    case 'weekly':
      return isoWeekday(day) === s.weekday;
  }
}
// Billing times strictly after `after` and not later than `until`, oldest first.
export function billingTimes(s: Subscription, after: number | null, until: number, limit = 400) {
  const result: number[] = [];
  let day = s.startDate;
  if (after !== null) {
    const resume = addDays(dayIn(new Date(after), s.timezone), -1);
    if (resume > day) day = resume;
  }
  const last = dayIn(new Date(until), s.timezone);
  for (; day <= last && result.length < limit; day = addDays(day, 1)) {
    if (s.endDate && day > s.endDate) break;
    if (!bills(s, day)) continue;
    const ts = zonedTime(day, BILLING_TIME, s.timezone);
    if ((after === null || ts > after) && ts <= until) result.push(ts);
  }
  return result;
}
export function nextBilling(s: Subscription, now = Date.now()) {
  if (!s.active) return null;
  const after = Math.max(now, s.cursor ? Date.parse(s.cursor) : 0);
  // A yearly plan can be up to 366 days away.
  const [next] = billingTimes(s, after, after + 800 * 86400000, 1);
  return next ?? null;
}
// Average cost per month in the account currency: yearly / 12, weekly × 52 / 12.
export function monthlyEquivalent(s: Subscription): Decimal {
  const amount = D(s.amount);
  return s.cycle === 'monthly'
    ? amount
    : s.cycle === 'yearly'
      ? amount.div(12)
      : amount.mul(52).div(12);
}
export function monthlyTotal(l: Ledger) {
  let total = D(0);
  const missing = new Set<string>();
  for (const s of l.subscriptions.filter((x) => x.active)) {
    const a = l.accounts.find((x) => x.id === s.accountId);
    const fx = a && rateFor(l, a.currency);
    if (!a || !fx) {
      if (a) missing.add(a.currency);
      continue;
    }
    total = total.plus(monthlyEquivalent(s).mul(fx));
  }
  return { total, missing: [...missing] };
}

// Book every charge that has come due. A subscription whose foreign-currency account has no
// CNY rate yet waits (its cursor does not move) so the charge is booked once the rate exists.
export function chargeSubscriptions(l: Ledger, now = Date.now()) {
  const transactions = [...l.transactions],
    blocked: string[] = [];
  let charged = 0;
  const subscriptions = l.subscriptions.map((s) => {
    if (!s.active) return s;
    const times = billingTimes(s, s.cursor ? Date.parse(s.cursor) : null, now);
    if (!times.length) return s;
    const account = l.accounts.find((a) => a.id === s.accountId);
    if (!account) return s;
    const fx = account.currency === 'CNY' ? D(1) : rateFor(l, account.currency);
    if (!fx) {
      blocked.push(`${s.name}：缺少 ${account.currency}/CNY 汇率，暂缓扣款`);
      return s;
    }
    for (const ts of times) {
      const id = `sub-${s.id}-${ts}`;
      if (transactions.some((t) => t.id === id)) continue;
      const t: Transaction = {
        id,
        kind: 'expense',
        amount: s.amount,
        accountId: s.accountId,
        fee: '0',
        categoryId: s.categoryId,
        occurredAt: new Date(ts).toISOString(),
        note: `订阅自动扣款：${s.name}`,
        cnyRate: exact(fx.toDecimalPlaces(12)),
        subscriptionId: s.id,
      };
      transactions.push(t);
      charged++;
    }
    return { ...s, cursor: new Date(times.at(-1)!).toISOString() };
  });
  const changed = subscriptions.some((s, i) => s !== l.subscriptions[i]);
  return { ledger: changed ? { ...l, subscriptions, transactions } : l, charged, blocked };
}
