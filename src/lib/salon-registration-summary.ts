import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { readSalonIntentStatus } from './salon-submission-intent';

const summary = z.object({
  facility_name: z.string().min(1).max(200), business_type: z.string().min(1).max(100),
  address: z.string().max(500).nullable(),
}).strict();
export type SalonRegistrationSummary =
  | { state: 'unverified' | 'unavailable' | 'uncommitted' | 'expired' }
  | { state: 'confirmed'; receiptId: string; name: string; type: string; area: string };

/** A selector is not permission. Prove the selected intent, its server lifetime
 * and committed receipt before reading just the three handoff display fields.
 * No email, phone, proof, HMAC, or arbitrary applicant row is returned. */
export async function readSalonRegistrationSummary(
  db: ReturnType<typeof createServiceRoleClient>, intentId: string, proof: unknown,
): Promise<SalonRegistrationSummary> {
  try {
    const status = await readSalonIntentStatus(db, intentId, proof);
    if (status.state !== 'committed') return status;
    const result = await db.from('salons').select('facility_name,business_type,address')
      .eq('id', status.receiptId).maybeSingle();
    const parsed = summary.safeParse(result.data);
    if (result.error !== null || !parsed.success) return { state: 'unavailable' };
    return { state: 'confirmed', receiptId: status.receiptId, name: parsed.data.facility_name,
      type: parsed.data.business_type, area: parsed.data.address ?? '' };
  } catch {
    return { state: 'unavailable' };
  }
}
