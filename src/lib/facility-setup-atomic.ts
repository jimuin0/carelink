import { z } from 'zod';
import { businessTypes, UUID_REGEX } from './constants';
import type { createServiceRoleClient } from './supabase-server';
import { isSalonIntentProof, salonIntentProofHash } from './salon-submission-proof';

export const facilitySetupInput = z.object({
  facility_name: z.string().trim().min(1).max(200).optional(),
  business_type: z.string().refine(value => businessTypes.includes(value)).optional(),
  phone: z.string().trim().max(20).optional(),
  prefecture: z.string().trim().max(20).optional(),
  city: z.string().trim().max(50).optional(),
  address: z.string().trim().max(200).optional(),
  license_warranted: z.literal(true),
  intentId: z.string().regex(UUID_REGEX).optional(),
}).strict();

export type FacilitySetupClaim =
  | { mode: 'none' }
  | { mode: 'legacy'; receiptId: string; issuedAt: string }
  | { mode: 'intent'; intentId: string; proof: string };

export type FacilitySetupResult =
  | { state: 'invalid' }
  | { state: 'unverified' }
  | { state: 'conflict' }
  | { state: 'unknown' }
  | { state: 'created' | 'replay' | 'already_member'; facilityId: string; slug: string };

const resultSchema = z.object({
  outcome: z.enum(['created', 'replay', 'already_member']),
  facility_id: z.string().regex(UUID_REGEX), facility_slug: z.string().min(1).max(300),
}).strict();
const rejectedSchema = z.object({
  outcome: z.enum(['invalid', 'unverified', 'conflict']),
  facility_id: z.null(), facility_slug: z.null(),
}).strict();

/** Authenticated user comes from getUser, claim from a verified cookie. No email
 * selector, client user ID, multi-receipt merge, or compensating deletion. */
export async function setupFacilityAtomically(
  db: ReturnType<typeof createServiceRoleClient>, userId: string, input: unknown, claim: FacilitySetupClaim,
): Promise<FacilitySetupResult> {
  const parsed = facilitySetupInput.safeParse(input);
  if (!parsed.success || !UUID_REGEX.test(userId)) return { state: 'invalid' };
  if (claim.mode === 'intent' && (!isSalonIntentProof(claim.proof)
    || claim.intentId !== parsed.data.intentId || !UUID_REGEX.test(claim.intentId))) return { state: 'unverified' };
  if (claim.mode !== 'intent' && parsed.data.intentId !== undefined) return { state: 'unverified' };
  if (claim.mode === 'legacy' && (!UUID_REGEX.test(claim.receiptId)
    || !Number.isFinite(Date.parse(claim.issuedAt)))) return { state: 'unverified' };
  const { intentId: _intentId, license_warranted, ...profile } = parsed.data;
  try {
    const { data, error } = await db.rpc('setup_facility_from_registration', {
      p_user_id: userId, p_claim_mode: claim.mode,
      p_receipt_id: claim.mode === 'legacy' ? claim.receiptId : null,
      p_legacy_issued_at: claim.mode === 'legacy' ? claim.issuedAt : null,
      p_intent_id: claim.mode === 'intent' ? claim.intentId : null,
      p_proof_hash: claim.mode === 'intent' ? salonIntentProofHash(claim.proof) : null,
      p_profile: profile, p_license_warranted: license_warranted,
    });
    // Even a failure-shaped response can follow an accepted transaction if a
    // proxy lost the acknowledgement. Keep the capability and reconcile/replay.
    if (error || !Array.isArray(data) || data.length !== 1) return { state: 'unknown' };
    const success = resultSchema.safeParse(data[0]);
    if (success.success) return { state: success.data.outcome, facilityId: success.data.facility_id, slug: success.data.facility_slug };
    const rejected = rejectedSchema.safeParse(data[0]);
    return { state: rejected.success ? rejected.data.outcome : 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}
