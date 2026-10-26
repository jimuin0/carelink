import { confirmedBusinessWeek } from './business-hours';

/** Saving all seven days explicitly confirms the schedule; defaults are not facts. */
export function hasConfirmedBookingHours(value: unknown): boolean {
  return confirmedBusinessWeek(value);
}
