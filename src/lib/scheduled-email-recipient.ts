import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const reference = z.discriminatedUnion('scheduled_kind', [
  z.object({ scheduled_email_version:z.literal(1),scheduled_kind:z.literal('review_request') }),
  z.object({ scheduled_email_version:z.literal(1),scheduled_kind:z.literal('favorites_digest'),scheduled_user_id:z.uuid() }),
]);

/** The digest destination comes from Auth, never a self-editable profile email.
 * An unavailable Auth lookup is retryable BEFORE the persistent dispatch fence. */
export async function checkScheduledEmailRecipient(db: SupabaseClient,payload:unknown,target: string):Promise<boolean> {
  const ref=reference.parse(payload);
  if(ref.scheduled_kind==='review_request') return true;
  const {data,error}=await db.auth.admin.getUserById(ref.scheduled_user_id);
  if(error || !data.user) throw new Error('scheduled email recipient identity unavailable');
  return data.user.id===ref.scheduled_user_id && data.user.email===target
    && typeof data.user.email_confirmed_at==='string' && Number.isFinite(Date.parse(data.user.email_confirmed_at));
}
