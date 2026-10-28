/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { bookingPayloadHash } from '../booking-create-receipt';
import type { BookingFormData } from '../validations-booking';
import { buildBookingConfirmationEnvelope } from '../email';

const booking: BookingFormData = { facility_id: '00000000-0000-4000-8000-000000000001', staff_id: null,
  menu_id: '00000000-0000-4000-8000-000000000002', coupon_id: null, booking_date: '2030-01-07',
  start_time: '23:30', end_time: '00:30', customer_name: 'Synthetic', email: 'synthetic@example.invalid',
  phone: null, total_price: 1000 };

test('same-day retries retain legacy hash while overnight end dates change it', () => {
  expect(bookingPayloadHash({ ...booking, end_date: booking.booking_date })).toBe(bookingPayloadHash(booking));
  expect(bookingPayloadHash({ ...booking, end_date: '2030-01-08' })).not.toBe(bookingPayloadHash(booking));
  expect(bookingPayloadHash({ ...booking, end_date: '2030-01-09' })).not.toBe(bookingPayloadHash({ ...booking, end_date: '2030-01-08' }));
});

test('reservation email explicitly displays the next calendar day', () => {
  const mail = buildBookingConfirmationEnvelope({ customerName: 'Synthetic', customerEmail: 'synthetic@example.invalid',
    facilityName: 'Synthetic', bookingDate: '2030-01-07', endDate: '2030-01-08',
    startTime: '23:30', endTime: '00:30', bookingId: 'synthetic' });
  expect(mail.html).toContain('2030年1月7日');
  expect(mail.html).toContain('2030年1月8日');
});
