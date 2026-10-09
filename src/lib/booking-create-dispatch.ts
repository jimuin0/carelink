import { Resend } from 'resend';
import { createServiceRoleClient } from './supabase-server';
import { dispatchEventEmail, eventEmailEnvelopeSchema } from './event-email-delivery';
import { sendResendForReconciliation } from './resend-result';
import { prepareBookingCreationChannel, sendBookingCreationLine } from './booking-create-notifications';
import { scheduleRetry } from './webhook-queue';
import { UUID_REGEX } from './constants';
import { safeCaptureException } from './safe';

export type BookingCreationDelivery = { accepted: number; pending: number; uncertain: number; skipped: number };
/** Fast path for the SAME committed jobs consumed by cron. Claim/start CAS fence precedes every provider effect. */
export async function dispatchBookingCreationNotifications(operationId: string): Promise<BookingCreationDelivery> {
  const result: BookingCreationDelivery = { accepted: 0, pending: 0, uncertain: 0, skipped: 0 };
  try {
    if (!UUID_REGEX.test(operationId)) throw new Error('invalid booking operation');
    const db = createServiceRoleClient();
    const { data: jobs, error } = await db.from('webhook_retry_queue').select('*')
      .eq('payload->>booking_create_operation', operationId).eq('status','pending').lte('scheduled_at', new Date().toISOString());
    if (error || !jobs) throw new Error('booking notification lookup unconfirmed');
    await Promise.all(jobs.map(async job => {
      const epoch = new Date().toISOString(); let attempted = false; let rejected = false;
      try {
        const { data: claimed, error: claimError } = await db.rpc('claim_webhook_retry_queue_v2', { p_job_ids:[job.id],p_claimed_at:epoch });
        if (claimError) throw new Error('booking notification claim unconfirmed');
        if (claimed?.length !== 1 || claimed[0].id !== job.id) { result.pending++; return; }
        // Use the authoritative current attempt/payload returned by claim, not the earlier lookup.
        job = claimed[0];
        let send: () => Promise<void>; let providerId: string | undefined;
        if (job.webhook_type === 'email') {
          const envelope = eventEmailEnvelopeSchema.parse(job.email_envelope);
          const payload = job.payload;
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || payload.idempotency_key !== `carelink-event-email/${job.id}`
            || job.target_id !== envelope.to || !process.env.RESEND_API_KEY) throw new Error('booking email preparation unconfirmed');
          const resend = new Resend(process.env.RESEND_API_KEY);
          send = async () => {
            const call = dispatchEventEmail(resend,envelope,job.id);
            const outcome = await sendResendForReconciliation(call); rejected = outcome === 'rejected';
            if (outcome !== 'delivered') throw new Error('booking email acceptance unconfirmed');
            const accepted = await call;
            if (!accepted.data || !UUID_REGEX.test(accepted.data.id)) throw new Error('booking email evidence invalid');
            providerId = accepted.data.id;
          };
        } else if (job.webhook_type === 'line_push') {
          const payload = job.payload;
          if (!process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK || typeof payload !== 'object' || payload === null || Array.isArray(payload)
            || typeof payload.message !== 'string') throw new Error('booking LINE preparation unconfirmed');
          const message = payload.message;
          send = async () => { if (!await sendBookingCreationLine(job.target_id,message)) throw new Error('booking LINE acceptance unconfirmed'); };
        } else send = await prepareBookingCreationChannel(job);
        const { data: rows, error: startError } = await db.rpc('start_booking_create_notification',{p_queue_id:job.id,p_claimed_at:epoch});
        if (startError) throw new Error('booking notification start unconfirmed');
        const fence = rows?.length === 1 ? rows[0] : null;
        if (fence?.outcome === 'not_owned') { result.pending++; return; }
        if (fence?.outcome === 'superseded') { result.skipped++; return; }
        if (fence?.outcome !== 'ready' || !fence.started_at || !Number.isFinite(Date.parse(fence.started_at))) throw new Error('booking notification start invalid');
        attempted = true; await send();
        const { data: marked, error: markError } = await db.from('webhook_retry_queue').update({ status:'success',delivered_at:new Date().toISOString(),
          processed_at:new Date().toISOString(),attempt_count:job.attempt_count+1,...(providerId?{provider_message_id:providerId}:{}) })
          .eq('id',job.id).eq('status','processing').eq('claimed_at',epoch).eq('delivery_started_at',fence.started_at).select('id');
        if (markError || marked?.length !== 1 || marked[0].id !== job.id) throw new Error('booking notification success record unconfirmed');
        result.accepted++;
      } catch {
        if (attempted && !rejected) result.uncertain++;
        else {
          const outcome = await scheduleRetry(job.id,job.attempt_count+1,'booking_create_delivery_unconfirmed',epoch);
          if (outcome === 'uncertain') result.uncertain++; else result.pending++;
        }
      }
    }));
  } catch { result.uncertain++; safeCaptureException(new Error('booking notification ledger unconfirmed'),'booking-create-dispatch'); }
  return result;
}
