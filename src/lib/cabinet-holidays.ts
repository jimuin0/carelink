import type { HolidayCalendar } from './special-business-hours';

/** The Cabinet Office publishes complete annual lists, including substitute holidays. */
export const CABINET_HOLIDAY_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const MAX_BYTES = 100_000;
const CACHE_MS = 30 * 60 * 1000;
let cached: { calendar: HolidayCalendar; expiresAt: number } | null = null;
let pending: Promise<HolidayCalendar | null> | null = null;

/** Reject truncated or malformed files rather than assuming missing holidays are weekdays. */
export function parseCabinetHolidays(csv: string): HolidayCalendar | null {
  const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (rows[0] !== '国民の祝日・休日月日,国民の祝日・休日名称') return null;
  const counts = new Map<number, number>();
  const dates = new Set<string>();
  for (const row of rows.slice(1)) {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,\r\n]+)$/.exec(row);
    if (!match) return null;
    const year = Number(match[1]);
    const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || dates.has(date)) return null;
    dates.add(date);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  const years = [...counts.keys()].sort((a, b) => a - b);
  if (!years.length) return null;
  // Earlier years include different laws and one-off Olympics changes. Limit
  // automated coverage to modern full years and require all ordinary fixed
  // holidays. A changed law becomes unknown until the parser is reviewed.
  const fixedDates = ['01-01', '02-11', '02-23', '04-29', '05-03', '05-04', '05-05', '08-11', '11-03', '11-23'];
  const relevant = years.filter(year => year >= 2022);
  if (!relevant.length || relevant.some((year, i) =>
    fixedDates.some(day => !dates.has(`${year}-${day}`)) || counts.get(year)! < 14 ||
    (i > 0 && year !== relevant[i - 1] + 1))) return null;
  const complete = relevant;
  const from = `${complete[0]}-01-01`;
  const through = `${complete.at(-1)}-12-31`;
  return { from, through, dates: new Set([...dates].filter(date => date >= from && date <= through)) };
}

async function downloadCabinetHolidays(): Promise<HolidayCalendar | null> {
  try {
    const response = await fetch(CABINET_HOLIDAY_URL, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) return null;
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(chunk.value);
    }
    const text = new TextDecoder('shift_jis', { fatal: true });
    return parseCabinetHolidays(chunks.map(chunk => text.decode(chunk, { stream: true })).join('') + text.decode());
  } catch {
    return null;
  }
}

/** Reuse verified data briefly and coalesce simultaneous requests within this process. */
export async function fetchCabinetHolidays(): Promise<HolidayCalendar | null> {
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.calendar, dates: new Set(cached.calendar.dates) };
  }
  if (!pending) {
    pending = downloadCabinetHolidays().then(calendar => {
      if (calendar) cached = { calendar, expiresAt: Date.now() + CACHE_MS };
      return calendar;
    }).finally(() => { pending = null; });
  }
  const calendar = await pending;
  return calendar ? { ...calendar, dates: new Set(calendar.dates) } : null;
}
