import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { BookingFormData } from './validations-booking';
export const BOOKING_CREATE_COOKIE = 'carelink_booking_scope';
export const bookingAcceptedSchema = z.object({ success: z.literal(true), state: z.literal('accepted'), operationId: z.uuid(), bookingId: z.uuid(),
  bookingStatus: z.enum(['pending','confirmed']), bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/), totalPrice: z.number().int().nonnegative(), notification: z.literal('queued') });
export function newBookingGuestScope() { return randomBytes(32).toString('base64url'); }
export function bookingGuestScopeHash(value: string | undefined): string | null {
  return value && /^[\w-]{43}$/.test(value) ? createHash('sha256').update(value).digest('hex') : null;
}
export function bookingPayloadHash(data: BookingFormData): string {
  // Fixed fields and normalized schema values; caller order/unknown JSON keys cannot change equality.
  return createHash('sha256').update(JSON.stringify([data.facility_id,data.staff_id,data.menu_id,data.menu_ids ?? [],data.coupon_id,
    data.booking_date,data.start_time,data.end_time,data.customer_name,data.email,data.phone ?? null,data.note ?? null,data.total_price,data.points_used ?? 0])).digest('hex');
}
export function acceptedBookingResponse(value: unknown, id: string) {
  const parsed = bookingAcceptedSchema.safeParse(value);
  return parsed.success && parsed.data.operationId === id ? parsed.data : null;
}
