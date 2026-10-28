/** Minute-precision intervals in Japan. End is exclusive; 24:00 is midnight. */
export interface BookingInterval { start: number; end: number }

function localDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value / 60_000 : null;
}

function minute(value: string, isEnd: boolean): number | null {
  if (isEnd && (value === '24:00' || value === '24:00:00')) return 1440;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Explicit end date avoids mistaking corrupted old records for overnight bookings. */
export function bookingInterval(date: string, start: string, endDate: string, end: string): BookingInterval | null {
  const day = localDay(date); const endDay = localDay(endDate);
  const from = minute(start, false); const to = minute(end, true);
  if (day === null || endDay === null || from === null || to === null) return null;
  const first = day + from; const last = endDay + to;
  if (last <= first || last - first > 480) return null;
  return { start: first, end: last };
}

/** Symmetric buffer around existing intervals, including the adjacent day. */
export function bookingIntervalsConflict(candidate: BookingInterval, existing: BookingInterval, buffer: number): boolean {
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 120 ||
      !Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end) ||
      !Number.isSafeInteger(existing.start) || !Number.isSafeInteger(existing.end) ||
      candidate.start >= candidate.end || existing.start >= existing.end) return true;
  return candidate.start < existing.end + buffer && candidate.end + buffer > existing.start;
}
