import { z } from 'zod';
import type { Ledger } from './domain';

const autoRateSchema = z.object({
  currency: z.enum(['USD', 'USDT', 'USDC', 'HKD', 'EUR']),
  value: z.string().regex(/^\d{1,6}(\.\d{1,12})?$/),
  source: z.string().min(1).max(200),
  asOf: z.string().datetime(),
});
export type AutoRate = z.infer<typeof autoRateSchema>;
export const autoRateCurrencies = ['USD', 'USDT', 'USDC', 'HKD', 'EUR'] as const;

// Non-CNY currencies the ledger actually holds or plans with.
export function ratesNeeded(l: Ledger) {
  const set = new Set<string>([
    ...l.accounts.map((a) => a.currency),
    ...l.holdings.map((h) => h.currency),
    ...l.plans.map((p) => p.amountCurrency),
  ]);
  set.delete('CNY');
  return [...set].filter((c) => (autoRateCurrencies as readonly string[]).includes(c));
}
// Fill missing rates and refresh automatic ones. Hand-entered rates are never replaced.
export function mergeAutoRates(l: Ledger, rates: AutoRate[]): Ledger {
  const needed = ratesNeeded(l);
  let changed = false;
  const next = [...l.rates];
  for (const r of rates) {
    if (!needed.includes(r.currency)) continue;
    const i = next.findIndex((x) => x.currency === r.currency);
    if (i >= 0 && !next[i].auto) continue;
    const row = { ...r, auto: true };
    if (i >= 0 && JSON.stringify(next[i]) === JSON.stringify(row)) continue;
    if (i >= 0) next[i] = row;
    else next.push(row);
    changed = true;
  }
  return changed ? { ...l, rates: next } : l;
}

let lastFetch = 0;
// Fetch when a needed rate is missing (at most every 2 minutes) or every 30 minutes otherwise.
export async function loadAutoRates(l: Ledger, now = Date.now()): Promise<AutoRate[] | null> {
  const needed = ratesNeeded(l);
  if (!needed.length) return null;
  const missing = needed.some((c) => !l.rates.some((r) => r.currency === c));
  const anyAuto = needed.some((c) => l.rates.some((r) => r.currency === c && r.auto));
  if (!missing && !anyAuto) return null;
  if (now - lastFetch < (missing ? 2 * 60000 : 30 * 60000)) return null;
  lastFetch = now;
  const res = await fetch('/api/rates', {
    signal: AbortSignal.timeout(20000),
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('自动汇率暂不可用，已保留原有汇率');
  return z.object({ rates: z.array(autoRateSchema).max(10) }).parse(await res.json()).rates;
}
