import { z } from 'zod';

// Mainland China public holidays from the open holiday-cn dataset, which transcribes the
// State Council notices (the `papers` field links the gov.cn source). Free, no key.
// A year without any paper is not yet published: callers must treat its days as unknown.
const sources = [
  (y: number) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`,
  (y: number) => `https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`,
  (y: number) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`,
];
const yearSchema = z.object({
  year: z.number().int(),
  papers: z.array(z.string().max(300)).max(20),
  days: z
    .array(
      z.object({
        name: z.string().max(40),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        isOffDay: z.boolean(),
      }),
    )
    .max(80),
});
export type HolidayYear = {
  year: number;
  published: boolean;
  // Weekday dates on which the exchanges are closed. Weekends are always closed, and
  // make-up working Saturdays (调休) are still not trading days, so they are not listed.
  closed: string[];
  source: string;
};
export async function fetchHolidayYear(year: number): Promise<HolidayYear> {
  if (!Number.isInteger(year) || year < 2015 || year > new Date().getFullYear() + 1)
    throw new Error('年份超出范围');
  for (const source of sources) {
    try {
      const res = await fetch(source(year), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!res.ok) continue;
      const data = yearSchema.parse(await res.json());
      if (data.year !== year || data.days.some((d) => !d.date.startsWith(String(year)))) continue;
      return {
        year,
        published: data.papers.length > 0 && data.days.length > 0,
        closed: data.days
          .filter(
            (d) => d.isOffDay && ![0, 6].includes(new Date(d.date + 'T00:00:00Z').getUTCDay()),
          )
          .map((d) => d.date)
          .sort(),
        source: data.papers[0] ?? '尚未公布',
      };
    } catch {
      /* try the next mirror */
    }
  }
  throw new Error('节假日数据暂时无法获取');
}
export function createHolidayReader(
  loader: typeof fetchHolidayYear = fetchHolidayYear,
  clock = () => Date.now(),
) {
  const cache = new Map<number, { at: number; value: HolidayYear }>();
  return async (year: number) => {
    const hit = cache.get(year);
    // Published years are final; an unpublished year is re-checked a few times a day.
    if (hit && clock() - hit.at < (hit.value.published ? 7 * 86400000 : 6 * 3600000))
      return hit.value;
    const value = await loader(year);
    cache.set(year, { at: clock(), value });
    return value;
  };
}
