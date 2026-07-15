/**
 * @jest-environment jsdom
 *
 * 【2026年7月15日 恒治の回帰】
 * defect1: /api/slots の取得失敗（非ok・例外）を「空きなし（満席）」に偽装せず、明確に区別された
 *   エラーUI（バナー＋再試行ボタン）を出すことを検証する。AbortError は失敗として扱わないことも検証。
 * defect8: 指名なし（おまかせ）時、同一時間帯に複数スタッフの空きがある場合の代表スタッフ選出が
 *   fetch 完了順（非決定的）ではなく、staff 配列順（決定的）で選ばれることを検証する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookingFlow, { mergeStaffSlotsForDate } from '../BookingFlow';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };

const MENUS: FacilityMenu[] = [
  {
    id: 'menu-1', facility_id: 'fac-1', category: 'カット', name: 'カット', description: null,
    price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
  } as FacilityMenu,
];

const COUPONS: Coupon[] = [];

async function goToDatetimeStep() {
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('defect1: /api/slots 取得失敗の顕在化', () => {
  const STAFF: StaffProfile[] = [
    { id: 'staff-1', facility_id: 'fac-1', name: '山田', position: 'スタイリスト', nomination_fee: 0 } as StaffProfile,
  ];

  test('非ok応答（500等）が1件でもあれば「満席」ではなく専用エラーUI＋再試行ボタンを表示する', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch;

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    await screen.findByText('空き状況を取得できませんでした。通信状況をご確認のうえ再度お試しください。');
    expect(screen.getByText('再試行')).toBeInTheDocument();
    // 満席メッセージ（別文言）とは明確に区別される
    expect(screen.queryByText('この期間は予約可能な時間帯がありません。別の週をお選びください。')).not.toBeInTheDocument();
  });

  test('fetch が例外を投げた場合もエラーUIを表示する', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    await screen.findByText('空き状況を取得できませんでした。通信状況をご確認のうえ再度お試しください。');
  });

  test('AbortError は失敗として扱わない（エラーUIを出さない）', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    global.fetch = jest.fn(() => Promise.reject(abortError)) as unknown as typeof fetch;

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    // ローディングが終わるまで待つ
    await waitFor(() => expect(screen.queryByText('この期間は予約可能な時間帯がありません。別の週をお選びください。')).toBeInTheDocument());
    expect(screen.queryByText('空き状況を取得できませんでした。通信状況をご確認のうえ再度お試しください。')).not.toBeInTheDocument();
  });

  test('再試行ボタンを押すと再度 /api/slots を呼び直す', async () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    await screen.findByText('再試行');
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByText('再試行'));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  test('取得成功時はエラーUIを表示しない', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }] }) })
    ) as unknown as typeof fetch;

    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
    await goToDatetimeStep();

    await screen.findAllByText('△');
    expect(screen.queryByText('空き状況を取得できませんでした。通信状況をご確認のうえ再度お試しください。')).not.toBeInTheDocument();
  });
});

describe('defect8: おまかせ時の代表スタッフ選出の決定性（純粋関数 mergeStaffSlotsForDate）', () => {
  const slotA = { slot_start: '10:00:00', slot_end: '11:00:00' };
  const slotB = { slot_start: '10:00:00', slot_end: '11:00:00' };

  test('代表スロットの staff_id は results 配列の先頭要素で決まる（fetch完了順ではなく配列順）', () => {
    const staffAFirst = mergeStaffSlotsForDate([
      { staffId: 'staff-a', slots: [slotA] },
      { staffId: 'staff-b', slots: [slotB] },
    ]);
    expect(staffAFirst['10:00'].slot.staff_id).toBe('staff-a');
    expect(staffAFirst['10:00'].count).toBe(2);

    const staffBFirst = mergeStaffSlotsForDate([
      { staffId: 'staff-b', slots: [slotB] },
      { staffId: 'staff-a', slots: [slotA] },
    ]);
    expect(staffBFirst['10:00'].slot.staff_id).toBe('staff-b');
    expect(staffBFirst['10:00'].count).toBe(2);
  });

  test('取得失敗（null）は代表候補から除外され、成功した結果のみでマージされる', () => {
    const merged = mergeStaffSlotsForDate([
      null,
      { staffId: 'staff-b', slots: [slotB] },
    ]);
    expect(merged['10:00'].slot.staff_id).toBe('staff-b');
    expect(merged['10:00'].count).toBe(1);
  });

  test('全件失敗（すべて null）なら空のマップになる', () => {
    expect(mergeStaffSlotsForDate([null, null])).toEqual({});
  });

  test('入力が空配列なら空のマップになる', () => {
    expect(mergeStaffSlotsForDate([])).toEqual({});
  });
});
