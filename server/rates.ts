import { z } from 'zod';
import Decimal from 'decimal.js';
import { rateTicker } from './okx';

// Automatic CNY conversion rates. Fiat comes from the CFETS RMB central parity (published
// 9:15 Beijing time on trading days), falling back to ECB reference rates via Frankfurter.
// Stablecoins are never assumed to equal 1 USD: USDT/CNY = OKX USDT-USD × USD/CNY and
// USDC/CNY = OKX USDC-USDT × USDT/CNY.
export type AutoRate = { currency: string; value: string; source: string; asOf: string };
const positive = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,12})?$/)
  .refine((v) => new Decimal(v).gt(0));
async function getJSON(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!res.ok) throw new Error('汇率数据源暂不可用');
  return res.json();
}
async function cfets(): Promise<AutoRate[]> {
  const raw = z
    .object({
      data: z.object({ lastDate: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/) }),
      records: z.array(z.object({ vrtEName: z.string(), price: z.string() })),
    })
    .parse(
      await getJSON('https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/fx/ccpr.json', {
        'User-Agent': 'Mozilla/5.0',
      }),
    );
  const [day, time] = raw.data.lastDate.split(' ');
  const asOf = new Date(`${day}T${time.padStart(5, '0')}:00+08:00`).toISOString();
  return ['USD', 'EUR', 'HKD'].map((c) => {
    const row = raw.records.find((r) => r.vrtEName === `${c}/CNY`);
    if (!row) throw new Error('中间价缺少 ' + c);
    return {
      currency: c,
      value: positive.parse(row.price),
      source: `中国外汇交易中心人民币中间价 ${day}（自动）`,
      asOf,
    };
  });
}
async function ecb(): Promise<AutoRate[]> {
  const raw = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rates: z.object({
        CNY: z.number().positive(),
        EUR: z.number().positive(),
        HKD: z.number().positive(),
      }),
    })
    .parse(await getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD,EUR'));
  const cny = new Decimal(raw.rates.CNY),
    asOf = new Date(`${raw.date}T16:00:00+02:00`).toISOString(),
    source = `欧洲央行参考汇率 ${raw.date}（自动，中间价不可用时的备用）`;
  return [
    { currency: 'USD', value: cny.toDecimalPlaces(6).toFixed(), source, asOf },
    { currency: 'EUR', value: cny.div(raw.rates.EUR).toDecimalPlaces(6).toFixed(), source, asOf },
    { currency: 'HKD', value: cny.div(raw.rates.HKD).toDecimalPlaces(6).toFixed(), source, asOf },
  ];
}
async function okxLast(instrument: 'USDT-USD' | 'USDC-USDT') {
  const [row] = z
    .array(z.object({ last: positive, ts: z.string().regex(/^\d{13}$/) }))
    .min(1)
    .parse(await rateTicker(instrument));
  return row;
}
export async function fetchRates(): Promise<AutoRate[]> {
  let fiat: AutoRate[];
  try {
    fiat = await cfets();
  } catch {
    fiat = await ecb();
  }
  const usd = fiat.find((r) => r.currency === 'USD')!;
  const result = [...fiat];
  try {
    const usdtUsd = await okxLast('USDT-USD');
    const usdt = new Decimal(usdtUsd.last).mul(usd.value).toDecimalPlaces(6);
    result.push({
      currency: 'USDT',
      value: usdt.toFixed(),
      source: `OKX USDT-USD ${usdtUsd.last} × 美元汇率 ${usd.value}（自动）`,
      asOf: new Date(Number(usdtUsd.ts)).toISOString(),
    });
    const usdcUsdt = await okxLast('USDC-USDT');
    result.push({
      currency: 'USDC',
      value: new Decimal(usdcUsdt.last).mul(usdt).toDecimalPlaces(6).toFixed(),
      source: `OKX USDC-USDT ${usdcUsdt.last} × USDT 汇率 ${usdt.toFixed()}（自动）`,
      asOf: new Date(Number(usdcUsdt.ts)).toISOString(),
    });
  } catch {
    /* Stablecoin rates stay as they were; fiat rates are still useful. */
  }
  return result;
}
export function createRateReader(loader = fetchRates, clock = () => Date.now()) {
  let cached: { at: number; rates: AutoRate[] } | null = null,
    pending: Promise<AutoRate[]> | null = null;
  return async () => {
    if (cached && clock() - cached.at < 30 * 60000) return cached.rates;
    pending ??= loader()
      .then((rates) => {
        cached = { at: clock(), rates };
        return rates;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
