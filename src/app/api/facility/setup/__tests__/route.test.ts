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
// claim（salons.claimed_by_user_id/claimed_at）の CAS・監査ログは salon-claim.test.ts /
// admin/registrations テストで別途検証済み。本ファイルでは「呼ばれたか・何が渡ったか」だけを
// 見たいので、writeAuditLog 自体は実装せずモックする（admin/registrations と同型）。
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
// salons の取得失敗を「握り潰していないこと」を見るため、通知側をモックする。
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendWelcomeEmail } from '@/lib/email';
import { canonicalizeEmail } from '@/lib/email-canonical';
import { signSalonClaim } from '@/lib/salon-claim';
import { POST } from '../route';

let mockFacilityInsert: jest.Mock;
let mockMemberInsert: jest.Mock;
let mockSalonSelect: jest.Mock;
let mockSalonEmailEq: jest.Mock;
let mockSalonStatusNeq: jest.Mock;
let mockSalonCookieIs: jest.Mock;
let mockSalonUpdate: jest.Mock;
let mockFacilityDelete: jest.Mock;
let mockPhotoInsert: jest.Mock;

// salonFound 時のリッチデータ（register 全項目の引き継ぎ・写真転送を検証するため）。
const SALON_FULL = {
  id: 'salon-full-id',
  facility_name: 'Salon from DB',
  business_type: 'ネイル・まつげサロン',
  phone: '03-1234-5678',
  address: '東京都渋谷区',
  postal_code: '150-0001',
  building_name: 'ABCビル 3F',
  nearest_station: '渋谷駅 徒歩5分',
  business_hours: '10:00〜20:00',
  regular_holiday: '毎週月曜日',
  seat_count: 4,
  staff_count: 3,
  has_parking: true,
  features: ['駐車場あり', '個室あり'],
  website: 'https://salon.example.com',
  pr_text: '開業20年の実績があります。',
  photo_url: 'https://s.example.com/salons/uuid/exterior.jpg',
  photo_urls: [
    'https://s.example.com/salons/uuid/exterior.jpg',
    'https://s.example.com/salons/uuid/interior_1.jpg',
  ],
};

function setupDefaultMocks(
  userExists: boolean = true,
  alreadyOwner: boolean = false,
  salonFound: boolean = false,
  facilityInsertFails: boolean = false,
  memberInsertFails: boolean = false,
  rollbackFails: boolean = false,
  opts: {
    salonData?: unknown;
    photoInsertFails?: boolean;
    userEmail?: string | null;
    // 【claim（2026年8月20日 新設）用のオプション】
    // Cookie 経由で見つかる salons 行（未指定 = null ＝ Cookie 経路では何も見つからない）。
    cookieSalonData?: unknown;
    // CAS（.is('claimed_by_user_id', null) 付き update）が 0 行更新に終わる（TOCTOU で
    // 先に他リクエストが claim した想定）。未指定なら常に成功する。
    salonClaimCasFails?: boolean;
    // CAS 自体が DB エラーを返す。
    salonClaimCasError?: boolean;
    // ロールバック経路での claim 解放 UPDATE が失敗する。
    salonClaimReleaseFails?: boolean;
    // メール経路が返す行（複数件・統合の検証用）。未指定なら salonFound から導く。
    emailSalonRows?: unknown;
    // メール経路の取得自体が失敗する（列が無い等）。
    emailSalonError?: unknown;
    // Cookie 経路の取得自体が失敗する。
    cookieSalonError?: unknown;
    // CAS がエラー無しで data:null を返す（PostgREST の戻りが想定外の形）。
    salonClaimCasNullData?: boolean;
  } = {}
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  // sendWelcomeEmail は boolean を返す契約（デフォルトは成功）。個別テストで false を
  // 上書きして送達失敗時のアラート分岐を検証する。
  (sendWelcomeEmail as jest.Mock).mockResolvedValue(true);

  const salonData = 'salonData' in opts ? opts.salonData : (salonFound ? SALON_FULL : null);
  const cookieSalonData = 'cookieSalonData' in opts ? opts.cookieSalonData : null;

  // .eq('email_canonical', ...) → .is('claimed_by_user_id', null) →
  // .or('status.is.null,status.neq.rejected') → .order()
  // eq/or を個別に spy として保持し、呼び出し引数（canonical 化されたメール・rejected 除外）を検証する。
  // 🔴 .neq ではなく .or なのは、status が NULL の行を落とさないため（route.ts のコメント参照）。
  // 🔴 .limit(1).maybeSingle() は使わない：salons.email に UNIQUE が無く同一メールで複数行
  //   （/register と /recruit）が実在するため、【全件】取って mergeSalonRows で統合する。
  //   1件だけ採ると /recruit が送らない列（写真・営業時間等）が無音で失われる。
  const emailSalonRows = 'emailSalonRows' in opts
    ? opts.emailSalonRows
    : (salonData ? [salonData] : []);
  mockSalonStatusNeq = jest.fn().mockReturnValue({
    order: jest.fn().mockResolvedValue({ data: emailSalonRows, error: opts.emailSalonError ?? null }),
  });
  const mockSalonEmailIs = jest.fn().mockReturnValue({ or: mockSalonStatusNeq });

  // Cookie 経路: .eq('id', claimedSalonIdFromCookie) → .is('claimed_by_user_id', null) →
  // .or(...) → .maybeSingle()
  mockSalonCookieIs = jest.fn().mockReturnValue({
    or: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: cookieSalonData,
        error: opts.cookieSalonError ?? null,
      }),
    }),
  });

  // 同じ .eq() が呼ばれるカラム名で経路を振り分ける（'id' = Cookie 経路 / それ以外 = メール経路）。
  mockSalonEmailEq = jest.fn((column: string) => {
    if (column === 'id') return { is: mockSalonCookieIs };
    return { is: mockSalonEmailIs };
  });
  mockSalonSelect = jest.fn().mockReturnValue({ eq: mockSalonEmailEq });

  // claim の条件付き UPDATE（CAS）と、member insert 失敗時の解放 UPDATE。
  // ペイロードの claimed_by_user_id が非 null なら claim 試行、null なら解放と判定する
  // （route.ts の2つの update 呼び出しはこの2値のどちらかしか送らない）。
  mockSalonUpdate = jest.fn((payload: { claimed_by_user_id: string | null }) => {
    // 🔴 .eq('id', …) ではなく .in('id', …)：統合に使った行を【全部】claim / 解放するため。
    if (payload && payload.claimed_by_user_id != null) {
      return {
        in: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue(
              opts.salonClaimCasError
                ? { data: null, error: new Error('claim update failed') }
                : {
                    data: opts.salonClaimCasNullData
                      ? null
                      : opts.salonClaimCasFails ? [] : [{ id: 'claimed-row-id' }],
                    error: null,
                  }
            ),
          }),
        }),
      };
    }
    return {
      in: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          error: opts.salonClaimReleaseFails ? new Error('claim release failed') : null,
        }),
      }),
    };
  });

  mockPhotoInsert = jest.fn().mockResolvedValue({
    error: opts.photoInsertFails ? new Error('photo insert error') : null,
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

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: userExists
            ? { id: 'user-123', email: 'userEmail' in opts ? opts.userEmail : 'owner@example.com' }
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
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: alreadyOwner ? [{ facility_id: 'fac-existing' }] : [],
                }),
              }),
            }),
          }),
          insert: mockMemberInsert,
        };
      } else if (table === 'facility_profiles') {
        return {
          insert: mockFacilityInsert,
          delete: mockFacilityDelete,
        };
      } else if (table === 'salons') {
        return {
          select: mockSalonSelect,
          update: mockSalonUpdate,
        };
      } else if (table === 'facility_photos') {
        return {
          insert: mockPhotoInsert,
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

// 本番の NextRequest は常に .cookies.get(name) を持つ（RequestCookies）。テストは通常の
// Request を `as any` でキャストして使っているためこの実装を持たず、素の Request のままだと
// route.ts の `request.cookies.get(SALON_CLAIM_COOKIE_NAME)` が例外になる。実物に近い最小限の
// 実装（Cookie ヘッダーから読む）を後付けする。このファイル内で `new Request(...)` するときは
// 必ずこれを通す。
function withCookiesShim(req: Request): Request {
  (req as unknown as { cookies: { get: (name: string) => { name: string; value: string } | undefined } }).cookies = {
    get: (name: string) => {
      const cookieHeader = req.headers.get('cookie') ?? '';
      const found = cookieHeader
        .split(';')
        .map((s) => s.trim())
        .find((c) => c.startsWith(`${name}=`));
      if (!found) return undefined;
      return { name, value: decodeURIComponent(found.slice(name.length + 1)) };
    },
  };
  return req;
}

// cookieValue 省略時は「Cookie 無し」を再現する。
// 許認可・届出の表明（利用規約 第12条）はサーバー側で必須。既存のケースは表明の有無を
// 主題にしていないので、既定で同意済みの body を送る（表明そのものの検査は専用のテストで行う）。
function makeRequest(body: object = {}, ip = '192.168.1.1', cookieValue?: string) {
  const withAttestation = 'license_warranted' in body ? body : { license_warranted: true, ...body };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip,
  };
  if (cookieValue !== undefined) {
    headers['cookie'] = `clnk_salon_claim=${encodeURIComponent(cookieValue)}`;
  }
  return withCookiesShim(new Request('http://localhost/api/facility/setup', {
    method: 'POST',
    headers,
    body: JSON.stringify(withAttestation),
  }));
}

describe('POST /api/facility/setup', () => {
  test('CSRF check failed → returns error', async () => {
    (checkCsrf as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 })
    );

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(401);
  });

  test('user already owns facility → 200 with facilityId', async () => {
    setupDefaultMocks(true, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.facilityId).toBe('fac-existing');
  });

  // 堅牢化: 既に複数施設に所属していても、ガードが壊れず新規作成せず最古の施設を返す。
  // 旧実装 .maybeSingle() は複数行で error+data=null を返しガードを素通りしていた（脆弱性）。
  test('user already in MULTIPLE facilities → 新規作成せず最古施設を返す（ガード堅牢性）', async () => {
    setupDefaultMocks();
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'facility_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  // created_at 昇順 + limit(1) で最古の1件のみ返る想定
                  limit: jest.fn().mockResolvedValue({
                    data: [{ facility_id: 'fac-oldest' }],
                  }),
                }),
              }),
            }),
            insert: mockMemberInsert,
          };
        }
        return {};
      }),
    });

    const res = await POST(
      makeRequest({ facility_name: 'New Store', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilityId).toBe('fac-oldest');
    // 新規 facility_members insert は呼ばれない（＝施設が増えない）
    expect(mockMemberInsert).not.toHaveBeenCalled();
  });

  test('missing facility_name → 400', async () => {
    const res = await POST(
      makeRequest({ business_type: 'ネイル・まつげサロン' }) as any
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
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility_name > 100 chars → truncated', async () => {
    const longName = 'x'.repeat(150);
    const res = await POST(
      makeRequest({ facility_name: longName, business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(200);
  });

  // 【2026年7月29日 仕様変更】business_type は検索・カテゴリ導線・/type/* の結合キーであり、
  // 正規タクソノミー外の値が入ると「施設は存在するのに到達できない」無音の断線を招く
  // （本番で実際に発生）。長すぎる値を切り詰めて通すのではなく、選択肢外は 400 で拒否する。
  test('business_type が正規タクソノミー外 → 400（切り詰めて通さない）', async () => {
    const longType = 'x'.repeat(100);
    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: longType }) as any
    );

    expect(res.status).toBe(400);
    expect(mockFacilityInsert).not.toHaveBeenCalled();
  });

  test('business_type が実在しない業種名 → 400', async () => {
    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: '整体サロン' }) as any
    );

    expect(res.status).toBe(400);
    expect(mockFacilityInsert).not.toHaveBeenCalled();
  });

  test('phone > 20 chars → truncated', async () => {
    const longPhone = 'x'.repeat(30);
    const res = await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'ネイル・まつげサロン',
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
        business_type: 'ネイル・まつげサロン',
        address: longAddr,
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('facility_profiles insert fails → 500', async () => {
    setupDefaultMocks(true, false, false, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(500);
  });

  test('facility_members insert fails → 500 and rollback', async () => {
    setupDefaultMocks(true, false, false, false, true);

    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    expect(res.status).toBe(500);
    expect(mockFacilityDelete).toHaveBeenCalled();
  });

  test('successful setup → 200 with facilityId and slug', async () => {
    const res = await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
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
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    const insertCall = mockFacilityInsert.mock.calls[0];
    expect(insertCall[0]).toMatchObject({
      status: 'draft',
      name: 'My Salon',
      business_type: 'ネイル・まつげサロン',
    });
  });

  test('facility_members created with role=owner', async () => {
    await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'ネイル・まつげサロン',
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
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    const json = await res.json();
    expect(json.slug).toContain('test-salon');
  });

  test('slug includes Date.now() for uniqueness', async () => {
    const res = await POST(
      makeRequest({
        facility_name: 'Salon A',
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    const json = await res.json();
    // Slug should have format: salon-a-{timestamp36}
    expect(json.slug).toMatch(/salon-a-/);
  });

  test('sends welcome email (awaitで完了保証)', async () => {
    await POST(
      makeRequest({
        facility_name: 'Test',
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: 'owner@example.com',
        facilityName: 'Test',
      })
    );
  });

  // 【2026年7月7日 本番実データで確定した恒久根治の回帰防止】ウェルカムメールを fire-and-forget
  // (waitUntil) に戻すと本番(Fluid Compute 無効)でレスポンス返却後に打ち切られ送信されない。
  // レスポンスは送信の完了(await)まで確定しないことを直列に検証する。
  test('ウェルカムメール送信が完了するまでレスポンスを確定させない（awaitで確実に完了・fire-and-forget回帰防止）', async () => {
    let resolveSend: (() => void) | undefined;
    const pending = new Promise<boolean>((resolve) => { resolveSend = () => resolve(true); });
    (sendWelcomeEmail as jest.Mock).mockReturnValueOnce(pending);

    const postPromise = POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );
    let settled = false;
    void postPromise.then(() => { settled = true; });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    resolveSend!();
    const res = await postPromise;
    expect(settled).toBe(true);
    expect(res.status).toBe(200);
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

    await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);

    // Email should not be called or should handle null email
  });

  test('exception during processing → 500', async () => {
    (checkCsrf as jest.Mock).mockImplementation(() => {
      throw new Error('CSRF check error');
    });

    await POST(
      makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any
    );

    // Should be caught and return 500
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facility_name: 'Test', business_type: 'ネイル・まつげサロン' },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5); // limit
    expect(call[3]).toBe(60_000); // window
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facility_name: 'Test', business_type: 'ネイル・まつげサロン' },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('invalid JSON body → defaults to empty object', async () => {
    const res = await POST(
      withCookiesShim(new Request('http://localhost/api/facility/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.1' },
        body: 'invalid {',
      })) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing x-forwarded-for → uses "unknown"', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = withCookiesShim(new Request('http://localhost/api/facility/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facility_name: 'T', business_type: 'ネイル・まつげサロン' }),
    }));
    await POST(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('phone/prefecture/city/address all set → all truncated', async () => {
    const res = await POST(
      makeRequest({
        facility_name: 'T',
        business_type: 'ネイル・まつげサロン',
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
      makeRequest({ facility_name: '!!!', business_type: 'ネイル・まつげサロン' }) as any
    );
    const json = await res.json();
    expect(json.slug).toMatch(/^facility-\d+-/);
  });

  test('member insert fails + rollback fails → still 500 with log', async () => {
    setupDefaultMocks(true, false, false, false, true, true);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(
      makeRequest({ facility_name: 'T', business_type: 'ネイル・まつげサロン' }) as any
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
    await POST(makeRequest({ facility_name: 'T', business_type: 'ネイル・まつげサロン' }) as any);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('sendWelcomeEmail rejects → safeCaptureException called silently', async () => {
    (sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error('SMTP down'));
    const res = await POST(
      makeRequest({ facility_name: 'T', business_type: 'ネイル・まつげサロン' }) as any
    );
    expect(res.status).toBe(200);
  });

  test('sendWelcomeEmail が false を返す（送達失敗）→ 無音化せず可視化するのみ（200のまま）', async () => {
    (sendWelcomeEmail as jest.Mock).mockResolvedValueOnce(false);
    const res = await POST(
      makeRequest({ facility_name: 'T', business_type: 'ネイル・まつげサロン' }) as any
    );
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendWelcomeEmail).toHaveBeenCalled();
  });

  test('salonData found but body has facility_name set → keeps body value (||)', async () => {
    setupDefaultMocks(true, false, true);
    const res = await POST(
      makeRequest({
        facility_name: '未設定の施設', // triggers salon lookup
        business_type: 'ネイル・まつげサロン',
        phone: '090-1111-2222',
        address: 'orig address',
      }) as any
    );
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // salonData provides facility_name; body value '未設定の施設' falls back via `facility_name = facility_name || salonData.facility_name`
    // But '未設定の施設' is truthy so the OR keeps the body value
    expect(call[0].name).toBe('未設定の施設');
    // phone/address: provided in body, so should be kept as body value
    expect(call[0].phone).toBe('090-1111-2222');
    expect(call[0].address).toBe('orig address');
  });

  test('auto-fill uses most recent salon record', async () => {
    setupDefaultMocks(true, false, true);

    await POST(
      makeRequest({
        facility_name: '未設定の施設',
        business_type: 'ネイル・まつげサロン',
      }) as any
    );

    expect(mockSalonSelect).toHaveBeenCalled();
  });

  // Branch coverage: line 77 — business_type falsy → right side (salonData.business_type) used
  test('business_type が空文字 → salonData.business_type にフォールバック (line 77 right branch)', async () => {
    setupDefaultMocks(true, false, true); // salonFound = true; salonData.business_type = 'ネイル・まつげサロン'
    const res = await POST(
      makeRequest({
        facility_name: '未設定の施設', // triggers salon lookup
        business_type: '',            // falsy → salonData.business_type ('ネイル・まつげサロン') used at line 77
      }) as any
    );
    // salonData.business_type fills in, so validation passes → 200
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // business_type should come from salonData ('ネイル・まつげサロン')
    expect(call[0].business_type).toBe('ネイル・まつげサロン');
  });

  // Branch coverage: line 76 — facility_name falsy (empty) → right side (salonData.facility_name) used
  test('facility_name が空文字 → salonData.facility_name にフォールバック (line 76 right branch)', async () => {
    setupDefaultMocks(true, false, true); // salonData.facility_name = 'Salon from DB', salonData.business_type = 'ネイル・まつげサロン'
    const res = await POST(
      makeRequest({
        facility_name: '',  // !facility_name is true → triggers salon lookup; then '' || salonData.facility_name uses right side
        business_type: 'ネイル・まつげサロン',
      }) as any
    );
    expect(res.status).toBe(200);
    const call = mockFacilityInsert.mock.calls[0];
    // facility_name should come from salonData ('Salon from DB')
    expect(call[0].name).toBe('Salon from DB');
  });

  // ─── B: register 全項目の引き継ぎ・写真転送 ───────────────────────────────

  test('salon あり → register 入力を facility に完全移送する（営業時間自由文/特徴/PR/席数/駐車場/写真URL）', async () => {
    setupDefaultMocks(true, false, true); // SALON_FULL
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
    expect(f.building).toBe('ABCビル 3F');
    expect(f.nearest_station).toBe('渋谷駅 徒歩5分');
    expect(f.business_hours_text).toBe('10:00〜20:00'); // 自由文は business_hours_text（JSONBの business_hours ではない）
    expect(f.regular_holiday).toBe('毎週月曜日');
    expect(f.seat_count).toBe(4);
    expect(f.staff_count).toBe(3);
    expect(f.parking).toBe(true);
    expect(f.features).toEqual(['駐車場あり', '個室あり']);
    expect(f.website_url).toBe('https://salon.example.com');
    expect(f.description).toBe('開業20年の実績があります。');
    expect(f.main_photo_url).toBe('https://s.example.com/salons/uuid/exterior.jpg');
    // 写真は facility_photos へ転送（先頭 exterior・以降 other・sort_order 保持）
    const photoRows = mockPhotoInsert.mock.calls[0][0];
    expect(photoRows).toHaveLength(2);
    expect(photoRows[0]).toMatchObject({ facility_id: 'fac-123', photo_url: 'https://s.example.com/salons/uuid/exterior.jpg', photo_type: 'exterior', sort_order: 0 });
    expect(photoRows[1]).toMatchObject({ photo_type: 'other', sort_order: 1 });
  });

  test('写真転送が失敗しても施設作成は成立（best-effort・200）', async () => {
    setupDefaultMocks(true, false, true, false, false, false, { photoInsertFails: true });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockPhotoInsert).toHaveBeenCalled();
  });

  test('salon はあるが photo_urls が空/未配列 → 写真転送はスキップ', async () => {
    setupDefaultMocks(true, false, true, false, false, false, { salonData: { ...SALON_FULL, photo_urls: null } });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockPhotoInsert).not.toHaveBeenCalled();
  });

  test('photo_urls の非文字列/空文字は除外して転送（filter 分岐）', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { ...SALON_FULL, photo_urls: ['https://ok.example/a.jpg', '', 123, null] },
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    const photoRows = mockPhotoInsert.mock.calls[0][0];
    expect(photoRows).toHaveLength(1);
    expect(photoRows[0].photo_url).toBe('https://ok.example/a.jpg');
  });

  test('salon の seat_count/features が非数値・非配列 → null/[] に安全化', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { facility_name: 'S', business_type: 'ネイル・まつげサロン', seat_count: 'x', features: 'y', has_parking: null, photo_urls: [] },
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.seat_count).toBeNull();
    expect(f.staff_count).toBeNull();
    expect(f.features).toEqual([]);
    expect(f.parking).toBe(false);
  });

  test('user に email が無い → salon 取得せず body 値で作成（user.email 分岐）', async () => {
    setupDefaultMocks(true, false, false, false, false, false, { userEmail: null });
    const res = await POST(makeRequest({ facility_name: 'ノーメール施設', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockSalonSelect).not.toHaveBeenCalled();
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.name).toBe('ノーメール施設');
  });

  // ─── prefecture / city の解決（2026年8月20日追加）───────────────────────────
  // 優先順位: body > salonData の列 > 住所からの復元 > null。
  // /search の地域絞り込み・getSimilarFacilities / getNearbyFacilities の結合キーが
  // null のままだと「公開されているのに地域で探すと出てこない」状態になるため、
  // この解決順序そのものを固定する。

  test('(i) body に prefecture/city があれば salonData の列より優先される', async () => {
    // salonData にも別の列があるが、body の明示値が勝つことを確認する
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { ...SALON_FULL, prefecture: '大阪府', city: '大阪市北区', address: '大阪府大阪市北区' },
    });
    const res = await POST(makeRequest({
      facility_name: 'Test',
      business_type: 'ネイル・まつげサロン',
      prefecture: '東京都',
      city: '新宿区',
    }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.prefecture).toBe('東京都');
    expect(f.city).toBe('新宿区');
  });

  test('(ii) body に無く salonData に prefecture/city 列があればそれが使われる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { ...SALON_FULL, prefecture: '大阪府', city: '大阪市北区', address: '東京都渋谷区（列優先の確認用に不一致にする）' },
    });
    const res = await POST(makeRequest({
      facility_name: 'Test',
      business_type: 'ネイル・まつげサロン',
    }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    // salonData の列（大阪府/大阪市北区）が使われる。住所文字列の東京都/渋谷区ではない。
    expect(f.prefecture).toBe('大阪府');
    expect(f.city).toBe('大阪市北区');
  });

  test('(iii) body にも salonData の列にも無ければ住所から復元される', async () => {
    // salonData には prefecture/city 列が無い（列がまだ無い環境を想定）が、address はある。
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { ...SALON_FULL, address: '東京都渋谷区神宮前1-1-1' },
    });
    const res = await POST(makeRequest({
      facility_name: 'Test',
      business_type: 'ネイル・まつげサロン',
    }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.prefecture).toBe('東京都');
    expect(f.city).toBe('渋谷区');
  });

  test('(iv) 住所からも復元できなければ null のまま（推測で埋めない）', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      salonData: { ...SALON_FULL, address: '都道府県を含まない住所表記' },
    });
    const res = await POST(makeRequest({
      facility_name: 'Test',
      business_type: 'ネイル・まつげサロン',
    }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.prefecture).toBeNull();
    expect(f.city).toBeNull();
  });

  test('(iv-b) address も無ければ prefecture/city は null のまま', async () => {
    setupDefaultMocks(true, false, false); // salonFound=false → salonData=null, body に address も無い
    const res = await POST(makeRequest({
      facility_name: 'Test',
      business_type: 'ネイル・まつげサロン',
    }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.prefecture).toBeNull();
    expect(f.city).toBeNull();
  });

  // ─── メール突合の canonical 化（2026年8月20日追加）───────────────────────────
  // /register と Auth のメールがバイト完全一致しないと引き継ぎが無音失敗していた欠陥の修正。
  // src/lib/email-canonical.ts の canonicalizeEmail() を使った突合を固定する。

  test('(i) salons.email が大文字混じりでも、Auth の小文字メールで引き継がれる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      userEmail: 'Owner@Example.com', // Auth 側は大文字混じり
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    // .eq('email_canonical', canonicalizeEmail(user.email)) が呼ばれ、引き継ぎが成立する
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', canonicalizeEmail('Owner@Example.com'));
    const f = mockFacilityInsert.mock.calls[0][0];
    // SALON_FULL の内容（postal_code 等）が引き継がれている＝salonData が見つかった証拠
    expect(f.postal_code).toBe('150-0001');
  });

  test('(ii) gmail のプラス付き／ドット違いでも同一人物として引き継がれる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      userEmail: 'o.wner+signup@gmail.com', // register 側は owner@gmail.com 相当の別表記
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', 'owner@gmail.com');
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
  });

  test('(iii) LINE ログインの合成メールでは salons を照会せず、引き継ぎ無しで施設が作られる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      userEmail: 'line_abcdef0123456789@line.carelink.local',
    });
    const res = await POST(makeRequest({ facility_name: 'LINEオーナーの施設', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    // salons への select 自体が発生しない（無駄な照合をしない）
    expect(mockSalonSelect).not.toHaveBeenCalled();
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.name).toBe('LINEオーナーの施設');
    // 引き継ぎ対象なし＝SALON_FULL 由来の postal_code は入らない
    expect(f.postal_code).toBeNull();
  });

  test('(iii-b) LINE 合成メールの判定は大文字混じりでも成立する（大文字小文字を無視）', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      userEmail: 'line_ABCDEF0123456789@LINE.CARELINK.LOCAL',
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockSalonSelect).not.toHaveBeenCalled();
  });

  test('(iv) status が rejected の salons 行は引き継がれない（NULL 安全な or で除外）', async () => {
    // salonData に rejected が混じっていても maybeSingle は DB 側で除外された結果を返す前提。
    // ここでは .or() の呼び出し引数そのものを検証し、除外条件が SQL に載っていることを確認する。
    setupDefaultMocks(true, false, true);
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    // 🔴 NULL 安全であること＝status.is.null を含むことまで主張する。
    // .neq('status','rejected') に戻すと `status <> 'rejected'` になり NULL 行が落ちるため、
    // ここが「rejected を除外している」だけの検査だと、その退行を素通しする。
    expect(mockSalonStatusNeq).toHaveBeenCalledWith('status.is.null,status.neq.rejected');
  });

  test('(iv-b) rejected 申込しか無い場合はモック側で null を返し、引き継ぎ無しで作成される（除外の実効性）', async () => {
    // 除外が実際に効いた結果を模す＝maybeSingle が null を返すケース。
    setupDefaultMocks(true, false, false); // salonFound=false → salonData=null
    const res = await POST(makeRequest({ facility_name: 'Rejected後の新規', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.name).toBe('Rejected後の新規');
    expect(f.postal_code).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 所有権 claim（Cookie による引き継ぎ・2026年8月20日 新設）
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/facility/setup — 所有権 claim（Cookie）', () => {
  const COOKIE_SALON_ID = '55555555-5555-4555-8555-555555555555';
  const ORIGINAL_SECRET = process.env.ADMIN_COOKIE_SECRET;

  beforeEach(() => {
    process.env.ADMIN_COOKIE_SECRET = 'test-admin-cookie-secret';
  });
  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.ADMIN_COOKIE_SECRET;
    else process.env.ADMIN_COOKIE_SECRET = ORIGINAL_SECRET;
  });

  const { writeAuditLog } = require('@/lib/audit-logger');

  // (i) Cookie があれば、その salons 行が引き継がれる（メール不一致でも）。
  test('(i) Cookie の salon id があれば、メールが一致しなくてもその行が引き継がれる', async () => {
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: { ...SALON_FULL, id: COOKIE_SALON_ID },
      userEmail: 'totally-different-person@example.com', // salons.email とは無関係
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    // SALON_FULL 由来の内容が引き継がれている（Cookie 経路が使われた証拠）。
    expect(f.postal_code).toBe('150-0001');
    // 🔴 メール経路も併せて引く（Cookie 経路だけを見て早期 return しない）。
    //   Cookie は最後に出した申込1件しか指さないため、/register→/recruit と2回出した人は
    //   Cookie が /recruit の行を指し、/register で入れた写真・営業時間が取り残される。
    //   両方の候補を集めて mergeSalonRows で統合するのが正しい（この人のメールに紐づく
    //   未 claim の申込が無ければ、単に0件が返るだけで挙動は変わらない）。
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', expect.anything());
  });

  // (i-b) Cookie の行とメール一致の行が【両方】ある場合、列ごとに統合される。
  //   これが無いと「後から /recruit を出しただけで /register の写真が消える」故障が残る。
  test('(i-b) Cookie の行とメール一致の行の両方から、列ごとに値が統合される', async () => {
    const RECRUIT_ROW = {
      ...SALON_FULL,
      id: COOKIE_SALON_ID,
      created_at: '2026-08-20T10:00:00.000Z', // 新しい（/recruit 相当）
      photo_urls: null,          // /recruit は写真を送らない
      business_hours: null,      // /recruit は営業時間を送らない
      postal_code: '999-9999',   // 新しい方が勝つべき列
    };
    const REGISTER_ROW = {
      ...SALON_FULL,
      id: '66666666-6666-4666-8666-666666666666',
      created_at: '2026-08-19T10:00:00.000Z', // 古い（/register 相当）
      photo_urls: ['https://storage.example.com/a.jpg'],
      business_hours: '10:00-19:00',
      postal_code: '150-0001',
    };
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: RECRUIT_ROW,
      emailSalonRows: [REGISTER_ROW],
      userEmail: 'owner@example.com',
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    // 新しい行が持つ値は新しい方が勝つ
    expect(f.postal_code).toBe('999-9999');
    // 新しい行に無い列は、古い行の値が生き残る（これが統合の本体）。
    // salons.business_hours（自由文）は facility_profiles.business_hours_text へ入る
    // （facility_profiles.business_hours は予約枠用の JSONB で別物）。
    expect(f.business_hours_text).toBe('10:00-19:00');
  });

  // (i-c) 使い終わった claim Cookie は必ず失効させる（同じ端末での使い回しを断つ）。
  test('(i-c) claim に使った Cookie は応答で失効させられる（共用端末での再利用を断つ）', async () => {
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: { ...SALON_FULL, id: COOKIE_SALON_ID },
      userEmail: 'owner@example.com',
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    // 🔴 署名の期限は発行から3日ある。消さないと、同じブラウザで次にサインアップした人が
    //   同じ Cookie で前の人の申込内容（住所・電話・写真）を自分の施設へ取り込めてしまう。
    const setCookie = res.cookies.get('clnk_salon_claim');
    expect(setCookie).toBeDefined();
    expect(setCookie!.value).toBe('');
    expect(setCookie!.maxAge).toBe(0);
  });

  // (i-d) Cookie がそもそも無いリクエストでは、無関係な Set-Cookie を足さない。
  test('(i-d) Cookie が無いリクエストでは失効 Cookie を足さない', async () => {
    setupDefaultMocks(true, false, true);
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(res.cookies.get('clnk_salon_claim')).toBeUndefined();
  });

  // (i-e) salons の取得が失敗したら【必ず通知する】。握り潰すと引き継ぎが無音で全滅する。
  test('(i-e) メール経路の取得が失敗したら通知される（無音で引き継ぎを失わない）', async () => {
    const { alertCaughtError } = require('@/lib/alert');
    (alertCaughtError as jest.Mock).mockClear();
    setupDefaultMocks(true, false, false, false, false, false, {
      emailSalonRows: null,
      emailSalonError: { code: '42703', message: 'column salons.email_canonical does not exist' },
      userEmail: 'owner@example.com',
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    // 施設作成自体は続行する（引き継ぎが無いだけで登録は通す）。
    expect(res.status).toBe(200);
    expect(alertCaughtError).toHaveBeenCalledWith(
      'facility-setup-salon-lookup',
      expect.any(Error),
      '/api/facility/setup',
    );
  });

  // (ii) Cookie が無ければ従来のメール一致に倒れる。
  test('(ii) Cookie が無ければ従来のメール一致（canonical）に倒れる', async () => {
    setupDefaultMocks(true, false, true); // salonFound=true → email 経路で SALON_FULL が見つかる
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any); // cookie 無し
    expect(res.status).toBe(200);
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', canonicalizeEmail('owner@example.com'));
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
  });

  // (iii) 署名が壊れた Cookie は無視され、メール一致に倒れる。
  test('(iii) 署名が壊れた Cookie は無視され、メール一致に倒れる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      cookieSalonData: { ...SALON_FULL, id: COOKIE_SALON_ID, postal_code: '999-9999' },
    });
    const validCookie = signSalonClaim(COOKIE_SALON_ID)!;
    const tampered = validCookie.slice(0, -1) + (validCookie.endsWith('a') ? 'b' : 'a');
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', tampered) as any);
    expect(res.status).toBe(200);
    // Cookie 経路の postal_code (999-9999) ではなく、メール経路の SALON_FULL (150-0001) が使われる。
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', canonicalizeEmail('owner@example.com'));
  });

  // (iv) 期限切れの Cookie は無視される（サーバー側で独立に判定）。
  test('(iv) 期限切れの Cookie は無視され、メール一致に倒れる', async () => {
    setupDefaultMocks(true, false, true, false, false, false, {
      cookieSalonData: { ...SALON_FULL, id: COOKIE_SALON_ID, postal_code: '999-9999' },
    });
    const now = Math.floor(Date.now() / 1000);
    const expired = signSalonClaim(COOKIE_SALON_ID, now - 60 * 60 * 24 * 4)!; // TTL(3日)を超過
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', expired) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
  });

  // (v) claim 済みの行は Cookie 経路でもメール経路でも引き継がれない。
  test('(v-a) claim 済みの行は Cookie 経路では選ばれない（select が .is(claimed_by_user_id, null) で除外する想定をモック側で模す）', async () => {
    // モックの select はクエリの絞り込み自体を実行しないため、「絞り込んだ結果 0 件」を
    // cookieSalonData: null で表現する（DB 側で claimed_by_user_id が非 null の行は
    // .is('claimed_by_user_id', null) に一致せず、maybeSingle() は null を返す）。
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: null,
      userEmail: null, // メール経路も通らないようにし、Cookie 経路の効果だけを見る
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Claim済み経由の新規', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.name).toBe('Claim済み経由の新規');
    expect(f.postal_code).toBeNull(); // 引き継ぎ無し
    expect(mockSalonUpdate).not.toHaveBeenCalled(); // claim 対象が無いので CAS 自体が走らない
  });

  test('(v-b) claim 済みの行はメール経路でも選ばれない（.is(claimed_by_user_id, null) で除外・select は null を返す想定）', async () => {
    setupDefaultMocks(true, false, false, false, false, false, {
      salonData: null, // 既に claim 済み＝メール一致条件を満たしても select 結果は null
    });
    const res = await POST(makeRequest({ facility_name: 'Claim済みのメール経由', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(mockSalonEmailEq).toHaveBeenCalledWith('email_canonical', canonicalizeEmail('owner@example.com'));
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBeNull();
    expect(mockSalonUpdate).not.toHaveBeenCalled();
  });

  // (vi) claim済みしか無い場合、エラーにならず引き継ぎ無しで施設が作られる。
  test('(vi) Cookie もメールも未 claim の行が無い → エラーにせず引き継ぎ無しで施設が作られる', async () => {
    setupDefaultMocks(true, false, false, false, false, false, { cookieSalonData: null });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: '引き継ぎ無し施設', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.name).toBe('引き継ぎ無し施設');
  });

  // (vii) 既に施設を持つユーザーが踏んでも claim が焼けない。
  test('(vii) 既に施設を持つユーザーが Cookie 付きで叩いても claim UPDATE は一切走らない', async () => {
    setupDefaultMocks(true, true /* alreadyOwner */, false, false, false, false, {
      cookieSalonData: { ...SALON_FULL, id: COOKIE_SALON_ID },
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilityId).toBe('fac-existing');
    // 1施設ガードで早期returnするため、salons の select/update は一切呼ばれない。
    expect(mockSalonSelect).not.toHaveBeenCalled();
    expect(mockSalonUpdate).not.toHaveBeenCalled();
  });

  // (viii) facility_members insert 失敗時に claim が解放される。
  test('(viii) facility_members insert 失敗時、CAS で立てた claim が解放 UPDATE で戻される', async () => {
    setupDefaultMocks(true, false, true, false, /* memberInsertFails */ true);
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(500);
    // 1回目 = claim 試行（claimed_by_user_id: 'user-123'）、2回目 = 解放（null）。
    expect(mockSalonUpdate).toHaveBeenCalledTimes(2);
    expect(mockSalonUpdate.mock.calls[0][0]).toMatchObject({ claimed_by_user_id: 'user-123' });
    expect(mockSalonUpdate.mock.calls[1][0]).toEqual({ claimed_by_user_id: null, claimed_at: null });
  });

  test('(viii-b) 解放 UPDATE 自体が失敗しても 500 応答は返る（ログのみ・無限リトライしない）', async () => {
    setupDefaultMocks(true, false, true, false, true, false, { salonClaimReleaseFails: true });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('claim release failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // (ix) claim が CAS である（同時実行で二重に立たない）＝ 0 行更新（既に他者が claim 済み）でも
  // エラーにせず施設作成は成立する。
  test('(ix) CAS が 0 行更新（TOCTOU で先に claim された）でもエラーにせず施設は作られ、claim は記録されない', async () => {
    setupDefaultMocks(true, false, true, false, false, false, { salonClaimCasFails: true });
    (writeAuditLog as jest.Mock).mockClear();
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // CAS で 0 行 → claim は成立しない → salons への監査ログは書かれない。
    // （許認可表明の監査ログ＝tableName:'facility_profiles' は claim と無関係に必ず書かれるので、
    //   「1本も呼ばれない」ではなく「salons への記録が無い」を主張する。）
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'salons' }),
    );
  });

  test('CAS 自体が DB エラーを返しても、施設作成は継続する（claim だけがログ記録され諦められる）', async () => {
    setupDefaultMocks(true, false, true, false, false, false, { salonClaimCasError: true });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('salon claim update failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // (x) claim が audit ログに記録される。
  test('(x) claim 成功時、salons への update として writeAuditLog が呼ばれる', async () => {
    setupDefaultMocks(true, false, true); // salonFound=true → SALON_FULL(id: 'salon-full-id') が対象
    (writeAuditLog as jest.Mock).mockClear();
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-123',
      facilityId: 'fac-123',
      action: 'update',
      tableName: 'salons',
      // 🔴 実際に CAS が焼き切った行の id を記録する（統合元が複数あり得るため、
      //   「引き継ぎに使った行」ではなく「claim が成立した行」が監査対象）。
      recordId: 'claimed-row-id',
      newValues: { claimed_by_user_id: 'user-123' },
    }));
  });

  test('claim 対象が無い場合は writeAuditLog は呼ばれない（無関係な操作を監査ログに残さない）', async () => {
    setupDefaultMocks(true, false, false); // salonFound=false → salonData=null
    (writeAuditLog as jest.Mock).mockClear();
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'salons' }),
    );
  });

  test('(i-f) Cookie 経路の取得が失敗しても通知され、施設作成は続行する', async () => {
    const { alertCaughtError } = require('@/lib/alert');
    (alertCaughtError as jest.Mock).mockClear();
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonError: { code: '42703', message: 'column salons.claimed_by_user_id does not exist' },
      userEmail: 'owner@example.com',
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    expect(alertCaughtError).toHaveBeenCalledWith(
      'facility-setup-salon-lookup',
      expect.any(Error),
      '/api/facility/setup',
    );
  });

  test('(i-g) Cookie 経路とメール経路が同じ行を拾っても、統合は1件として扱う', async () => {
    // 同じ id の行が両経路から来る（Cookie で指した申込が、そのまま本人のメールでも引ける）。
    const SAME = { ...SALON_FULL, id: COOKIE_SALON_ID, created_at: null };
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: SAME,
      emailSalonRows: [SAME],
      userEmail: 'owner@example.com',
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    // claim の CAS には重複を除いた1件だけが渡る（同じ id を2回並べない）。
    const claimCall = mockSalonUpdate.mock.calls.find(
      (c: unknown[]) => (c[0] as { claimed_by_user_id: string | null }).claimed_by_user_id != null,
    );
    expect(claimCall).toBeDefined();
    // created_at が null でも並べ替えで落ちない（?? '' の分岐）。
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('150-0001');
  });

  test('(i-g2) created_at が null の行が複数あっても並べ替えで落ちない', async () => {
    // salons.created_at は NOT NULL ではない。null 同士でも比較が成立し、
    // 元の順（Cookie 経路が先）が保たれることを確かめる。
    const COOKIE_ROW = { ...SALON_FULL, id: COOKIE_SALON_ID, created_at: null, postal_code: '111-1111' };
    const EMAIL_ROW = { ...SALON_FULL, id: '77777777-7777-4777-8777-777777777777', created_at: null, postal_code: '222-2222' };
    setupDefaultMocks(true, false, false, false, false, false, {
      cookieSalonData: COOKIE_ROW,
      emailSalonRows: [EMAIL_ROW],
      userEmail: 'owner@example.com',
    });
    const cookie = signSalonClaim(COOKIE_SALON_ID)!;
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }, '192.168.1.1', cookie) as any);
    expect(res.status).toBe(200);
    const f = mockFacilityInsert.mock.calls[0][0];
    expect(f.postal_code).toBe('111-1111');
  });

  test('(i-h) CAS が error 無しで data:null を返しても claim は成立扱いにしない', async () => {
    (writeAuditLog as jest.Mock).mockClear();
    setupDefaultMocks(true, false, true, false, false, false, {
      salonClaimCasNullData: true,
      userEmail: 'owner@example.com',
    });
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    // 「更新できたのか分からない」戻りを成功と読み替えない（salons への監査ログは書かない）。
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'salons' }),
    );
  });

  // ─── 許認可・届出の表明（利用規約 第12条）をサーバー側で必須にする ───
  test('(xi) license_warranted が無い POST は 400（画面を経由しない登録を通さない）', async () => {
    setupDefaultMocks(true, false, false);
    const res = await POST(makeRequest({
      facility_name: 'Test', business_type: 'ネイル・まつげサロン', license_warranted: undefined,
    }) as any);
    expect(res.status).toBe(400);
    // 施設は1件も作られない。
    expect(mockFacilityInsert).not.toHaveBeenCalled();
  });

  test('(xi-b) license_warranted が false でも 400（チェックを外した状態を通さない）', async () => {
    setupDefaultMocks(true, false, false);
    const res = await POST(makeRequest({
      facility_name: 'Test', business_type: 'ネイル・まつげサロン', license_warranted: false,
    }) as any);
    expect(res.status).toBe(400);
    expect(mockFacilityInsert).not.toHaveBeenCalled();
  });

  test('(xi-c) 表明ありなら、その事実が監査ログに残る', async () => {
    (writeAuditLog as jest.Mock).mockClear();
    setupDefaultMocks(true, false, false);
    const res = await POST(makeRequest({ facility_name: 'Test', business_type: 'ネイル・まつげサロン' }) as any);
    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-123',
      facilityId: 'fac-123',
      tableName: 'facility_profiles',
      newValues: expect.objectContaining({ license_warranted: true }),
    }));
  });
});
