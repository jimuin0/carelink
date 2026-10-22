import { bookingStaffLabel, isNominatedBooking, rebookSearchParams } from '../booking-nomination';

// おまかせ（指名なし）の予約も予約 RPC が担当者を割り当てて staff_id に保存する（2026年10月22日）。
// staff_id があるだけで「指名」と扱うと、再予約に指名料がかかり、店舗画面で指名とフリーが見分けられない。
describe('isNominatedBooking', () => {
  test.each([
    [{ staff_id: 's1', staff_auto_assigned: false }, true],
    [{ staff_id: 's1' }, true],
    [{ staff_id: 's1', staff_auto_assigned: null }, true],
    [{ staff_id: 's1', staff_auto_assigned: true }, false],
    [{ staff_id: null, staff_auto_assigned: false }, false],
    [{ staff_id: null, staff_auto_assigned: true }, false],
  ])('%j → %s', (booking, expected) => {
    expect(isNominatedBooking(booking)).toBe(expected);
  });
});

describe('rebookSearchParams', () => {
  test('指名した予約はメニューとスタッフを引き継ぐ', () => {
    expect(rebookSearchParams({ menu_id: 'm1', staff_id: 's1', staff_auto_assigned: false }).toString())
      .toBe('menu_id=m1&staff_id=s1');
  });

  test('指名なしで割り当てられた予約はスタッフを引き継がない（回帰防止: 指名料がかかっていた）', () => {
    expect(rebookSearchParams({ menu_id: 'm1', staff_id: 's1', staff_auto_assigned: true }).toString())
      .toBe('menu_id=m1');
  });

  test('メニューもスタッフも無ければ空', () => {
    expect(rebookSearchParams({ menu_id: null, staff_id: null }).toString()).toBe('');
  });

  test('メニューが無くても指名スタッフは引き継ぐ', () => {
    expect(rebookSearchParams({ menu_id: null, staff_id: 's1' }).toString()).toBe('staff_id=s1');
  });
});

describe('bookingStaffLabel', () => {
  test.each([
    [null, true, '指名なし'],
    [undefined, false, '指名なし'],
    ['', undefined, '指名なし'],
    ['佐藤', true, '指名なし（担当: 佐藤）'],
    ['佐藤', false, '佐藤'],
    ['佐藤', null, '佐藤'],
    ['佐藤', undefined, '佐藤'],
  ])('%s / %s → %s', (name, autoAssigned, expected) => {
    expect(bookingStaffLabel(name, autoAssigned)).toBe(expected);
  });
});
