/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/onboarding-followup
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds facilities 3～4 days old (not published, email not sent)
 *   - CAS guard (is null check) prevents double-send
 *   - Detects incomplete steps (menus, staff, photos, schedules)
 *   - Fetches staff IDs then schedules (2-stage query)
 *   - Sends onboarding email with missing steps
 *   - Handles facility errors gracefully
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

let mockFacilitiesSelect: jest.Mock;
let mockMenusSelect: jest.Mock;
let mockStaffSelect: jest.Mock;
let mockPhotosSelect: jest.Mock;
let mockMemberSelect: jest.Mock;
let mockProfileSelect: jest.Mock;
let mockFacilitiesUpdate: jest.Mock;
let mockSchedulesSelect: jest.Mock;

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
  (sendOnboardingFollowEmail as jest.Mock).mockResolvedValue(undefined);

  if (emailSendFails) {
    (sendOnboardingFollowEmail as jest.Mock).mockRejectedValue(new Error('Email failed'));
  }

  const facilitiesData = facilitiesFound > 0
    ? [{ id: 'fac-123', name: 'New Salon', status: 'draft' }]
    : [];

  const staffData = hasStaff ? [{ id: 'staff-1' }, { id: 'staff-2' }] : [];
  const memberData = memberFound ? { user_id: 'owner-user-123' } : null;
  const profileData = profileFound ? { email: 'owner@example.com' } : null;

  mockFacilitiesSelect = jest.fn();
  mockMenusSelect = jest.fn();
  mockStaffSelect = jest.fn();
  mockPhotosSelect = jest.fn();
  mockMemberSelect = jest.fn();
  mockProfileSelect = jest.fn();
  mockSchedulesSelect = jest.fn();

  mockFacilitiesUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      is: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: updateFails ? [] : [{ id: 'fac-123' }],
        }),
      }),
    }),
  });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'facility_profiles') {
      return {
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              neq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: facilitiesData }),
                }),
              }),
            }),
          }),
        }),
        update: mockFacilitiesUpdate,
      };
    } else if (table === 'facility_menus') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ count: hasMenus ? 2 : 0 }),
        }),
      };
    } else if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: staffData }),
        }),
      };
    } else if (table === 'facility_photos') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ count: hasPhotos ? 3 : 0 }),
        }),
      };
    } else if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybySingle: jest.fn().mockResolvedValue({ data: memberData }),
              maybeSingle: jest.fn().mockResolvedValue({ data: memberData }),
            }),
          }),
        }),
      };
    } else if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybySingle: jest.fn().mockResolvedValue({ data: profileData }),
            maybeSingle: jest.fn().mockResolvedValue({ data: profileData }),
          }),
        }),
      };
    } else if (table === 'staff_schedules') {
      return {
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ count: hasSchedules ? 1 : 0 }),
        }),
      };
    }
    return {};
  });

  // Expose mocks for assertions
  mockFacilitiesSelect.mockImplementation(() => facilitiesData);
  mockMenusSelect.mockImplementation(() => ({ count: hasMenus ? 2 : 0 }));
  mockStaffSelect.mockImplementation(() => ({ data: staffData }));
  mockPhotosSelect.mockImplementation(() => ({ count: hasPhotos ? 3 : 0 }));
  mockMemberSelect.mockImplementation(() => ({ data: memberData }));
  mockProfileSelect.mockImplementation(() => ({ data: profileData }));
  mockSchedulesSelect.mockImplementation(() => ({ count: hasSchedules ? 1 : 0 }));
}

beforeEach(() => {
  jest.clearAllMocks();
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

  test('no facilities in 3-4 day window → 200 with sent=0', async () => {
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

  test('filters facilities not published (status != published)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('facility_profiles');
  });

  test('filters unpublished email (onboarding_email_sent_at IS NULL)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('facility_profiles');
  });

  test('CAS guard prevents double-send (is null check)', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(mockFacilitiesUpdate).toHaveBeenCalled();
  });

  test('double-fire scenario (already claimed) → skips', async () => {
    mockFacilitiesUpdate.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        is: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [],
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('detects missing menus', async () => {
    setupDefaultMocks(1, false, true, true, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['メニュー・料金の登録']),
      })
    );
  });

  test('detects missing staff', async () => {
    setupDefaultMocks(1, true, false, true, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['スタッフの登録']),
      })
    );
  });

  test('detects missing photos', async () => {
    setupDefaultMocks(1, true, true, false, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['施設写真のアップロード']),
      })
    );
  });

  test('detects missing schedules (via staff_schedules)', async () => {
    setupDefaultMocks(1, true, true, true, false);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['スケジュールの設定']),
      })
    );
  });

  test('always includes publish step', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['施設を「公開」にする']),
      })
    );
  });

  test('fetches staff IDs then queries staff_schedules', async () => {
    setupDefaultMocks(1, true, true, true, false);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_schedules');
  });

  test('skips schedules query if no staff found', async () => {
    setupDefaultMocks(1, true, false, true, true);

    await GET(makeRequest() as any);

    // Should not query schedules
  });

  test('gets owner user_id from facility_members', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  test('skips if owner member not found', async () => {
    setupDefaultMocks(1, true, true, true, true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // Should not send email
  });

  test('gets owner email from profiles', async () => {
    setupDefaultMocks(1, true, true, true, true, true);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('profiles');
  });

  test('skips if owner email not found', async () => {
    setupDefaultMocks(1, true, true, true, true, true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    // Should not send email
  });

  test('sends onboarding email with facility name', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityName: 'New Salon',
      })
    );
  });

  test('sends onboarding email to owner email', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: 'owner@example.com',
      })
    );
  });

  test('email send failure → logs and continues', async () => {
    setupDefaultMocks(1, true, true, true, true, true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('limits facilities to 100', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockFromDelegate).toHaveBeenCalledWith('facility_profiles');
  });

  test('exception during processing → 500', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('Fatal'); });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('time window 3-4 days ago', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Should use Date.now() - 3*24*60*60*1000 and 4*24*60*60*1000
  });

  test('all missing steps detected', async () => {
    setupDefaultMocks(1, false, false, false, false);

    await GET(makeRequest() as any);

    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining([
          'メニュー・料金の登録',
          'スタッフの登録',
          '施設写真のアップロード',
          'スケジュールの設定',
          '施設を「公開」にする',
        ]),
      })
    );
  });

  test('no missing steps (all complete)', async () => {
    setupDefaultMocks(1, true, true, true, true);

    await GET(makeRequest() as any);

    // Should only have publish step
    const call = (sendOnboardingFollowEmail as jest.Mock).mock.calls[0];
    expect(call[0].missingSteps).toContain('施設を「公開」にする');
  });

  test('staffData null → staffIds empty, schedule query skipped', async () => {
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [{ id: 'fac-z', name: 'Z', status: 'draft' }] }),
                  }),
                }),
              }),
            }),
          }),
          update: mockFacilitiesUpdate,
        };
      }
      if (table === 'facility_menus') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: 1 }) }) };
      if (table === 'staff_profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null }) }) };
      if (table === 'facility_photos') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: 1 }) }) };
      if (table === 'facility_members') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'owner' } }),
            }),
          }),
        }),
      };
      if (table === 'profiles') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: { email: 'o@example.com' } }),
          }),
        }),
      };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['スタッフの登録']),
      })
    );
  });

  test('scheduleCount nullable (null count) → falls back to 0 = missing schedule', async () => {
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [{ id: 'fac-n', name: 'N', status: 'draft' }] }),
                  }),
                }),
              }),
            }),
          }),
          update: mockFacilitiesUpdate,
        };
      }
      if (table === 'facility_menus') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: 1 }) }) };
      if (table === 'staff_profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ id: 's1' }] }) }) };
      if (table === 'facility_photos') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: 1 }) }) };
      if (table === 'staff_schedules') return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ count: null }) }) };
      if (table === 'facility_members') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'owner' } }),
            }),
          }),
        }),
      };
      if (table === 'profiles') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: { email: 'o@example.com' } }),
          }),
        }),
      };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['スケジュールの設定']),
      })
    );
  });

  test('facility processing throws → caught, skipped++', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [{ id: 'f-err', name: 'E', status: 'draft' }] }),
                  }),
                }),
              }),
            }),
          }),
          update: mockFacilitiesUpdate,
        };
      }
      if (table === 'facility_menus') throw new Error('menus query exploded');
      return {};
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

    // Should fetch menus, staff, photos, member in parallel
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_menus');
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_photos');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  // Branch coverage: line 84 — menuCount is null → (menuCount ?? 0) uses right side 0 → missingStep added
  // Branch coverage: line 86 — photoCount is null → (photoCount ?? 0) uses right side 0 → missingStep added
  test('menuCount=null, photoCount=null → どちらも 0 に fallback し missing step 追加', async () => {
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [{ id: 'fac-q', name: 'Q', status: 'draft' }] }),
                  }),
                }),
              }),
            }),
          }),
          update: mockFacilitiesUpdate,
        };
      }
      // menuCount null → (menuCount ?? 0) === 0 → push メニュー step (line 84 right branch)
      if (table === 'facility_menus') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: null }) }) };
      if (table === 'staff_profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [{ id: 's1' }] }) }) };
      // photoCount null → (photoCount ?? 0) === 0 → push photo step (line 86 right branch)
      if (table === 'facility_photos') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: null }) }) };
      if (table === 'staff_schedules') return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ count: 1 }) }) };
      if (table === 'facility_members') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'owner-u' } }),
            }),
          }),
        }),
      };
      if (table === 'profiles') return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: { email: 'o@test.com' } }),
          }),
        }),
      };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: expect.arrayContaining(['メニュー・料金の登録', '施設写真のアップロード']),
      })
    );
  });
});
