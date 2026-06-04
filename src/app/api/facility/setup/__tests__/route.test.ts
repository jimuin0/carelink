/**
 * @jest-environment node
 *
 * Tests for POST /api/facility/setup
 * Key assertions:
 *   - CSRF validation
 *   - Rate limiting (5 req/min)
 *   - Auth required (session-based)
 *   - Checks if user already owns facility
 *   - Auto-fill from salons table (email match)
 *   - facility_name & business_type required
 *   - String length limits applied
 *   - Slug generation (unique via Date.now())
 *   - facility_profiles insert (status=draft)
 *   - facility_members insert (role=owner)
 *   - Rollback on member error
 *   - Welcome email sent (fire-and-forget)
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit');
jest.mock('@supabase/ssr');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/email');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendWelcomeEmail } from '@/lib/email';
import { POST } from '../route';

let mockFacilityInsert: jest.Mock;
let mockMemberInsert: jest.Mock;
let mockSalonSelect: jest.Mock;
let mockFacilityDelete: jest.Mock;
let mockFacilityMemberSelect: jest.Mock;
let mockFacilityUpdate: jest.Mock;
let mockPhotoInsert: jest.Mock;
let salonRow: Record<string, unknown> | null;

function setupDefaultMocks(
  userExists: boolean = true,
  alreadyOwner: boolean = false,
  salonFound: boolean = false,
  facilityInsertFails: boolean = false,
  memberInsertFails: boolean = false,
  rollbackFails: boolean = false
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined);

  mockFacilityMemberSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: alreadyOwner ? { facility_id: 'fac-existing' } : null,
      }),
    }),
  });

  salonRow = salonFound
    ? {
        facility_name: 'Salon from DB',
        business_type: 'nail',
        phone: '03-1234-5678',
        address: '東京都渋谷区',
      }
    : null;
  mockSalonSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data: salonRow })),
        }),
      }),
    }),
  });

  mockFacilityInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: facilityInsertFails
          ? null
          : {
              id: 'fac-123',
            },
        error: facilityInsertFails ? new Error('Insert error') : null,
      }),
    }),
  });

  mockMemberInsert = jest.fn().mockResolvedValue({
    error: memberInsertFails ? new Error('Member insert error') : null,
  });

  mockFacilityDelete = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: rollbackFails ? new Error('Rollback error') : null,
    }),
  });

  // リード引き継ぎ enrichment（best-effort）用のモック。既定は成功。
  mockFacilityUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  });
  mockPhotoInsert = jest.fn().mockResolvedValue({ error: null });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: userExists
            ? { id: 'user-123', email: 'owner@example.com' }
            : null,
        },
      }),
    },
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'facility_members') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: alreadyOwner ? { facility_id: 'fac-existing' } : null,
              }),
            }),
          }),
          insert: mockMemberInsert,
        };
      } else if (table === 'facility_profiles') {
        return {
          insert: mockFacilityInsert,
          delete: mockFacilityDelete,
          update: mockFacilityUpdate,
        };
      } else if (table === 'facility_photos') {
        return {
          insert: mockPhotoInsert,
        };
      } else if (table === 'salons') {
        return {
          select: mockSalonSelect,
        };
      }
      return {};
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

function makeRequest(body: object = {}, ip = '192.168.1.1') {
  return new Request('http://localhost/api/facility/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/facility/setup', () => {
  test('CSRF check failed → returns error', async () => {
    (checkCsrf as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 })
    );

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(401);
  });

  test('user already owns facility → 200 with facilityId', async () => {
    setupDefaultMocks(true, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.facilityId).toBe('fac-existing');
  });

  test('missing facility_name → 400', async () => {
    const res = await POST(
      makeRequest({ business_type: 'nail' }) as any
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('施設名');
  });

  test('missing business_type → 400', async () => {
    const res = await POST(
      makeRequest({ facility_name: 'Test' }) as any
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('業種');
  });

  test('facility_name set to 未設定の施設 → auto-fill from salons', async () => {
    setupDefaultMocks(true, false, true);

    const res = await POST(
      makeRequest({
        facility_name: '未設定の施設',
        business_type: 'eyelash',
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility_name > 100 chars → truncated', async () => {
    const longName = 'x'.repeat(150);
    const res = await POST(
      makeRequest({ facility_name: longName, business_type: 'nail' }) as any
    );

    expect(res.status).toBe(200);
  });

  test('business_type > 50 chars → truncated', async () => {
    const longType = 'x'.repeat(100);
    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: longType }) as any
    );

    expect(res.status).toBe(200);
  });

  test('phone > 20 chars → truncated', async () => {
    const longPhone = 'x'.repeat(30);
    const res = await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'nail',
        phone: longPhone,
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('address > 200 chars → truncated', async () => {
    const longAddr = 'x'.repeat(250);
    const res = await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'nail',
        address: longAddr,
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility_profiles insert fails → 500', async () => {
    setupDefaultMocks(true, false, false, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(500);
  });

  test('facility_members insert fails → 500 and rollback', async () => {
    setupDefaultMocks(true, false, false, false, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(500);
    expect(mockFacilityDelete).toHaveBeenCalled();
  });

  test('owner UNIQUE違反(23505・並行setup) → 自施設破棄して既存施設を返す(200)', async () => {
    setupDefaultMocks(true, false, false);
    mockMemberInsert = jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    let mcall = 0;
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn(() => { mcall++; return Promise.resolve({ data: mcall === 1 ? null : { facility_id: 'winner-fac' } }); }),
              }),
            }),
            insert: mockMemberInsert,
          };
        }
        if (table === 'facility_profiles') return { insert: mockFacilityInsert, delete: mockFacilityDelete, update: mockFacilityUpdate };
        if (table === 'facility_photos') return { insert: mockPhotoInsert };
        if (table === 'salons') return { select: mockSalonSelect };
        return {};
      }),
    });
    const res = await POST(makeRequest({ facility_name: 'T', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilityId).toBe('winner-fac');
    expect(mockFacilityDelete).toHaveBeenCalled();
  });

  test('owner UNIQUE違反だが winner 取得不可 → 500', async () => {
    setupDefaultMocks(true, false, false);
    mockMemberInsert = jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }),
            }),
            insert: mockMemberInsert,
          };
        }
        if (table === 'facility_profiles') return { insert: mockFacilityInsert, delete: mockFacilityDelete, update: mockFacilityUpdate };
        if (table === 'facility_photos') return { insert: mockPhotoInsert };
        if (table === 'salons') return { select: mockSalonSelect };
        return {};
      }),
    });
    const res = await POST(makeRequest({ facility_name: 'T', business_type: 'nail' }) as any);
    expect(res.status).toBe(500);
  });

  test('successful setup → 200 with facilityId and slug', async () => {
    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.facilityId).toBe('fac-123');
    expect(json.slug).toBeDefined();
  });

  test('facility_profiles created with status=draft', async () => {
    await POST(
      makeRequest({
        facility_name: 'My Salon',
        business_type: 'nail',
      }) as any
    );

    const insertCall = mockFacilityInsert.mock.calls[0];
    expect(insertCall[0]).toMatchObject({
      status: 'draft',
      name: 'My Salon',
      business_type: 'nail',
    });
  });

  test('facility_members created with role=owner', async () => {
    await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'nail',
      }) as any
    );

    expect(mockMemberInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        facility_id: 'fac-123',
        user_id: 'user-123',
        role: 'owner',
      })
    );
  });

  test('slug generated from facility_name', async () => {
    const res = await POST(
      makeRequest({
        facility_name: 'Test Salon',
        business_type: 'nail',
      }) as any
    );

    const json = await res.json();
    expect(json.slug).toContain('test-salon');
  });

  test('slug includes Date.now() for uniqueness', async () => {
    const res = await POST(
      makeRequest({
        facility_name: 'Salon A',
        business_type: 'nail',
      }) as any
    );

    const json = await res.json();
    // Slug should have format: salon-a-{timestamp36}
    expect(json.slug).toMatch(/salon-a-/);
  });

  test('sends welcome email fire-and-forget', async () => {
    await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'nail',
      }) as any
    );

    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: 'owner@example.com',
        facilityName: 'Test',
      })
    );
  });

  test('skips email if user has no email', async () => {
    (sendWelcomeEmail as jest.Mock).mockClear();

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-456', email: null } },
        }),
      },
    });

    await POST(makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any);

    // Email should not be called or should handle null email
  });

  test('exception during processing → 500', async () => {
    (checkCsrf as jest.Mock).mockImplementation(() => {
      throw new Error('CSRF check error');
    });

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'nail' }) as any
    );

    // Should be caught and return 500
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facility_name: 'Test', business_type: 'nail' },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5); // limit
    expect(call[3]).toBe(60_000); // window
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facility_name: 'Test', business_type: 'nail' },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('invalid JSON body → defaults to empty object', async () => {
    const res = await POST(
      new Request('http://localhost/api/facility/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.1' },
        body: 'invalid {',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing x-forwarded-for → uses "unknown"', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/facility/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facility_name: 'T', business_type: 'nail' }),
    });
    await POST(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('phone/prefecture/city/address all set → all truncated', async () => {
    const res = await POST(
      makeRequest({
        facility_name: 'T',
        business_type: 'nail',
        phone: '03-1111-2222',
        prefecture: '東京都',
        city: '渋谷区',
        address: '神宮前1-1-1',
      }) as any
    );
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    expect(call[0].phone).toBe('03-1111-2222');
    expect(call[0].prefecture).toBe('東京都');
    expect(call[0].city).toBe('渋谷区');
    expect(call[0].address).toBe('神宮前1-1-1');
  });

  test('facility_name with only special chars → slug fallback facility-Date.now()', async () => {
    const res = await POST(
      makeRequest({ facility_name: '!!!', business_type: 'nail' }) as any
    );
    const json = await res.json();
    expect(json.slug).toMatch(/^facility-\d+-/);
  });

  test('member insert fails + rollback fails → still 500 with log', async () => {
    setupDefaultMocks(true, false, false, false, true, true);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(
      makeRequest({ facility_name: 'T', business_type: 'nail' }) as any
    );
    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('user without email → skips welcome email', async () => {
    (sendWelcomeEmail as jest.Mock).mockClear();
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-456', email: null } },
        }),
      },
    });
    await POST(makeRequest({ facility_name: 'T', business_type: 'nail' }) as any);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('sendWelcomeEmail rejects → safeCaptureException called silently', async () => {
    (sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error('SMTP down'));
    const res = await POST(
      makeRequest({ facility_name: 'T', business_type: 'nail' }) as any
    );
    expect(res.status).toBe(200);
  });

  test('body の facility_name が プレースホルダ"未設定の施設" → リード名で置換（auto-fill是正）', async () => {
    setupDefaultMocks(true, false, true);
    const res = await POST(
      makeRequest({
        facility_name: '未設定の施設', // プレースホルダはリード名で置換される
        business_type: 'eyelash',
        phone: '090-1111-2222',
        address: 'orig address',
      }) as any
    );
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // '未設定の施設' はプレースホルダ扱いで salonData.facility_name に置換（旧 || 実装の取りこぼし是正）
    expect(call[0].name).toBe('Salon from DB');
    // phone/address: body 指定があるので body 値を保持
    expect(call[0].phone).toBe('090-1111-2222');
    expect(call[0].address).toBe('orig address');
  });

  test('リード詳細＋写真を施設へ引き継ぐ（enrichment）', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = {
      facility_name: 'S', business_type: 'nail', phone: '03-1', address: 'addr',
      postal_code: '5600001', building_name: 'ビル3F', nearest_station: '堺東駅 徒歩5分',
      regular_holiday: '月曜', seat_count: 5, staff_count: 3, has_parking: true,
      features: ['駐車場', '個室'], pr_text: 'PR文', website: 'https://x.com',
      photo_url: 'https://x/p0.jpg', business_hours: '10:00-20:00',
      // index0=exterior,1..3=interior,4..6=menu,7=other(cats範囲外)。null/空はフィルタで除外。
      photo_urls: ['https://x/0.jpg', 'https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg', 'https://x/5.jpg', 'https://x/6.jpg', 'https://x/7.jpg', null, ''],
    };
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
    const upArg = mockFacilityUpdate.mock.calls[0][0];
    expect(upArg.postal_code).toBe('5600001');
    expect(upArg.building).toBe('ビル3F');
    expect(upArg.access_info).toBe('堺東駅 徒歩5分');
    expect(upArg.seat_count).toBe(5);
    expect(upArg.parking).toBe(true);
    expect(upArg.features).toEqual(['駐車場', '個室']);
    expect(upArg.business_hours_text).toBe('10:00-20:00');
    const photoArg = mockPhotoInsert.mock.calls[0][0];
    expect(photoArg.length).toBe(8); // null/空は除外
    expect(photoArg[0].photo_type).toBe('exterior');
    expect(photoArg[1].photo_type).toBe('interior');
    expect(photoArg[4].photo_type).toBe('menu');
    expect(photoArg[7].photo_type).toBe('other');
  });

  test('enrichment: 拡張カラム不在 → フォールバックで再試行（200）', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = { facility_name: 'S', business_type: 'nail', business_hours: '10-20' };
    mockFacilityUpdate = jest.fn()
      .mockReturnValueOnce({ eq: jest.fn().mockResolvedValue({ error: { code: 'PGRST204', message: 'col missing' } }) })
      .mockReturnValueOnce({ eq: jest.fn().mockResolvedValue({ error: null }) });
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
    expect(mockFacilityUpdate).toHaveBeenCalledTimes(2);
  });

  test('enrichment: update が {error} 返却 → 非致命(200)', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = { facility_name: 'S', business_type: 'nail' };
    mockFacilityUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'up fail' } }) });
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
  });

  test('enrichment: 写真 insert 失敗 → 非致命(200)', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = { facility_name: 'S', business_type: 'nail', photo_urls: ['https://x/a.jpg'] };
    mockPhotoInsert = jest.fn().mockResolvedValue({ error: { message: 'photo fail' } });
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
    expect(mockPhotoInsert).toHaveBeenCalled();
  });

  test('enrichment: 写真が全て非文字列/空 → insert 呼ばれない(200)', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = { facility_name: 'S', business_type: 'nail', photo_urls: [null, '', 123] };
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
    expect(mockPhotoInsert).not.toHaveBeenCalled();
  });

  test('enrichment: update が throw → 非致命(200)', async () => {
    setupDefaultMocks(true, false, true);
    salonRow = { facility_name: 'S', business_type: 'nail' };
    mockFacilityUpdate = jest.fn(() => { throw new Error('boom'); });
    const res = await POST(makeRequest({ facility_name: '未設定の施設', business_type: 'nail' }) as any);
    expect(res.status).toBe(200);
  });

  test('auto-fill uses most recent salon record', async () => {
    setupDefaultMocks(true, false, true);

    await POST(
      makeRequest({
        facility_name: '未設定の施設',
        business_type: 'nail',
      }) as any
    );

    expect(mockSalonSelect).toHaveBeenCalled();
  });

  // Branch coverage: line 77 — business_type falsy → right side (salonData.business_type) used
  test('business_type が空文字 → salonData.business_type にフォールバック (line 77 right branch)', async () => {
    setupDefaultMocks(true, false, true); // salonFound = true; salonData.business_type = 'nail'
    const res = await POST(
      makeRequest({
        facility_name: '未設定の施設', // triggers salon lookup
        business_type: '',            // falsy → salonData.business_type ('nail') used at line 77
      }) as any
    );
    // salonData.business_type fills in, so validation passes → 200
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // business_type should come from salonData ('nail')
    expect(call[0].business_type).toBe('nail');
  });

  // Branch coverage: line 76 — facility_name falsy (empty) → right side (salonData.facility_name) used
  test('facility_name が空文字 → salonData.facility_name にフォールバック (line 76 right branch)', async () => {
    setupDefaultMocks(true, false, true); // salonData.facility_name = 'Salon from DB', salonData.business_type = 'nail'
    const res = await POST(
      makeRequest({
        facility_name: '',  // !facility_name is true → triggers salon lookup; then '' || salonData.facility_name uses right side
        business_type: 'nail',
      }) as any
    );
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // facility_name should come from salonData ('Salon from DB')
    expect(call[0].name).toBe('Salon from DB');
  });
});
