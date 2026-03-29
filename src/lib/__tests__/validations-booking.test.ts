import { bookingSchema } from '../validations-booking';

const validBooking = {
  facility_id: '550e8400-e29b-41d4-a716-446655440000',
  staff_id: null,
  menu_id: null,
  coupon_id: null,
  booking_date: '2026-04-01',
  start_time: '10:00',
  end_time: '11:00',
  customer_name: '神原良祐',
  email: 'test@example.com',
  phone: '090-1234-5678',
  note: '',
  total_price: 5000,
};

describe('bookingSchema', () => {
  test('正常データが通過する', () => {
    const result = bookingSchema.safeParse(validBooking);
    expect(result.success).toBe(true);
  });

  test('facility_idがUUID以外だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, facility_id: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  test('booking_dateが不正形式だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, booking_date: '2026/04/01' });
    expect(result.success).toBe(false);
  });

  test('customer_nameが空だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, customer_name: '' });
    expect(result.success).toBe(false);
  });

  test('emailが不正だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, email: 'invalid' });
    expect(result.success).toBe(false);
  });

  test('noteが501文字だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, note: 'あ'.repeat(501) });
    expect(result.success).toBe(false);
  });

  test('total_priceが負だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, total_price: -1 });
    expect(result.success).toBe(false);
  });

  test('total_priceがnullはOK', () => {
    const result = bookingSchema.safeParse({ ...validBooking, total_price: null });
    expect(result.success).toBe(true);
  });

  test('staff_idがUUIDなら通過', () => {
    const result = bookingSchema.safeParse({
      ...validBooking,
      staff_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(true);
  });

  test('start_timeが不正（25:00）だとエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, start_time: '25:00' });
    expect(result.success).toBe(false);
  });

  test('start_timeが有効（23:59）なら通る', () => {
    const result = bookingSchema.safeParse({ ...validBooking, start_time: '23:59' });
    expect(result.success).toBe(true);
  });

  test('過去日のbooking_dateはエラー', () => {
    const result = bookingSchema.safeParse({ ...validBooking, booking_date: '2020-01-01' });
    expect(result.success).toBe(false);
  });
});
