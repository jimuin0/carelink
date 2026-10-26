import { addDays } from './admin-date';

/** RFC 5545 hours are 00..23. SQL's end-of-day 24:00 is next-day 00:00. */
export function toIcalLocalDateTime(date: string, time: string): string {
  if (time === '24:00' || time === '24:00:00') return `${addDays(date, 1).replace(/-/g, '')}T000000`;
  const clock = (time.replace(/:/g, '') + '000000').slice(0, 6);
  return `${date.replace(/-/g, '')}T${clock}`;
}
