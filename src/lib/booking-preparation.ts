const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Saving all seven days explicitly confirms the schedule; defaults are not facts. */
export function hasConfirmedBookingHours(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hours = value as Record<string, unknown>;
  let openDays = 0;
  for (const day of DAYS) {
    if (!Object.prototype.hasOwnProperty.call(hours, day)) return false;
    const entry = hours[day];
    if (entry === null) continue;
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    const window = entry as Record<string, unknown>;
    if (typeof window.open !== 'string' || typeof window.close !== 'string'
      || !TIME.test(window.open) || !TIME.test(window.close) || window.open >= window.close) return false;
    openDays++;
  }
  return openDays > 0;
}
