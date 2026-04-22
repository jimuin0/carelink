const mockSendNotification = jest.fn();

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

let mockSubData: unknown = null;
const mockDeleteEq = jest.fn().mockResolvedValue({ error: null });
const mockDeleteFn = jest.fn().mockReturnValue({ eq: mockDeleteEq });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockSubData }),
        }),
      }),
      delete: mockDeleteFn,
    }),
  }),
}));

// Set env BEFORE require (import is hoisted, require is not)
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendPushToUser } = require('../push');

beforeEach(() => {
  mockSendNotification.mockReset();
  mockDeleteFn.mockClear();
  mockDeleteEq.mockClear();
  mockSubData = null;
});

describe('sendPushToUser', () => {
  test('サブスクリプションがない場合はfalseを返す', async () => {
    mockSubData = null;
    const result = await sendPushToUser('user-1', { title: 'Test', body: 'Hello' });
    expect(result).toBe(false);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test('サブスクリプションがある場合はPush通知を送信する', async () => {
    mockSubData = { endpoint: 'https://push.example.com/sub1', p256dh: 'key1', auth: 'auth1' };
    mockSendNotification.mockResolvedValue({});

    const result = await sendPushToUser('user-1', { title: '予約確定', body: '明日10:00〜' });
    expect(result).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.com/sub1', keys: { p256dh: 'key1', auth: 'auth1' } },
      JSON.stringify({ title: '予約確定', body: '明日10:00〜' })
    );
  });

  test('410エラー時にサブスクリプションを削除する', async () => {
    mockSubData = { endpoint: 'https://push.example.com/expired', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    const result = await sendPushToUser('user-expired', { title: 'Test', body: 'Expired' });
    expect(result).toBe(false);
    expect(mockDeleteFn).toHaveBeenCalled();
  });

  test('通常のエラー時はサブスクリプションを削除しない', async () => {
    mockSubData = { endpoint: 'https://push.example.com/err', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    const result = await sendPushToUser('user-err', { title: 'Test', body: 'Error' });
    expect(result).toBe(false);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });
});

describe('sendPushToUser — deep tests', () => {
  test('VAPID キー未設定時は即 false を返す', async () => {
    const origPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const origPriv = process.env.VAPID_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    // Re-require to pick up missing env
    jest.resetModules();
    jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: mockSendNotification }));
    jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }), delete: mockDeleteFn }) }) }));
    const { sendPushToUser: freshFn } = require('../push');
    const result = await freshFn('user-x', { title: 'T', body: 'B' });
    expect(result).toBe(false);
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = origPub;
    process.env.VAPID_PRIVATE_KEY = origPriv;
  });

  test('404 エラー時もサブスクリプションを削除する', async () => {
    mockSubData = { endpoint: 'https://push.example.com/gone', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockRejectedValue({ statusCode: 404 });

    const result = await sendPushToUser('user-404', { title: 'T', body: 'B' });
    expect(result).toBe(false);
    expect(mockDeleteFn).toHaveBeenCalled();
  });

  test('url フィールドがペイロードに含まれる', async () => {
    mockSubData = { endpoint: 'https://push.example.com/s', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockResolvedValue({});

    await sendPushToUser('user-url', { title: 'T', body: 'B', url: '/mypage' });
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.url).toBe('/mypage');
  });

  test('tag フィールドがペイロードに含まれる', async () => {
    mockSubData = { endpoint: 'https://push.example.com/s', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockResolvedValue({});

    await sendPushToUser('user-tag', { title: 'T', body: 'B', tag: 'booking' });
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.tag).toBe('booking');
  });

  test('ペイロードが JSON.stringify されて渡る', async () => {
    mockSubData = { endpoint: 'https://push.example.com/s', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockResolvedValue({});
    const pl = { title: '予約確定', body: '10:00〜' };

    await sendPushToUser('user-json', pl);
    expect(mockSendNotification.mock.calls[0][1]).toBe(JSON.stringify(pl));
  });

  test('pushSubscription が endpoint/keys 構造で渡る', async () => {
    mockSubData = { endpoint: 'https://fcm.example.com/e1', p256dh: 'abc', auth: 'xyz' };
    mockSendNotification.mockResolvedValue({});

    await sendPushToUser('user-struct', { title: 'T', body: 'B' });
    const sub = mockSendNotification.mock.calls[0][0];
    expect(sub.endpoint).toBe('https://fcm.example.com/e1');
    expect(sub.keys.p256dh).toBe('abc');
    expect(sub.keys.auth).toBe('xyz');
  });

  test('削除クエリが正しい user_id で eq される', async () => {
    mockSubData = { endpoint: 'https://push.example.com/del', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    await sendPushToUser('user-del-check', { title: 'T', body: 'B' });
    expect(mockDeleteEq).toHaveBeenCalledWith('user_id', 'user-del-check');
  });

  test('500 エラーでは削除されず false が返る', async () => {
    mockSubData = { endpoint: 'https://push.example.com/s', p256dh: 'k', auth: 'a' };
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    const result = await sendPushToUser('user-500', { title: 'T', body: 'B' });
    expect(result).toBe(false);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendPushToFacilityOwners
// ---------------------------------------------------------------------------
// These tests use jest.resetModules() + jest.doMock() so that each test can
// control the `from()` mock independently of the module-level mock above.
// ---------------------------------------------------------------------------
describe('sendPushToFacilityOwners', () => {
  // Per-test mocks — assigned in beforeEach
  let sendPushToFacilityOwners: (facilityId: string, payload: { title: string; body: string }) => Promise<void>;
  let mockSendNotificationLocal: jest.Mock;
  let mockFromFn: jest.Mock;

  beforeEach(() => {
    jest.resetModules();

    mockSendNotificationLocal = jest.fn();

    // mockFromFn is called with the table name and must return the right chain.
    // Default: facility_members returns no members; push_subscriptions returns null sub.
    mockFromFn = jest.fn((table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [] }),
            }),
          }),
        };
      }
      // push_subscriptions (used by sendPushToUser)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null }),
          }),
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    jest.doMock('web-push', () => ({
      setVapidDetails: jest.fn(),
      sendNotification: (...args: unknown[]) => mockSendNotificationLocal(...args),
    }));

    jest.doMock('../supabase-server', () => ({
      createServiceRoleClient: () => ({ from: mockFromFn }),
    }));

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-pub';
    process.env.VAPID_PRIVATE_KEY = 'test-priv';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ sendPushToFacilityOwners } = require('../push'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('VAPID キー未設定時は何もしない', async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    // Re-require with missing env
    jest.resetModules();
    jest.doMock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: mockSendNotificationLocal }));
    jest.doMock('../supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFromFn }) }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ sendPushToFacilityOwners } = require('../push'));

    await sendPushToFacilityOwners('facility-1', { title: 'T', body: 'B' });

    expect(mockFromFn).not.toHaveBeenCalled();
    expect(mockSendNotificationLocal).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-pub';
    process.env.VAPID_PRIVATE_KEY = 'test-priv';
  });

  test('メンバーが空の場合は通知を送らない', async () => {
    // Default mockFromFn already returns { data: [] } for facility_members
    await sendPushToFacilityOwners('facility-empty', { title: 'T', body: 'B' });

    expect(mockSendNotificationLocal).not.toHaveBeenCalled();
  });

  test('メンバーが null の場合は通知を送らない', async () => {
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    await sendPushToFacilityOwners('facility-null', { title: 'T', body: 'B' });

    expect(mockSendNotificationLocal).not.toHaveBeenCalled();
  });

  test('1 人のメンバーにサブスクリプションがある場合は通知を送る', async () => {
    const sub = { endpoint: 'https://push.example.com/u1', p256dh: 'key1', auth: 'auth1' };

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [{ user_id: 'user-owner-1' }] }),
            }),
          }),
        };
      }
      // push_subscriptions
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: sub }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    mockSendNotificationLocal.mockResolvedValue({});

    await sendPushToFacilityOwners('facility-1', { title: '予約確定', body: '明日10:00〜' });

    expect(mockSendNotificationLocal).toHaveBeenCalledTimes(1);
    expect(mockSendNotificationLocal).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: '予約確定', body: '明日10:00〜' })
    );
  });

  test('複数メンバーがいる場合は全員に通知を送る', async () => {
    const members = [
      { user_id: 'owner-a' },
      { user_id: 'owner-b' },
    ];
    const subs: Record<string, { endpoint: string; p256dh: string; auth: string }> = {
      'owner-a': { endpoint: 'https://push.example.com/a', p256dh: 'pa', auth: 'aa' },
      'owner-b': { endpoint: 'https://push.example.com/b', p256dh: 'pb', auth: 'ab' },
    };

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: members }),
            }),
          }),
        };
      }
      // push_subscriptions — eq('user_id', userId) returns the right sub
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: () => Promise.resolve({ data: subs[userId] ?? null }),
          }),
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    mockSendNotificationLocal.mockResolvedValue({});

    await sendPushToFacilityOwners('facility-multi', { title: 'Multi', body: 'Test' });

    expect(mockSendNotificationLocal).toHaveBeenCalledTimes(2);
    const endpoints = mockSendNotificationLocal.mock.calls.map(
      (call: [{ endpoint: string }, string]) => call[0].endpoint
    );
    expect(endpoints).toContain('https://push.example.com/a');
    expect(endpoints).toContain('https://push.example.com/b');
  });

  test('一部メンバーが通知失敗しても他メンバーには送信される (Promise.allSettled)', async () => {
    const members = [
      { user_id: 'user-fail' },
      { user_id: 'user-ok' },
    ];
    const subs: Record<string, { endpoint: string; p256dh: string; auth: string }> = {
      'user-fail': { endpoint: 'https://push.example.com/fail', p256dh: 'pf', auth: 'af' },
      'user-ok':   { endpoint: 'https://push.example.com/ok',   p256dh: 'po', auth: 'ao' },
    };

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: members }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: () => Promise.resolve({ data: subs[userId] ?? null }),
          }),
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    mockSendNotificationLocal
      .mockRejectedValueOnce({ statusCode: 500 })  // user-fail
      .mockResolvedValueOnce({});                   // user-ok

    // Should not throw even though one member's push failed
    await expect(
      sendPushToFacilityOwners('facility-partial', { title: 'T', body: 'B' })
    ).resolves.toBeUndefined();

    expect(mockSendNotificationLocal).toHaveBeenCalledTimes(2);
  });

  test('facility_members クエリが正しい facilityId と role で呼ばれる', async () => {
    const inMock = jest.fn().mockResolvedValue({ data: [] });
    const eqMock = jest.fn().mockReturnValue({ in: inMock });
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock });

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'facility_members') {
        return { select: selectMock };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      };
    });

    await sendPushToFacilityOwners('facility-xyz', { title: 'T', body: 'B' });

    expect(mockFromFn).toHaveBeenCalledWith('facility_members');
    expect(selectMock).toHaveBeenCalledWith('user_id');
    expect(eqMock).toHaveBeenCalledWith('facility_id', 'facility-xyz');
    expect(inMock).toHaveBeenCalledWith('role', ['owner', 'admin']);
  });
});
