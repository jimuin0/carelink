/** Convert persisted Japanese local booking times without using the server's timezone. */
export function bookingCalendarTimes(date: string, start: string, end: string, endDate = date): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const day = new Date(`${date}T00:00:00Z`);
  const endDay = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date ||
      !Number.isFinite(endDay.getTime()) || endDay.toISOString().slice(0, 10) !== endDate) return null;
  const clock = /^(?:([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?|24:00(?::00)?)$/;
  const from = clock.exec(start);
  const to = clock.exec(end);
  if (!from || !to || start.startsWith('24:')) return null;
  const seconds = (match: RegExpExecArray) => match[1] === undefined ? 86400 :
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  const startSeconds = seconds(from);
  const endSeconds = seconds(to);
  const base = day.getTime() - 9 * 3_600_000;
  const finish = endDay.getTime() - 9 * 3_600_000 + endSeconds * 1000;
  if (finish <= base + startSeconds * 1000 || finish - (base + startSeconds * 1000) > 24 * 3_600_000) return null;
  return { start: new Date(base + startSeconds * 1000).toISOString(), end: new Date(finish).toISOString() };
}
