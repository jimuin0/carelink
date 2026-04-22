import { bookingSchema } from '../validations-booking';

const validBooking = {
  facility_id: '550e8400-e29b-41d4-a716-446655440000',
  staff_id: null,
  menu_id: null,
  coupon_id: null,
  booking_date: '2027-04-01',
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

describe('bookingSchema — deep tests', () => {
  test('total_price が 9999999 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, total_price: 9999999 }).success).toBe(true);
  });

  test('total_price が 10000000 → エラー', () => {
    expect(bookingSchema.safeParse({ ...validBooking, total_price: 10000000 }).success).toBe(false);
  });

  test('points_used が 0 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, points_used: 0 }).success).toBe(true);
  });

  test('points_used が 9999999 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, points_used: 9999999 }).success).toBe(true);
  });

  test('points_used が -1 → エラー', () => {
    expect(bookingSchema.safeParse({ ...validBooking, points_used: -1 }).success).toBe(false);
  });

  test('customer_name が 100文字 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, customer_name: 'あ'.repeat(100) }).success).toBe(true);
  });

  test('customer_name が 101文字 → エラー', () => {
    expect(bookingSchema.safeParse({ ...validBooking, customer_name: 'あ'.repeat(101) }).success).toBe(false);
  });

  test('email が 254文字 → 通過', () => {
    const localPart = 'a'.repeat(242);
    const email = `${localPart}@example.com`; // 242+12=254
    expect(bookingSchema.safeParse({ ...validBooking, email }).success).toBe(true);
  });

  test('end_time が不正 (24:00) → エラー', () => {
    expect(bookingSchema.safeParse({ ...validBooking, end_time: '24:00' }).success).toBe(false);
  });

  test('end_time が 00:00 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, end_time: '00:00' }).success).toBe(true);
  });

  test('booking_date が 1年先 → 通過', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const dateStr = future.toISOString().split('T')[0];
    expect(bookingSchema.safeParse({ ...validBooking, booking_date: dateStr }).success).toBe(true);
  });

  test('phone が null → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, phone: null }).success).toBe(true);
  });

  test('phone が undefined → 通過', () => {
    const { phone, ...rest } = validBooking;
    expect(bookingSchema.safeParse(rest).success).toBe(true);
  });

  test('note が 500文字 → 通過', () => {
    expect(bookingSchema.safeParse({ ...validBooking, note: 'a'.repeat(500) }).success).toBe(true);
  });

  test('menu_ids が UUID 配列 → 通過', () => {
    expect(bookingSchema.safeParse({
      ...validBooking,
      menu_ids: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'],
    }).success).toBe(true);
  });

  test('menu_ids が 21 件 → エラー', () => {
    const uuids = Array.from({ length: 21 }, (_, i) => `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`);
    expect(bookingSchema.safeParse({ ...validBooking, menu_ids: uuids }).success).toBe(false);
  });

  test('start_time の分が 60 → エラー', () => {
    expect(bookingSchema.safeParse({ ...validBooking, start_time: '10:60' }).success).toBe(false);
  });
});
