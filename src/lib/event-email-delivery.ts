import type { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { createServiceRoleClient } from './supabase-server';
import { sendResendForReconciliation } from './resend-result';
import { safeCaptureException } from './safe';
import { postAlert } from './alert';
import { z } from 'zod';
import { UUID_REGEX } from './constants';

export type EventEmailEnvelope = { from: string; to: string; subject: string; html: string };
export const eventEmailEnvelopeSchema = z.object({ from: z.string().min(1).max(320), to: z.email().max(254),
  subject: z.string().min(1).max(200), html: z.string().min(1).max(100000) }).strict();

export function dispatchEventEmail(resend: Resend, envelope: EventEmailEnvelope, id: string) {
  if (!UUID_REGEX.test(id) || !eventEmailEnvelopeSchema.safeParse(envelope).success) throw new Error('invalid event email');
  // resend-checked: both dispatch owners pass this promise to sendResendForReconciliation and require a provider UUID before recording acceptance.
  return resend.emails.send({ ...envelope, tags: [{ name: 'carelink_event_operation', value: id }] }, {
    idempotencyKey: `carelink-event-email/${id}`,
  });
}

/** Single-event notifications: record and fence even the first provider call.
 * Unknown acceptance never creates a second queue job or resets the fence.
 * Resend's finite idempotency window is not a substitute for this ledger.
 */
export async function sendDurableEventEmail(resend: Resend, envelope: EventEmailEnvelope, context: string): Promise<boolean> {
  const id = randomUUID();
  const claimEpoch = new Date().toISOString();
  const key = `carelink-event-email/${id}`;
  const fail = () => {
    const error = new Error('event email acceptance or ledger transition not confirmed');
    safeCaptureException(error, `email:${context}`);
    postAlert({ level: 'error', message: `通知メールの結果未確認（${context}）。送達台帳を照合してください。`, route: `email:${context}`,
      extra: { operationId: id }, env: process.env.VERCEL_ENV });
    return false;
  };
  try {
    const db = createServiceRoleClient();
    const { data: reserved, error: reserveError } = await db.from('webhook_retry_queue').insert({
      id, webhook_type: 'email', target_id: envelope.to,
      payload: { event_email_version: 1, idempotency_key: key }, email_envelope: envelope,
      status: 'processing', claimed_at: claimEpoch, delivery_started_at: null,
      attempt_count: 0, max_attempts: 3, scheduled_at: claimEpoch,
    }).select('id').single();
    if (reserveError || reserved?.id !== id) return fail();
    const { data: started, error: startError } = await db.from('webhook_retry_queue')
      .update({ delivery_started_at: claimEpoch }).eq('id', id).eq('status', 'processing')
      .eq('claimed_at', claimEpoch).is('delivery_started_at', null).select('id').maybeSingle();
    if (startError || started?.id !== id) return fail();
    const sendCall = dispatchEventEmail(resend, envelope, id);
    const outcome = await sendResendForReconciliation(sendCall);
    if (outcome === 'uncertain') return fail();
    if (outcome === 'rejected') {
      // Only a definitive provider rejection permits automatic retry. Store
      // the same envelope/key; a later worker must not regenerate them.
      const { data: pending, error } = await db.from('webhook_retry_queue').update({
        status: 'pending', claimed_at: null, delivery_started_at: null, attempt_count: 1,
        scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(), last_error: 'provider_rejected',
      }).eq('id', id).eq('status', 'processing').eq('claimed_at', claimEpoch)
        .eq('delivery_started_at', claimEpoch).select('id').maybeSingle();
      if (error || pending?.id !== id) return fail();
      return fail();
    }
    const accepted = await sendCall;
    if (!accepted.data || !UUID_REGEX.test(accepted.data.id)) return fail();
    const { data: completed, error } = await db.from('webhook_retry_queue').update({
      status: 'success', delivered_at: new Date().toISOString(), processed_at: new Date().toISOString(),
      provider_message_id: accepted.data.id, attempt_count: 1, last_error: null,
    }).eq('id', id).eq('status', 'processing').eq('claimed_at', claimEpoch)
      .eq('delivery_started_at', claimEpoch).select('id').maybeSingle();
    return !error && completed?.id === id ? true : fail();
  } catch {
    return fail();
  }
}

/** Provider read only. An ID, 404, expired key or different envelope never
 * releases an unknown job. Operations may supply an ID found in Resend logs. */
export async function verifyEventEmailAcceptance(resend: Resend, envelope: EventEmailEnvelope, id: string,
  messageId: string, startedAt: string): Promise<boolean> {
  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(messageId) || !eventEmailEnvelopeSchema.safeParse(envelope).success
    || !Number.isFinite(Date.parse(startedAt))) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([resend.emails.get(messageId), new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), 10000);
    })]);
    const m = result?.data;
    if (result?.error || !m) return false;
    const created = Date.parse(m.created_at);
    return m.id === messageId && m.from === envelope.from && m.subject === envelope.subject && m.html === envelope.html
      && Array.isArray(m.to) && m.to.length === 1 && m.to[0] === envelope.to
      && Array.isArray(m.tags) && m.tags.some(t => t.name === 'carelink_event_operation' && t.value === id)
      && Number.isFinite(created) && created >= Date.parse(startedAt) - 300000 && created <= Date.now() + 300000;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
