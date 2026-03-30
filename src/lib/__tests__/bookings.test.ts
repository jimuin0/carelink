const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { createBooking, getUserBookings, getBookingById, cancelBooking } from '../bookings';

beforeEach(() => {
  mockFrom.mockReset();
});

/** Helper: build a fluent chain that resolves at any terminal method */
function fluent(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: Record<string, any> = {};
  const handler = () => self;
  self.select = jest.fn(handler);
  self.insert = jest.fn(handler);
  self.update = jest.fn(handler);
  self.eq = jest.fn(handler);
  self.not = jest.fn(handler);
  self.lt = jest.fn(handler);
  self.gt = jest.fn(handler);
  self.order = jest.fn(handler);
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  // For terminal calls that don't use .single()
  self.then = (fn: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(fn);
  return self;
}

describe('createBooking', () => {
  const bookingData = {
    facility_id: 'fac-1',
    user_id: 'user-1',
    staff_id: 'staff-1',
    menu_id: 'menu-1',
    coupon_id: null,
    booking_date: '2026-04-01',
    start_time: '10:00',
    end_time: '11:00',
    customer_name: 'テスト太郎',
    email: 'test@example.com',
    phone: null,
    note: null,
    total_price: 5000,
  };

  test('正常に予約を作成する', async () => {
    const conflictChain = fluent({ data: [] });
    const mockBooking = { id: 'b-1', ...bookingData, status: 'pending' };
    const insertChain = fluent({ data: mockBooking, error: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      return callNum === 1 ? conflictChain : insertChain;
    });

    const result = await createBooking(bookingData);
    expect(result.booking).toEqual(mockBooking);
    expect(result.error).toBeNull();
  });

  test('競合がある場合はエラーを返す', async () => {
    const conflictChain = fluent({ data: [{ id: 'conflict-1' }] });
    mockFrom.mockReturnValue(conflictChain);

    const result = await createBooking(bookingData);
    expect(result.booking).toBeNull();
    expect(result.error).toBe('この時間帯は既に予約が入っています');
  });

  test('staff_idがない場合は競合チェックをスキップする', async () => {
    const noStaff = { ...bookingData, staff_id: null };
    const mockBooking = { id: 'b-2', ...noStaff, status: 'pending' };
    const insertChain = fluent({ data: mockBooking, error: null });
    mockFrom.mockReturnValue(insertChain);

    const result = await createBooking(noStaff);
    expect(result.booking).toEqual(mockBooking);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  test('DB挿入失敗時にエラーメッセージを返す', async () => {
    const conflictChain = fluent({ data: [] });
    const insertChain = fluent({ data: null, error: { message: 'insert failed' } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      return callNum === 1 ? conflictChain : insertChain;
    });

    const result = await createBooking(bookingData);
    expect(result.booking).toBeNull();
    expect(result.error).toBe('insert failed');
  });
});

describe('getUserBookings', () => {
  test('ユーザーの予約一覧を返す', async () => {
    const bookings = [{ id: 'b-1' }, { id: 'b-2' }];
    const chain = fluent({ data: bookings });
    chain.order = jest.fn(() => Promise.resolve({ data: bookings }));
    mockFrom.mockReturnValue(chain);

    const result = await getUserBookings('user-1');
    expect(result).toEqual(bookings);
  });

  test('データがない場合は空配列', async () => {
    const chain = fluent({ data: null });
    chain.order = jest.fn(() => Promise.resolve({ data: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getUserBookings('user-1');
    expect(result).toEqual([]);
  });
});

describe('getBookingById', () => {
  test('予約を返す', async () => {
    const booking = { id: 'b-1', facility_id: 'fac-1' };
    mockFrom.mockReturnValue(fluent({ data: booking }));

    const result = await getBookingById('b-1');
    expect(result).toEqual(booking);
  });

  test('存在しない場合はnull', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getBookingById('nonexistent');
    expect(result).toBeNull();
  });
});

describe('cancelBooking', () => {
  test('正常にキャンセルする', async () => {
    const lookupChain = fluent({ data: { id: 'b-1', user_id: 'user-1', status: 'pending' } });
    const updateResult = { error: null };
    const updateChain = fluent(updateResult);
    // For update, the terminal is .eq() not .single()
    const updateEq = jest.fn(() => Promise.resolve(updateResult));
    updateChain.eq = updateEq;
    updateChain.update = jest.fn(() => ({ eq: updateEq }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      return callNum === 1 ? lookupChain : updateChain;
    });

    const result = await cancelBooking('b-1', 'user-1');
    expect(result.error).toBeNull();
  });

  test('予約が存在しない場合', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await cancelBooking('nonexistent', 'user-1');
    expect(result.error).toBe('予約が見つかりません');
  });

  test('他のユーザーの予約はキャンセルできない', async () => {
    mockFrom.mockReturnValue(fluent({ data: { id: 'b-1', user_id: 'other-user', status: 'pending' } }));

    const result = await cancelBooking('b-1', 'user-1');
    expect(result.error).toBe('権限がありません');
  });

  test('既にキャンセル済み', async () => {
    mockFrom.mockReturnValue(fluent({ data: { id: 'b-1', user_id: 'user-1', status: 'cancelled' } }));

    const result = await cancelBooking('b-1', 'user-1');
    expect(result.error).toBe('既にキャンセル済みです');
  });

  test('完了済みの予約はキャンセルできない', async () => {
    mockFrom.mockReturnValue(fluent({ data: { id: 'b-1', user_id: 'user-1', status: 'completed' } }));

    const result = await cancelBooking('b-1', 'user-1');
    expect(result.error).toBe('完了済みの予約はキャンセルできません');
  });
});
