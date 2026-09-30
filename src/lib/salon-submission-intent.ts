import { randomBytes, randomUUID } from 'node:crypto';
import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX } from './constants';
import { SALON_CANONICAL_VERSION } from './salon-submission-contract';
import {
  isSalonIntentProof, salonIntentProofHash, SALON_HMAC_SCHEME, SALON_INTENT_TTL_SECONDS, SALON_PREPARE_TTL_SECONDS,
} from './salon-submission-proof';

type Database = ReturnType<typeof createServiceRoleClient>;

export type SalonIntentStatus =
  | { state: 'unverified' | 'unavailable' | 'expired' | 'uncommitted' }
  | { state: 'committed'; receiptId: string };

/** No applicant data or notification is created during preparation. The proof
 * must be returned only as an intent-specific HttpOnly cookie, never JSON. */
export async function prepareSalonIntent(db: Database): Promise<
  | { state: 'prepared'; intentId: string; proof: string; expiresAt: string }
  | { state: 'unavailable' }
> {
  const intentId = randomUUID();
  const proof = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SALON_PREPARE_TTL_SECONDS * 1000).toISOString();
  try {
    const { data, error } = await db.from('salon_submission_intents').insert({
      id: intentId, proof_hash: salonIntentProofHash(proof),
      canonical_version: SALON_CANONICAL_VERSION, hmac_scheme: SALON_HMAC_SCHEME,
      created_at: createdAt.toISOString(), prepare_expires_at: expiresAt,
    }).select('id').single();
    if (error || data?.id !== intentId) return { state: 'unavailable' };
    return { state: 'prepared', intentId, proof, expiresAt };
  } catch {
    // The insert may have committed, but without its browser capability it can
    // never become an application. Do not log raw DB errors or expose a proof.
    return { state: 'unavailable' };
  }
}

/** Capability checked in the query itself. An unknown ID and a wrong proof
 * are indistinguishable; no applicant data or payload HMAC is returned. */
export async function readSalonIntentStatus(
  db: Database, intentId: string, proof: unknown, now = Date.now(),
): Promise<SalonIntentStatus> {
  if (!UUID_REGEX.test(intentId) || !isSalonIntentProof(proof)) return { state: 'unverified' };
  try {
    const { data, error } = await db.from('salon_submission_intents')
      .select('salon_id,committed_at,created_at,prepare_expires_at,canonical_version,hmac_scheme')
      .eq('id', intentId).eq('proof_hash', salonIntentProofHash(proof)).maybeSingle();
    if (error) return { state: 'unavailable' };
    if (!data) return { state: 'unverified' };
    if (data.canonical_version !== SALON_CANONICAL_VERSION || data.hmac_scheme !== SALON_HMAC_SCHEME) {
      return { state: 'unavailable' };
    }
    const issuedAt = Date.parse(data.created_at);
    if (!Number.isFinite(issuedAt)) return { state: 'unavailable' };
    // Cookie expiry is not an authorization boundary: a copied cookie can be
    // sent manually. The database issue time independently limits access.
    if (issuedAt > now || issuedAt + SALON_INTENT_TTL_SECONDS * 1000 <= now) return { state: 'unverified' };
    if (data.salon_id !== null || data.committed_at !== null) {
      if (typeof data.salon_id !== 'string' || !UUID_REGEX.test(data.salon_id)
        || typeof data.committed_at !== 'string' || !Number.isFinite(Date.parse(data.committed_at))) {
        return { state: 'unavailable' };
      }
      return { state: 'committed', receiptId: data.salon_id };
    }
    const expiresAt = Date.parse(data.prepare_expires_at);
    if (!Number.isFinite(expiresAt)) return { state: 'unavailable' };
    return { state: expiresAt <= now ? 'expired' : 'uncommitted' };
  } catch {
    return { state: 'unavailable' };
  }
}
