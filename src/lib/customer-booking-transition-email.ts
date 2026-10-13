import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildBookingCancelledEnvelope, buildBookingCancellationToFacilityEnvelope, buildBookingRescheduledEnvelope } from './email';
import { computeCancelFee, hoursUntilBookingStart } from './cancel-fee';
import { eventEmailEnvelopeSchema, type EventEmailEnvelope } from './event-email-delivery';

const snapshotSchema = z.object({
  bookingId: z.uuid(), customerName: z.string(), customerEmail: z.string(), facilityName: z.string(),
  bookingDate: z.iso.date(), startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/), menuName: z.string().nullable(),
  totalPrice: z.number().int().nonnegative().nullable(), capturedAt: z.iso.datetime({ offset: true }),
  cancelPolicy: z.object({ free_cancel_hours: z.number().nullable(), late_cancel_rate: z.number().nullable() }).nullable(),
}).strict();
const jobSchema = z.object({
  id: z.uuid(), webhook_type: z.literal('email'), target_id: z.email(), facility_id: z.uuid(),
  claimed_at: z.string(), email_envelope: z.unknown(),
  payload: z.object({
    event_email_version: z.literal(1), dispatch_version: z.literal(2),
    idempotency_key: z.string(), customer_booking_transition_version: z.literal(1),
    kind: z.enum(['cancelled', 'rescheduled']), role: z.enum(['customer', 'owner']), snapshot: snapshotSchema,
  }).strict(),
}).refine(j => j.payload.idempotency_key === `carelink-event-email/${j.id}`
  && (j.payload.role !== 'customer' || j.target_id === j.payload.snapshot.customerEmail)
  && (j.payload.kind !== 'rescheduled' || j.payload.role === 'customer'));

/** Dispatch only the snapshot captured in the booking transaction. Never fetch
 * today's booking/menu/owner data to reconstruct an earlier change or cancellation. */
export async function prepareCustomerBookingTransitionEnvelope(db: SupabaseClient, input: unknown): Promise<EventEmailEnvelope> {
  const job = jobSchema.parse(input);
  if (job.email_envelope !== null) {
    const frozen = eventEmailEnvelopeSchema.parse(job.email_envelope);
    if (frozen.to !== job.target_id) throw new Error('customer booking envelope scope mismatch');
    return frozen;
  }
  const s = job.payload.snapshot;
  const data = { ...s, menuName: s.menuName ?? undefined, totalPrice: s.totalPrice ?? undefined,
    cancelFee: computeCancelFee(s.cancelPolicy, s.totalPrice,
      hoursUntilBookingStart(s.bookingDate, s.startTime, Date.parse(s.capturedAt))).fee };
  const envelope = eventEmailEnvelopeSchema.parse(job.payload.kind === 'rescheduled'
    ? buildBookingRescheduledEnvelope(data)
    : job.payload.role === 'customer' ? buildBookingCancelledEnvelope(data)
      : buildBookingCancellationToFacilityEnvelope({ ...data, facilityEmail: job.target_id }));
  const frozen = await db.from('webhook_retry_queue').update({ email_envelope: envelope })
    .eq('id', job.id).eq('status', 'processing').eq('claimed_at', job.claimed_at)
    .is('delivery_started_at', null).is('email_envelope', null).select('id').maybeSingle();
  if (frozen.error || frozen.data?.id !== job.id) throw new Error('customer booking envelope freeze not confirmed');
  return envelope;
}
