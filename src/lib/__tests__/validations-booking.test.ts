import { bookingSchema, getTodayString, getMaxDateString } from '../validations-booking';

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

  // round6+Gmail正規化: email の保存時 canonical 化（突合の非対称・顧客分裂・new_customer クーポン
  // 複数取得=金銭バグを防ぐ）。Gmail はドット・"+tag" 除去＋小文字化、非Gmail は小文字化のみ。
  test('email は canonical 化される（Gmail はドット/+tag 除去・小文字化）', () => {
    const r = bookingSchema.safeParse({ ...validBooking, email: 'Taro.Yamada+shopA@Gmail.COM' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('taroyamada@gmail.com');
  });

  test('email 非Gmail は小文字化のみ（ドット・+tag は保持）', () => {
    const r = bookingSchema.safeParse({ ...validBooking, email: 'Taro.Yamada+x@Example.COM' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('taro.yamada+x@example.com');
  });

  test('customer_name は前後空白が除去される', () => {
    const r = bookingSchema.safeParse({ ...validBooking, customer_name: '  山田 太郎  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customer_name).toBe('山田 太郎');
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

  test('booking_date が 1年を超える未来（2100-01-01）→ エラー（L42 ConditionalExpression mutation kill）', () => {
    // ConditionalExpression → true mutation: 上限チェックが消えると通過してしまう
    expect(bookingSchema.safeParse({ ...validBooking, booking_date: '2100-01-01' }).success).toBe(false);
  });
});

describe('getTodayString — JST変換精度テスト（L15/L17/L18 mutation kill）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('UTC 23:00 → JST 翌日 08:00 → 翌日の日付を返す', () => {
    // UTC 2026-01-04T23:00:00Z → JST 2026-01-05T08:00:00+09:00
    // +→- mutation: UTC-9 = 2026-01-04T14:00 → '2026-01-04' になり失敗する
    // *→/ mutation: offset ≈ 0ms → UTC date '2026-01-04' になり失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getTodayString()).toBe('2026-01-05');
  });

  test('月のゼロパディング（1月 → "01"）', () => {
    // padStart(2, '') mutation: '1' が返り '2026-1-05' になり失敗する
    // +1 → -1 mutation: month = -1 → '-1' になり失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getTodayString()).toBe('2026-01-05');
  });

  test('日のゼロパディング（5日 → "05"）', () => {
    // padStart(2, '') mutation: '5' が返り '2026-01-5' になり失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getTodayString()).toMatch(/-05$/);
  });
});

describe('getMaxDateString — JST変換精度テスト（L24/L25/L27/L28 mutation kill）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('1年後の正確な日付を返す', () => {
    // UTC 2026-01-04T23:00:00Z → JST 2026-01-05 → max = '2027-01-05'
    // +→- mutation: UTC-9日付 '2026-01-04' + 1年 = '2027-01-04' になり失敗する
    // setUTCFullYear → setUTCMonth mutation: 年が加算されず月が狂い失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getMaxDateString()).toBe('2027-01-05');
  });

  test('getMaxDateString の月ゼロパディング（1月 → "01"）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getMaxDateString()).toMatch(/^2027-01-/);
  });

  test('getMaxDateString の日ゼロパディング（5日 → "05"）', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    expect(getMaxDateString()).toMatch(/-05$/);
  });
});

describe('bookingSchema — getMaxDateString との境界値テスト（L42 EqualityOperator mutation kill）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('booking_date が getMaxDateString() と等しい → 通過（<= が必要）', () => {
    // EqualityOperator <= → < mutation: 等値で fail になり失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    const maxDate = getMaxDateString(); // '2027-01-05'
    expect(bookingSchema.safeParse({ ...validBooking, booking_date: maxDate }).success).toBe(true);
  });
});

describe('bookingSchema — getTodayString との境界値テスト（L41 EqualityOperator mutation kill）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('booking_date が getTodayString() と等しい → 通過（>= が必要）', () => {
    // EqualityOperator >= → > mutation: 等値で fail になり失敗する
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));
    const today = getTodayString(); // '2026-01-05'
    expect(bookingSchema.safeParse({ ...validBooking, booking_date: today }).success).toBe(true);
  });
});
