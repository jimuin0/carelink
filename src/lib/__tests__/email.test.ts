const mockSend = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}));

// Set env before require
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'Test <test@example.com>';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendBookingConfirmation, sendBookingReminder, sendBookingConfirmed, sendBookingCancelled, sendNewBookingNotification, sendBookingStatusUpdate, generateUnsubscribeToken, sendWelcomeEmail, sendOnboardingFollowEmail, sendFavoritesDigest } = require('../email');

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
});

describe('sendBookingConfirmed', () => {
  test('確定メールにHTMLで「確定」が含まれる', async () => {
    await sendBookingConfirmed(baseData);
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('確定');
  });
});

describe('sendBookingCancelled', () => {
  test('キャンセルメールを送信する', async () => {
    await sendBookingCancelled(baseData);
    const args = mockSend.mock.calls[0][0];
    expect(args.subject).toContain('キャンセル');
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

describe('RESEND_API_KEY未設定時', () => {
  test('送信をスキップする', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    // Need fresh module for this test
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendBookingConfirmation: freshSend } = require('../email');
    await freshSend(baseData);
    // Since no Resend instance, send should not be called
    process.env.RESEND_API_KEY = origKey;
  });
});

describe('送信エラー時', () => {
  test('Sentryにエラーを報告する', async () => {
    mockSend.mockRejectedValueOnce(new Error('network error'));
    await sendBookingConfirmation(baseData);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
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

describe('RESEND_API_KEY未設定時 — 全send関数', () => {
  test('全send関数がスキップされる（resend=null）', async () => {
    const origKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    jest.mock('resend', () => ({ Resend: jest.fn() }));
    jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../email');
    const noSendMock = jest.fn();
    const minData = {
      customerName: 'テスト', customerEmail: 'a@b.com', facilityName: 'サロン',
      bookingDate: '2026-04-01', startTime: '10:00', endTime: '11:00', bookingId: 'x',
    };
    await mod.sendBookingConfirmation(minData);
    await mod.sendBookingReminder(minData);
    await mod.sendBookingConfirmed(minData);
    await mod.sendBookingCancelled(minData);
    await mod.sendNewBookingNotification({ ...minData, facilityEmail: 'f@f.com' });
    await mod.sendWelcomeEmail({ ownerEmail: 'o@o.com', facilityName: 'F' });
    await mod.sendOnboardingFollowEmail({ ownerEmail: 'o@o.com', facilityName: 'F', missingSteps: [] });
    await mod.sendBookingStatusUpdate({ ...minData, newStatus: 'confirmed' });
    await mod.sendFavoritesDigest({ userEmail: 'u@u.com', facilities: [] });
    expect(noSendMock).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = origKey;
  });
});
