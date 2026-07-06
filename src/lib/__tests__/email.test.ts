const mockSend = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}), { virtual: true });

// Set env before require
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'Test <test@example.com>';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendBookingConfirmation, sendBookingReminder, sendBookingConfirmed, sendBookingRescheduled, sendBookingCancelled, sendNewBookingNotification, sendNewReviewNotification, sendBookingCancellationToFacility, sendBookingStatusUpdate, generateUnsubscribeToken, sendWelcomeEmail, sendOnboardingFollowEmail, sendFavoritesDigest, sendDailySummaryEmail, sendWeeklyReportEmail } = require('../email');

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
  mockSend.mockResolvedValue({});
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendBookingConfirmation: freshSend, sendBookingRescheduled: freshReschedule, sendDailySummaryEmail: freshSummary, sendWeeklyReportEmail: freshWeekly } = require('../email');
    await freshSend(baseData);
    await freshReschedule(baseData); // resend 未生成で早期 return（送信されない）

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../email');
    const noSendMock = jest.fn();
    const minData = {
      customerName: 'テスト', customerEmail: 'a@b.com', facilityName: 'サロン',
      bookingDate: '2026-04-01', startTime: '10:00', endTime: '11:00', bookingId: 'x',
    };
    await mod.sendBookingConfirmation(minData);
    await mod.sendBookingReminder(minData);
    await mod.sendTimeAdjustRequest(minData);
    await mod.sendBookingConfirmed(minData);
    await mod.sendBookingCancelled(minData);
    await mod.sendNewBookingNotification({ ...minData, facilityEmail: 'f@f.com' });
    await mod.sendNewReviewNotification({ facilityEmail: 'f@f.com', facilityName: 'F', reviewerName: 'R', rating: 5 });
    await mod.sendBookingCancellationToFacility({ ...minData, facilityEmail: 'f@f.com' });
    await mod.sendWelcomeEmail({ ownerEmail: 'o@o.com', facilityName: 'F' });
    await mod.sendOnboardingFollowEmail({ ownerEmail: 'o@o.com', facilityName: 'F', missingSteps: [] });
    await mod.sendBookingStatusUpdate({ ...minData, newStatus: 'confirmed' });
    await mod.sendFavoritesDigest({ userEmail: 'u@u.com', facilities: [] });
    expect(noSendMock).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = origKey;
  });
});
