import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { businessTypes, UUID_REGEX } from './constants';
import { salonIntentProofHash } from './salon-submission-proof';

export const SALON_RECOVERY_TTL = 72 * 60 * 60;
export function salonRecoveryCookieName(id: string): string {
  if (!UUID_REGEX.test(id)) throw new Error('Invalid recovery selector');
  return `carelink_salon_recovery_${id.toLowerCase()}`;
}
export const salonRecoveryInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), after: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('prepare'), receiptId: z.uuid() }).strict(),
  z.object({ action: z.literal('summary'), recoveryId: z.uuid() }).strict(),
]);
const receipt = z.object({ receipt_id: z.uuid(), facility_name: z.string().min(1).max(200),
  business_type: z.string().refine(value => businessTypes.includes(value)),
  created_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const prepared = z.object({ outcome: z.literal('prepared'), grant_id: z.uuid(),
  expires_at: z.string().datetime({ offset: true }),
}).strict();
const unavailable = z.object({ outcome: z.literal('unverified'), grant_id: z.null(), expires_at: z.null() }).strict();
const summary = z.object({ outcome: z.literal('confirmed'), receipt_id: z.uuid(),
  facility_name: z.string().min(1).max(200), business_type: z.string().refine(value => businessTypes.includes(value)),
  address: z.string().nullable(),
}).strict();
const absent = z.object({ outcome: z.literal('unverified'), receipt_id: z.null(),
  facility_name: z.null(), business_type: z.null(), address: z.null() }).strict();
type Db = ReturnType<typeof createServiceRoleClient>;
// Provider messages/details/hints can include identifiers or customer fields.
// Only fixed diagnostic codes enter server logs; the public API stays generic.
const RECOVERY_DIAGNOSTIC_CODES = new Set([
  '08006', '40001', '40P01', '42501', '53300', '55P03', '57014', '57P01',
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', 'PGRST116', 'PGRST202', 'PGRST301',
]);

/** These service-only RPCs authorize the current confirmed Auth row again under
 * lock. No caller email/user selector, aliases, direct Auth grants or auto-claim. */
export async function listSalonRecovery(db: Db, userId: string, after?: string) {
  const { data, error } = await db.rpc('list_recoverable_salon_receipts', { p_user_id: userId, ...(after ? { p_after_id: after } : {}) });
  if (error?.code === '42501' && error.message === 'REGISTRATION_ACCOUNT_UNVERIFIED') return { state: 'unverified' as const };
  if (error) {
    const code = RECOVERY_DIAGNOSTIC_CODES.has(error.code) ? error.code : 'unclassified';
    throw new Error(`Registration recovery list unavailable [${code}]`);
  }
  const parsed = z.array(receipt).max(51).safeParse(data);
  if (!parsed.success) throw new Error('Invalid registration recovery list');
  const rows = parsed.data.slice(0, 50);
  return { state: 'ready' as const, receipts: rows,
    next: parsed.data.length === 51 ? rows[49].receipt_id : null };
}

export async function prepareSalonRecovery(db: Db, userId: string, receiptId: string, recoveryId: string, proof: string) {
  const { data, error } = await db.rpc('prepare_salon_recovery', { p_user_id: userId, p_receipt_id: receiptId,
    p_grant_id: recoveryId, p_proof_hash: salonIntentProofHash(proof) });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Registration recovery preparation unavailable');
  const denied = unavailable.safeParse(data[0]);
  if (denied.success) return { state: 'unverified' as const };
  const parsed = prepared.safeParse(data[0]);
  if (!parsed.success || parsed.data.grant_id !== recoveryId
    || Date.parse(parsed.data.expires_at) <= Date.now()
    || Date.parse(parsed.data.expires_at) > Date.now() + (SALON_RECOVERY_TTL + 60) * 1000) {
    throw new Error('Invalid registration recovery preparation');
  }
  return { state: 'prepared' as const, recoveryId, expiresAt: parsed.data.expires_at };
}

export async function readSalonRecovery(db: Db, userId: string, recoveryId: string, proof: string) {
  const { data, error } = await db.rpc('read_salon_recovery', { p_user_id: userId,
    p_grant_id: recoveryId, p_proof_hash: salonIntentProofHash(proof) });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Registration recovery summary unavailable');
  if (absent.safeParse(data[0]).success) return { state: 'unverified' as const };
  const parsed = summary.safeParse(data[0]);
  if (!parsed.success) throw new Error('Invalid registration recovery summary');
  return { state: 'confirmed' as const, receiptId: parsed.data.receipt_id,
    name: parsed.data.facility_name, type: parsed.data.business_type, address: parsed.data.address };
}
