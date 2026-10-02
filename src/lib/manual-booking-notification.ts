import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { buildBookingConfirmedEnvelope } from './email';
import { eventEmailEnvelopeSchema, type EventEmailEnvelope } from './event-email-delivery';

const reference = z.object({ id: z.uuid(), webhook_type: z.literal('manual_booking_confirmation'),
  target_id: z.uuid(), facility_id: z.uuid(), claimed_at: z.string(), email_envelope: z.unknown(),
  payload: z.object({ operation_id: z.uuid(), template_version: z.literal(1) }).strict(),
}).refine(j => j.id === j.target_id && j.id === j.payload.operation_id);
const original = z.object({ booking_id: z.uuid(), facility_id: z.uuid(), input: z.object({
  facility_id: z.uuid(), customer_name: z.string().min(1), email: z.email(), booking_date: z.string(),
  start_time: z.string(), end_time: z.string(),
}), result: z.object({ total_price: z.number().int().nonnegative(), menu_names: z.string(),
  facility_name: z.string(), staff_name: z.string().nullable(),
}) });

/** Resolve immutable operation data and freeze one envelope before dispatch.
 * The notification survives an API crash immediately after the booking commit.
 * Reclaim may reuse an already frozen envelope but may never rewrite it. */
export async function prepareManualBookingEnvelope(db: ReturnType<typeof createServiceRoleClient>, input: unknown): Promise<EventEmailEnvelope> {
  const job = reference.parse(input);
  if (job.email_envelope !== null) return eventEmailEnvelopeSchema.parse(job.email_envelope);
  const found = await db.from('manual_booking_operations').select('booking_id,facility_id,input,result')
    .eq('operation_id', job.id).maybeSingle();
  const row = original.safeParse(found.data);
  if (found.error || !row.success || row.data.facility_id !== job.facility_id || row.data.input.facility_id !== job.facility_id) {
    throw new Error('manual booking notification reference unavailable');
  }
  const source = row.data;
  const envelope = eventEmailEnvelopeSchema.parse(buildBookingConfirmedEnvelope({ bookingId: source.booking_id,
    customerName: source.input.customer_name, customerEmail: source.input.email, facilityName: source.result.facility_name,
    bookingDate: source.input.booking_date, startTime: source.input.start_time, endTime: source.input.end_time,
    menuName: source.result.menu_names, staffName: source.result.staff_name ?? undefined, totalPrice: source.result.total_price }));
  const frozen = await db.from('webhook_retry_queue').update({ email_envelope: envelope }).eq('id', job.id)
    .eq('status', 'processing').eq('claimed_at', job.claimed_at).is('delivery_started_at', null)
    .is('email_envelope', null).select('id').maybeSingle();
  if (frozen.error || frozen.data?.id !== job.id) throw new Error('manual booking notification freeze not confirmed');
  return envelope;
}
