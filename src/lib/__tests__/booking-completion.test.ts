/**
 * @jest-environment node
 *
 * applyCompletionSideEffects（完了進入時の来店記録＋来店ポイント付与）の単体テスト。
 * reverseCompletionSideEffects の対称形で、両予約完了経路（/api/booking/complete・
 * /api/admin/booking-status）が共有する副作用ロジックの全ブランチを網羅する。
 */
import { applyCompletionSideEffects, type CompletableBooking } from '../booking-completion';

const mockCapture = jest.fn();
jest.mock('../safe', () => ({ safeCaptureException: (...args: unknown[]) => mockCapture(...args) }));

type Result = { data?: unknown; error?: unknown };

/** facility_menus / staff_profiles の .select().eq().single() チェーン。 */
function nameLookup(data: unknown) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data, error: null })),
      })),
    })),
  };
}

/** customer_visits / user_points の .insert() （await されるので Promise を返す）。 */
function insertTable(result: Result, capture: { insert?: jest.Mock } = {}) {
  const insert = jest.fn(() => Promise.resolve(result));
  capture.insert = insert;
  return { insert };
}

function makeAdmin(opts: {
  menu?: unknown;
  staff?: unknown;
  visitResult?: Result;
  pointResult?: Result;
  visitCap?: { insert?: jest.Mock };
  pointCap?: { insert?: jest.Mock };
}) {
  const from = jest.fn((table: string) => {
    if (table === 'facility_menus') return nameLookup(opts.menu ?? null);
    if (table === 'staff_profiles') return nameLookup(opts.staff ?? null);
    if (table === 'customer_visits') return insertTable(opts.visitResult ?? { error: null }, opts.visitCap);
    if (table === 'user_points') return insertTable(opts.pointResult ?? { error: null }, opts.pointCap);
    throw new Error(`unexpected table ${table}`);
  });
  // SupabaseClient 型に合わせるためのキャスト
  return { from } as unknown as Parameters<typeof applyCompletionSideEffects>[0];
}

const base: CompletableBooking = {
  id: 'b1', facility_id: 'f1', user_id: 'u1', customer_name: '田中',
  email: 'c@example.com', booking_date: '2026-05-01', total_price: 5000,
  menu_id: 'menu-1', staff_id: 'staff-1',
};

beforeEach(() => jest.clearAllMocks());

test('フルパス: menu/staff 解決・来店記録・ポイント(50)付与', async () => {
  const visitCap: { insert?: jest.Mock } = {};
  const admin = makeAdmin({
    menu: { name: 'カット' }, staff: { name: '佐藤' }, visitCap,
  });
  const points = await applyCompletionSideEffects(admin, base);
  expect(points).toBe(50); // 5000 / 100
  expect(visitCap.insert).toHaveBeenCalledWith(expect.objectContaining({
    booking_id: 'b1', menu_name: 'カット', staff_name: '佐藤', amount: 5000,
  }));
  expect(mockCapture).not.toHaveBeenCalled();
});

test('menu_id/staff_id が null → 名前解決スキップ・menu_name/staff_name は null', async () => {
  const visitCap: { insert?: jest.Mock } = {};
  const admin = makeAdmin({ visitCap });
  const points = await applyCompletionSideEffects(admin, {
    ...base, menu_id: null, staff_id: null, user_id: null,
  });
  expect(points).toBe(0); // user_id null → ポイント付与なし
  expect(visitCap.insert).toHaveBeenCalledWith(expect.objectContaining({
    menu_name: null, staff_name: null,
  }));
});

test('menu/staff レコードが見つからない(data null) → name は null フォールバック', async () => {
  const visitCap: { insert?: jest.Mock } = {};
  const admin = makeAdmin({ menu: null, staff: null, visitCap });
  await applyCompletionSideEffects(admin, base);
  expect(visitCap.insert).toHaveBeenCalledWith(expect.objectContaining({
    menu_name: null, staff_name: null,
  }));
});

test('visit insert / point insert がエラー → safeCaptureException が2回・本体は継続', async () => {
  const admin = makeAdmin({
    menu: { name: 'カット' }, staff: { name: '佐藤' },
    visitResult: { error: { message: 'visit fail' } },
    pointResult: { error: { message: 'point fail' } },
  });
  const points = await applyCompletionSideEffects(admin, base);
  expect(points).toBe(50);
  expect(mockCapture).toHaveBeenCalledTimes(2);
  expect(mockCapture).toHaveBeenCalledWith({ message: 'visit fail' }, 'booking-completion');
  expect(mockCapture).toHaveBeenCalledWith({ message: 'point fail' }, 'booking-completion');
});

test('total_price が小さくポイント0 → user_points.insert は呼ばれない', async () => {
  const pointCap: { insert?: jest.Mock } = {};
  const admin = makeAdmin({ menu: { name: 'カット' }, staff: { name: '佐藤' }, pointCap });
  const points = await applyCompletionSideEffects(admin, { ...base, total_price: 50 });
  expect(points).toBe(0); // floor(50/100) = 0
  expect(pointCap.insert).toBeUndefined(); // user_points テーブルに触れていない
});

test('total_price が 0 → ポイント条件 false（user_id あり）', async () => {
  const pointCap: { insert?: jest.Mock } = {};
  const admin = makeAdmin({ menu: { name: 'カット' }, staff: { name: '佐藤' }, pointCap });
  const points = await applyCompletionSideEffects(admin, { ...base, total_price: 0 });
  expect(points).toBe(0);
  expect(pointCap.insert).toBeUndefined();
});
