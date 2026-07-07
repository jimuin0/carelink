const mockPostAlert = jest.fn();
const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

jest.mock('@/lib/alert', () => ({
  postAlert: (...args: unknown[]) => mockPostAlert(...args),
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  mockPostAlert.mockReset();
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('email.ts の EMAIL_FROM ドメインガード', () => {
  it('本番かつ未検証ドメインならSlackへ🔴アラートする', () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    require('../email');
    expect(mockPostAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('resend.dev'),
        route: 'email:from-domain-guard',
      })
    );
  });

  it('本番かつ検証済みドメインならアラートしない', () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <noreply@carelink-jp.com>';
    require('../email');
    expect(mockPostAlert).not.toHaveBeenCalled();
  });

  it('本番以外の環境ではドメイン検証をスキップする', () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    require('../email');
    expect(mockPostAlert).not.toHaveBeenCalled();
  });

  it('FROMにドメインが含まれない場合は何もしない', () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'invalid-no-at-symbol';
    require('../email');
    expect(mockPostAlert).not.toHaveBeenCalled();
  });
});

describe('safeSend失敗時のSlackアラートにroute(email種別)が含まれる', () => {
  it('sendNewReviewNotificationの失敗はroute="email:new_review_notification"でアラートする', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <noreply@carelink-jp.com>';
    mockSend.mockRejectedValueOnce(new Error('resend rejected'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const { sendNewReviewNotification } = require('../email');
    const ok = await sendNewReviewNotification({
      facilityEmail: 'owner@example.com',
      facilityName: 'テストサロン',
      reviewerName: 'テスト太郎',
      rating: 5,
      comment: null,
    });
    expect(ok).toBe(false);
    expect(mockPostAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('new_review_notification'),
        route: 'email:new_review_notification',
      })
    );
    consoleSpy.mockRestore();
  });
});
