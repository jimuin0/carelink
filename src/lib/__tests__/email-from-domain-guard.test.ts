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

  it('本番でEMAIL_FROMが不正形式(@なし)なら形式ガードで🔴アラートしデフォルトへフォールバックする', () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'carelink-jp.com'; // ドメインのみ＝Resend が 422 で拒否する不正値
    require('../email');
    expect(mockPostAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', route: 'email:from-format-guard' })
    );
    // 有効なデフォルト(carelink-jp.com ドメイン)へ倒れるため、ドメイン未検証アラートは出ない。
    expect(mockPostAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ route: 'email:from-domain-guard' })
    );
  });

  /**
   * 【2026年7月31日 追加・今回塞いだ穴】
   * 旧実装は未検証ドメインを検知しても【警告するだけで送信元を差し替えなかった】。
   * その結果 EMAIL_FROM が resend.dev（Resend のテスト専用・アカウント所有者本人にしか
   * 届かない）のままだと、警告は出るのにメールは客へ一通も届かない。
   * 本番の cron_logs は daily-summary が毎日 emailsSent:0 で、設定が正しいと確認できた
   * 瞬間が一度も無かった。警告頼みでは間違っていても気づけないため、送信元自体を倒す。
   */
  it('本番かつ未検証ドメイン(resend.dev)なら、実際の送信は検証済みデフォルトfromで行う', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendNewReviewNotification } = require('../email');
    await sendNewReviewNotification({
      facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'A', rating: 5, comment: null,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CareLink <noreply@carelink-jp.com>' })
    );
    // 倒したうえで、設定ミス自体は必ず可視化する（黙って直すと設定が誤ったまま残る）。
    expect(mockPostAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', route: 'email:from-domain-guard' })
    );
  });

  it('本番かつ検証済みドメインなら env の値をそのまま送信元に使う（正常系を壊さない）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink 予約 <yoyaku@carelink-jp.com>';
    mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendNewReviewNotification } = require('../email');
    await sendNewReviewNotification({
      facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'A', rating: 5, comment: null,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CareLink 予約 <yoyaku@carelink-jp.com>' })
    );
    expect(mockPostAlert).not.toHaveBeenCalled();
  });

  // 開発・テストは Resend のサンドボックスを使うのが正常系。ここまで倒すと開発が壊れる。
  it('非本番では未検証ドメインでも env の値をそのまま使う（サンドボックス送信を壊さない）', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendNewReviewNotification } = require('../email');
    await sendNewReviewNotification({
      facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'A', rating: 5, comment: null,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CareLink <onboarding@resend.dev>' })
    );
  });

  it('非本番でも形式不正なら有効なデフォルトfromへ倒す（開発時のtypoでResend 422にしない）', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'carelink-jp.com';
    mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendNewReviewNotification } = require('../email');
    await sendNewReviewNotification({
      facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'A', rating: 5, comment: null,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CareLink <noreply@carelink-jp.com>' })
    );
    // 非本番はドメイン検証をしない＝アラートも出さない（サンドボックス運用の正常系）。
    expect(mockPostAlert).not.toHaveBeenCalled();
  });

  it('不正形式のEMAIL_FROMでも実際の送信は有効なデフォルトfromで行う（設定ミスで送信全滅にしない）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'carelink-jp.com';
    mockSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const { sendNewReviewNotification } = require('../email');
    await sendNewReviewNotification({
      facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'A', rating: 5, comment: null,
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'CareLink <noreply@carelink-jp.com>' })
    );
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

  it('cronがrun単位で集約するcontext(booking_reminder等)は個別アラートしない(alertDeliveryFailuresとの二重通知防止)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 'k';
    process.env.EMAIL_FROM = 'CareLink <noreply@carelink-jp.com>';
    mockSend.mockRejectedValueOnce(new Error('resend rejected'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const { sendBookingReminder } = require('../email');
    const ok = await sendBookingReminder({
      customerName: 'テスト太郎',
      customerEmail: 'test@example.com',
      facilityName: 'テストサロン',
      bookingDate: '2026-04-01',
      startTime: '10:00',
      endTime: '11:00',
      bookingId: 'b-1',
    });
    expect(ok).toBe(false);
    expect(mockPostAlert).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
