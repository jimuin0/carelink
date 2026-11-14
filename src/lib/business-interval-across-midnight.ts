import { businessIntervalFits, businessWindows, confirmedBusinessWeek } from './business-hours';

/** Check an interval expressed as minutes from the start of its booking day.
 * This does not authorize a booking or check staff, conflicts or date overrides.
 * Those must be checked atomically by the booking service before use.
 */
export function businessIntervalAcrossMidnightFits(hours: unknown, weekday: number, start: number, end: number): boolean {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= 1440 ||
      end <= start || end - start > 1440 || !confirmedBusinessWeek(hours)) return false;
  if (end <= 1440) return businessIntervalFits(hours, weekday, start, end);
  return businessWindows(hours, weekday).some(window => window.start <= start && window.end === 1440) &&
    businessWindows(hours, (weekday + 1) % 7).some(window => window.start === 0 && window.end >= end - 1440);
}
