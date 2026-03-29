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
