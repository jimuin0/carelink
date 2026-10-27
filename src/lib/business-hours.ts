/** Weekly opening hours belong to the weekday on which each period starts.
 * An overnight period continues into the following calendar day, even when
 * that day's own opening periods are closed. No user/session state is cached.
 */
export interface BusinessPeriod { open: string; close: string }
export interface BusinessDay extends BusinessPeriod { periods?: BusinessPeriod[] }
export type BusinessWeek = Record<string, BusinessDay | null>;
export interface MinuteWindow { start: number; end: number }
export const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const MAX_BUSINESS_PERIODS = 12;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function businessMinute(value: unknown, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === '24:00') return 1440;
  if (typeof value !== 'string' || !CLOCK.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function periodWindow(period: BusinessPeriod): MinuteWindow | null {
  const start = businessMinute(period.open);
  const close = businessMinute(period.close, true);
  if (start === null || close === null || start === close) return null;
  return { start, end: close < start ? close + 1440 : close };
}

/** null means invalid; [] means an explicitly closed day. */
export function businessPeriods(value: unknown): BusinessPeriod[] | null {
  if (value === null) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const raw = record.periods === undefined ? [record] : record.periods;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BUSINESS_PERIODS) return null;
  const periods: BusinessPeriod[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { open, close } = entry as Record<string, unknown>;
    if (typeof open !== 'string' || typeof close !== 'string') return null;
    const period = { open, close };
    if (!periodWindow(period)) return null;
    periods.push(period);
  }
  return periods;
}

export function mergeBusinessWindows(windows: MinuteWindow[]): MinuteWindow[] {
  const merged: MinuteWindow[] = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged;
}

/** Actual calendar-day windows, including the previous opening day's tail.
 * Preserve the legacy unconstrained meaning of an absent schedule/day key.
 * Malformed explicit periods fail closed rather than opening the whole day.
 */
export function businessWindows(hours: unknown, day: number): MinuteWindow[] {
  if (!Number.isInteger(day) || day < 0 || day > 6) return [];
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return [{ start: 0, end: 1440 }];
  const week = hours as Record<string, unknown>;
  if (!Object.hasOwn(week, WEEK_DAYS[day])) return [{ start: 0, end: 1440 }];
  const raw = week[WEEK_DAYS[day]];
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) return [{ start: 0, end: 1440 }];
  if (raw && typeof raw === 'object' && !Object.hasOwn(raw, 'periods') &&
    ((raw as Record<string, unknown>).open == null || (raw as Record<string, unknown>).close == null)) return [{ start: 0, end: 1440 }];
  const current = businessPeriods(raw);
  if (current === null) return [];
  const windows = current.map(period => periodWindow(period)!).map(window => ({ start: window.start, end: Math.min(window.end, 1440) }));
  const previous = businessPeriods(week[WEEK_DAYS[(day + 6) % 7]]);
  for (const period of previous ?? []) {
    const window = periodWindow(period)!;
    if (window.end > 1440) windows.push({ start: 0, end: window.end - 1440 });
  }
  return mergeBusinessWindows(windows);
}

export function businessIntervalFits(hours: unknown, day: number, start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1440 && end > start
    && businessWindows(hours, day).some(window => start >= window.start && end <= window.end);
}

/** Valid complete week, with no overlapping periods across midnight/week ends. */
export function confirmedBusinessWeek(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const week = value as Record<string, unknown>;
  const windows: MinuteWindow[] = [];
  for (let day = 0; day < 7; day++) {
    if (!Object.hasOwn(week, WEEK_DAYS[day])) return false;
    const periods = businessPeriods(week[WEEK_DAYS[day]]);
    if (periods === null) return false;
    for (const period of periods) {
      const window = periodWindow(period)!;
      windows.push({ start: day * 1440 + window.start, end: day * 1440 + window.end });
    }
  }
  if (windows.length === 0) return false;
  const repeated = [...windows, ...windows.map(window => ({ start: window.start + 10080, end: window.end + 10080 }))]
    .sort((a, b) => a.start - b.start);
  return repeated.every((window, index) => index === 0 || repeated[index - 1].end <= window.start);
}

export function formatBusinessDay(value: unknown): string {
  const periods = businessPeriods(value);
  if (periods === null) return '未設定';
  if (periods.length === 0) return '休み';
  return [...periods].sort((a, b) => businessMinute(a.open)! - businessMinute(b.open)!).map(period => {
    if (period.open === '00:00' && period.close === '24:00') return '24時間営業';
    const nextDay = businessMinute(period.close, true)! < businessMinute(period.open)!;
    return `${period.open} 〜 ${nextDay ? '翌' : ''}${period.close}`;
  }).join(' ／ ');
}


/** Google LocalBusiness uses 00:00..23:59 for an all-day structured-data entry.
 * Keep the actual saved/displayed/booking closing time at 24:00.
 * https://developers.google.com/search/docs/appearance/structured-data/local-business#business-hours
 */
export function schemaBusinessPeriods(value: unknown): BusinessPeriod[] {
  return (businessPeriods(value) ?? []).map(period => ({ ...period, close: period.close === '24:00' ? '23:59' : period.close }));
}
