import { D, rateFor, type Ledger } from './domain';
import { tr } from './i18n';

const isAmount = (v: string) => /^\d+(\.\d+)?$/.test(v.trim()) && D(v).gt(0);
const places = (currency: string) => (['CNY', 'USD', 'HKD', 'EUR'].includes(currency) ? 2 : 8);
// Cross-currency transfer: the rate actually paid vs. the reference rate kept in the ledger
// (automatic central parity or a hand-entered rate). For gift cards and top-ups the gap is
// the real cost; it can be booked as a fee so it shows up in spending.
export function transferQuote(
  l: Ledger,
  from: string,
  toCurrency: string,
  amount: string,
  received: string,
) {
  if (!isAmount(amount) || !isAmount(received)) return null;
  const actual = D(amount).div(received);
  const rf = rateFor(l, from),
    rt = rateFor(l, toCurrency);
  const ref = rf && rt ? rt.div(rf) : null; // `from` units per 1 `toCurrency`
  const result: {
    actual: string;
    reference: string | null;
    premiumText: string;
    extra: { amount: string; principal: string } | null;
  } = {
    actual: actual.toDecimalPlaces(4).toFixed(),
    reference: null,
    premiumText: '',
    extra: null,
  };
  if (!ref) return result;
  const premium = actual.div(ref).minus(1).mul(100);
  result.reference = `1 ${toCurrency} = ${ref.toDecimalPlaces(4).toFixed()} ${from}`;
  result.premiumText = premium.abs().lt(0.05)
    ? tr('与参考汇率一致')
    : `${premium.gt(0) ? tr('溢价') : tr('折价')} ${premium.abs().toDecimalPlaces(2).toFixed()}%`;
  const principal = D(received).mul(ref).toDecimalPlaces(places(from)),
    extra = D(amount).minus(principal);
  if (extra.gt(0) && premium.gte(0.05))
    result.extra = { amount: extra.toFixed(), principal: principal.toFixed() };
  return result;
}
