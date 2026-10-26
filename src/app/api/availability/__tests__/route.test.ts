/**
 * @jest-environment node
 *
 * Tests for GET /api/availability
 * Key assertions:
 *   - Rate limiting (10 req/min per IP)
 *   - Query param validation (facilityId, year, month)
 *   - Year/month range validation (currentYear-1 to currentYear+2)
 *   - Fetches active staff for facility
 *   - 集約 RPC get_month_availability（N+1 解消の高速パス）
 *   - get_month_availability 未デプロイ（PGRST202）→ 従来 get_available_slots ループへフォールバック
 *   - 集約関数以外のエラー → 500
 *   - 可用性ステータス（available / few / full）と past=full の判定
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn() }));
import { checkBookingReadiness } from '@/lib/facility-publish-gate';

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockStaffSelect: jest.Mock;
let mockRpc: jest.Mock;

interface MockOpts {
  staffCount?: number;
  /** facility_profiles.business_hours の戻り。null=未設定（ゲートしない）。 */
  businessHours?: Record<string, unknown> | null;
  monthSlots?: number;        // 集約 RPC が各日に返す slots 値
  monthData?: unknown;        // 明示指定で monthRows を上書き（null テスト等）
  monthError?: { code?: string } | null;
  legacySlotsPerStaff?: number; // フォールバック時 get_available_slots が staff ごとに返す枠数
  hoursError?: unknown;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function setupDefaultMocks(opts: MockOpts = {}) {
  const {
    staffCount = 2,
    businessHours = null,
    monthSlots = 5,
    monthData,
    monthError = null,
    legacySlotsPerStaff = 5,
    hoursError = null,
  } = opts;

  const staffData = Array.from({ length: staffCount }, (_, i) => ({ id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000001` }));

  mockStaffSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({limit: jest.fn().mockImplementation(() => {
          const query = {gt: jest.fn().mockResolvedValue({data:[],error:null}),then: (resolve: (value: unknown) => unknown) => Promise.resolve({data:staffData,error:null}).then(resolve)};
          return query;
        })}),
      }),
    }),
  });

  mockRpc = jest.fn((fn: string, params: Record<string, number>) => {
    if (fn === 'get_month_availability') {
      if (monthError) return Promise.resolve({ data: null, error: monthError });
      if (monthData !== undefined) return Promise.resolve({ data: monthData, error: null });
      const days = daysInMonth(params.p_year, params.p_month);
      const rows = Array.from({ length: days }, (_, i) => ({
        d: `${params.p_year}-${String(params.p_month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
        slots: monthSlots,
      }));
      return Promise.resolve({ data: rows, error: null });
    }
    // get_available_slots（フォールバック経路）
    return Promise.resolve({
      data: Array.from({ length: legacySlotsPerStaff }, (_, i) => ({ slot_start: `${String(9 + i).padStart(2, '0')}:00` })),
    });
  });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  // facility_profiles（business_hours 取得）と staff_profiles で chain の形が違うため
  // テーブル名で出し分ける。単一の from を返すと business_hours 取得が壊れ、
  // ルート全体が catch されて 500 になる（休業日判定の追加で必要になった）。
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn((table: string) =>
      table === 'facility_profiles'
        ? {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { business_hours: businessHours }, error: hoursError }),
              }),
            }),
          }
        : { select: mockStaffSelect },
    ),
    rpc: mockRpc,
  });
}

beforeEach(() => {
  // The route runs availability RPCs through service_role; delegate to the per-test client stub.
  const supabaseServer = require('@/lib/supabase-server');
  supabaseServer.createServiceRoleClient.mockImplementation(() => supabaseServer.createServerSupabaseClient());
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
  jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: true, missing: [] }, error: null });
});

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const FUTURE_YEAR = new Date().getFullYear() + 1;

function makeRequest(
  facilityId: string = VALID_UUID,
  staffId?: string,
  year: number = FUTURE_YEAR,
  month: number = 6,
  ip = '192.168.1.1'
) {
  let url = `http://localhost/api/availability?facilityId=${facilityId}&year=${year}&month=${month}`;
  if (staffId) url += `&staffId=${staffId}`;
  return new Request(url, { method: 'GET', headers: { 'x-forwarded-for': ip } });
}

describe('GET /api/availability', () => {
  test('掲載だけの施設は月次RPCも呼ばず準備中を返す', async () => {
    jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: false, missing: ['営業時間'] }, error: null });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dates: {}, bookingAvailable: false });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(checkBookingReadiness).toHaveBeenCalledWith(expect.anything(), VALID_UUID);
  });
  test('準備状態の読取失敗は予約なしの正常に変換しない', async () => {
    jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: false, missing: [] }, error: { message: 'unavailable' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(429);
  });

  test('missing facilityId → 400', async () => {
    const res = await GET(new Request('http://localhost/api/availability?year=2026&month=5', { method: 'GET' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid facilityId UUID → 400', async () => {
    const res = await GET(makeRequest('not-uuid') as any);
    expect(res.status).toBe(400);
  });

  test('invalid staffId UUID → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, 'not-uuid') as any);
    expect(res.status).toBe(400);
  });

  test('missing year → 400', async () => {
    const res = await GET(new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&month=5`, { method: 'GET' }) as any);
    expect(res.status).toBe(400);
  });

  test('missing month → 400', async () => {
    const res = await GET(new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&year=2026`, { method: 'GET' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid month (< 1) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 0) as any);
    expect(res.status).toBe(400);
  });

  test('invalid month (> 12) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 13) as any);
    expect(res.status).toBe(400);
  });

  test('year too far in past (< currentYear-1) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, new Date().getFullYear() - 2, 5) as any);
    expect(res.status).toBe(400);
  });

  test('year too far in future (> currentYear+2) → 400', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, new Date().getFullYear() + 3, 5) as any);
    expect(res.status).toBe(400);
  });

  test('valid request → 200 with dates object', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.dates).toBe('object');
  });

  test('fetches active staff for facility', async () => {
    await GET(makeRequest() as any);
    expect(mockStaffSelect).toHaveBeenCalledWith('id');
    const outerEq = mockStaffSelect.mock.results[0].value.eq;
    const innerEq = outerEq.mock.results[0].value.eq;
    expect(innerEq).toHaveBeenCalledWith('is_active', true);
  });

  test('all eleven active staff reach the aggregate instead of taking only ten', async () => {
    setupDefaultMocks({ staffCount: 11 });
    expect((await GET(makeRequest())).status).toBe(200);
    expect(mockRpc.mock.calls[0][1].p_staff_ids).toHaveLength(11);
  });

  test('no active staff → returns empty dates（RPC は呼ばれない）', async () => {
    setupDefaultMocks({ staffCount: 0 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.dates).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("past dates marked as 'past'（過去日は満席ではない）", async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 5) as any);
    const json = await res.json();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    Object.entries(json.dates).forEach(([date, info]: [string, any]) => {
      const dateObj = new Date(date + 'T00:00:00+09:00');
      if (dateObj < todayMidnight) {
        expect(info.status).toBe('past');
        expect(info.slots).toBe(0);
      }
    });
  });

  /**
   * 【2026年7月30日 追加・休業日と満席の区別】
   * 本番実測で、定休日（訪問専門 神原鍼灸院の木曜）の施設ページに赤字点滅で「本日満枠」と
   * 出ていた。0 枠を一律 full にしていたため、休んでいる日が「人気で埋まっている」と読めた。
   * business_hours の規約は get_available_slots（20260703000004）と同じにする。
   */
  describe('休業日（closed）の判定', () => {
    // 実行時期に依存しないよう、未来の月から「その曜日の最初の日」を計算して使う。
    // 固定日付を書くと年が変わった瞬間に曜日がずれ、時間経過でテストが壊れる。
    const YEAR = FUTURE_YEAR, MONTH = 6;
    const dayOf = (dow: number): string => {
      for (let d = 1; d <= 28; d++) {
        const iso = `${YEAR}-06-${String(d).padStart(2, '0')}`;
        if (new Date(`${iso}T00:00:00Z`).getUTCDay() === dow) return iso;
      }
      throw new Error('該当曜日が見つからない');
    };
    const THU = dayOf(4), FRI = dayOf(5), SUN = dayOf(0);

    test('曜日キーが存在して null → その曜日は closed（満席と区別する）', async () => {
      setupDefaultMocks({ monthSlots: 0, businessHours: { thu: null, sun: null } });
      const res = await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any);
      const json = await res.json();
      expect(json.dates[THU].status).toBe('closed');
      expect(json.dates[SUN].status).toBe('closed');
      expect(json.dates[FRI].status).toBe('full'); // 営業日で空きゼロは full のまま
    });

    test('前日から続く深夜営業があれば、当日の営業開始が休みでも closed にしない', async () => {
      setupDefaultMocks({ monthSlots: 5, businessHours: { wed: { open: '18:00', close: '05:00' }, thu: null } });
      const json = await (await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any)).json();
      expect(json.dates[THU].status).toBe('available');
    });

    test('営業日は枠があれば closed にならない', async () => {
      setupDefaultMocks({ monthSlots: 5, businessHours: { thu: null } });
      const res = await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any);
      const json = await res.json();
      expect(json.dates[THU].status).toBe('closed');
      expect(json.dates[FRI].status).toBe('available');
    });

    test('business_hours 未設定 → ゲートしない（SQL 側と同じ後方互換）', async () => {
      setupDefaultMocks({ monthSlots: 0, businessHours: null });
      const res = await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any);
      const json = await res.json();
      expect(Object.values(json.dates).every((d: any) => d.status !== 'closed')).toBe(true);
    });

    test('曜日キーが無い → その曜日はゲートしない', async () => {
      setupDefaultMocks({ monthSlots: 0, businessHours: { mon: { open: '09:00', close: '18:00' } } });
      const res = await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any);
      const json = await res.json();
      expect(json.dates[THU].status).toBe('full');
    });

    test('フォールバック経路でも休業日を closed にする', async () => {
      setupDefaultMocks({
        monthError: { code: 'PGRST202' }, staffCount: 1, legacySlotsPerStaff: 0,
        businessHours: { thu: null },
      });
      const res = await GET(makeRequest(VALID_UUID, undefined, YEAR, MONTH) as any);
      const json = await res.json();
      expect(json.dates[THU].status).toBe('closed');
    });
  });

  test('集約 RPC get_month_availability を 1 回呼ぶ（N+1 解消・高速パス）', async () => {
    await GET(makeRequest() as any);
    const monthCalls = mockRpc.mock.calls.filter((c) => c[0] === 'get_month_availability');
    expect(monthCalls).toHaveLength(1);
    expect(monthCalls[0][1]).toEqual({
      p_facility_id: VALID_UUID,
      p_staff_ids: ['00000001-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001'],
      p_year: FUTURE_YEAR,
      p_month: 6,
      p_duration_minutes: 60,
    });
    // 高速パスでは個別 get_available_slots は呼ばれない
    expect(mockRpc.mock.calls.some((c) => c[0] === 'get_available_slots')).toBe(false);
  });

  test('集約 slots>=3 → status=available（3 で丸め）', async () => {
    setupDefaultMocks({ monthSlots: 8 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const available = Object.values(json.dates).find((d: any) => d.status === 'available');
    expect(available).toBeDefined();
    expect((available as any).slots).toBe(3);
  });

  test('集約 slots 1〜2 → status=few', async () => {
    setupDefaultMocks({ monthSlots: 2 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const few = Object.values(json.dates).find((d: any) => d.status === 'few');
    expect(few).toBeDefined();
    expect((few as any).slots).toBe(2);
  });

  test('集約 slots=0 → 未来日も status=full', async () => {
    setupDefaultMocks({ monthSlots: 0 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const nonFull = Object.values(json.dates).filter((d: any) => d.status !== 'full');
    expect(nonFull).toHaveLength(0);
  });

  test.each([null, [], [{d: `${FUTURE_YEAR}-06-15`, slots:8}]])('incomplete monthly result never fabricates full days %#', async monthData => {
    setupDefaultMocks({monthData});
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).dates).toBeUndefined();
  });

  test('集約関数未デプロイ（PGRST202）→ get_available_slots ループにフォールバック', async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, legacySlotsPerStaff: 5 });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // フォールバックでは get_available_slots が呼ばれ、status が算出される
    expect(mockRpc.mock.calls.some((c) => c[0] === 'get_available_slots')).toBe(true);
    const available = Object.values(json.dates).find((d: any) => d.status === 'available');
    expect(available).toBeDefined();
  });

  test('フォールバック: 1 枠のみ → few / 早期 break しない', async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 1, legacySlotsPerStaff: 1 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const few = Object.values(json.dates).find((d: any) => d.status === 'few');
    expect(few).toBeDefined();
    expect((few as any).slots).toBe(1);
  });

  test('フォールバック: 0 枠 → full', async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 1, legacySlotsPerStaff: 0 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const nonFull = Object.values(json.dates).filter((d: any) => d.status !== 'full');
    expect(nonFull).toHaveLength(0);
  });

  test('フォールバック: 2 スタッフで 1 人目が 3 枠 → 早期 break（2 人目 RPC なし）', async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 2, legacySlotsPerStaff: 3 });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    const available = Object.values(json.dates).find((d: any) => d.status === 'available' && d.slots === 3);
    expect(available).toBeDefined();
  });

  test("フォールバック: 全日過去の月 → 過去日を 'past' にする（fallback isPast true 分岐）", async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 1, legacySlotsPerStaff: 1 });
    // currentYear-1 は検証内（year < currentYear-1 のみ 400）かつ全日が過去 → フォールバックの過去日分岐を通る
    const pastYear = new Date().getFullYear() - 1;
    const res = await GET(makeRequest(VALID_UUID, undefined, pastYear, 6) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    const all = Object.values(json.dates);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((d: any) => d.status === 'past' && d.slots === 0)).toBe(true);
    // 全日過去 → futureDates 空 → get_available_slots は呼ばれない
    expect(mockRpc.mock.calls.some((c) => c[0] === 'get_available_slots')).toBe(false);
  });

  test('null fallback result never fabricates full days', async () => {
    setupDefaultMocks({monthError:{code:'PGRST202'},staffCount:1});
    mockRpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});
    mockRpc.mockImplementation((fn:string) => Promise.resolve({data:null,error:fn==='get_month_availability'?{code:'PGRST202'}:null}));
    const res=await GET(makeRequest());expect(res.status).toBe(500);expect((await res.json()).dates).toBeUndefined();
  });

  test('フォールバックもDB失敗なら0枠・満席の成功応答にしない', async () => {
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 1 });
    mockRpc.mockImplementation((fn: string) => Promise.resolve({ data: null, error: { code: fn === 'get_month_availability' ? 'PGRST202' : '57014' } }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect((await res.json()).dates).toBeUndefined();
  });

  test('営業時間の再照合が失敗したらカレンダー成功応答にしない', async () => {
    setupDefaultMocks({ hoursError: { code: '57014' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect((await res.json()).dates).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('集約RPCがランタイムエラー（PGRST202 以外）→ 500 にせず従来ループにフォールバック', async () => {
    // 関数が schema cache 未反映や実データでランタイムエラーを返しても公開導線を止めない。
    // フォールバックは実データ再計算（legacySlotsPerStaff=5）→ available。
    setupDefaultMocks({ monthError: { code: '42883' }, staffCount: 1, legacySlotsPerStaff: 5 });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(mockRpc.mock.calls.some((c) => c[0] === 'get_available_slots')).toBe(true);
    const available = Object.values(json.dates).find((d: any) => d.status === 'available');
    expect(available).toBeDefined();
  });

  test('returns status available/few/full for each date', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    Object.values(json.dates).forEach((info: any) => {
      expect(['available', 'few', 'full']).toContain(info.status);
    });
  });

  test('includes slots count for each date', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    Object.values(json.dates).forEach((info: any) => {
      expect(typeof info.slots).toBe('number');
    });
  });

  test('staffId 指定 → 単一スタッフで集約 RPC を呼ぶ', async () => {
    const STAFF_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await GET(makeRequest(VALID_UUID, STAFF_UUID) as any);
    const monthCalls = mockRpc.mock.calls.filter((c) => c[0] === 'get_month_availability');
    expect(monthCalls[0][1].p_staff_ids).toEqual([STAFF_UUID]);
  });

  test('rate limit params (10 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest(VALID_UUID, undefined, 2026, 5, '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('availability');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest(VALID_UUID, undefined, 2026, 5, '10.0.0.1, 192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection failed');
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('dates include YYYY-MM-DD format', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 5) as any);
    const json = await res.json();
    Object.keys(json.dates).forEach((date: string) => {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test('pads month and day with leading zeros', async () => {
    const res = await GET(makeRequest(VALID_UUID, undefined, 2026, 1) as any);
    const json = await res.json();
    Object.keys(json.dates).forEach((date: string) => {
      expect(date).toMatch(/2026-01-\d{2}/);
    });
  });

  test('missing x-forwarded-for → uses "unknown" IP', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request(`http://localhost/api/availability?facilityId=${VALID_UUID}&year=2026&month=5`, { method: 'GET' });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('staffList null (?? []) → dates empty（RPC 未到達）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({limit: jest.fn().mockResolvedValue({ data: [], error:null })}),
            }),
          }),
        }),
      }),
      rpc: jest.fn(),
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.dates).toEqual({});
  });

  // Branch coverage: line 38 — staffId が指定された場合 staffIds=[staffId]（true 分岐・staff fetch スキップ）
  test('valid UUID staffId → staff fetch スキップ（line 38 true 分岐）', async () => {
    const STAFF_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    // business_hours 取得のため facility_profiles は必ず引く。ここで検証したいのは
    // 「staffId 指定時に staff_profiles を引かない」ことなので、テーブル名で判定する。
    const fromMock = jest.fn((table: string) =>
      table === 'facility_profiles'
        ? {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: { business_hours: null } }),
              }),
            }),
          }
        : { select: jest.fn() },
    );
    createServerSupabaseClient.mockReturnValue({
      from: fromMock,
      rpc: jest.fn((fn: string, params: Record<string, number>) => {
        if (fn === 'get_month_availability') {
          const days = daysInMonth(params.p_year, params.p_month);
          const rows = Array.from({ length: days }, (_, i) => ({
            d: `${params.p_year}-${String(params.p_month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
            slots: 0,
          }));
          return Promise.resolve({ data: rows, error: null });
        }
        return Promise.resolve({ data: [] });
      }),
    });
    const res = await GET(makeRequest(VALID_UUID, STAFF_UUID) as any);
    expect(fromMock.mock.calls.map((c) => c[0])).not.toContain('staff_profiles');
    expect(res.status).toBe(200);
  });
});

// AV-2: staff_profiles 取得エラーを握り潰さず 500 で顕在化する（空きカレンダー偽装の防止）
test('AV-2: staff_profiles 取得エラー → 500', async () => {
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })}),
          }),
        }),
      }),
    }),
    rpc: mockRpc,
  });
  const res = await GET(makeRequest()); // staffId 未指定 → staff_profiles クエリが走る
  expect(res.status).toBe(500);
});

test('availability RPCs run through the service-role client, never anon PostgREST directly', async () => {
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  expect(jest.isMockFunction(createServiceRoleClient)).toBe(true);
  const source = require('fs').readFileSync(require('path').join(process.cwd(), 'src/app/api/availability/route.ts'), 'utf8');
  expect(source).not.toMatch(/supabase\.rpc\('get_(available_slots|month_availability)'/);
});

// 2026年10月23日: 当日の「本日空き」が開始時刻（JST）を過ぎた枠まで数えていた。
// 集約 RPC は日単位の件数しか返さないため、当日だけ「これから始まる枠」で数え直す。
describe('当日は開始時刻を過ぎた枠を数えない', () => {
  afterEach(() => { jest.useRealTimers(); });
  const at = (iso: string) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date(iso));
  };

  test('JST 12:00 には 9〜12時の枠を数えず、当日は few になる（他の日は集約値のまま）', async () => {
    at('2027-06-10T03:00:00Z'); // JST 2027-06-10 12:00
    setupDefaultMocks({ monthSlots: 5, legacySlotsPerStaff: 5 }); // 09:00〜13:00
    const res = await GET(makeRequest(VALID_UUID, undefined, 2027, 6));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dates['2027-06-10']).toEqual({ slots: 2, status: 'few' }); // 13:00 × 2人
    expect(json.dates['2027-06-11']).toEqual({ slots: 3, status: 'available' });
    expect(json.dates['2027-06-09'].status).toBe('past');
    const dayCalls = mockRpc.mock.calls.filter((c) => c[0] === 'get_available_slots');
    expect(dayCalls.map((c) => c[1].p_date)).toEqual(['2027-06-10', '2027-06-10']);
  });

  test('当日の枠がすべて過ぎていれば full（空き扱いにしない）', async () => {
    at('2027-06-10T05:00:00Z'); // JST 14:00
    setupDefaultMocks({ monthSlots: 5, legacySlotsPerStaff: 5 });
    const json = await (await GET(makeRequest(VALID_UUID, undefined, 2027, 6))).json();
    expect(json.dates['2027-06-10']).toEqual({ slots: 0, status: 'full' });
  });

  test('UTC ではまだ前日の JST 早朝も、当日（JST）の枠を数え直す', async () => {
    at('2027-06-09T16:00:00Z'); // JST 2027-06-10 01:00
    setupDefaultMocks({ monthSlots: 0, legacySlotsPerStaff: 5 });
    const json = await (await GET(makeRequest(VALID_UUID, undefined, 2027, 6))).json();
    expect(json.dates['2027-06-10'].status).toBe('available');
    expect(json.dates['2027-06-09'].status).toBe('past');
  });

  test('当日が定休日なら数え直さず closed', async () => {
    at('2027-06-10T03:00:00Z'); // 2027-06-10 は木曜
    setupDefaultMocks({ monthSlots: 5, businessHours: { thu: null } });
    const json = await (await GET(makeRequest(VALID_UUID, undefined, 2027, 6))).json();
    expect(json.dates['2027-06-10'].status).toBe('closed');
    expect(mockRpc.mock.calls.some((c) => c[0] === 'get_available_slots')).toBe(false);
  });

  test('当日の数え直しが失敗したら成功応答にしない', async () => {
    at('2027-06-10T03:00:00Z');
    setupDefaultMocks({ monthSlots: 5 });
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation((fn: string, params: Record<string, number>) =>
      fn === 'get_available_slots' ? Promise.resolve({ data: null, error: { code: '57014' } }) : base(fn, params));
    const res = await GET(makeRequest(VALID_UUID, undefined, 2027, 6));
    expect(res.status).toBe(500);
  });

  test('フォールバック経路でも当日は過ぎた枠を数えない', async () => {
    at('2027-06-10T03:00:00Z');
    setupDefaultMocks({ monthError: { code: 'PGRST202' }, staffCount: 1, legacySlotsPerStaff: 5 });
    const json = await (await GET(makeRequest(VALID_UUID, undefined, 2027, 6))).json();
    expect(json.dates['2027-06-10']).toEqual({ slots: 1, status: 'few' });
    expect(json.dates['2027-06-11'].status).toBe('available');
  });
});
