import type { createServiceRoleClient } from './supabase-server';
import { buildBookingConfirmedEnvelope, buildBookingCancelledEnvelope, buildBookingStatusUpdateEnvelope } from './email';
import { eventEmailEnvelopeSchema } from './event-email-delivery';

/** Freeze the complete ordered menu display before the atomic state/outbox
 * transaction. Revision comparison in the RPC rejects a stale booking read. */
export async function buildStatusEnvelope(db: ReturnType<typeof createServiceRoleClient>, booking: {
  id: string; facility_id: string; customer_name: string; email: string | null;
  booking_date: string; start_time: string; end_time: string; total_price: number | null;
  menu_id: string | null; menu_ids: string[] | null; staff_id: string | null;
}, status: string, reason?: string) {
  if (!booking.email || status === 'arrived') return null;
  const facility = await db.from('facility_profiles').select('name').eq('id', booking.facility_id).single();
  if (facility.error || !facility.data?.name) throw new Error('booking notification facility unavailable');
  const ids = booking.menu_ids?.length ? booking.menu_ids : booking.menu_id ? [booking.menu_id] : [];
  let menuName: string | undefined;
  if (ids.length) {
    const menus = await db.from('facility_menus').select('id,name').eq('facility_id', booking.facility_id).in('id', ids);
    if (menus.error || !Array.isArray(menus.data)) throw new Error('booking notification menus unavailable');
    menuName = ids.map(id => menus.data.find(row => row.id === id)?.name ?? '削除済みメニュー').join('、');
  }
  let staffName: string | undefined;
  if (booking.staff_id) {
    const staff = await db.from('staff_profiles').select('name').eq('facility_id', booking.facility_id).eq('id', booking.staff_id).maybeSingle();
    if (staff.error) throw new Error('booking notification staff unavailable');
    staffName = staff.data?.name;
  }
  const data = { bookingId: booking.id, customerName: booking.customer_name, customerEmail: booking.email,
    facilityName: facility.data.name, bookingDate: booking.booking_date, startTime: booking.start_time,
    endTime: booking.end_time, totalPrice: booking.total_price ?? undefined, menuName, staffName };
  return eventEmailEnvelopeSchema.parse(status === 'confirmed' ? buildBookingConfirmedEnvelope(data)
    : status === 'cancelled' ? buildBookingCancelledEnvelope(data)
      : buildBookingStatusUpdateEnvelope({ ...data, newStatus: status, reason }));
}
