import { businessPeriods, confirmedBusinessWeek, mergeBusinessWindows, periodWindow, WEEK_DAYS, type MinuteWindow } from './business-hours';

/** Reception closes before the actual end of each opening period, not before midnight.
 * null means the schedule or cutoff is invalid. This function does not authorize bookings.
 */
export function businessReceptionWindows(hours: unknown, weekday: number, cutoff: number): MinuteWindow[] | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      !Number.isInteger(cutoff) || cutoff < 0 || cutoff > 1440 || !confirmedBusinessWeek(hours)) return null;
  const week = hours as Record<string, unknown>;
  const windows: MinuteWindow[] = [];
  // Merge touching sessions before subtracting the cutoff. Otherwise a shop
  // open through midnight would incorrectly stop reception every midnight.
  // Two full weeks on each side also reveal a continuously open weekly cycle.
  for (let offset = -14; offset <= 14; offset++) {
    const day = ((weekday + offset) % 7 + 7) % 7;
    for (const period of businessPeriods(week[WEEK_DAYS[day]])!) {
      const window = periodWindow(period)!;
      windows.push({ start: window.start + offset * 1440, end: window.end + offset * 1440 });
    }
  }
  return mergeBusinessWindows(windows).flatMap(window => {
    // A period covering more than a week repeats without a closing time.
    const end = window.end - window.start > 7 * 1440 ? window.end : window.end - cutoff;
    const start = Math.max(0, window.start);
    const clippedEnd = Math.min(1440, end);
    return start < clippedEnd ? [{ start, end: clippedEnd }] : [];
  });
}
