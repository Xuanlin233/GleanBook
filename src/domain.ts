import Decimal from 'decimal.js';
import { z } from 'zod';

Decimal.set({ precision: 160, rounding: Decimal.ROUND_HALF_UP });
export const D = (v: Decimal.Value) => new Decimal(v);
export const uid = () => crypto.randomUUID();
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_:-]+$/)
  .refine(
    (value) =>
      !Object.prototype.hasOwnProperty.call(Object.prototype, value) && value !== 'prototype',
    '记录 ID 使用了保留名称',
  );
const dec = z
  .string()
  .max(48)
  .regex(/^-?\d{1,24}(\.\d{1,18})?$/)
  .refine((v) => D(v).isFinite());
const nonneg = dec.refine((v) => D(v).gte(0), '请输入非负数');
const positive = dec.refine((v) => D(v).gt(0), '金额必须大于零');
// Calculated values can have more fractional places than any single input.
// Preserve them exactly in snapshots rather than rejecting or rounding them.
const computed = z
  .string()
  .max(330)
  .regex(/^-?\d{1,160}(\.\d{1,160})?$/);
const time = z.string().datetime({ offset: true });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const currencies = ['CNY', 'USD', 'USDT', 'USDC', 'HKD', 'EUR'] as const;
const currency = z.enum(currencies);
export const accountKinds = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  bank: '银行卡',
  manual: '其他账户',
  liability: '负债',
};
export const accountSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    kind: z.enum(['cash', 'wechat', 'alipay', 'bank', 'manual', 'liability']),
    currency,
    opening: dec,
    source: z.enum(['manual', 'external']),
    externalBalance: dec.optional(),
    updatedAt: time.optional(),
    externalKey: z.string().max(100).optional(),
  })
  .strict();
export const categorySchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(30),
    kind: z.enum(['income', 'expense']),
    icon: z.string().max(30),
  })
  .strict();
export const transactionSchema = z
  .object({
    id,
    kind: z.enum(['income', 'expense', 'transfer', 'refund', 'fee']),
    amount: positive,
    accountId: id,
    toAccountId: id.optional(),
    received: positive.optional(),
    fee: nonneg,
    categoryId: id.optional(),
    refundOf: id.optional(),
    occurredAt: time,
    note: z.string().max(500),
    cnyRate: positive,
    // Set on expenses created automatically by a subscription.
    subscriptionId: id.optional(),
  })
  .strict();
// Recurring subscription (订阅): on each billing day an expense is booked to its account.
export const subscriptionCycles = { monthly: '每月', yearly: '每年', weekly: '每周' } as const;
export const subscriptionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    amount: positive,
    accountId: id,
    categoryId: id,
    cycle: z.enum(['monthly', 'yearly', 'weekly']),
    // Day of month for monthly / yearly (31 = last day in shorter months).
    day: z.number().int().min(1).max(31).optional(),
    month: z.number().int().min(1).max(12).optional(),
    weekday: z.number().int().min(1).max(7).optional(),
    startDate: date,
    endDate: date.optional(),
    active: z.boolean(),
    timezone: z.string().max(80),
    // Billing time of the newest charge already booked.
    cursor: time.optional(),
    note: z.string().max(200),
    createdAt: time,
  })
  .strict();
const priceSchema = z
  .object({
    value: positive,
    currency,
    asOf: time,
    fetchedAt: time,
    source: z.string().trim().min(1).max(200),
    mode: z.enum(['official', 'manual', 'market']),
    change24h: dec.nullable().optional(),
    navDate: date.optional(),
  })
  .strict();
export const holdingSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['fund', 'crypto', 'earn', 'other']),
    symbol: z.string().trim().min(1).max(60),
    quantity: nonneg,
    cost: nonneg.nullable(),
    currency,
    source: z.enum(['manual', 'okx']),
    location: z.string().max(80),
    price: priceSchema.nullable(),
    externalKey: z.string().max(100).optional(),
    updatedAt: time.optional(),
    earnings: dec.nullable().optional(),
  })
  .strict();
export const investmentSchema = z
  .object({
    id,
    holdingId: id,
    kind: z.enum(['buy', 'sell', 'dividend', 'adjust', 'interest']),
    status: z.enum(['pending', 'confirmed']),
    quantity: dec,
    cash: nonneg,
    fee: nonneg,
    accountId: id.optional(),
    occurredAt: time,
    note: z.string().max(500),
  })
  .strict();
// Recurring investment (定投). Each due period becomes a planRun that snapshots the plan
// terms, so editing a plan only affects future periods.
export const planFrequencies = {
  daily: '每天',
  weekdays: '每个工作日',
  weekly: '每周',
  biweekly: '每两周',
  monthly: '每月',
} as const;
const planTerms = {
  sourceType: z.enum(['account', 'holding']),
  sourceId: id,
  targetId: id,
  // amount: spend a fixed sum of money each period; quantity: buy a fixed number of units.
  mode: z.enum(['amount', 'quantity']),
  amount: positive,
  // Money currency for mode=amount (source or target currency); target currency otherwise.
  amountCurrency: currency,
  // Percent, front-end load style: net = gross / (1 + rate).
  feeRate: nonneg.refine((v) => D(v).lte(10), '费率不应超过 10%'),
};
export const planSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(60),
    ...planTerms,
    frequency: z.enum(['daily', 'weekdays', 'weekly', 'biweekly', 'monthly']),
    weekday: z.number().int().min(1).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().max(80),
    startDate: date,
    endDate: date.optional(),
    // Skip periods that fall on weekends or mainland public holidays instead of running them.
    skipHolidays: z.boolean().optional(),
    active: z.boolean(),
    // Scheduled time of the newest period already generated.
    cursor: time.optional(),
    createdAt: time,
    note: z.string().max(500),
  })
  .strict();
export const planRunSchema = z
  .object({
    id,
    planId: id,
    planName: z.string().max(60),
    scheduledAt: time,
    status: z.enum(['pending', 'confirmed']),
    ...planTerms,
    // Settlement. sourceAmount is money for an account source, units for a holding source.
    sourceAmount: computed.optional(),
    targetQuantity: computed.optional(),
    // Gross cost in target currency, fee included.
    targetCost: computed.optional(),
    fee: computed.optional(),
    targetPrice: computed.optional(),
    sourcePrice: computed.optional(),
    // 1 unit of source currency = fxRate units of target currency, locked at settlement.
    fxRate: computed.optional(),
    priceNote: z.string().max(300).optional(),
    waiting: z.string().max(300).optional(),
    manual: z.boolean().optional(),
  })
  .strict();
const rateSchema = z
  .object({
    currency,
    value: positive,
    source: z.string().trim().min(1).max(200),
    asOf: time,
    // Filled from /api/rates. A rate without this flag was entered by hand and is never replaced.
    auto: z.boolean().optional(),
  })
  .strict();
const snapshotSchema = z
  .object({
    id,
    day: date,
    timezone: z.string().max(80),
    at: time,
    net: computed,
    assets: computed.refine((v) => D(v).gte(0)),
    liabilities: computed.refine((v) => D(v).gte(0)),
    complete: z.boolean(),
  })
  .strict();
export const ledgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    createdAt: time,
    accounts: z.array(accountSchema).max(1000),
    categories: z.array(categorySchema).max(1000),
    transactions: z.array(transactionSchema).max(50000),
    holdings: z.array(holdingSchema).max(5000),
    investments: z.array(investmentSchema).max(50000),
    plans: z.array(planSchema).max(500).default([]),
    subscriptions: z.array(subscriptionSchema).max(500).default([]),
    planRuns: z.array(planRunSchema).max(50000).default([]),
    rates: z.array(rateSchema).max(100),
    snapshots: z.array(snapshotSchema).max(20000),
    // Intraday net-worth observations for the "今日" chart: one per change, last 48 hours.
    intraday: z
      .array(z.object({ at: time, net: computed, complete: z.boolean() }).strict())
      .max(2000)
      .default([]),
    budgets: z
      .array(
        z
          .object({
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            categoryId: id.nullable(),
            amount: nonneg,
          })
          .strict(),
      )
      .max(10000),
    settings: z
      .object({
        theme: z.enum(['system', 'light', 'dark']),
        hideAmounts: z.boolean(),
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat('zh-CN', { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, '无效时区'),
        gainColor: z.enum(['green', 'red']),
        // Assets page: hide accounts and holdings worth less than ¥0.1.
        hideSmall: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type Ledger = z.infer<typeof ledgerSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Holding = z.infer<typeof holdingSchema>;
export type Investment = z.infer<typeof investmentSchema>;
export type Price = z.infer<typeof priceSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type PlanRun = z.infer<typeof planRunSchema>;
export type PlanTerms = Pick<
  Plan,
  'sourceType' | 'sourceId' | 'targetId' | 'mode' | 'amount' | 'amountCurrency' | 'feeRate'
>;

export function emptyLedger(): Ledger {
  return {
    schemaVersion: 1,
    revision: 0,
    createdAt: new Date().toISOString(),
    accounts: [],
    transactions: [],
    holdings: [],
    investments: [],
    plans: [],
    subscriptions: [],
    planRuns: [],
    rates: [],
    snapshots: [],
    intraday: [],
    budgets: [],
    categories: [
      ['food', '餐饮美食', 'expense', 'fork'],
      ['shop', '购物消费', 'expense', 'bag'],
      ['transport', '交通出行', 'expense', 'car'],
      ['home', '居家生活', 'expense', 'house'],
      ['fun', '休闲娱乐', 'expense', 'game'],
      ['health', '医疗健康', 'expense', 'heart'],
      ['other', '其他支出', 'expense', 'dots'],
      ['salary', '工资收入', 'income', 'wallet'],
      ['bonus', '奖金补贴', 'income', 'gift'],
      ['other-income', '其他收入', 'income', 'dots'],
    ].map(([id, name, kind, icon]) => ({ id, name, kind: kind as 'expense' | 'income', icon })),
    settings: {
      theme: 'system',
      hideAmounts: false,
      timezone: 'Asia/Shanghai',
      gainColor: 'green',
    },
  };
}
export function dayIn(at: string | Date, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const get = (k: string) => p.find((x) => x.type === k)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const monthIn = (at: string | Date, tz: string) => dayIn(at, tz).slice(0, 7);
export const money = (v: Decimal.Value, hide = false, unit = true) => {
  if (hide) return '••••••';
  const [integer, fraction] = D(v).toFixed(2).split('.');
  return `${unit ? '¥ ' : ''}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
};
export const exact = (v: Decimal.Value) => D(v).toFixed();
export function rateFor(l: Ledger, currency: string): Decimal | null {
  return currency === 'CNY'
    ? D(1)
    : l.rates.find((x) => x.currency === currency)
      ? D(l.rates.find((x) => x.currency === currency)!.value)
      : null;
}
export function accountBalance(l: Ledger, a: Account): Decimal {
  if (a.source === 'external') return D(a.externalBalance ?? '0');
  let bal = D(a.opening);
  for (const t of l.transactions) {
    if (t.accountId === a.id)
      bal = bal.plus(
        t.kind === 'income' || t.kind === 'refund'
          ? D(t.amount)
          : D(t.amount)
              .plus(t.kind === 'transfer' ? t.fee : 0)
              .neg(),
      );
    if (t.kind === 'transfer' && t.toAccountId === a.id) bal = bal.plus(t.received!);
  }
  for (const e of l.investments.filter((x) => x.accountId === a.id)) {
    if (e.kind === 'buy') bal = bal.minus(D(e.cash).plus(e.fee));
    if (e.status === 'confirmed' && (e.kind === 'sell' || e.kind === 'dividend'))
      bal = bal.plus(D(e.cash).minus(e.fee));
  }
  for (const r of l.planRuns)
    if (r.sourceType === 'account' && r.sourceId === a.id && r.sourceAmount !== undefined)
      bal = bal.minus(r.sourceAmount);
  return bal;
}
export function holdingPosition(l: Ledger, h: Holding) {
  let quantity = D(h.quantity),
    cost = h.cost === null ? null : D(h.cost),
    realized: Decimal | null = h.cost === null ? null : D(0),
    pending = D(0),
    interest = D(0);
  const events = [...l.investments.filter((x) => x.holdingId === h.id), ...planEvents(l, h)].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );
  for (const e of events) {
    if (e.status === 'pending') {
      if (e.kind === 'buy') pending = pending.plus(e.cash);
      continue;
    }
    if (e.kind === 'buy') {
      quantity = quantity.plus(e.quantity);
      if (cost !== null) cost = cost.plus(e.cash).plus(e.fee);
    }
    if (e.kind === 'sell') {
      const soldCost = cost === null || quantity.eq(0) ? null : cost.mul(e.quantity).div(quantity);
      if (soldCost !== null && realized !== null) {
        realized = realized.plus(D(e.cash).minus(e.fee).minus(soldCost));
        cost = cost!.minus(soldCost);
      }
      quantity = quantity.minus(e.quantity);
    }
    if (e.kind === 'dividend' && realized !== null) realized = realized.plus(e.cash).minus(e.fee);
    if (e.kind === 'adjust') quantity = quantity.plus(e.quantity);
    if (e.kind === 'interest') {
      quantity = quantity.plus(e.quantity);
      interest = interest.plus(e.quantity);
    }
    if (quantity.lt(0)) throw new Error('持仓份额不足，请检查交易时间和赎回数量');
  }
  return { quantity, cost, realized, pending, interest };
}
// A plan run acts as a buy on the target and, for a holding source, a sell on the source.
// A pending run counts only once its money is known: it is then pending principal, like a
// pending subscription, and the source account has already been charged.
function planEvents(l: Ledger, h: Holding): Investment[] {
  const events: Investment[] = [];
  for (const r of l.planRuns) {
    const base = { id: r.id, holdingId: h.id, occurredAt: r.scheduledAt, fee: '0', note: '' };
    if (r.targetId === h.id && r.targetCost !== undefined) {
      if (r.status === 'confirmed' && r.targetQuantity !== undefined)
        events.push({
          ...base,
          kind: 'buy',
          status: 'confirmed',
          quantity: r.targetQuantity,
          cash: r.targetCost,
        });
      else if (r.status === 'pending' && r.sourceAmount !== undefined)
        events.push({ ...base, kind: 'buy', status: 'pending', quantity: '0', cash: r.targetCost });
    }
    if (
      r.sourceType === 'holding' &&
      r.sourceId === h.id &&
      r.status === 'confirmed' &&
      r.sourceAmount !== undefined &&
      r.sourcePrice !== undefined
    )
      events.push({
        ...base,
        kind: 'sell',
        status: 'confirmed',
        quantity: r.sourceAmount,
        cash: D(r.sourceAmount).mul(r.sourcePrice).toFixed(),
      });
  }
  return events;
}
export function holdingValue(l: Ledger, h: Holding) {
  const p = holdingPosition(l, h),
    fx = rateFor(l, h.currency);
  if (!fx) return p.quantity.eq(0) && p.pending.eq(0) ? D(0) : null;
  if (!h.price) return p.quantity.eq(0) ? p.pending.mul(fx) : null;
  return p.quantity.mul(h.price.value).plus(p.pending).mul(fx);
}
export function totals(l: Ledger) {
  let assets = D(0),
    liabilities = D(0);
  const missing: string[] = [];
  const distribution: Record<string, Decimal> = {
    现金账户: D(0),
    基金: D(0),
    加密资产: D(0),
    简单赚币: D(0),
    其他资产: D(0),
  };
  for (const a of l.accounts) {
    const bal = accountBalance(l, a),
      fx = rateFor(l, a.currency);
    if (!fx && !bal.eq(0)) {
      missing.push(a.name + '：缺少 ' + a.currency + '/CNY 汇率');
      continue;
    }
    const v = bal.mul(fx ?? 1);
    if (v.lt(0)) liabilities = liabilities.plus(v.abs());
    else {
      assets = assets.plus(v);
      distribution.现金账户 = distribution.现金账户.plus(v);
    }
  }
  for (const h of l.holdings) {
    const v = holdingValue(l, h);
    if (v === null) {
      missing.push(h.name + '：缺少价格或汇率');
      continue;
    }
    assets = assets.plus(v);
    const key = { fund: '基金', crypto: '加密资产', earn: '简单赚币', other: '其他资产' }[h.kind];
    distribution[key] = distribution[key].plus(v);
  }
  return {
    assets,
    liabilities,
    net: assets.minus(liabilities),
    missing,
    complete: missing.length === 0,
    distribution,
  };
}
export function monthly(l: Ledger, month: string) {
  let income = D(0),
    expense = D(0);
  const categories: Record<string, Decimal> = Object.create(null);
  for (const t of l.transactions.filter(
    (t) => monthIn(t.occurredAt, l.settings.timezone) === month,
  )) {
    const amount = D(t.amount).mul(t.cnyRate);
    if (t.kind === 'income') income = income.plus(amount);
    else if (t.kind === 'expense' || t.kind === 'fee' || t.kind === 'refund') {
      const v = t.kind === 'refund' ? amount.neg() : amount;
      expense = expense.plus(v);
      const cat = t.categoryId ?? 'other';
      categories[cat] = (categories[cat] ?? D(0)).plus(v);
    } else if (t.kind === 'transfer') {
      const fee = D(t.fee).mul(t.cnyRate);
      expense = expense.plus(fee);
      categories.other = (categories.other ?? D(0)).plus(fee);
    }
  }
  const budget = l.budgets.find((x) => x.month === month && x.categoryId === null);
  return {
    income,
    expense,
    balance: income.minus(expense),
    categories,
    budget: budget ? D(budget.amount) : null,
    remaining: budget ? D(budget.amount).minus(expense) : null,
  };
}
export function validateLedger(raw: unknown): Ledger {
  const l = ledgerSchema.parse(raw);
  const all = [
    l.accounts,
    l.categories,
    l.transactions,
    l.holdings,
    l.investments,
    l.plans,
    l.subscriptions,
    l.planRuns,
    l.snapshots,
  ];
  for (const items of all)
    if (new Set(items.map((x) => x.id)).size !== items.length) throw new Error('存在重复记录 ID');
  if (new Set(l.rates.map((x) => x.currency)).size !== l.rates.length)
    throw new Error('汇率币种重复');
  if (l.rates.some((x) => x.currency === 'CNY' && !D(x.value).eq(1)))
    throw new Error('人民币汇率必须为 1');
  const acc = (aid: string) => {
    const a = l.accounts.find((a) => a.id === aid);
    if (!a) throw new Error('记录引用的账户不存在');
    return a;
  };
  for (const a of l.accounts) {
    if (
      a.source === 'external' &&
      (!a.externalKey || a.externalBalance === undefined || !a.updatedAt)
    )
      throw new Error('外部账户缺少余额快照');
    if (a.kind === 'liability' && D(a.opening).gt(0)) throw new Error('负债期初余额应小于或等于零');
  }
  for (const t of l.transactions) {
    const a = acc(t.accountId);
    if (a.currency === 'CNY' && !D(t.cnyRate).eq(1)) throw new Error('人民币账单汇率必须为 1');
    if (t.kind === 'transfer') {
      if (!t.toAccountId || !t.received || t.accountId === t.toAccountId)
        throw new Error('转账需要两个不同账户和转入金额');
      const b = acc(t.toAccountId);
      if (a.source === 'external' || b.source === 'external')
        throw new Error('同步账户余额只由外部快照更新，请勿记录本地划转');
      if (a.currency === b.currency && !D(t.amount).eq(t.received))
        throw new Error('同币种转账金额必须相同，手续费单独填写');
    } else {
      if (!D(t.fee).eq(0)) throw new Error('非转账手续费请单独记一笔');
      const cat = l.categories.find((c) => c.id === t.categoryId);
      if (!cat || cat.kind !== (t.kind === 'income' ? 'income' : 'expense'))
        throw new Error('请选择匹配的收支分类');
    }
    if (t.kind === 'refund') {
      const original = l.transactions.find((x) => x.id === t.refundOf && x.kind === 'expense');
      if (
        !original ||
        acc(original.accountId).currency !== a.currency ||
        t.categoryId !== original.categoryId
      )
        throw new Error('退款需关联同币种原支出，沿用原分类');
      if (t.occurredAt < original.occurredAt) throw new Error('退款时间不能早于原支出');
      const sum = l.transactions
        .filter((x) => x.kind === 'refund' && x.refundOf === original.id)
        .reduce((v, x) => v.plus(x.amount), D(0));
      if (sum.gt(original.amount)) throw new Error('累计退款超过原支出');
    }
  }
  for (const h of l.holdings) {
    if (h.price && h.price.currency !== h.currency) throw new Error('持仓价格币种不一致');
    if (
      h.price?.navDate &&
      (h.kind !== 'fund' ||
        h.price.currency !== 'CNY' ||
        h.price.navDate !== dayIn(h.price.asOf, 'Asia/Shanghai'))
    )
      throw new Error('基金净值日期与价格数据不一致');
    if (h.source === 'okx' && (!h.externalKey || !h.updatedAt))
      throw new Error('同步持仓缺少来源标识');
  }
  for (const e of l.investments) {
    const h = l.holdings.find((x) => x.id === e.holdingId);
    if (!h || h.source !== 'manual') throw new Error('投资操作需要手动持仓');
    if (e.status === 'pending' && !['buy', 'sell'].includes(e.kind))
      throw new Error('只有申购和赎回可待确认');
    if (['buy', 'sell'].includes(e.kind) && D(e.quantity).lte(0))
      throw new Error('申购赎回必须填写精确正份额');
    if (['buy', 'sell', 'dividend'].includes(e.kind)) {
      const a = e.accountId ? acc(e.accountId) : null;
      if (!a || a.source !== 'manual' || a.currency !== h.currency)
        throw new Error('请选择与持仓计价币种相同的手动结算账户');
    }
    if (e.kind === 'dividend' && (!D(e.quantity).eq(0) || D(e.cash).lt(e.fee)))
      throw new Error('现金分红份额应为 0，金额不可小于手续费');
    if (
      ['interest', 'adjust'].includes(e.kind) &&
      (!D(e.cash).eq(0) || !D(e.fee).eq(0) || e.accountId)
    )
      throw new Error('份额调整和利息不扣现金');
    if (e.kind === 'interest' && D(e.quantity).lte(0)) throw new Error('利息份额必须为正');
  }
  validatePlans(l);
  for (const s of l.subscriptions) {
    const a = acc(s.accountId);
    if (a.source !== 'manual') throw new Error('订阅扣款账户需要手动维护的账户');
    if (!l.categories.some((c) => c.id === s.categoryId && c.kind === 'expense'))
      throw new Error('订阅需要选择支出分类');
    if (s.cycle !== 'weekly' && !s.day) throw new Error('请选择订阅扣款日');
    if (s.cycle === 'yearly' && !s.month) throw new Error('请选择每年扣款的月份');
    if (s.cycle === 'weekly' && !s.weekday) throw new Error('请选择每周扣款的星期');
    if (s.endDate && s.endDate < s.startDate) throw new Error('订阅结束日期早于开始日期');
  }
  for (const t of l.transactions)
    if (t.subscriptionId && t.kind !== 'expense') throw new Error('订阅扣款只能是支出');
  l.holdings.forEach((h) => holdingPosition(l, h));
  for (const h of l.holdings) {
    const p = holdingPosition(l, h);
    const reserved = l.investments
      .filter((e) => e.holdingId === h.id && e.kind === 'sell' && e.status === 'pending')
      .reduce((v, e) => v.plus(e.quantity), D(0));
    if (reserved.gt(p.quantity)) throw new Error('待赎回份额超过可用持仓');
  }
  const budgetKeys = l.budgets.map((b) => b.month + ':' + (b.categoryId ?? 'total'));
  if (new Set(budgetKeys).size !== budgetKeys.length) throw new Error('预算设置重复');
  for (const b of l.budgets)
    if (b.categoryId && !l.categories.some((c) => c.id === b.categoryId && c.kind === 'expense'))
      throw new Error('预算引用无效分类');
  for (const s of l.snapshots) {
    try {
      new Intl.DateTimeFormat('zh', { timeZone: s.timezone });
    } catch {
      throw new Error('快照时区无效');
    }
    if (s.day !== dayIn(s.at, s.timezone)) throw new Error('快照日期与统计时区不一致');
    if (!D(s.net).eq(D(s.assets).minus(s.liabilities))) throw new Error('快照资产与净资产不一致');
  }
  if (new Set(l.snapshots.map((s) => s.timezone + ':' + s.day)).size !== l.snapshots.length)
    throw new Error('同一天同一时区只能保留一个快照');
  return l;
}
export function planEnds(l: Ledger, x: PlanTerms) {
  const target = l.holdings.find((h) => h.id === x.targetId);
  if (!target || target.source !== 'manual') throw new Error('定投去向需要手动维护的持仓');
  let sourceCurrency: Holding['currency'], sourceName: string;
  if (x.sourceType === 'account') {
    const a = l.accounts.find((a) => a.id === x.sourceId);
    if (!a || a.source !== 'manual' || a.kind === 'liability')
      throw new Error('定投来源需要手动维护的非负债账户');
    sourceCurrency = a.currency;
    sourceName = a.name;
  } else {
    const s = l.holdings.find((h) => h.id === x.sourceId);
    if (!s || s.source !== 'manual') throw new Error('定投来源持仓需要手动维护');
    if (s.id === target.id) throw new Error('定投来源与去向不能是同一持仓');
    sourceCurrency = s.currency;
    sourceName = s.name;
  }
  if (x.mode === 'amount' && ![sourceCurrency, target.currency].includes(x.amountCurrency))
    throw new Error('定额币种需为来源或去向的币种');
  if (x.mode === 'quantity' && x.amountCurrency !== target.currency)
    throw new Error('定份额计划的计价币种应为去向持仓币种');
  return { target, sourceCurrency, sourceName };
}
function validatePlans(l: Ledger) {
  for (const p of l.plans) {
    planEnds(l, p);
    if (['weekly', 'biweekly'].includes(p.frequency) && !p.weekday)
      throw new Error('每周定投需要选择星期');
    if (p.frequency === 'monthly' && !p.monthDay) throw new Error('每月定投需要选择日期');
    if (p.endDate && p.endDate < p.startDate) throw new Error('定投结束日期早于开始日期');
    try {
      new Intl.DateTimeFormat('zh', { timeZone: p.timezone });
    } catch {
      throw new Error('定投时区无效');
    }
  }
  for (const r of l.planRuns) {
    planEnds(l, r);
    if (
      r.status === 'confirmed' &&
      (r.sourceAmount === undefined ||
        r.targetQuantity === undefined ||
        r.targetCost === undefined ||
        (r.sourceType === 'holding' && r.sourcePrice === undefined))
    )
      throw new Error('已确认的定投记录缺少成交数据');
    for (const v of [r.sourceAmount, r.targetQuantity, r.targetCost, r.fee])
      if (v !== undefined && D(v).lt(0)) throw new Error('定投成交数据不能为负');
  }
  if (new Set(l.planRuns.map((r) => r.planId + '@' + r.scheduledAt)).size !== l.planRuns.length)
    throw new Error('同一计划同一时间只能有一期定投');
}
export const INTRADAY_KEEP_MS = 48 * 3600000;
// Record a point whenever net worth or completeness changes. Changes within the same minute
// replace the previous point so a burst of edits or price updates stays one point.
function captureIntraday(l: Ledger, at: string, net: string, complete: boolean) {
  const now = Date.parse(at),
    kept = l.intraday.filter((p) => now - Date.parse(p.at) < INTRADAY_KEEP_MS && p.at <= at),
    last = kept.at(-1);
  if (last && last.net === net && last.complete === complete) return kept;
  if (last && now - Date.parse(last.at) < 60000) kept.pop();
  return [...kept, { at, net, complete }].slice(-2000);
}
export function captureSnapshot(l: Ledger, at = new Date().toISOString()): Ledger {
  if (!l.accounts.length && !l.holdings.length) return l;
  const t = totals(l),
    day = dayIn(at, l.settings.timezone),
    sid = `${l.settings.timezone.replace(/\//g, '_')}:${day}`;
  return {
    ...l,
    intraday: captureIntraday(l, at, exact(t.net), t.complete),
    snapshots: [
      ...l.snapshots.filter((x) => x.id !== sid),
      {
        id: sid,
        day,
        timezone: l.settings.timezone,
        at,
        net: exact(t.net),
        assets: exact(t.assets),
        liabilities: exact(t.liabilities),
        complete: t.complete,
      },
    ],
  };
}
export const backupSchema = z
  .object({
    format: z.literal('shizhang-backup'),
    version: z.literal(1),
    exportedAt: time,
    ledger: ledgerSchema,
  })
  .strict();
export function parseBackup(text: string): Ledger {
  if (text.length > 20 * 1024 * 1024) throw new Error('备份不能超过 20 MB');
  const parsed = backupSchema.parse(JSON.parse(text));
  return validateLedger(parsed.ledger);
}
export function mergeBackup(current: Ledger, incoming: Ledger) {
  const next = structuredClone(current);
  let skipped = 0,
    added = 0;
  const conflicts: string[] = [];
  for (const key of [
    'accounts',
    'categories',
    'transactions',
    'holdings',
    'investments',
    'plans',
    'subscriptions',
    'planRuns',
    'snapshots',
  ] as const) {
    const dest = next[key] as { id: string }[];
    for (const row of incoming[key]) {
      const prev = dest.find((x) => x.id === row.id);
      if (!prev) {
        dest.push(row);
        added++;
      } else if (JSON.stringify(prev) === JSON.stringify(row)) skipped++;
      else conflicts.push(`${key}:${row.id}`);
    }
  }
  for (const key of ['rates', 'budgets'] as const) {
    const dest = next[key] as unknown as Record<string, unknown>[];
    for (const row of incoming[key]) {
      const k = key === 'rates' ? 'currency' : 'month';
      const prev = dest.find(
        (x) =>
          x[k] === (row as Record<string, unknown>)[k] &&
          (key === 'rates' || x.categoryId === (row as { categoryId: unknown }).categoryId),
      );
      if (!prev) {
        dest.push(row);
        added++;
      } else if (JSON.stringify(prev) === JSON.stringify(row)) skipped++;
      else conflicts.push(`${key}:${String((row as Record<string, unknown>)[k])}`);
    }
  }
  if (!conflicts.length) {
    try {
      validateLedger(next);
    } catch (e) {
      conflicts.push(e instanceof Error ? e.message : '合并数据关联校验失败');
    }
  }
  return { ledger: next, added, skipped, conflicts };
}
export function csvExport(l: Ledger) {
  const cell = (s: string) =>
    '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
  const rows = [
    [
      'ID',
      '类型',
      '金额',
      '币种',
      '日期时间',
      '分类',
      '账户',
      '转入账户',
      '转入金额',
      '手续费',
      '人民币汇率',
      '关联退款',
      '备注',
    ],
    ...l.transactions.map((t) => [
      t.id,
      { income: '收入', expense: '支出', transfer: '转账', refund: '退款', fee: '手续费' }[t.kind],
      t.amount,
      l.accounts.find((a) => a.id === t.accountId)!.currency,
      t.occurredAt,
      l.categories.find((c) => c.id === t.categoryId)?.name ?? '',
      l.accounts.find((a) => a.id === t.accountId)!.name,
      l.accounts.find((a) => a.id === t.toAccountId)?.name ?? '',
      t.received ?? '',
      t.fee,
      t.cnyRate,
      t.refundOf ?? '',
      t.note,
    ]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
