import type { SupabaseClient } from '@supabase/supabase-js';
import { fromEnv } from './email-from';
import { esc, escSubject } from './email';
import { UUID_REGEX } from './constants';
import { eventEmailEnvelopeSchema } from './event-email-delivery';

export type CouponEmailResult = 'queued' | 'already_notified' | 'uncertain';

/** The coupon owns the delivery identity, including every later cron invocation. */
export async function queueCustomerCouponEmail(db: SupabaseClient, input: {
  facilityId: string; facilityName: string; facilitySlug: string;
  email: string; customerName: string; daysSince: number; validUntil: string;
}): Promise<CouponEmailResult> {
  const reservation = await db.rpc('reserve_customer_coupon_email_atomic', {
    p_facility_id: input.facilityId, p_email: input.email, p_valid_until: input.validUntil,
  });
  if (reservation.error || reservation.data?.length !== 1) throw new Error('Coupon email reservation not confirmed');
  const row = reservation.data[0];
  if (row.state === 'already_notified') return 'already_notified';
  // A historical null marker does not establish that a provider never accepted the email.
  if (row.state === 'legacy_uncertain') return 'uncertain';
  if (row.state !== 'reserved' || typeof row.operation_id !== 'string' || !UUID_REGEX.test(row.operation_id)
    || typeof row.coupon_id !== 'string' || !UUID_REGEX.test(row.coupon_id)
    || typeof row.code !== 'string' || typeof row.valid_until !== 'string') throw new Error('Invalid coupon email reservation');
  const envelope = eventEmailEnvelopeSchema.parse({
    from: fromEnv(), to: input.email,
    subject: escSubject(`【${input.facilityName}】お久しぶりです！特別クーポンをお届けします`),
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <p>${esc(input.customerName || 'お客')}様</p>
      <p>前回のご来店から${input.daysSince}日が経ちました。お体の調子はいかがですか？</p>
      <p>${esc(input.facilityName)}から、特別割引クーポンをご用意いたしました。</p>
      <p>クーポンコード: <strong>${esc(row.code)}</strong></p>
      <p>500円引き｜有効期限: ${esc(row.valid_until)}</p>
      <p><a href="https://carelink-jp.com/facility/${encodeURIComponent(input.facilitySlug)}">ご予約・クーポン利用はこちら</a></p>
      <p>このメールは CareLink から自動送信されています。</p></div>`,
  });
  const prepared = await db.rpc('prepare_customer_coupon_email_atomic', {
    p_operation_id: row.operation_id, p_envelope: envelope,
  });
  if (prepared.error || prepared.data?.length !== 1 || prepared.data[0].id !== row.operation_id) {
    throw new Error('Coupon email publication not confirmed');
  }
  const status = prepared.data[0].status;
  if (status === 'success') return 'already_notified';
  if (status === 'failed' || status === 'uncertain') return 'uncertain';
  if (status !== 'pending' && status !== 'processing') throw new Error('Invalid coupon email publication');
  // The existing webhook worker owns dispatch, its persistent start fence and provider reconciliation.
  return 'queued';
}
