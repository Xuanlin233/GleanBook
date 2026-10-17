// Shared by the browser and the Node backend. No dependencies.
// Mainland fund NAVs for day D are published in the evening of D (QDII later).
// Before 18:00 Shanghai, or on weekends, the newest NAV that can exist is the previous weekday's.
// Holidays are not modelled: on a holiday this simply keeps checking every 30 minutes.
export const NAV_PUBLISH_HOUR = 18;
function shanghaiParts(at: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (k: string) => p.find((x) => x.type === k)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();
export function expectedNavDate(now = new Date()): string {
  const { day, hour } = shanghaiParts(now);
  let d = hour < NAV_PUBLISH_HOUR ? addDays(day, -1) : day;
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}
// A saved NAV older than the newest publishable one is checked again every 30 minutes;
// once current, the 6-hour interval applies.
export const fundRefreshInterval = (navDate: string | undefined, now = new Date()) =>
  navDate && navDate >= expectedNavDate(now) ? 6 * 3600000 : 30 * 60000;
