/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockSend = jest.fn();
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));
jest.mock('@/lib/webhook-queue', () => ({ enqueueWebhook: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
import { sendBookingReminderForCron } from '../email';
import { safeCaptureException } from '../safe';

const fixture = { customerName: 'Fixture', customerEmail: 'fixture@example.com', facilityName: 'Fixture', bookingDate: '2026-09-22', startTime: '10:00', endTime: '11:00' };
beforeEach(() => { jest.clearAllMocks(); process.env.RESEND_API_KEY = 're_fixture'; });
test.each([
  [{ data: { id: 'fixture-message' }, error: null }, 'delivered'],
  [{ data: null, error: { statusCode: 429 } }, 'rejected'],
  [{ data: null, error: { statusCode: null, name: 'application_error' } }, 'uncertain'],
  [{ data: null, error: { statusCode: 500 } }, 'uncertain'],
])('cronメールはSDK応答%sを%sに分類する', async (result, outcome) => {
  mockSend.mockResolvedValue(result);
  await expect(sendBookingReminderForCron(fixture)).resolves.toBe(outcome);
  expect(mockSend).toHaveBeenCalledTimes(1);
});
test('設定なしは送信せず拒否として扱う', async () => {
  delete process.env.RESEND_API_KEY;
  await expect(sendBookingReminderForCron(fixture)).resolves.toBe('rejected');
  expect(mockSend).not.toHaveBeenCalled();
});
test('3日前の案内は日数を表示し一度だけ送信する', async () => {
  mockSend.mockResolvedValue({ data: { id: 'fixture-message' }, error: null });
  await expect(sendBookingReminderForCron(fixture, 3)).resolves.toBe('delivered');
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
    subject: expect.stringContaining('3日後'), html: expect.stringContaining('3日後'),
  }));
  expect(mockSend).toHaveBeenCalledTimes(1);
});
// 2026年10月22日 神原さん決定：cron が実際に使うこちらの経路にも送信基準を必ず載せる
// （送信経路が2本あり、片方だけに足すと届くメールによって書いてあることが違ってしまう）。
test.each([1, 3, 7])('cronメール（%i日前）に送信基準（当日朝9時時点の予約）を明記する', async (days) => {
  mockSend.mockResolvedValue({ data: { id: 'fixture-message' }, error: null });
  await sendBookingReminderForCron(fixture, days);
  expect(mockSend.mock.calls[0][0].html).toContain('本メールは、当日朝9時の時点でご予約いただいているお客様にお送りしています。');
});
test('SDKの同期例外でも自動再送せず照合待ちにする', async () => {
  const error = new Error('sdk unavailable');
  mockSend.mockImplementationOnce(() => { throw error; });
  await expect(sendBookingReminderForCron(fixture)).resolves.toBe('uncertain');
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(safeCaptureException).toHaveBeenCalledWith(error, 'email:booking_reminder_cron_uncertain');
});
