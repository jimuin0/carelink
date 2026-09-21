/** @jest-environment node */
const mockSend = jest.fn();
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));
jest.mock('@/lib/webhook-queue', () => ({ enqueueWebhook: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
import { sendBookingReminderForCron } from '../email';

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
