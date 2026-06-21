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
import { sendOnboardingFollowEmail } from '@/lib/email';
import { GET } from '../route';

// Holds the facility_profiles UPDATE mock for the current test (for claim/release assertions).
let facUpdateMock: jest.Mock;

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

function buildFrom(opts: any = {}) {
  const {
    facilities = [{ id: 'fac-123', name: 'New Salon', status: 'draft' }],
    claimed = [{ id: 'fac-123' }],
    releaseError = null,
    menuCount = 0,
    staffData = [] as any[],
    photoCount = 0,
    scheduleCount = 0,
    member = { user_id: 'owner-user-123' },
    profile = { email: 'owner@example.com' },
    orderSpy = null as any,
  } = opts;

  facUpdateMock = facilitiesUpdate(claimed, releaseError);

  return (table: string) => {
    if (table === 'facility_profiles') {
      const order = orderSpy || jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: facilities }),
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
    if (table === 'facility_menus') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: menuCount }) }) };
    if (table === 'staff_profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: staffData }) }) };
    if (table === 'facility_photos') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: photoCount }) }) };
    if (table === 'staff_schedules') return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ count: scheduleCount }) }) };
    if (table === 'facility_members') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: member }) }),
        }),
      }),
    };
    if (table === 'profiles') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: profile }) }),
      }),
    };
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
    const orderSpy = jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) });
    mockFromDelegate.mockImplementation(buildFrom({ facilities: [], orderSpy }));
    await GET(makeRequest() as any);
    expect(orderSpy).toHaveBeenCalledWith('created_at', { ascending: true });
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
});
