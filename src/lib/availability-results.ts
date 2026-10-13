import { z } from 'zod';
import { databaseDiagnostic } from './database-diagnostic';

const staffPageSchema = z.array(z.object({ id: z.string().uuid() }));

/** Keep reading after short pages: PostgREST can cap rows below our page size. */
export async function readCompleteAvailabilityStaff(
  readPage: (afterId: string) => Promise<{ data: unknown; error: unknown }>,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor = '';
  // Bound public-request work; exhausting the budget is unknown, never "full".
  for (let page = 0; page < 100; page++) {
    const result = await readPage(cursor);
    if (result.error) throw databaseDiagnostic(result.error);
    const parsed = staffPageSchema.safeParse(result.data);
    if (!parsed.success) throw new Error('Availability staff page invalid');
    if (parsed.data.length === 0) return ids;
    for (const row of parsed.data) {
      if (row.id <= cursor) throw new Error('Availability staff cursor did not advance');
      ids.push(row.id);
      cursor = row.id;
    }
  }
  throw new Error('Availability staff read budget exhausted');
}

/** The SQL aggregate returns every calendar day, including days with zero slots. */
export function readCompleteMonthAvailability(raw: unknown, year: number, month: number): Map<string, number> {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const parsed = z.array(z.object({ d: z.string(), slots: z.number().int().nonnegative() })).length(days).safeParse(raw);
  if (!parsed.success) throw new Error('Availability month result incomplete');
  const expected = new Set(Array.from({ length: days }, (_, index) =>
    `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`));
  const counts = new Map<string, number>();
  for (const row of parsed.data) {
    if (!expected.has(row.d) || counts.has(row.d)) throw new Error('Availability month date invalid');
    counts.set(row.d, row.slots);
  }
  return counts;
}

export function countConfirmedAvailabilitySlots(raw: unknown): number {
  const parsed = z.array(z.object({ slot_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/) })).safeParse(raw);
  if (!parsed.success) throw new Error('Availability fallback result invalid');
  return parsed.data.length;
}
