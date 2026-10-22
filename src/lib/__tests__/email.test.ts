const mockSend = jest.fn();
const mockCaptureException = jest.fn();
const mockEnqueueWebhook = jest.fn();
const mockLedgerInsert = jest.fn(), mockLedgerUpdate = jest.fn();
jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => {
  let id: string;
  const chain = { insert: jest.fn((row) => { id = row.id; mockLedgerInsert(row); return chain; }),
    update: jest.fn((row) => { mockLedgerUpdate(row); return chain; }), eq: jest.fn(() => chain), is: jest.fn(() => chain),
    select: jest.fn(() => chain), single: jest.fn(async () => ({ data: { id }, error: null })),
    maybeSingle: jest.fn(async () => ({ data: { id }, error: null })) };
  return { from: () => chain };
} }));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}), { virtual: true });

jest.mock('@/lib/webhook-queue', () => ({
  enqueueWebhook: (...args: unknown[]) => mockEnqueueWebhook(...args),
}));

// Set env before require
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'Test <test@example.com>';

const { sendBookingConfirmation, sendBookingReminder, sendBookingConfirmed, sendBookingRescheduled, sendBookingCancelled, sendNewBookingNotification, sendNewReviewNotification, sendNewInquiryNotification, sendNewQuestionNotification, sendBookingCancellationToFacility, sendBookingStatusUpdate, generateUnsubscribeToken, sendWelcomeEmail, sendOnboardingFollowEmail, sendFavoritesDigest, sendDailySummaryEmail, sendWeeklyReportEmail, sendTimeAdjustRequest, sendInquiryReply, sendRegistrationLeadFollowEmail, sendOperatorNotification } = require('../email');
const { safeRedirect } = require('../safe-redirect');

/**
 * メール本文内の /auth/{signup|login}?redirect=... リンクを取り出し、ログイン後の戻り先を
 * middleware.ts・/auth/callback と同じ手順（redirect の値を safeRedirect で解決）で求める。
 * 文字列に "redirect=" が含まれているかだけの検査にしない（CLAUDE.md の指示どおり）。
 */
function authLinkDestination(html: string, page: 'signup' | 'login'): string {
  const match = html.match(new RegExp(`href="(https://carelink-jp\\.com/auth/${page}\\?redirect=[^"]+)"`));
  expect(match).not.toBeNull();
  const outer = new URL(match![1]);
  return safeRedirect(outer.searchParams.get('redirect'), 'https://carelink-jp.com');
}

const baseData = {
  customerName: 'テスト太郎',
  customerEmail: 'test@example.com',
  facilityName: 'テストサロン',
  bookingDate: '2026-04-01',
  startTime: '10:00',
  endTime: '11:00',
  menuName: 'カット',
  staffName: '田中',
  totalPrice: 5000,
  bookingId: 'b-1',
};

beforeEach(() => {
  mockSend.mockReset();
  mockCaptureException.mockReset();
  mockEnqueueWebhook.mockReset();
  mockLedgerInsert.mockReset();
  mockLedgerUpdate.mockReset();
  mockEnqueueWebhook.mockResolvedValue(undefined);
  mockSend.mockResolvedValue({ data: { id: '99999999-9999-4999-8999-999999999999' }, error: null });
});

describe('sendBookingConfirmation', () => {
  test('メールを送信する', async () => {
    await sendBookingConfirmation(baseData);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('test@example.com');
    expect(args.subject).toContain('テストサロン');
    expect(args.subject).toContain('予約を受け付けました');
  });

  test('HTMLに顧客名が含まれる', async () => {
    await sendBookingConfirmation(baseData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('テスト太郎');
  });
});

describe('sendBookingReminder', () => {
  test('リマインドメールを送信する', async () => {
    await sendBookingReminder(baseData);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('リマインド');
  });

  test('daysBefore 省略時は「明日」文言（従来挙動）', async () => {
    await sendBookingReminder(baseData);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('明日');
    expect(args.html).toContain('明日');
  });

  test('daysBefore=3 は「3日後」文言', async () => {
    await sendBookingReminder(baseData, 3);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('3日後');
    expect(args.html).toContain('3日後');
    expect(args.subject).not.toContain('明日');
  });

  test('daysBefore=7 は「7日後」文言', async () => {
    await sendBookingReminder(baseData, 7);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('7日後');
  });

  // 2026年10月22日 神原さん決定：リマインドは朝9時に1回だけ送り、その基準をメールに明記する。
  test.each([1, 3, 7])('daysBefore=%i のメールにも送信基準（当日朝9時時点の予約）を明記する', async (days) => {
    await sendBookingReminder(baseData, days);
    expect(mockSend.mock.calls[0][0].html).toContain('本メールは、当日朝9時の時点でご予約いただいているお客様にお送りしています。');
  });
});

describe('sendTimeAdjustRequest', () => {
  test('時間調整のお願いメールを送信する（件名・顧客名・施設名）', async () => {
    const { sendTimeAdjustRequest } = require('../email');
    await sendTimeAdjustRequest(baseData);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('test@example.com');
    expect(args.subject).toContain('時間調整のお願い');
    expect(args.subject).toContain('テストサロン');
    expect(args.html).toContain('テスト太郎');
    expect(args.html).toContain('調整のお願い');
  });
});

describe('sendBookingConfirmed', () => {
  test('確定メールにHTMLで「確定」が含まれる', async () => {
    await sendBookingConfirmed(baseData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('確定');
  });
});

describe('sendBookingRescheduled', () => {
  test('変更確認メールにHTMLで「変更」が含まれる', async () => {
    await sendBookingRescheduled(baseData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('変更');
  });
});

describe('sendBookingCancelled', () => {
  test('キャンセルメールを送信する', async () => {
    await sendBookingCancelled(baseData);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('キャンセル');
  });

  test('cancelFee > 0 のときキャンセル料の案内を本文に含める', async () => {
    await sendBookingCancelled({ ...baseData, cancelFee: 2500 });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('キャンセル料');
    expect(html).toContain('¥2,500');
    expect(html).toContain('施設より直接');
  });

  test('cancelFee なし → キャンセル料案内を含めない', async () => {
    await sendBookingCancelled(baseData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('キャンセル料');
  });
});

describe('sendNewBookingNotification', () => {
  test('施設メールに送信する', async () => {
    await sendNewBookingNotification({ ...baseData, facilityEmail: 'salon@example.com' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('salon@example.com');
    expect(args.subject).toContain('新しい予約');
  });
});

describe('sendNewReviewNotification', () => {
  const reviewData = {
    facilityEmail: 'salon@example.com',
    facilityName: 'テストサロン',
    reviewerName: 'テスト花子',
    rating: 4,
  };

  test('施設メールに送信する', async () => {
    await sendNewReviewNotification({ ...reviewData, comment: '良かったです' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('salon@example.com');
    expect(args.subject).toContain('新しい口コミ');
    expect(args.subject).toContain('★4');
    expect(args.html).toContain('テスト花子');
    expect(args.html).toContain('良かったです');
    expect(args.html).toContain('/admin/reviews');
  });

  test('commentがnullの場合はコメント欄を出力しない', async () => {
    await sendNewReviewNotification({ ...reviewData, comment: null });
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('コメント</td>');
  });

  // 2026年10月22日：複数店舗のオーナーが別の店舗の口コミ画面を開かないよう、店舗を URL で指定する。
  test('facilityId があれば管理画面リンクに ?facility_id= を付ける', async () => {
    const facilityId = '71000000-0000-4000-8000-000000000002';
    await sendNewReviewNotification({ ...reviewData, facilityId });
    expect(mockSend.mock.calls[0][0].html).toContain(`/admin/reviews?facility_id=${facilityId}"`);
  });

  test('facilityId が無ければ従来どおり店舗指定なしのリンク', async () => {
    await sendNewReviewNotification(reviewData);
    expect(mockSend.mock.calls[0][0].html).toContain('/admin/reviews"');
  });
});

// 【2026年7月10日 恒久根治】施設への問い合わせがオーナーに届かない構造的欠陥の修正。
// 【2026年7月28日 新設】問い合わせ返信。差出人が運営アドレスに固定されること、
// 問い合わせ者が返信したら運営に戻る replyTo が付くことを退行させない。
describe('sendInquiryReply', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({ data: { id: 'em_inquiry' }, error: null });
  });

  const replyData = {
    to: 'customer@example.com',
    inquirerName: 'テスト花子',
    body: 'お問い合わせありがとうございます。',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };

  test('問い合わせ者へ送信し運営アドレスと同一操作の冪等キーを使う', async () => {
    expect(await sendInquiryReply(replyData)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('customer@example.com');
    expect(args.from).toBe('Test <test@example.com>');
    expect(args.html).toContain('テスト花子');
    expect(args.html).toContain('お問い合わせありがとうございます。');
    expect(mockSend.mock.calls[0][1]).toEqual({ idempotencyKey: replyData.idempotencyKey });
  });

  test('replyTo 未指定なら差出人と同じアドレスに返信が戻る', async () => {
    await sendInquiryReply(replyData);
    expect(mockSend.mock.calls[0][0].replyTo).toBe('Test <test@example.com>');
  });

  test('replyTo 指定時はその宛先に返信が戻る', async () => {
    await sendInquiryReply({ ...replyData, replyTo: 'support@carelink-jp.com' });
    expect(mockSend.mock.calls[0][0].replyTo).toBe('support@carelink-jp.com');
  });

  test('本文はエスケープされる（HTML 注入を防ぐ）', async () => {
    await sendInquiryReply({ ...replyData, body: '<script>alert(1)</script>' });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('問い合わせ返信の失敗は汎用再送キューへ登録しない', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { statusCode: 500, message: 'sensitive provider detail' } });
    expect(await sendInquiryReply(replyData)).toBe(false);
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('provider message IDがない応答を送信成功として扱わない', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: null });
    expect(await sendInquiryReply(replyData)).toBe(false);
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });
});

describe('sendNewInquiryNotification', () => {
  const inquiryData = {
    facilityEmail: 'salon@example.com',
    facilityName: 'テストサロン',
    inquirerName: 'テスト花子',
    inquirerEmail: 'hanako@example.com',
    inquirerPhone: '090-1234-5678',
    message: '予約について質問があります',
  };

  describe('sendOperatorNotification', () => {
  const OLD = process.env.OPERATOR_NOTIFY_EMAIL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OPERATOR_NOTIFY_EMAIL;
    else process.env.OPERATOR_NOTIFY_EMAIL = OLD;
  });

  test('OPERATOR_NOTIFY_EMAIL の全宛先に送信する（カンマ区切り・空白除去）', async () => {
    process.env.OPERATOR_NOTIFY_EMAIL = 'a@example.com, b@example.com';
    const ok = await sendOperatorNotification({
      subject: 'テスト件名',
      lines: [{ label: 'お名前', value: 'テスト花子' }],
    });
    expect(ok).toBe(true);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toEqual(['a@example.com', 'b@example.com']);
    expect(args.subject).toBe('テスト件名');
    expect(args.html).toContain('テスト花子');
  });

  test('宛先が未設定なら送信せず false', async () => {
    delete process.env.OPERATOR_NOTIFY_EMAIL;
    expect(await sendOperatorNotification({ subject: 'x', lines: [] })).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('値はHTMLエスケープされる（XSS対策）', async () => {
    process.env.OPERATOR_NOTIFY_EMAIL = 'a@example.com';
    await sendOperatorNotification({
      subject: 'x',
      lines: [{ label: '内容', value: '<script>alert(1)</script>' }],
    });
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('<script>alert(1)</script>');
    expect(args.html).toContain('&lt;script&gt;');
  });
});

  test('施設メールに送信する', async () => {
    await sendNewInquiryNotification(inquiryData);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('salon@example.com');
    expect(args.subject).toContain('新しいお問い合わせ');
    expect(args.subject).toContain('テスト花子');
    expect(args.html).toContain('テスト花子');
    expect(args.html).toContain('hanako@example.com');
    expect(args.html).toContain('090-1234-5678');
    expect(args.html).toContain('予約について質問があります');
    expect(args.html).toContain('/admin/facility-inquiries');
  });

  test('phone未指定の場合は電話欄を出力しない', async () => {
    await sendNewInquiryNotification({ ...inquiryData, inquirerPhone: null });
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('電話</td>');
  });

  test('facilityId があれば管理画面リンクに ?facility_id= を付ける（複数店舗で別店舗を開かない）', async () => {
    const facilityId = '71000000-0000-4000-8000-000000000002';
    await sendNewInquiryNotification({ ...inquiryData, facilityId });
    expect(mockSend.mock.calls[0][0].html).toContain(`/admin/facility-inquiries?facility_id=${facilityId}"`);
  });

  test('本文はHTMLエスケープされる（XSS対策）', async () => {
    await sendNewInquiryNotification({ ...inquiryData, message: '<script>alert(1)</script>' });
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('<script>alert(1)</script>');
    expect(args.html).toContain('&lt;script&gt;');
  });
});

describe('sendNewQuestionNotification（施設 Q&A の新着質問・2026年10月22日）', () => {
  const facilityId = '71000000-0000-4000-8000-000000000003';
  const questionData = {
    facilityEmail: 'salon@example.com',
    facilityName: 'テストサロン',
    question: '駐車場はありますか？\n2台分あると助かります',
    facilityId,
  };

  test('店舗のメールへ、質問文と、その店舗を指定した Q&A 管理画面へのリンクを送る', async () => {
    expect(await sendNewQuestionNotification(questionData)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('salon@example.com');
    expect(args.from).toBe('Test <test@example.com>');
    expect(args.subject).toBe('【CareLink】Q&Aに新しい質問が届きました - テストサロン');
    expect(args.html).toContain('駐車場はありますか？');
    expect(args.html).toContain(`/admin/qa?facility_id=${facilityId}"`);
    expect(args.html).toContain('管理画面で回答する');
  });

  test('質問文・店舗名は HTML エスケープし、件名の改行は潰す（XSS・ヘッダ注入対策）', async () => {
    await sendNewQuestionNotification({ ...questionData, question: '<script>alert(1)</script>', facilityName: '<b>店</b>\r\nBcc: x@example.com' });
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toContain('<script>alert(1)</script>');
    expect(args.html).toContain('&lt;script&gt;');
    expect(args.html).not.toContain('<b>店</b>');
    expect(args.subject).not.toMatch(/[\r\n]/);
  });

  test('質問者のアカウント情報は載せない（回答に必要なのは質問文だけ）', async () => {
    await sendNewQuestionNotification(questionData);
    const args = mockSend.mock.calls[0][0];
    expect(args.html).not.toMatch(/user_id|@example\.invalid/);
  });
});

describe('sendBookingCancellationToFacility', () => {
  test('施設メールに店向け文面で送信する（顧客名・メールを含む）', async () => {
    await sendBookingCancellationToFacility({ ...baseData, facilityEmail: 'salon@example.com' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('salon@example.com');
    expect(args.subject).toContain('キャンセル');
    expect(args.html).toContain('テスト太郎');
    expect(args.html).toContain('test@example.com');
    expect(args.html).toContain('/admin/bookings');
  });

  // 回帰（D4）: お客様にはキャンセル料の発生と、お支払い方法は施設から直接案内することが届くのに、
  // 店舗宛のキャンセル通知には金額もその事実も無く、お客様は案内を待ったままになっていた。
  test('キャンセル料が発生したときは金額・料率と、お客様へ支払い方法を連絡する案内を載せる', () => {
    const { buildBookingCancellationToFacilityEnvelope } = require('../email');
    const envelope = buildBookingCancellationToFacilityEnvelope({
      ...baseData, facilityEmail: 'salon@example.com', cancelFee: 4000, cancelFeeRate: 50, cancelledAt: '2026-04-01T03:05:00Z',
    });
    expect(envelope.html).toContain('キャンセル料');
    expect(envelope.html).toContain('&yen;4,000（施術料金の50%）');
    expect(envelope.html).toContain('キャンセルポリシーにより、お客様へキャンセル料 <strong>&yen;4,000</strong> の発生と、お支払い方法は施設から直接ご案内することをメールでお知らせしています。お支払い方法をお客様へ直接ご連絡ください。');
    // 無料期限の内か外かを店舗が確かめられるよう、受け付けた時刻（JST）を載せる。
    expect(envelope.html).toContain('キャンセル受付');
    expect(envelope.html).toContain('2026年4月1日 12:05');
  });

  // 回帰（レビュー指摘）: お客様宛の文面を「」で引用していたが、実際の文面（お客様宛メール）と一致していなかった。
  // 店舗がお客様からの問い合わせに答えるとき、存在しない文言を前提にしないよう、引用せず地の文で伝える。
  test('お客様宛の文面を引用の形で書かない（実際の文面と食い違わない）', () => {
    const { buildBookingCancellationToFacilityEnvelope } = require('../email');
    const envelope = buildBookingCancellationToFacilityEnvelope({ ...baseData, facilityEmail: 'salon@example.com', cancelFee: 4000 });
    expect(envelope.html).not.toMatch(/「[^」]*キャンセル料[^」]*」/);
  });

  // 回帰（レビュー指摘）: メールアドレスの無いお客様にはお客様宛のキャンセル通知が積まれないのに、
  // 店舗宛には「お客様にお知らせしています」と書いていたため、店舗は連絡を待ち、お客様は料金を知らないままになった。
  test.each(['', '   '])('メールアドレスの無いお客様 %j: お知らせしていないことと、店舗から直接案内することを伝える', (customerEmail) => {
    const { buildBookingCancellationToFacilityEnvelope } = require('../email');
    const envelope = buildBookingCancellationToFacilityEnvelope({
      ...baseData, customerEmail, facilityEmail: 'salon@example.com', cancelFee: 4000, cancelFeeRate: 50,
    });
    expect(envelope.html).toContain('お客様のメールアドレスの登録が無いため、キャンセル料はお客様へメールでお知らせしていません。キャンセル料 <strong>&yen;4,000</strong> とお支払い方法を、お客様へ直接ご案内ください。');
    expect(envelope.html).not.toContain('お知らせしています');
  });

  test('キャンセル料が無いときは金額も支払いの案内も載せない（受付時刻は載せる）', () => {
    const { buildBookingCancellationToFacilityEnvelope } = require('../email');
    const envelope = buildBookingCancellationToFacilityEnvelope({
      ...baseData, facilityEmail: 'salon@example.com', cancelFee: 0, cancelFeeRate: 50, cancelledAt: '2026-04-01T03:05:00Z',
    });
    expect(envelope.html).not.toContain('キャンセル料');
    expect(envelope.html).not.toContain('お支払い方法');
    expect(envelope.html).toContain('2026年4月1日 12:05');
  });

  test('料率が分からないときは金額だけを載せる・受付時刻が無いときは行を出さない', () => {
    const { buildBookingCancellationToFacilityEnvelope } = require('../email');
    const envelope = buildBookingCancellationToFacilityEnvelope({ ...baseData, facilityEmail: 'salon@example.com', cancelFee: 1200 });
    expect(envelope.html).toContain('&yen;1,200</td>');
    expect(envelope.html).not.toContain('施術料金の');
    expect(envelope.html).not.toContain('キャンセル受付');
  });
});

describe('buildBookingRescheduleToFacilityEnvelope', () => {
  test('店舗の宛先へ、変更前の日時と変更後の予約内容を店向け文面で組み立てる（送信は worker のみ）', () => {
    const { buildBookingRescheduleToFacilityEnvelope } = require('../email');
    const envelope = buildBookingRescheduleToFacilityEnvelope({
      ...baseData, customerName: '<b>テスト太郎</b>', facilityEmail: 'salon@example.com',
      previous: { bookingDate: '2026-03-31', startTime: '15:00:00', endTime: '16:00:00' },
    });
    expect(envelope.to).toBe('salon@example.com');
    expect(envelope.subject).toBe('【CareLink】予約日時が変更されました - <b>テスト太郎</b>様');
    expect(envelope.html).toContain('&lt;b&gt;テスト太郎&lt;/b&gt;');
    expect(envelope.html).toContain('test@example.com');
    expect(envelope.html).toContain('変更前の日時');
    expect(envelope.html).toContain('2026年3月31日（火） 15:00〜16:00');
    expect(envelope.html).toContain('変更後のご予約内容');
    expect(envelope.html).toContain('2026年4月1日（水） 10:00〜11:00');
    expect(envelope.html).toContain('/admin/bookings');
    expect(mockSend).not.toHaveBeenCalled();
  });

  // 「管理画面で確認する」は白文字の太字・本文サイズ。#0ea5e9（約2.8:1）は WCAG AA（4.5:1）に届かない。
  test('ボタンは共通スタイル（#0369A1・白文字 約5.9:1）で、AA 未満の #0ea5e9 を使わない', () => {
    const { buildBookingRescheduleToFacilityEnvelope, EMAIL_BUTTON_STYLE } = require('../email');
    const envelope = buildBookingRescheduleToFacilityEnvelope({
      ...baseData, facilityEmail: 'salon@example.com',
      previous: { bookingDate: '2026-03-31', startTime: '15:00:00', endTime: '16:00:00' },
    });
    expect(EMAIL_BUTTON_STYLE).toContain('background:#0369A1;color:#fff;');
    expect(envelope.html).toContain(`style="${EMAIL_BUTTON_STYLE}">管理画面で確認する</a>`);
    expect(envelope.html).not.toContain('background:#0ea5e9');
  });
});

describe('sendBookingStatusUpdate', () => {
  test('ステータスラベルが日本語に変換される', async () => {
    await sendBookingStatusUpdate({ ...baseData, newStatus: 'confirmed' });
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('確定');
  });

  test('reasonがある場合HTMLに含まれる', async () => {
    await sendBookingStatusUpdate({ ...baseData, newStatus: 'cancelled', reason: '都合により' });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('都合により');
  });

  test('未知のステータスはそのまま表示', async () => {
    await sendBookingStatusUpdate({ ...baseData, newStatus: 'custom_status' });
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('custom_status');
  });
});

describe('sendDailySummaryEmail', () => {
  const summaryData = {
    facilityEmail: 'owner@example.com', facilityName: 'テストサロン', date: '2026-04-01',
    totalRevenue: 12000, bookingCount: 5, completedCount: 4, cancelledCount: 1,
    newCustomerCount: 2, repeatCustomerCount: 2,
  };

  test('施設オーナーへ売上サマリーを送信し true を返す', async () => {
    const ok = await sendDailySummaryEmail(summaryData);
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('owner@example.com');
    expect(args.subject).toContain('売上サマリー');
    expect(args.html).toContain('¥12,000');
    expect(args.html).toContain('テストサロン');
  });
});

describe('sendWeeklyReportEmail', () => {
  const weeklyData = {
    facilityEmail: 'owner@example.com', facilityName: 'テストサロン', periodStart: '2026-03-25', periodEnd: '2026-03-31',
    totalRevenue: 84000, bookingCount: 30, completedCount: 25, cancelledCount: 3,
    newCustomerCount: 8, repeatCustomerCount: 17,
  };

  test('施設オーナーへ週次レポートを送信し true を返す', async () => {
    const ok = await sendWeeklyReportEmail(weeklyData);
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('owner@example.com');
    expect(args.subject).toContain('週次レポート');
    expect(args.html).toContain('¥84,000');
    expect(args.html).toContain('2026-03-25 〜 2026-03-31');
  });
});

describe('RESEND_API_KEY未設定時', () => {
  test('送信をスキップする', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    // Need fresh module for this test
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
    const { sendBookingConfirmation: freshSend, sendBookingRescheduled: freshReschedule, sendDailySummaryEmail: freshSummary, sendWeeklyReportEmail: freshWeekly, sendInquiryReply: freshReply } = require('../email');
    await freshSend(baseData);
    await freshReschedule(baseData); // resend 未生成で早期 return（送信されない）

    // 問い合わせ返信も同様に false を返す（呼び出し元はこれを見て「送信済み」と記録しない）。
    const okReply = await freshReply({ to: 'c@example.com', inquirerName: 'X', body: 'y' });
    expect(okReply).toBe(false);

    // Resend 未生成のため送信されない。サマリー/週次メールは false を返す（!resend 分岐）。
    const ok = await freshSummary({
      facilityEmail: 'o@example.com', facilityName: 'X', date: '2026-04-01',
      totalRevenue: 0, bookingCount: 0, completedCount: 0, cancelledCount: 0,
      newCustomerCount: 0, repeatCustomerCount: 0,
    });
    expect(ok).toBe(false);
    const okW = await freshWeekly({
      facilityEmail: 'o@example.com', facilityName: 'X', periodStart: '2026-03-25', periodEnd: '2026-03-31',
      totalRevenue: 0, bookingCount: 0, completedCount: 0, cancelledCount: 0,
      newCustomerCount: 0, repeatCustomerCount: 0,
    });
    expect(okW).toBe(false);
    process.env.RESEND_API_KEY = origKey;
  });
});

describe('送信エラー時', () => {
  test('non-queueable sender handles provider error without fields and non-Error rejection', async () => {
    mockSend.mockResolvedValueOnce({ data:null,error:{ unexpected:'shape' } });
    expect(await sendBookingReminder(baseData)).toBe(false);
    mockSend.mockRejectedValueOnce('synthetic-rejection');
    expect(await sendBookingReminder(baseData)).toBe(false);
  });
  test('console.error にエラーを記録する（Phase 8: Sentry 廃止）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockSend.mockRejectedValueOnce(new Error('network error'));
    await sendBookingConfirmation(baseData);
    // safe.ts safeCaptureException → console.error 経由で出力される
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[safeCaptureException:'),
      expect.anything(),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  test('Error以外がrejectされた場合もString化してfalseを返す', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockSend.mockRejectedValueOnce('plain-string-rejection');
    const ok = await sendBookingConfirmation(baseData);
    expect(ok).toBe(false);
    consoleSpy.mockRestore();
  });

  // 【最重要・恒久根治の回帰防止・2026年7月8日】Resend SDK は API エラー(Invalid from の 422 等)を
  // throw せず戻り値 { data, error } の error に載せて resolve する。旧 safeSend は error を検査せず
  // 無条件 return true しており、送信失敗が「成功」に化け、ローンチ以来 通知メールが送られて
  // いないのに全て成功扱いされていた（本番診断で確定）。error があれば false を返すことを保証する。
  test('resend.emails.sendが{error}をresolveした場合はfalseを返す（例外を投げないResend APIエラーを握り潰さない）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { statusCode: 422, name: 'validation_error', message: 'Invalid `from` field.' },
    });
    const ok = await sendBookingConfirmation(baseData);
    expect(ok).toBe(false);
    consoleSpy.mockRestore();
  });

  test('resend.emails.sendが{data,error:null}をresolveした場合はtrueを返す（正常系）', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: '99999999-9999-4999-8999-999999999999' }, error: null });
    const ok = await sendBookingConfirmation(baseData);
    expect(ok).toBe(true);
  });

  test('errorにstatusCode/name/messageが欠けていてもfalseを返す（フォールバック整形）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockSend.mockResolvedValueOnce({ data: null, error: { unexpected: 'shape' } });
    const ok = await sendBookingConfirmation(baseData);
    expect(ok).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('単発イベントの初回台帳と二重送信防止', () => {
  test.each([
    [sendBookingConfirmation, baseData], [sendBookingRescheduled, baseData], [sendTimeAdjustRequest, baseData],
    [sendBookingConfirmed, baseData], [sendBookingCancelled, baseData],
    [sendBookingStatusUpdate, { ...baseData, newStatus: 'confirmed' }],
    [sendNewBookingNotification, { ...baseData, facilityEmail: 'owner@example.com' }],
    [sendBookingCancellationToFacility, { ...baseData, facilityEmail: 'owner@example.com' }],
    [sendNewReviewNotification, { facilityEmail: 'owner@example.com', facilityName: 'X', reviewerName: 'Y', rating: 5 }],
    [sendNewInquiryNotification, { facilityEmail: 'owner@example.com', facilityName: 'X', inquirerName: 'Y', inquirerEmail: 'y@example.com', message: 'fixture' }],
    [sendNewQuestionNotification, { facilityEmail: 'owner@example.com', facilityName: 'X', question: 'fixture', facilityId: '71000000-0000-4000-8000-000000000003' }],
    [sendWelcomeEmail, { ownerEmail: 'owner@example.com', facilityName: 'X' }],
  ])('初回を永続化し、500の結果不明後に別queueを追加しない %p', async (send, data) => {
    mockSend.mockResolvedValueOnce({ data: null, error: { statusCode: 500 } });
    expect(await send(data)).toBe(false);
    expect(mockLedgerInsert).toHaveBeenCalledTimes(1);
    expect(mockLedgerInsert).toHaveBeenCalledWith(expect.objectContaining({ webhook_type: 'email',
      email_envelope: expect.objectContaining({ to: expect.any(String), subject: expect.any(String), html: expect.any(String) }) }));
    expect(mockLedgerUpdate).toHaveBeenCalledTimes(1);
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });
  test('成功も同じ台帳にprovider受理を保存する', async () => {
    expect(await sendBookingConfirmation(baseData)).toBe(true);
    expect(mockLedgerInsert).toHaveBeenCalledTimes(1);
    expect(mockLedgerUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success', provider_message_id: '99999999-9999-4999-8999-999999999999' }));
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });
  const failResend = () => mockSend.mockResolvedValueOnce({ data: null, error: { statusCode: 500 } });
  // BULK_AGGREGATED_CONTEXTS（各cronが独自の翌run再送を持つ）は対象外＝enqueueされない
  test('sendBookingReminder 失敗（booking_reminder context）→ enqueueWebhook は呼ばれない（cron自前retryと二重化させない）', async () => {
    failResend();
    await sendBookingReminder(baseData);
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('sendDailySummaryEmail 失敗（daily_summary context）→ enqueueWebhook は呼ばれない', async () => {
    failResend();
    await sendDailySummaryEmail({
      facilityEmail: 'o@example.com', facilityName: 'X', date: '2026-04-01',
      totalRevenue: 0, bookingCount: 0, completedCount: 0, cancelledCount: 0,
      newCustomerCount: 0, repeatCustomerCount: 0,
    });
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('sendWeeklyReportEmail 失敗（weekly_report context）→ enqueueWebhook は呼ばれない', async () => {
    failResend();
    await sendWeeklyReportEmail({
      facilityEmail: 'o@example.com', facilityName: 'X', periodStart: '2026-03-25', periodEnd: '2026-03-31',
      totalRevenue: 0, bookingCount: 0, completedCount: 0, cancelledCount: 0,
      newCustomerCount: 0, repeatCustomerCount: 0,
    });
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('sendOnboardingFollowEmail 失敗（onboarding_follow context）→ enqueueWebhook は呼ばれない', async () => {
    failResend();
    await sendOnboardingFollowEmail({ ownerEmail: 'o@example.com', facilityName: 'X', missingSteps: ['写真'] });
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('sendFavoritesDigest 失敗（favorites_digest context）→ enqueueWebhook は呼ばれない', async () => {
    failResend();
    await sendFavoritesDigest({ userEmail: 'u@example.com', facilities: [] });
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  test('RESEND_API_KEY未設定でresendがnull（送信自体を試みない）場合は enqueueWebhook を呼ばない', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
    jest.mock('@/lib/webhook-queue', () => ({ enqueueWebhook: (...args: unknown[]) => mockEnqueueWebhook(...args) }));
    const fresh = require('../email');
    const ok = await fresh.sendBookingConfirmation(baseData);
    expect(ok).toBe(false);
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = origKey;
  });
});
describe('generateUnsubscribeToken', () => {
  test('32バイトのhex文字列を返す（64文字）', () => {
    const token = generateUnsubscribeToken();
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  test('毎回異なるトークンを生成する', () => {
    const t1 = generateUnsubscribeToken();
    const t2 = generateUnsubscribeToken();
    expect(t1).not.toBe(t2);
  });
});

describe('sendWelcomeEmail', () => {
  test('オーナーメールに送信する', async () => {
    await sendWelcomeEmail({ ownerEmail: 'owner@example.com', ownerName: 'テストオーナー', facilityName: 'テストサロン' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe('owner@example.com');
    expect(mockSend.mock.calls[0][0].subject).toContain('テストサロン');
  });

  test('ownerNameが省略された場合はデフォルト名を使う', async () => {
    await sendWelcomeEmail({ ownerEmail: 'owner@example.com', facilityName: 'サロン' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('オーナー');
  });
});

describe('sendOnboardingFollowEmail', () => {
  test('未設定項目をリスト化してメール送信', async () => {
    await sendOnboardingFollowEmail({
      ownerEmail: 'owner@example.com',
      facilityName: 'テストサロン',
      missingSteps: ['メニューを登録してください', 'スタッフを追加してください'],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('メニューを登録してください');
    expect(html).toContain('スタッフを追加してください');
  });

  test('XSS防止: facilityNameがエスケープされる', async () => {
    await sendOnboardingFollowEmail({
      ownerEmail: 'owner@example.com',
      facilityName: '<script>alert(1)</script>',
      missingSteps: ['項目A'],
    });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('掲載の公開に要る項目と、ネット予約に要る項目を分けて案内する', async () => {
    await sendOnboardingFollowEmail({
      ownerEmail: 'owner@example.com',
      facilityName: 'テストサロン',
      missingSteps: ['基本情報（住所）', '無料掲載を公開'],
      bookingSteps: ['ネット予約：営業時間の確認・保存', '<b>予約枠</b>'],
    });
    const html: string = mockSend.mock.calls[0][0].html;
    const listing = html.indexOf('無料掲載の公開に必要な項目');
    const booking = html.indexOf('ネット予約の受付に必要な項目');
    expect(listing).toBeGreaterThan(-1);
    expect(booking).toBeGreaterThan(listing);
    expect(html.indexOf('<li>基本情報（住所）</li>')).toBeGreaterThan(listing);
    expect(html.indexOf('<li>基本情報（住所）</li>')).toBeLessThan(booking);
    expect(html.indexOf('<li>ネット予約：営業時間の確認・保存</li>')).toBeGreaterThan(booking);
    expect(html).toContain('掲載だけのご利用なら不要です');
    expect(html).toContain('&lt;b&gt;予約枠&lt;/b&gt;');
  });

  test('空の区分は見出しごと出さない', async () => {
    await sendOnboardingFollowEmail({ ownerEmail: 'owner@example.com', facilityName: 'テストサロン', missingSteps: [], bookingSteps: ['写真'] });
    const html: string = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('無料掲載の公開に必要な項目');
    expect(html).toContain('ネット予約の受付に必要な項目');
    mockSend.mockClear();
    await sendOnboardingFollowEmail({ ownerEmail: 'owner@example.com', facilityName: 'テストサロン', missingSteps: ['無料掲載を公開'] });
    expect(mockSend.mock.calls[0][0].html).not.toContain('ネット予約の受付に必要な項目');
  });
});

describe('sendFavoritesDigest', () => {
  test('お気に入りサロンの更新を送信する', async () => {
    await sendFavoritesDigest({
      userEmail: 'user@example.com',
      userName: 'テストユーザー',
      facilities: [
        { name: 'サロンA', slug: 'salon-a', newCoupons: 2, hasNewMenus: true },
        { name: 'サロンB', slug: 'salon-b', newCoupons: 0, hasNewMenus: false },
      ],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('サロンA');
    expect(html).toContain('新着クーポン 2件');
    expect(html).toContain('新メニュー追加');
  });

  test('userNameが省略された場合はデフォルト名を使う', async () => {
    await sendFavoritesDigest({
      userEmail: 'user@example.com',
      facilities: [{ name: 'サロンA', slug: 'salon-a', newCoupons: 1, hasNewMenus: false }],
    });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('お客様');
  });

  test('unsubscribeTokenが含まれる場合はリンクを追加', async () => {
    await sendFavoritesDigest({
      userEmail: 'user@example.com',
      facilities: [],
      unsubscribeToken: 'test-token-abc',
    });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('test-token-abc');
    expect(html).toContain('メールの受信を停止する');
  });
});

describe('bookingDetailHtml — オプションフィールド省略', () => {
  const minData = {
    customerName: 'ミニ太郎',
    customerEmail: 'mini@example.com',
    facilityName: 'ミニサロン',
    bookingDate: '2026-04-01',
    startTime: '10:00',
    endTime: '11:00',
    bookingId: 'b-min',
    // menuName/staffName/totalPrice は全て省略
  };

  test('menuName省略 → メニュー行なし', async () => {
    await sendBookingConfirmation(minData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('メニュー</td>');
  });

  test('staffName省略 → 担当行なし', async () => {
    await sendBookingConfirmation(minData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('担当</td>');
  });

  test('totalPrice省略 → 料金行なし', async () => {
    await sendBookingConfirmation(minData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('料金</td>');
  });
});

describe('EMAIL_FROM未設定時 — FROM のデフォルト値フォールバック', () => {
  test('EMAIL_FROM 未設定でもデフォルト差出人でメールを送信する（行13フォールバック）', async () => {
    const origFrom = process.env.EMAIL_FROM;
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test-key';
    jest.resetModules();
    const sendMock = jest.fn().mockResolvedValue({});
    jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })) }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
    const { sendBookingConfirmation } = require('../email');
    await sendBookingConfirmation({
      customerName: 'テスト', customerEmail: 'a@b.com', facilityName: 'サロン',
      bookingDate: '2026-04-01', startTime: '10:00', endTime: '11:00', bookingId: 'x',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].from).toBe('CareLink <noreply@carelink-jp.com>');
    if (origFrom !== undefined) process.env.EMAIL_FROM = origFrom;
    process.env.RESEND_API_KEY = origKey;
  });
});

describe('RESEND_API_KEY未設定時 — 全send関数', () => {
  test('全send関数がスキップされる（resend=null）', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

    const mod = require('../email');
    const noSendMock = jest.fn();

    const minData = {
      customerName: 'テスト',
      customerEmail: 'a@b.com',
      facilityName: 'サロン',
      bookingDate: '2026-04-01',
      startTime: '10:00',
      endTime: '11:00',
      bookingId: 'x',
    };

    await mod.sendBookingConfirmation(minData);
    await mod.sendBookingReminder(minData);
    await mod.sendTimeAdjustRequest(minData);
    await mod.sendBookingConfirmed(minData);
    await mod.sendBookingCancelled(minData);
    await mod.sendNewBookingNotification({
      ...minData,
      facilityEmail: 'f@f.com',
    });
    await mod.sendNewReviewNotification({
      facilityEmail: 'f@f.com',
      facilityName: 'F',
      reviewerName: 'R',
      rating: 5,
    });
    await mod.sendNewInquiryNotification({
      facilityEmail: 'f@f.com',
      facilityName: 'F',
      inquirerName: 'I',
      inquirerEmail: 'i@i.com',
      message: 'M',
    });
    expect(await mod.sendNewQuestionNotification({
      facilityEmail: 'f@f.com',
      facilityName: 'F',
      question: 'Q',
      facilityId: '71000000-0000-4000-8000-000000000003',
    })).toBe(false);
    await mod.sendBookingCancellationToFacility({
      ...minData,
      facilityEmail: 'f@f.com',
    });
    await mod.sendWelcomeEmail({
      ownerEmail: 'o@o.com',
      facilityName: 'F',
    });
    await mod.sendOnboardingFollowEmail({
      ownerEmail: 'o@o.com',
      facilityName: 'F',
      missingSteps: [],
    });
    await mod.sendBookingStatusUpdate({
      ...minData,
      newStatus: 'confirmed',
    });
    await mod.sendFavoritesDigest({
      userEmail: 'u@u.com',
      facilities: [],
    });

    const operatorOk = await mod.sendOperatorNotification({
      subject: 'テスト',
      lines: [],
    });

    expect(operatorOk).toBe(false);
    expect(noSendMock).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = origKey;
  });
});

// ---------------------------------------------------------------------------
// 掲載申込者向けのフォローメール
//
// 🔴 なぜ実装そのものを検査するか
// 呼び出す側（onboarding-followup cron）のテストは jest.mock('@/lib/email') でモジュールごと
// 差し替えるため、実装は一度も実行されない。配線のテストだけがあって実装の検査が無い状態は、
// 文面の事故（宛先の取り違え・リンクの壊れ・引き継ぎアドレスの記載漏れ）を丸ごと見逃す。
//
// 🔴 2026年10月22日: リンクの行き先を /register/recover（送信済みの掲載申込を復旧）に固定した。
// 以前のリンク（/admin/onboarding?facility_name=…）は受付を特定できず、申込内容を引き継がない
// 空の店舗を作らせていた（作った後は復旧でも取り込めない）。
// ---------------------------------------------------------------------------
const failRegistrationSend = () => mockSend.mockResolvedValueOnce({
  data: null,
  error: { statusCode: 500, name: 'server_error', message: 'boom' },
});

describe('sendRegistrationLeadFollowEmail', () => {
  const base = {
    email: 'lead@example.com',
    facilityName: 'テストサロン',
    receiptId: '74000000-0000-4000-8000-000000000001',
  };

  test('申込者のアドレス宛に送る', async () => {
    const ok = await sendRegistrationLeadFollowEmail(base);
    expect(ok).toBe(true);
    expect(mockSend.mock.calls[0][0].to).toBe('lead@example.com');
  });

  test('🔴 本文に「登録に使ったメールアドレス」と受付番号が入る', async () => {
    await sendRegistrationLeadFollowEmail(base);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('lead@example.com');
    expect(html).toContain('受付番号：74000000-0000-4000-8000-000000000001');
  });

  test('🔴 回帰: アカウント作成・ログインのどちらのリンクも、同じ申込を引き継ぐ復旧画面（/register/recover）へ戻る', async () => {
    await sendRegistrationLeadFollowEmail(base);
    const html = mockSend.mock.calls[0][0].html;
    expect(authLinkDestination(html, 'signup')).toBe('/register/recover');
    expect(authLinkDestination(html, 'login')).toBe('/register/recover');
    // 申込内容を引き継がない新規作成フォーム（/admin/onboarding）へは一切導かない。
    expect(html).not.toContain('onboarding');
  });

  test('🔴 回帰: 無条件に「そのまま引き継がれます」「入力し直す必要はありません」と約束しない', async () => {
    await sendRegistrationLeadFollowEmail(base);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('入力し直す必要はありません');
    expect(html).not.toContain('そのまま管理画面に引き継がれます');
    expect(html).toContain('送信済みの掲載申込を復旧');
    // 表示されないときに空の店舗を作らせない案内
    expect(html).toContain('新しく店舗を作成したり申し込み直したりせず');
    expect(html).toContain('href="https://carelink-jp.com/contact"');
  });

  test('HTML特殊文字を含む施設名がエスケープされる（生のタグを本文に出さない）', async () => {
    await sendRegistrationLeadFollowEmail({ ...base, facilityName: '<script>x</script>' });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('送信に失敗したら false を返す（cron が claim を解放して再試行できる）', async () => {
    failRegistrationSend();
    const ok = await sendRegistrationLeadFollowEmail(base);
    expect(ok).toBe(false);
  });

  test('RESEND_API_KEY 未設定なら送信を試みず false', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
    jest.mock('@/lib/webhook-queue', () => ({ enqueueWebhook: (...args: unknown[]) => mockEnqueueWebhook(...args) }));
    const fresh = require('../email');
    const ok = await fresh.sendRegistrationLeadFollowEmail(base);
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = origKey;
  });
});
it('auto-confirmed booking owner mail never requests an unnecessary approval',()=>{
 const {buildNewBookingNotificationEnvelope}=require('../email');
 const mail=buildNewBookingNotificationEnvelope({...baseData,facilityEmail:'synthetic@example.invalid',bookingStatus:'confirmed'});
 expect(mail.html).toContain('新しい予約が確定しました');expect(mail.html).not.toContain('確認・承認してください');
});
it('owner mail shows the phone and the note (visit address), escaped and with line breaks kept',()=>{
 const {buildNewBookingNotificationEnvelope}=require('../email');
 const mail=buildNewBookingNotificationEnvelope({...baseData,facilityEmail:'synthetic@example.invalid',customerPhone:' 090-0000-0000 ',note:'大阪府豊中市合成町1-2-3\n<script>x</script>'});
 expect(mail.html).toContain('電話番号');expect(mail.html).toContain('090-0000-0000');
 expect(mail.html).toContain('訪問先のご住所を含む');expect(mail.html).toContain('大阪府豊中市合成町1-2-3');
 expect(mail.html).toContain('white-space:pre-wrap');
 expect(mail.html).not.toContain('<script>x</script>');expect(mail.html).toContain('&lt;script&gt;');
});
it('owner mail omits the phone and note rows when they are blank',()=>{
 const {buildNewBookingNotificationEnvelope}=require('../email');
 const mail=buildNewBookingNotificationEnvelope({...baseData,facilityEmail:'synthetic@example.invalid',customerPhone:'  ',note:null});
 expect(mail.html).not.toContain('電話番号');expect(mail.html).not.toContain('ご要望・備考');
});

// 2026年10月23日: 店舗向けの新規予約メールに、お客様が予約時に使ったポイントを出す。
// 料金はポイント利用後の金額なので、行が無いとメニュー価格との差の理由が店舗に分からない。
describe('owner mail shows the points the customer used', () => {
  const owner = { ...baseData, facilityEmail: 'synthetic@example.invalid' };
  const build = (data: Record<string, unknown>) => require('../email').buildNewBookingNotificationEnvelope(data) as { html: string };

  it('shows ポイント利用 -¥N and marks the price as the amount after points', () => {
    const mail = build({ ...owner, totalPrice: 6000, pointsUsed: 2000 });
    expect(mail.html).toContain('ポイント利用</td>');
    expect(mail.html).toContain('-&yen;2,000');
    expect(mail.html).toContain('&yen;6,000（ポイント利用後）');
  });

  it('shows the points row even when the whole price was paid with points', () => {
    const mail = build({ ...owner, totalPrice: 0, pointsUsed: 8000 });
    expect(mail.html).toContain('&yen;0（ポイント利用後）');
    expect(mail.html).toContain('-&yen;8,000');
  });

  it.each([[undefined], [0]])('no points (%p) → no points row and the price is shown as before', (pointsUsed) => {
    const mail = build({ ...owner, totalPrice: 6000, pointsUsed });
    expect(mail.html).not.toContain('ポイント利用');
    expect(mail.html).toContain('&yen;6,000</td>');
  });

  it('points without a price still show the points row', () => {
    const mail = build({ ...owner, totalPrice: undefined, pointsUsed: 500 });
    expect(mail.html).not.toContain('料金</td>');
    expect(mail.html).toContain('-&yen;500');
  });

  it('customer-facing mails never show the points row (only the owner notification passes it)', () => {
    const mail = require('../email').buildBookingConfirmationEnvelope({ ...baseData, totalPrice: 6000 }) as { html: string };
    expect(mail.html).not.toContain('ポイント利用');
  });
});
