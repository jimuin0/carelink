/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/schedules.ts
 * Covers getStaffSchedules and getAvailableSlots
 */

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: jest.fn(() => ({
    from: mockFrom,
    rpc: jest.fn(() => { throw new Error('availability RPC must not use the anon client'); }),
  })),
  createServiceRoleClient: jest.fn(() => ({ rpc: mockRpc })),
}));

import { getStaffSchedules, getAvailableSlots } from '../schedules';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStaffSchedules()', () => {
  test('スタッフのスケジュール一覧を返す', async () => {
    const schedules = [
      { id: 's1', staff_id: 'staff-1', day_of_week: 1, start_time: '09:00', end_time: '18:00' },
      { id: 's2', staff_id: 'staff-1', day_of_week: 2, start_time: '10:00', end_time: '19:00' },
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: schedules })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getStaffSchedules('staff-1');
    expect(result).toEqual(schedules);
    expect(chain.eq).toHaveBeenCalledWith('staff_id', 'staff-1');
  });

  test('data が null → 空配列', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getStaffSchedules('staff-2');
    expect(result).toEqual([]);
  });

  test('空のスケジュール → 空配列', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: [] })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getStaffSchedules('staff-3');
    expect(result).toEqual([]);
  });
});

describe('getAvailableSlots()', () => {
  test('利用可能スロット一覧を返す', async () => {
    const slots = [
      { start_time: '09:00', end_time: '10:00' },
      { start_time: '10:00', end_time: '11:00' },
    ];
    mockRpc.mockResolvedValue({ data: slots });

    const result = await getAvailableSlots('facility-1', 'staff-1', '2026-05-01', 60);
    expect(result).toEqual(slots);
    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: 'facility-1',
      p_staff_id: 'staff-1',
      p_date: '2026-05-01',
      p_duration_minutes: 60,
    });
  });

  test('data が null → 空配列', async () => {
    mockRpc.mockResolvedValue({ data: null });

    const result = await getAvailableSlots('f1', 's1', '2026-05-01', 30);
    expect(result).toEqual([]);
  });

  test('空スロット → 空配列', async () => {
    mockRpc.mockResolvedValue({ data: [] });

    const result = await getAvailableSlots('f1', 's1', '2026-05-01', 90);
    expect(result).toEqual([]);
  });
});

// 点検 A94：本体は error を見ずに (data ?? []) を返すため、DB 障害が「勤務なし」「空き枠0件」として
// 成功扱いになる（来院者には満枠に見え、通知も出ない）。上の「data が null → 空配列」は error の無い
// 正常系に限った話で、error 分岐は未検証だった。本体の修正待ちのため test.failing で現状を固定し、
// 本体が直ると反転して知らせる（そのとき test に戻す）。
describe('【本体未修正】DB 障害を空として握り潰さない', () => {
  test.failing('getStaffSchedules: error ありは空配列で成功扱いにしない（reject する）', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: null, error: { message: 'db down' } })),
    };
    mockFrom.mockReturnValue(chain);
    await expect(getStaffSchedules('staff-1')).rejects.toBeDefined();
  });

  test.failing('getAvailableSlots: error ありは空配列で成功扱いにしない（reject する）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(getAvailableSlots('f1', 's1', '2026-05-01', 30)).rejects.toBeDefined();
  });
});
