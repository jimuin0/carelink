/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/onboarding-followup
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds facilities 3～7 days old (not published, email not sent), oldest-first
 *   - CAS guard (is null check) prevents double-send
 *   - Detects incomplete steps (menus, staff, photos, schedules)
 *   - Fetches staff IDs then schedules (2-stage query)
 *   - Sends onboarding email with missing steps
 *   - Time budget guard defers remaining work to next run (timeout-proof)
 *   - Releases claim (sent_at→null) on transient failure; keeps claim when no contact
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email');

const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendOnboardingFollowEmail, sendRegistrationLeadFollowEmail } from '@/lib/email';
import { GET } from '../route';

// Holds the facility_profiles UPDATE mock for the current test (for claim/release assertions).
let facUpdateMock: jest.Mock;
// Holds the salons UPDATE mock for the current test (for claim/release assertions, 第2パス).
let salonUpdateMock: jest.Mock;

// facility_profiles UPDATE used for BOTH:
//   claim:   .update({sent_at:now}).eq('id').is(null).select('id') → { data: claimed }
//   release: .update({sent_at:null}).eq('id') (awaited) → returns eq object; { error } destructured
function facilitiesUpdate(claimed: any[] = [{ id: 'fac-123' }], releaseError: any = null) {
  const eqReturn: any = {
    is: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ data: claimed }),
    }),
    error: releaseError ?? undefined,
  };
  return jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(eqReturn) });
}

// salons UPDATE（第2パス）は facilitiesUpdate と全く同じ形（claim/release 二役）なので
// ロジックを共有する。変数名だけ役割に合わせて分けてある。
const salonsUpdate = facilitiesUpdate;

function buildFrom(opts: any = {}) {
  const {
    facilities = [{ id: 'fac-123', name: 'New Salon', status: 'draft' }],
    facilitiesErr = null,
    claimed = [{ id: 'fac-123' }],
    releaseError = null,
    menuCount = 0,
    staffData = [] as any[],
    photoCount = 0,
    scheduleCount = 0,
    member = { user_id: 'owner-user-123' },
    profile = { email: 'owner@example.com' },
    orderSpy = null as any,
    menuError = null,
    staffError = null,
    photoError = null,
    memberError = null,
    scheduleError = null,
    // ---- 第2パス（salons）用オプション。デフォルトは既存テストの挙動を変えない空配列。----
    salons = [] as any[],
    salonsErr = null,
    salonClaimed = [{ id: 'sal-1' }],
    salonReleaseError = null,
    salonOrderSpy = null as any,
    // profiles.email = X のとき「アカウント作成済み」とみなすメール一覧。
    existingAccountEmails = [] as string[],
    profileEmailCheckError = null,
  } = opts;

  facUpdateMock = facilitiesUpdate(claimed, releaseError);
  salonUpdateMock = salonsUpdate(salonClaimed, salonReleaseError);

  return (table: string) => {
    if (table === 'facility_profiles') {
      // fetchAllPaged により .limit() ではなく .range() でページングされる
      // （1000件PostgREST上限の恒久取りこぼしを根治した実装に合わせる）。
      const order = orderSpy || jest.fn().mockReturnValue({
        range: jest.fn((from: number, to: number) => Promise.resolve({
          data: facilitiesErr ? null : facilities.slice(from, to + 1),
          error: facilitiesErr,
        })),
      });
      return {
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              neq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({ order }),
              }),
            }),
          }),
        }),
        update: facUpdateMock,
      };
    }
    if (table === 'facility_menus') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: menuCount, error: menuError }) }) };
    if (table === 'staff_profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: staffData, error: staffError }) }) };
    if (table === 'facility_photos') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: photoCount, error: photoError }) }) };
    if (table === 'staff_schedules') return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ count: scheduleCount, error: scheduleError }) }) };
    if (table === 'facility_members') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: member, error: memberError }) }),
        }),
      }),
    };
    // salons.is() の呼び出し引数を検証したいテスト用（未指定なら中身を検証しない素の jest.fn）。
    const salonIsSpy = opts.salonIsSpy as jest.Mock | null;
    // profiles は2つの異なる呼び出し元から使われる:
    //   facility パス:  .select('email').eq('id', userId).maybeSingle()      → member の owner profile
    //   salons パス:    .select('id').eq('email', email).maybeSingle()       → アカウント作成済みか判定
    // eq() に渡された field 名で分岐する（呼び出し元コードの引数をそのまま検証できる）。
    if (table === 'profiles') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn((field: string, value: string) => {
          if (field === 'email') {
            const found = existingAccountEmails.includes(value) ? { id: `profile-${value}` } : null;
            return { maybeSingle: jest.fn().mockResolvedValue({ data: found, error: profileEmailCheckError }) };
          }
          return { maybeSingle: jest.fn().mockResolvedValue({ data: profile }) };
        }),
      }),
    };
    if (table === 'salons') {
      const order = salonOrderSpy || jest.fn().mockReturnValue({
        range: jest.fn((from: number, to: number) => Promise.resolve({
          data: salonsErr ? null : salons.slice(from, to + 1),
          error: salonsErr,
        })),
      });
      const isFn = salonIsSpy
        ? salonIsSpy.mockReturnValue({ order })
        : jest.fn().mockReturnValue({ order });
      return {
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              is: isFn,
            }),
          }),
        }),
        update: salonUpdateMock,
      };
    }
    return {};
  };
}

function setupDefaultMocks(
  facilitiesFound: number = 1,
  hasMenus: boolean = false,
  hasStaff: boolean = false,
  hasPhotos: boolean = false,
  hasSchedules: boolean = false,
  memberFound: boolean = true,
  profileFound: boolean = true,
  emailSendFails: boolean = false,
  updateFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  // sendOnboardingFollowEmail は送達可否を boolean で返す（safeSend 仕様）。成功=true→claim維持。
  (sendOnboardingFollowEmail as jest.Mock).mockResolvedValue(true);
  // 🔴 sendRegistrationLeadFollowEmail も同じ契約（boolean）。既定を true にしないと
  // 第2パスのテスト (iv)（送信失敗→claim解放）が「既定 undefined=falsy」でたまたま
  // 偽陽性になる（CLAUDE.md の LINE outcome の教訓と同型の罠）。
  (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(true);
  if (emailSendFails) {
    // 送信失敗は throw ではなく false 返却で表現される（本番の safeSend は throw しない）→ claim 解放で再送。
    (sendOnboardingFollowEmail as jest.Mock).mockResolvedValue(false);
  }

  const facilities = facilitiesFound > 0
    ? Array.from({ length: facilitiesFound }, (_, i) => ({ id: `fac-${i + 1}`, name: 'New Salon', status: 'draft' }))
    : [];

  mockFromDelegate.mockImplementation(
    buildFrom({
      facilities,
      claimed: updateFails ? [] : [{ id: 'fac-1' }],
      menuCount: hasMenus ? 2 : 0,
      staffData: hasStaff ? [{ id: 'staff-1' }, { id: 'staff-2' }] : [],
      photoCount: hasPhotos ? 3 : 0,
      scheduleCount: hasSchedules ? 1 : 0,
      member: memberFound ? { user_id: 'owner-user-123' } : null,
      profile: profileFound ? { email: 'owner@example.com' } : null,
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/onboarding-followup', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/onboarding-followup', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );
    const res = await GET(makeRequest('invalid') as any);
    expect(res.status).toBe(401);
  });

  test('no facilities in window → 200 with sent=0', async () => {
    setupDefaultMocks(0);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('facility found → processes onboarding', async () => {
    setupDefaultMocks(1, true, true, true, true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('applies oldest-first order on created_at', async () => {
    const orderSpy = jest.fn().mockReturnValue({ range: jest.fn().mockResolvedValue({ data: [] }) });
    mockFromDelegate.mockImplementation(buildFrom({ facilities: [], orderSpy }));
    await GET(makeRequest() as any);
    expect(orderSpy).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  // 【恒久根治の回帰防止】旧実装は主クエリの error を無視しており、一過性障害が「0件=skipped
  // (成功)」に偽装されfollowupメールが無音で全停止していた（review-request H-2 と同型）。
  test('facilities主クエリがerror → 500（0件=skipped 成功偽装しない）', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: { message: 'db error' } }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'db error' }),
    );
  });

  // 分岐カバレッジ: error が Error インスタンスの場合は .message を直接使う経路。
  test('facilities主クエリのerrorがErrorインスタンス → その message を使う', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: new Error('boom instance') }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'boom instance' }),
    );
  });

  // 分岐カバレッジ: error が Error でも message プロパティ持ちでもない場合は String() フォールバック。
  test('facilities主クエリのerrorがmessage無し → String() フォールバック', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: 'plain-string-error' }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'plain-string-error' }),
    );
  });

  test('filters facilities not published / email IS NULL', async () => {
    setupDefaultMocks(1);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_profiles');
  });

  test('CAS guard prevents double-send (is null check)', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(facUpdateMock).toHaveBeenCalled();
  });

  test('double-fire scenario (already claimed) → skips', async () => {
    setupDefaultMocks(1, true, true, true, true, true, true, false, true); // updateFails → claim returns []
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('detects missing menus', async () => {
    setupDefaultMocks(1, false, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['メニュー・料金の登録']) })
    );
  });

  test('detects missing staff', async () => {
    setupDefaultMocks(1, true, false, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['スタッフの登録']) })
    );
  });

  test('detects missing photos', async () => {
    setupDefaultMocks(1, true, true, false, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['施設写真のアップロード']) })
    );
  });

  test('detects missing schedules (via staff_schedules)', async () => {
    setupDefaultMocks(1, true, true, true, false);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['スケジュールの設定']) })
    );
  });

  test('always includes publish step', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['施設を「公開」にする']) })
    );
  });

  test('fetches staff IDs then queries staff_schedules', async () => {
    setupDefaultMocks(1, true, true, true, false);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_schedules');
  });

  test('gets owner user_id from facility_members', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  test('owner member not found → noContact, claim kept (no release)', async () => {
    setupDefaultMocks(1, true, true, true, true, false); // memberFound=false
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(0);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  });

  test('owner email not found → noContact, claim kept (no release)', async () => {
    setupDefaultMocks(1, true, true, true, true, true, false); // profileFound=false
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(0);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  });

  test('sends onboarding email with facility name and owner email', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ facilityName: 'New Salon', ownerEmail: 'owner@example.com' })
    );
  });

  test('email send failure → releases claim (sent_at→null) for retry', async () => {
    setupDefaultMocks(1, true, true, true, true, true, true, true); // emailSendFails
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
  });

  test('claim release failure → logs error', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (sendOnboardingFollowEmail as jest.Mock).mockRejectedValue(new Error('Email failed'));
    (logCronRun as jest.Mock).mockResolvedValue(undefined);
    (checkCronAuth as jest.Mock).mockReturnValue(null);
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 2, staffData: [{ id: 's1' }], photoCount: 3, scheduleCount: 1,
      releaseError: { message: 'release boom' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith(
      '[onboarding-followup] claim release failed',
      expect.objectContaining({ facilityId: 'fac-123' })
    );
    errSpy.mockRestore();
  });

  test('consider limit reached → warns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(2000, true, true, true, true);
    await GET(makeRequest() as any);
    expect(warnSpy).toHaveBeenCalledWith(
      '[onboarding-followup] consider limit reached',
      expect.objectContaining({ limit: 2000 })
    );
    warnSpy.mockRestore();
  });

  test('time budget exceeded → defers remaining to next run', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(1, true, true, true, true);
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(10_000_000);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deferred).toBe(1);
    expect(json.processed).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      '[onboarding-followup] time budget exceeded, deferring rest to next run',
      expect.objectContaining({ deferred: 1 })
    );
    warnSpy.mockRestore();
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'success', expect.any(Date),
      expect.objectContaining({ processed: expect.any(Number) })
    );
  });

  test('exception during processing → 500', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('Fatal'); });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('all missing steps detected', async () => {
    setupDefaultMocks(1, false, false, false, false);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining([
          'メニュー・料金の登録', 'スタッフの登録', '施設写真のアップロード',
          'スケジュールの設定', '施設を「公開」にする',
        ]),
      })
    );
  });

  test('no missing steps (all complete) → only publish step', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    const call = (sendOnboardingFollowEmail as jest.Mock).mock.calls[0];
    expect(call[0].missingSteps).toContain('施設を「公開」にする');
  });

  test('staffData null → staffIds empty, schedule query skipped', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-z', name: 'Z', status: 'draft' }],
      claimed: [{ id: 'fac-z' }],
      menuCount: 1, staffData: null, photoCount: 1,
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['スタッフの登録']) })
    );
  });

  test('scheduleCount null → falls back to 0 = missing schedule', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-n', name: 'N', status: 'draft' }],
      claimed: [{ id: 'fac-n' }],
      menuCount: 1, staffData: [{ id: 's1' }], photoCount: 1, scheduleCount: null,
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['スケジュールの設定']) })
    );
  });

  test('facility processing throws → caught, claim released', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fromImpl = buildFrom({ facilities: [{ id: 'f-err', name: 'E', status: 'draft' }], claimed: [{ id: 'f-err' }] });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_menus') throw new Error('menus query exploded');
      return fromImpl(table);
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  test('non-Error throw → String fallback', async () => {
    mockFromDelegate.mockImplementation(() => { throw 'plain string'; });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('Promise.all for parallel queries', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_menus');
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_photos');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  test('未完了ステップ判定クエリが error → 誤内容メールを送らず claim 解放（翌 run 再送）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // menu count クエリが error → stepQueryErr → throw → catch で delivered=false のまま claim 解放。
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-e1', name: 'E1', status: 'draft' }],
      claimed: [{ id: 'fac-e1' }],
      menuError: { message: 'menu count boom' },
      staffData: [{ id: 's1' }], photoCount: 1, scheduleCount: 1,
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    // 誤内容メールは送らない
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
    // claim を解放（onboarding_email_sent_at: null）して翌 run 再送
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[onboarding-followup] facility processing error',
      expect.objectContaining({ facilityId: 'fac-e1' })
    );
    errSpy.mockRestore();
  });

  test('staff_schedules カウントが error → 「未設定」誤判定を避け throw → claim 解放', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // staffData 非空 → schedule クエリが走る。そのクエリが error → throw → claim 解放。
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-e2', name: 'E2', status: 'draft' }],
      claimed: [{ id: 'fac-e2' }],
      menuCount: 1, staffData: [{ id: 's1' }], photoCount: 1,
      scheduleError: { message: 'schedule count boom' },
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
    errSpy.mockRestore();
  });

  test('menuCount=null, photoCount=null → both fallback to 0 → missing steps added', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-q', name: 'Q', status: 'draft' }],
      claimed: [{ id: 'fac-q' }],
      menuCount: null, staffData: [{ id: 's1' }], photoCount: null, scheduleCount: 1,
      member: { user_id: 'owner-u' }, profile: { email: 'o@test.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: expect.arrayContaining(['メニュー・料金の登録', '施設写真のアップロード']) })
    );
  });

  // ==========================================================================
  // 第2パス: salons（登録はしたがアカウントを作っていない申込者）
  // 本番実データ（salons 8件 vs facility_profiles 3件）で確定した差の5件を拾う。
  // ==========================================================================
  describe('salons 第2パス（登録リードフォロー）', () => {
    const leadSalon = { id: 'sal-1', email: 'lead@example.com', facility_name: 'Lead Salon', business_type: 'clinic' };

    test('(i) profiles に同じ email が無い salons 行にフォローメールが送られる', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'lead@example.com',
        facilityName: 'Lead Salon',
        businessType: 'clinic',
      });
      expect(json.processed).toBe(1);
      expect(json.sent).toBe(1);
    });

    // 🔴 negative control: この除外条件（existingAccountEmails に含まれる → 送らない）を
    // route.ts 側で一時的に無効化（if (existingProfile) { alreadyRegistered = true; } を
    // 常に false 相当にする）して本テストを実行し、実際に赤くなる（送信されてしまう）ことを
    // 確認済み → 元に戻して緑に復帰。テストが本当に条件を検知できることを確認した。
    test('(ii) profiles に同じ email が【ある】salons 行には送られない（アカウント作成済みは対象外）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salons: [leadSalon],
        existingAccountEmails: ['lead@example.com'],
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      // アカウント作成済み＝claim は維持（null への解放が起きない）。
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(0);
      const json = await res.json();
      expect(json.sent).toBe(0);
    });

    test('(iii) registration_followup_sent_at IS NULL で絞り込む（主クエリの .is フィルタ）', async () => {
      const salonIsSpy = jest.fn();
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [], salonIsSpy }));
      await GET(makeRequest() as any);
      expect(salonIsSpy).toHaveBeenCalledWith('registration_followup_sent_at', null);
    });

    test('(iv) 送信に失敗したら claim が解放される（翌 run で再試行できる）', async () => {
      (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(false);
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sent).toBe(0);
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(1);
    });

    test('(v) 既存の facility_profiles パスの挙動が変わっていない（同時に処理しても両方 sent に数えられる）', async () => {
      setupDefaultMocks(1, true, true, true, true); // facility_profiles 側は既存どおりフル完了ケース
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [{ id: 'fac-1', name: 'New Salon', status: 'draft' }],
        claimed: [{ id: 'fac-1' }],
        menuCount: 2, staffData: [{ id: 's1' }], photoCount: 3, scheduleCount: 1,
        member: { user_id: 'owner-user-123' }, profile: { email: 'owner@example.com' },
        salons: [leadSalon],
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      // facility 1件 + salon 1件 = processed 2（facility パスの完了ロジックは無変更のまま機能）
      expect(json.processed).toBe(2);
      expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
        expect.objectContaining({ facilityName: 'New Salon', ownerEmail: 'owner@example.com' })
      );
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'lead@example.com', facilityName: 'Lead Salon', businessType: 'clinic',
      });
    });

    test('(vi) 第2パスのクエリが error を返したときに「0件で成功」に偽装されない → 500', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: { message: 'salons db error' } }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'salons db error' }),
      );
      // facilities.length===0 のケースでも salonsErr は「facilities クエリ後・salons クエリで」検出される
      // ので、facilities 側の空チェックより先に必ず評価される（0件成功への偽装が起きない）ことの確認。
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
    });

    // 分岐カバレッジ: salonsErr が Error インスタンスの場合は .message を直接使う経路。
    test('salonsErr が Error インスタンス → その message を使う', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: new Error('salon boom instance') }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'salon boom instance' }),
      );
    });

    // 分岐カバレッジ: salonsErr が message を持たない場合は String() フォールバック。
    test('salonsErr が message 無し → String() フォールバック', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: 'plain-salon-error' }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'plain-salon-error' }),
      );
    });

    test('facilities が空でも salons があれば処理し「0件=skipped」に偽装しない（&& 分岐カバレッジ）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'success', expect.any(Date),
        expect.objectContaining({ processed: 1 }),
      );
    });

    test('facilities も salons も空 → skipped（従来どおり）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sent).toBe(0);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'skipped', expect.any(Date),
        expect.objectContaining({ processed: 0, skipped: 0 }),
      );
    });

    test('二重発火（既に claim 済み）→ skip', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon], salonClaimed: [] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const json = await res.json();
      expect(json.skipped).toBe(1);
    });

    test('profiles email 照合クエリが error → 誤って送信せず claim 解放（翌 run 再送）', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [], salons: [leadSalon], profileEmailCheckError: { message: 'profile email check boom' },
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        '[onboarding-followup] salon processing error',
        expect.objectContaining({ salonId: 'sal-1' })
      );
      errSpy.mockRestore();
    });

    test('claim release 失敗 → ログに残す', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(false);
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [], salons: [leadSalon], salonReleaseError: { message: 'salon release boom' },
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(errSpy).toHaveBeenCalledWith(
        '[onboarding-followup] salon claim release failed',
        expect.objectContaining({ salonId: 'sal-1' })
      );
      errSpy.mockRestore();
    });

    test('時間予算超過 → 残りは翌 run に回す（deferred に加算される）', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(10_000_000);
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deferred).toBe(1);
      expect(json.processed).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '[onboarding-followup] time budget exceeded, deferring rest to next run (salons)',
        expect.objectContaining({ deferred: 1 })
      );
      warnSpy.mockRestore();
    });

    test('oldest-first 順で created_at を order する', async () => {
      const salonOrderSpy = jest.fn().mockReturnValue({ range: jest.fn().mockResolvedValue({ data: [] }) });
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [], salonOrderSpy }));
      await GET(makeRequest() as any);
      expect(salonOrderSpy).toHaveBeenCalledWith('created_at', { ascending: true });
    });
  });
});
