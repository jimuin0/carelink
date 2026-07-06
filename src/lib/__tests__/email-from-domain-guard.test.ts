const mockPostAlert = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

jest.mock('@/lib/alert', () => ({
  postAlert: (...args: unknown[]) => mockPostAlert(...args),
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  mockPostAlert.mockReset();
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
      expect.objectContaining({ level: 'error', message: expect.stringContaining('resend.dev') })
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
