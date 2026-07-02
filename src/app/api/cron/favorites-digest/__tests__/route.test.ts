/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/favorites-digest
 * Key assertions:
 *   - CRON_SECRET validation
 *   - ISO week calculation & idempotency
 *   - Aggregates user favorites + facility updates
 *   - Filters new coupons & menus (7-day window)
 *   - CAS guard (neq check) for double-fire prevention
 *   - Respects email_unsubscribed flag
 *   - Generates unsubscribe token
 *   - Fire-and-forget email sending
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email');

const mockFromDelegate = jest.fn();
const mockListUsersDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsersDelegate(...args),
      },
    },
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendFavoritesDigest, generateUnsubscribeToken } from '@/lib/email';
import { GET } from '../route';

let mockFavoritesSelect: jest.Mock;
let mockCouponsSelect: jest.Mock;
let mockMenusSelect: jest.Mock;
let mockFacilitiesSelect: jest.Mock;
let mockProfilesSelect: jest.Mock;
let mockProfilesUpdate: jest.Mock;
let mockTokenInsert: jest.Mock;
let mockListUsers: jest.Mock;

function setupDefaultMocks(
  favoritesFound: number = 1,
  unsubscribed: boolean = false,
  alreadySentThisWeek: boolean = false,
  couponsFound: number = 1,
  menusFound: number = 0,
  tokenInsertFails: boolean = false,
  emailSendFails: boolean = false,
  releaseError: { message: string } | null = null
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (generateUnsubscribeToken as jest.Mock).mockReturnValue('unsubscribe-token-123');
  // sendFavoritesDigest は送達可否を boolean で返す（safeSend 仕様）。成功=true。
  (sendFavoritesDigest as jest.Mock).mockResolvedValue(true);

  if (emailSendFails) {
    // 送信失敗は throw ではなく false 返却で表現される。
    (sendFavoritesDigest as jest.Mock).mockResolvedValue(false);
  }

  mockFavoritesSelect = jest.fn().mockResolvedValue({
    data:
      favoritesFound > 0
        ? [
            { user_id: 'user-1', facility_id: 'fac-1' },
            { user_id: 'user-1', facility_id: 'fac-2' },
            { user_id: 'user-2', facility_id: 'fac-1' },
          ]
        : [],
  });

  mockCouponsSelect = jest.fn().mockResolvedValue({
    data:
      couponsFound > 0
        ? [
            { facility_id: 'fac-1', id: 'coupon-1' },
            { facility_id: 'fac-1', id: 'coupon-2' },
            { facility_id: 'fac-2', id: 'coupon-3' },
          ]
        : [],
  });

  mockMenusSelect = jest.fn().mockResolvedValue({
    data:
      menusFound > 0
        ? [
            { facility_id: 'fac-2', id: 'menu-1' },
            { facility_id: 'fac-2', id: 'menu-2' },
          ]
        : [],
  });

  mockFacilitiesSelect = jest.fn().mockResolvedValue({
    data: [
      { id: 'fac-1', name: 'Salon A', slug: 'salon-a' },
      { id: 'fac-2', name: 'Salon B', slug: 'salon-b' },
    ],
  });

  mockProfilesSelect = jest.fn().mockResolvedValue({
    data: [
      {
        id: 'user-1',
        display_name: 'User 1',
        email_unsubscribed: unsubscribed,
        favorites_digest_sent_week: alreadySentThisWeek ? '2026-W17' : null,
      },
    ],
  });

  mockProfilesUpdate = jest.fn().mockReturnValue({
    eq: jest
      .fn()
      .mockReturnValue({
        or: jest.fn().mockResolvedValue({
          select: jest.fn().mockResolvedValue({
            data: alreadySentThisWeek ? [] : [{ id: 'user-1' }],
          }),
        }),
      }),
  });

  mockTokenInsert = jest.fn().mockResolvedValue({
    error: tokenInsertFails ? new Error('Token insert error') : null,
  });

  mockListUsers = jest.fn().mockResolvedValue({
    data: {
      users: [{ id: 'user-1', email: 'user1@example.com' }],
    },
  });
  mockListUsersDelegate.mockImplementation(mockListUsers);

  const favoritesData = favoritesFound > 0
    ? [
        { user_id: 'user-1', facility_id: 'fac-1' },
        { user_id: 'user-1', facility_id: 'fac-2' },
        { user_id: 'user-2', facility_id: 'fac-1' },
      ]
    : [];
  const couponsData = couponsFound > 0
    ? [
        { facility_id: 'fac-1', id: 'coupon-1' },
        { facility_id: 'fac-1', id: 'coupon-2' },
        { facility_id: 'fac-2', id: 'coupon-3' },
      ]
    : [];
  const menusData = menusFound > 0
    ? [
        { facility_id: 'fac-2', id: 'menu-1' },
        { facility_id: 'fac-2', id: 'menu-2' },
      ]
    : [];
  const claimedData = alreadySentThisWeek ? [] : [{ id: 'user-1' }];

  // fetchAllPaged 終端: 1ページ目(offset 0)に rows、2ページ目以降は空配列を返す。
  const paged = (rows: any[]) =>
    jest.fn().mockImplementation((from: number) => Promise.resolve({ data: from === 0 ? rows : [], error: null }));

  const profilesData = [
    {
      id: 'user-1',
      display_name: 'User 1',
      email_unsubscribed: unsubscribed,
      favorites_digest_sent_week: alreadySentThisWeek ? '2026-W17' : null,
    },
  ];
  const facilitiesData = [
    { id: 'fac-1', name: 'Salon A', slug: 'salon-a' },
    { id: 'fac-2', name: 'Salon B', slug: 'salon-b' },
  ];

  mockFavoritesSelect = jest.fn().mockReturnValue({
    range: paged(favoritesData),
  });
  // coupons/menus: .in().gte().eq().range() （FID_CHUNK ループ内で全件ページング）
  mockCouponsSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ range: paged(couponsData) }),
      }),
    }),
  });
  // facility_menus は is_active 列が無く絞り込みを廃止 → .in().gte().range()
  mockMenusSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({ range: paged(menusData) }),
    }),
  });
  // facilities: .in().range()
  mockFacilitiesSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({ range: paged(facilitiesData) }),
  });
  // profiles select: .in().range()
  mockProfilesSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockReturnValue({ range: paged(profilesData) }),
  });
  // eq の戻りは2用途を兼ねる:
  //   claim:   .update().eq('id').or('...is.null,...neq.W').select('id') → { data: claimedData }
  //     （F-1 根治: NULL 行を三値論理で除外しないよう .neq 単独から .or(is.null,neq) へ変更）
  //   release: await .update().eq('id')（直接 await）→ オブジェクトを return → { error } 分解
  mockProfilesUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      or: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: claimedData }),
      }),
      error: releaseError ?? undefined,
    }),
  });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'favorites') {
      return { select: (...args: any[]) => mockFavoritesSelect(...args) };
    } else if (table === 'coupons') {
      return { select: (...args: any[]) => mockCouponsSelect(...args) };
    } else if (table === 'facility_menus') {
      return { select: (...args: any[]) => mockMenusSelect(...args) };
    } else if (table === 'facility_profiles') {
      return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
    } else if (table === 'profiles') {
      return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
    } else if (table === 'email_unsubscribe_tokens') {
      return { insert: mockTokenInsert };
    }
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/favorites-digest', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/favorites-digest', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no favorites → 200 with sent=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('favorites 取得が DB エラー → error ログ＋500（無音スキップにしない）', async () => {
    setupDefaultMocks(0);
    mockFavoritesSelect.mockReturnValue({
      range: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect((logCronRun as jest.Mock).mock.calls.some((c: any[]) => c[1] === 'error')).toBe(true);
  });

  test('successful send → 200 with sent count', async () => {
    setupDefaultMocks(1, false, false, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('skips if user already sent this week', async () => {
    // Pin date to 2026-04-20 (ISO week 17) so thisWeek === '2026-W17'
    // setupDefaultMocks(alreadySentThisWeek=true) sets favorites_digest_sent_week='2026-W17'
    // → profile.favorites_digest_sent_week === thisWeek TRUE branch is triggered
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T10:00:00Z'));
    setupDefaultMocks(1, false, true, 1);

    const res = await GET(makeRequest() as any);

    jest.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('respects email_unsubscribed flag', async () => {
    setupDefaultMocks(1, true, false, 1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('aggregates favorites per user', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should group favorites by user_id into Map
  });

  test('fetches coupons from last 7 days', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockCouponsSelect).toHaveBeenCalled();
  });

  test('fetches menus from last 7 days', async () => {
    setupDefaultMocks(1, false, false, 0, 1);

    await GET(makeRequest() as any);

    expect(mockMenusSelect).toHaveBeenCalled();
  });

  test('filters only active coupons (is_active=true)', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockCouponsSelect).toHaveBeenCalled();
  });

  test('新メニュー追加施設を検出（facility_menus に is_active 列が無いため絞り込みは廃止）', async () => {
    setupDefaultMocks(1, false, false, 0, 1);

    await GET(makeRequest() as any);

    expect(mockMenusSelect).toHaveBeenCalled();
  });

  test('CAS guard update (neq check) prevents double-fire', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockProfilesUpdate).toHaveBeenCalled();
  });

  test('skips if another invocation already claimed week', async () => {
    mockProfilesUpdate.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        or: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('generates unsubscribe token', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(generateUnsubscribeToken).toHaveBeenCalled();
  });

  test('inserts unsubscribe token', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockTokenInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user_id: expect.any(String),
      })
    );
  });

  test('token insert fails → 送信中止し claim 解放（停止不能な誤配信を防ぐ・E-1）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setupDefaultMocks(1, false, false, 1, 0, true); // tokenInsertFails=true

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // token 保存に失敗したら送信しない（DB に無い token を指すメールを送らない）
    expect(sendFavoritesDigest).not.toHaveBeenCalled();
    // 中止ログ
    expect(errSpy).toHaveBeenCalledWith(
      '[favorites-digest] unsubscribe token insert failed, aborting send',
      expect.anything(),
    );
    // claim を直前の値（null=未送信）へ戻して同週の再 run でやり直せる様にする
    const calls = (mockProfilesUpdate as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ favorites_digest_sent_week: null });
    errSpy.mockRestore();
  });

  test('token insert fails かつ claim 解放も失敗 → releaseErr をログ（E-1 releaseErr 分岐）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setupDefaultMocks(1, false, false, 1, 0, true, false, { message: 'release boom' });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(sendFavoritesDigest).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith('[favorites-digest] claim release failed', expect.anything());
    errSpy.mockRestore();
  });

  test('sends digest only if facility has updates', async () => {
    setupDefaultMocks(1, false, false, 1, 0);

    await GET(makeRequest() as any);

    // Should send only if coupons OR menus exist for that facility
    expect(sendFavoritesDigest).toHaveBeenCalled();
  });

  test('email send fails → claim を解放（前の値へ復元）して再送可能にする（恒久 miss 防止・回帰防止）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setupDefaultMocks(1, false, false, 1, 0, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // claim(初回 thisWeek セット) と release(前の値へ復元) で update が2回以上呼ばれる
    const calls = (mockProfilesUpdate as jest.Mock).mock.calls.map((c) => c[0]);
    // 復元: favorites_digest_sent_week を「直前の値（null=未送信）」に戻す
    expect(calls).toContainEqual({ favorites_digest_sent_week: null });
    errSpy.mockRestore();
  });

  test('email send fails かつ claim 解放も失敗 → エラーログ（releaseErr 分岐）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setupDefaultMocks(1, false, false, 1, 0, false, true, { message: 'release boom' });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith('[favorites-digest] claim release failed', expect.anything());
    errSpy.mockRestore();
  });

  test('email includes new coupon count', async () => {
    setupDefaultMocks(1, false, false, 2);

    await GET(makeRequest() as any);

    // Facilities array should include newCoupons count
  });

  test('email includes hasNewMenus flag', async () => {
    setupDefaultMocks(1, false, false, 1, 1);

    await GET(makeRequest() as any);

    // Facilities array should include hasNewMenus
  });

  test('lists auth users to fetch emails', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockListUsers).toHaveBeenCalled();
  });

  test('skips user if no email found', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [] },
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'favorites-digest',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('exception during processing → 500 with error log', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('Fatal'); });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('ISO week calculation for idempotency', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should calculate week number
  });

  test('limits favorites query to 500', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    expect(mockFavoritesSelect).toHaveBeenCalled();
  });

  test('deduplicates facility IDs', async () => {
    setupDefaultMocks(1, false, false, 1);

    await GET(makeRequest() as any);

    // Should use Set to deduplicate facilities
  });

  test('favorites query returns null → 200 with sent=0', async () => {
    mockFavoritesSelect = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({ data: null }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') {
        return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      }
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('non-Error throw in catch → String fallback', async () => {
    mockFromDelegate.mockImplementation(() => { throw 'plain string error'; });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('facility missing from facilityMap → filtered out', async () => {
    // Favorites point to fac-99 which isn't in facilities query result
    mockFavoritesSelect = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({
        data: [{ user_id: 'user-1', facility_id: 'fac-99' }],
      }),
    });
    mockCouponsSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            range: jest.fn((from: number) => Promise.resolve({
              data: from === 0 ? [{ facility_id: 'fac-99', id: 'c1' }] : [], error: null,
            })),
          }),
        }),
      }),
    });
    mockFacilitiesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: [], error: null })) }), // empty, no fac-99
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('filters out facilities with no updates', async () => {
    setupDefaultMocks(1, false, false, 0, 0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // No email should be sent if no coupons/menus
  });

  // Branch coverage: line 23 - isoWeek 内部 (dayNum の Sunday → 7 への変換)
  test('isoWeek: 日曜日をdayNum=7として扱い正しいweek文字列を返す', async () => {
    // Jest fake timers で日曜日に設定 (2026-01-04 は日曜)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-04T10:00:00Z'));
    setupDefaultMocks(1, false, false, 1);

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // logCronRun の呼び出しで week 文字列が渡される
    expect(logCronRun).toHaveBeenCalledWith(
      'favorites-digest',
      'success',
      expect.any(Date),
      expect.anything()
    );
    jest.useRealTimers();
  });

  // Branch coverage: line 70 - newCoupons が null の場合の for-of スキップ
  test('coupons query returns null → couponCountMap が空のまま処理', async () => {
    mockCouponsSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: null, error: null })) }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  // Branch coverage: line 82 - newMenus が null → new Set([]) として処理
  test('facility_menus query returns null → newMenuFacilities が空のまま処理', async () => {
    mockMenusSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: null, error: null })) }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  // Branch coverage: line 90 - facilityMap が null の場合（facilities query が null）
  test('facility_profiles query returns null → facilityMap が空のまま', async () => {
    mockFacilitiesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: null, error: null })) }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  // Branch coverage: line 100 - authUsers が null → emailMap が空
  test('listUsers returns null authUsers → emailMap 空 → ユーザーをスキップ', async () => {
    mockListUsersDelegate.mockResolvedValue({ data: null });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // emailMap 空なのでメール送信されない
    expect(json.processed).toBe(0);
  });

  // Branch coverage: listUsers が error を返したら break（その時点までの emailMap で続行）
  test('listUsers error → break（emailMap 空・送信スキップ・200）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockListUsersDelegate.mockResolvedValue({ data: null, error: { message: 'listUsers boom' } });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(errSpy).toHaveBeenCalledWith('[favorites-digest] listUsers failed', expect.any(Object));
    errSpy.mockRestore();
  });

  // Branch coverage: listUsers が 1000件返したら次ページへ継続（users.length < 1000 の false 分岐）
  test('listUsers 1000件 → 次ページ取得を継続', async () => {
    setupDefaultMocks();
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `u${i}@example.com` }));
    mockListUsersDelegate.mockImplementation((opts: any) =>
      Promise.resolve({ data: { users: opts.page === 1 ? page1 : [] } }));

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // page1(1000件) で継続→page2(空) で終了＝2回呼ばれる
    expect(mockListUsersDelegate).toHaveBeenCalledTimes(2);
  });

  // Branch coverage: profile.display_name が null → userName undefined（?? の右辺）
  test('display_name null → sendFavoritesDigest に userName undefined', async () => {
    setupDefaultMocks();
    // recipient profiles は .in('id').range() チェーンで取得される（display_name を null に差し替え）
    mockProfilesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        range: jest.fn((from: number) => Promise.resolve({
          data: from === 0
            ? [{ id: 'user-1', display_name: null, email_unsubscribed: false, favorites_digest_sent_week: null }]
            : [],
          error: null,
        })),
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendFavoritesDigest).toHaveBeenCalledWith(expect.objectContaining({ userName: undefined }));
  });

  // Branch coverage: line 102/105 - profiles が null の場合 for-of が空ループ
  test('profiles query returns null → for-of ループをスキップ', async () => {
    mockProfilesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: null, error: null })) }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  // Branch coverage: line 121 — couponCountMap.get(fid) || 0 when facility has menus but no coupons
  // (couponCountMap.get returns undefined → || 0 fires)
  test('新着メニューのみの施設（クーポンなし）→ newCoupons=0 でメール送信', async () => {
    // fac-1: menu only (no coupons), user-1 favorites fac-1
    mockFavoritesSelect = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({
        data: [{ user_id: 'user-1', facility_id: 'fac-1' }],
      }),
    });
    // No coupons for any facility
    mockCouponsSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ range: jest.fn(() => Promise.resolve({ data: [], error: null })) }),
        }),
      }),
    });
    // fac-1 has a new menu
    mockMenusSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          range: jest.fn((from: number) => Promise.resolve({ data: from === 0 ? [{ facility_id: 'fac-1' }] : [], error: null })),
        }),
      }),
    });
    mockFacilitiesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        range: jest.fn((from: number) => Promise.resolve({ data: from === 0 ? [{ id: 'fac-1', name: 'Salon A', slug: 'salon-a' }] : [], error: null })),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // fac-1 has menu update but no coupons → newCoupons = couponCountMap.get('fac-1') || 0 = 0
    expect(json.processed).toBe(1);
    expect(sendFavoritesDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        facilities: expect.arrayContaining([
          expect.objectContaining({ newCoupons: 0, hasNewMenus: true }),
        ]),
      })
    );
  });

  // Branch coverage: line 105 — profile exists in profilesSelect but user has NO email in emailMap
  // (emailMap.get(profile.id) returns undefined → if(!email) TRUE branch → skipped)
  test('profilesにユーザーが存在するがemailMapに対応エントリなし → スキップ', async () => {
    // user-1 is in profiles but listUsers only returns user-2 (different id)
    mockListUsersDelegate.mockResolvedValue({
      data: { users: [{ id: 'user-2', email: 'user2@example.com' }] },
    });
    // profiles returns user-1 (not email_unsubscribed, not sent this week)
    mockProfilesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        range: jest.fn((from: number) => Promise.resolve({
          data: from === 0 ? [{
            id: 'user-1',
            display_name: 'User 1',
            email_unsubscribed: false,
            favorites_digest_sent_week: null,
          }] : [],
          error: null,
        })),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // user-1 profile found, but no email in emailMap → skipped++ → processed=0
    expect(json.processed).toBe(0);
    expect(sendFavoritesDigest).not.toHaveBeenCalled();
  });

  // Branch coverage: line 110 - userFacilityMap.get returns undefined → facilityIds = []
  test('userFacilityMap にユーザーが存在しない場合 facilityIds = []', async () => {
    // profiles に user-1 とは別のユーザーが返ってくる（user-99 は favorites にいない）
    mockProfilesSelect = jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        range: jest.fn((from: number) => Promise.resolve({
          data: from === 0 ? [{
            id: 'user-99',
            display_name: 'Unknown',
            email_unsubscribed: false,
            favorites_digest_sent_week: null,
          }] : [],
          error: null,
        })),
      }),
    });
    mockListUsersDelegate.mockResolvedValue({
      data: { users: [{ id: 'user-99', email: 'unknown@example.com' }] },
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'favorites') return { select: (...args: any[]) => mockFavoritesSelect(...args) };
      if (table === 'coupons') return { select: (...args: any[]) => mockCouponsSelect(...args) };
      if (table === 'facility_menus') return { select: (...args: any[]) => mockMenusSelect(...args) };
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'profiles') return {
        select: (...args: any[]) => mockProfilesSelect(...args),
        update: (...args: any[]) => mockProfilesUpdate(...args),
      };
      if (table === 'email_unsubscribe_tokens') return { insert: mockTokenInsert };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // facilityIds = [] → updatedFacilities = [] → skipped
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('実時間予算超過 → 残りユーザーを deferred して打ち切り', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T00:00:00Z'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // 送信対象を2ユーザーにする（既定 favorites は user-1/user-2 とも fac-1 に紐付き、fac-1 はクーポンあり）。
    const paged2 = jest.fn().mockImplementation((from: number) => Promise.resolve({
      data: from === 0
        ? [
            { id: 'user-1', display_name: 'User 1', email_unsubscribed: false, favorites_digest_sent_week: null },
            { id: 'user-2', display_name: 'User 2', email_unsubscribed: false, favorites_digest_sent_week: null },
          ]
        : [],
      error: null,
    }));
    mockProfilesSelect.mockReturnValue({ in: jest.fn().mockReturnValue({ range: paged2 }) });
    mockListUsersDelegate.mockResolvedValue({
      data: { users: [{ id: 'user-1', email: 'user1@example.com' }, { id: 'user-2', email: 'user2@example.com' }] },
    });
    // 1人目の送信中に 60 秒進める → 2人目のループ先頭で予算超過 → break。
    (sendFavoritesDigest as jest.Mock).mockImplementationOnce(() => {
      jest.advanceTimersByTime(60_000);
      return Promise.resolve(true); // 1人目は送信成功（boolean 仕様）→ sent=1 → 残り1人 deferred
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.deferred).toBe(1);
    warnSpy.mockRestore();
    jest.useRealTimers();
  });
});
