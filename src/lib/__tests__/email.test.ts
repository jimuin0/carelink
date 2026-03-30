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
const { sendBookingConfirmation, sendBookingReminder, sendBookingConfirmed, sendBookingCancelled, sendNewBookingNotification, sendBookingStatusUpdate } = require('../email');

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
