import { businessPeriods, businessWindows, confirmedBusinessWeek, mergeBusinessWindows, type BusinessDay, type MinuteWindow, WEEK_DAYS } from './business-hours';

/** Optional per-facility settings. A null override closes the entire calendar day. */
export interface SpecialBusinessHours {
  dates: Record<string, BusinessDay | null>;
  closeOnPublicHolidays: boolean;
}

/** Missing dates are known non-holidays only inside the verified coverage. */
export interface HolidayCalendar {
  from: string;
  through: string;
  dates: ReadonlySet<string>;
}

function parsedDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? parsed : null;
}

/** Calendar-day windows after applying explicit dates and a trusted holiday calendar.
 * null means that the data is incomplete; [] means confirmed closed.
 */
export function specialBusinessWindows(
  hours: unknown, date: string, settings: SpecialBusinessHours | null,
  publicHolidays: HolidayCalendar | null,
): MinuteWindow[] | null {
  const current = parsedDate(date);
  if (!current || !confirmedBusinessWeek(hours)) return null;
  if (settings && Object.hasOwn(settings.dates, date) && settings.dates[date] === null) return [];
  const previous = new Date(current.getTime() - 86_400_000).toISOString().slice(0, 10);
  const days = [previous, date];
  const week = { ...(hours as Record<string, BusinessDay | null>) };
  for (let offset = 0; offset < 2; offset++) {
    const d = days[offset];
    const key = WEEK_DAYS[(current.getUTCDay() + 6 + offset) % 7];
    if (settings && Object.hasOwn(settings.dates, d)) {
      const override = settings.dates[d];
      if (businessPeriods(override) === null) return null;
      if (offset === 1 && override === null) return [];
      week[key] = override;
    } else if (settings?.closeOnPublicHolidays) {
      if (publicHolidays === null || !parsedDate(publicHolidays.from) || !parsedDate(publicHolidays.through) ||
          d < publicHolidays.from || d > publicHolidays.through) return null;
      if (publicHolidays.dates.has(d)) {
        if (offset === 1) return [];
        week[key] = null;
      }
    }
  }
  return businessWindows(week, current.getUTCDay());
}

/** Reception windows for a calendar date, including special closures.
 * The closing offset is measured from the end of a continuous opening, not
 * from midnight. Unknown holiday data never becomes a positive claim.
 */
export function specialReceptionWindows(
  hours: unknown, date: string, settings: SpecialBusinessHours | null,
  publicHolidays: HolidayCalendar | null, cutoff: number,
): MinuteWindow[] | null {
  const current = parsedDate(date);
  if (!current || !Number.isInteger(cutoff) || cutoff < 0 || cutoff > 1440) return null;
  const spans: MinuteWindow[] = [];
  // cutoff is at most one day: looking two days ahead prevents a continuous
  // opening from acquiring an artificial deadline at the edge of the range.
  for (let offset = -1; offset <= 2; offset++) {
    const d = new Date(current.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const windows = specialBusinessWindows(hours, d, settings, publicHolidays);
    if (windows === null) return null;
    spans.push(...windows.map(window => ({ start: window.start + offset * 1440, end: window.end + offset * 1440 })));
  }
  return mergeBusinessWindows(spans).flatMap(span => {
    const start = Math.max(0, span.start);
    const end = Math.min(1440, span.end - cutoff);
    return start < end ? [{ start, end }] : [];
  });
}

/** Check all calendar days touched by one appointment; null means unknown. */
export function specialBusinessIntervalFits(
  hours: unknown, date: string, start: number, end: number,
  settings: SpecialBusinessHours | null, publicHolidays: HolidayCalendar | null,
): boolean | null {
  const current = parsedDate(date);
  if (!current || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || start >= 1440 || end <= start || end - start > 1440) return null;
  const today = specialBusinessWindows(hours, date, settings, publicHolidays);
  if (today === null) return null;
  if (end <= 1440) return today.some(window => window.start <= start && end <= window.end);
  const tomorrow = new Date(current.getTime() + 86_400_000).toISOString().slice(0, 10);
  const next = specialBusinessWindows(hours, tomorrow, settings, publicHolidays);
  if (next === null) return null;
  return today.some(window => window.start <= start && window.end === 1440) &&
    next.some(window => window.start === 0 && window.end >= end - 1440);
}

/** Public status is based on JST, independent of the visitor's device zone. */
export function specialReceptionStatus(
  hours: unknown, settings: SpecialBusinessHours | null, publicHolidays: HolidayCalendar | null,
  cutoff: number | null, timestamp: number,
): 'open' | 'reception_closed' | 'closed' | 'unknown' {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return 'unknown';
  const now = new Date(timestamp + 9 * 3_600_000);
  if (!Number.isFinite(now.getTime())) return 'unknown';
  const date = now.toISOString().slice(0, 10);
  const opening = specialBusinessWindows(hours, date, settings, publicHolidays);
  if (opening === null) return 'unknown';
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!opening.some(window => window.start <= minute && minute < window.end)) return 'closed';
  if (cutoff === null) return 'open';
  const reception = specialReceptionWindows(hours, date, settings, publicHolidays, cutoff);
  if (reception === null) return 'unknown';
  return reception.some(window => window.start <= minute && minute < window.end) ? 'open' : 'reception_closed';
}

