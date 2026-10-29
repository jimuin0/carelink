import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX } from './constants';

type Db = ReturnType<typeof createServiceRoleClient>;
/** A private receipt-scoped marker is only an eligibility hint. The atomic
 * setup RPC independently rechecks the capability, consent and verified email. */
export async function registrationPublicationAvailable(db: Db, receiptId: string): Promise<boolean> {
  if (!UUID_REGEX.test(receiptId)) throw new Error('REGISTRATION_PUBLICATION_UNAVAILABLE');
  const result = await db.from('salon_registration_publication').select('receipt_id').eq('receipt_id', receiptId).maybeSingle();
  if (result.error !== null) throw new Error('REGISTRATION_PUBLICATION_UNAVAILABLE');
  if (result.data === null) return false;
  if (result.data.receipt_id !== receiptId) throw new Error('REGISTRATION_PUBLICATION_UNAVAILABLE');
  return true;
}
