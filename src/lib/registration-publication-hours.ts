import { z } from 'zod';
import { businessPeriods, confirmedBusinessWeek, WEEK_DAYS } from './business-hours';

/** Stable, explicit seven-day schedule for a new registration. Never infer
 * structured hours from the legacy free-text field. A null result must not be
 * used to authorize publication. */
type CanonicalDay = { open: string; close: string; periods?: { open: string; close: string }[] };
export function canonicalRegistrationHours(value: unknown): Record<string, CanonicalDay | null> | null {
  if (!confirmedBusinessWeek(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !(WEEK_DAYS as readonly string[]).includes(key))) return null;
  const result: Record<string, CanonicalDay | null> = {};
  for (const day of WEEK_DAYS) {
    // confirmedBusinessWeek already checked every day and period.
    const periods = businessPeriods(input[day])!;
    result[day] = periods.length === 0 ? null : periods.length === 1 ? periods[0] : { ...periods[0], periods };
  }
  return result;
}

// Drafts may contain incomplete values, but only known weekday/period fields.
// A draft is input data and never grants publication permission.
const periodDraft = z.object({ open: z.string().max(5), close: z.string().max(5) }).strict();
const dayDraft = periodDraft.extend({ periods: z.array(periodDraft).max(12).optional() }).strict().nullable();
export const registrationHoursDraftSchema = z.partialRecord(z.enum(WEEK_DAYS), dayDraft);
