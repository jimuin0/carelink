import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildBookingCancelledEnvelope, buildBookingCancellationToFacilityEnvelope, buildBookingRescheduledEnvelope, buildBookingRescheduleToFacilityEnvelope } from './email';
import { cancelFeeFromContext, cancelPolicySnapshotSchema } from './cancel-fee-receipt';
import { eventEmailEnvelopeSchema, type EventEmailEnvelope } from './event-email-delivery';

const timeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);
const snapshotSchema = z.object({
  bookingId: z.uuid(), bookingRevision: z.iso.datetime({ offset: true }),
  customerName: z.string(), customerEmail: z.string(), facilityName: z.string(),
  bookingDate: z.iso.date(), endDate: z.iso.date().optional(), startTime: timeSchema,
  endTime: timeSchema, menuName: z.string().nullable(),
  totalPrice: z.number().int().nonnegative().nullable(), capturedAt: z.iso.datetime({ offset: true }),
  // cancel_rule is present from 20261023020000 on; older jobs carry only the two numbers.
  cancelPolicy: cancelPolicySnapshotSchema.nullable(),
  // The date/time before a customer change (20261022100100). Absent on cancellations
  // and on change jobs queued before that migration.
  previous: z.object({ bookingDate: z.iso.date(), endDate: z.iso.date().optional(), startTime: timeSchema, endTime: timeSchema }).strict().optional(),
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
  // Only a change carries the previous date/time, and the shop's change email needs it.
  && (j.payload.kind === 'rescheduled' || j.payload.snapshot.previous === undefined)
  && (j.payload.kind !== 'rescheduled' || j.payload.role === 'customer' || j.payload.snapshot.previous !== undefined));

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
  // One computation for both templates: the shop is told the exact amount the customer was told.
  const fee = cancelFeeFromContext({ policy: s.cancelPolicy, totalPrice: s.totalPrice,
    bookingDate: s.bookingDate, startTime: s.startTime, capturedAt: s.capturedAt });
  const data = { ...s, menuName: s.menuName ?? undefined, totalPrice: s.totalPrice ?? undefined,
    cancelFee: fee.fee, cancelFeeRate: fee.rate, cancelledAt: s.capturedAt,
    // The customer side of these jobs is only queued by the member's own cancel/change
    // (cancel_booking_with_points_atomic and change_booking_atomic require bookings.user_id = actor),
    // so the booking is always visible in /mypage.
    hasAccount: true };
  const envelope = eventEmailEnvelopeSchema.parse(job.payload.kind === 'rescheduled'
    ? job.payload.role === 'customer' ? buildBookingRescheduledEnvelope(data)
      // The schema guarantees `previous` for the shop's change email.
      : buildBookingRescheduleToFacilityEnvelope({ ...data, facilityEmail: job.target_id, previous: s.previous! })
    : job.payload.role === 'customer' ? buildBookingCancelledEnvelope(data)
      : buildBookingCancellationToFacilityEnvelope({ ...data, facilityEmail: job.target_id }));
  const frozen = await db.from('webhook_retry_queue').update({ email_envelope: envelope })
    .eq('id', job.id).eq('status', 'processing').eq('claimed_at', job.claimed_at)
    .is('delivery_started_at', null).is('email_envelope', null).select('id').maybeSingle();
  if (frozen.error || frozen.data?.id !== job.id) throw new Error('customer booking envelope freeze not confirmed');
  return envelope;
}
