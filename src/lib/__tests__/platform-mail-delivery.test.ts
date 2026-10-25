/** @jest-environment node */
import type { Resend } from 'resend';
import { Resend as ResendConstructor } from 'resend';
import { dispatchPlatformMail, inspectPlatformMail, cancelPlatformMail, platformMailProvider } from '../platform-mail-delivery';
import { PLATFORM_MAIL_FROM, PLATFORM_MAIL_REPLY_TO, type PlatformMailEnvelope } from '../platform-mail-contract';
jest.mock('resend', () => ({ Resend: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const providerId = '22222222-2222-4222-8222-222222222222';
const at = '2026-10-25T12:00:00.000Z';
const envelope: PlatformMailEnvelope = { from: PLATFORM_MAIL_FROM, replyTo: PLATFORM_MAIL_REPLY_TO, to: 'synthetic@example.invalid', subject: '検証', text: '架空の検証本文' };
const message = { id: providerId, from: envelope.from, subject: envelope.subject, text: envelope.text,
  to: [envelope.to], reply_to: [envelope.replyTo], tags: [{ name: 'carelink_operator_mail', value: id }],
  created_at: at, last_event: 'delivered', scheduled_at: null };
let send: jest.Mock, get: jest.Mock, cancel: jest.Mock, client: Resend;
beforeEach(() => {
  send = jest.fn().mockResolvedValue({ data: { id: providerId }, error: null });
  get = jest.fn().mockResolvedValue({ data: message, error: null });
  cancel = jest.fn().mockResolvedValue({ data: { id: providerId }, error: null });
  client = { emails: { send, get, cancel } } as unknown as Resend;
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
test('provider absence is explicit; a configured key is server-only', () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  expect(platformMailProvider()).toBeNull();
  process.env.RESEND_API_KEY = 'synthetic-not-a-real-key';
  platformMailProvider(); expect(ResendConstructor).toHaveBeenCalledWith('synthetic-not-a-real-key');
  if (saved === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved;
});
test('dispatch fixes the exact envelope and operation key, including schedule', async () => {
  const scheduled = { ...envelope, scheduledAt: '2026-10-26T00:00:00Z' };
  expect(await dispatchPlatformMail(client, scheduled, id)).toEqual({ state: 'accepted', id: providerId });
  expect(send).toHaveBeenCalledWith({ ...scheduled, tags: [{ name: 'carelink_operator_mail', value: id }] }, { idempotencyKey: id });
});
test.each([null, 'invalid-id', 'invalid-envelope'])('refuses unsafe dispatch before network: %s', input => {
  return expect(dispatchPlatformMail(input === null ? null : client, input === 'invalid-envelope' ? { ...envelope, from: 'bad' } as unknown as PlatformMailEnvelope : envelope, input === 'invalid-id' ? 'bad' : id)).resolves.toEqual({ state: 'unknown' });
});
test.each([null, {}, { error: { message: 'private provider diagnostic' }, data: { id: providerId } }, { data: null }, { data: { id: 1 } }, { data: { id: 'invalid' } }])('does not treat malformed/rejected provider data as sent: %j', response => {
  send.mockResolvedValue(response); return expect(dispatchPlatformMail(client, envelope, id)).resolves.toEqual({ state: 'unknown' });
});
test('network rejection stays unknown', async () => { send.mockRejectedValue(new Error('private')); expect(await dispatchPlatformMail(client, envelope, id)).toEqual({ state: 'unknown' }); });
test('bounded dispatch keeps the reservation uncertain without a fallback send', async () => {
  jest.useFakeTimers(); send.mockReturnValue(new Promise(() => {}));
  const pending = dispatchPlatformMail(client, envelope, id);
  await jest.advanceTimersByTimeAsync(10001);
  expect(await pending).toEqual({ state: 'unknown' }); expect(send).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('matched immutable provider receipt is confirmed', async () => { expect(await inspectPlatformMail(client, envelope, id, providerId, at)).toEqual({ id: providerId, event: 'delivered' }); });
test.each(['queued', 'sent', 'opened', 'clicked', 'suppressed', 'delivery_delayed', 'bounced', 'complained', 'canceled', 'failed', 'future_unknown'])('provider events are observed without inventing delivery: %s', last_event => {
  get.mockResolvedValue({ data: { ...message, last_event } });
  return expect(inspectPlatformMail(client, envelope, id, providerId, at)).resolves.toEqual(last_event === 'future_unknown' ? null : { id: providerId, event: ({ queued: 'accepted', opened: 'delivered', clicked: 'delivered', suppressed: 'failed', delivery_delayed: 'delayed', canceled: 'cancelled' } as Record<string, string>)[last_event] ?? last_event });
});
test.each(['client', 'id', 'provider', 'envelope', 'time'])('malformed inspection request does not read provider: %s', invalid => {
  return expect(inspectPlatformMail(invalid === 'client' ? null : client, invalid === 'envelope' ? { ...envelope, text: '' } : envelope, invalid === 'id' ? 'bad' : id, invalid === 'provider' ? 'bad' : providerId, invalid === 'time' ? 'bad' : at)).resolves.toBeNull();
});
test.each([null, {}, { error: { message: 'private' } }, { data: null }])('inspection rejects missing provider receipt: %j', response => {
  get.mockResolvedValue(response); return expect(inspectPlatformMail(client, envelope, id, providerId, at)).resolves.toBeNull();
});
test.each([
  { id }, { from: 'other@example.invalid' }, { subject: 'different' }, { text: 'different' },
  { to: null }, { to: [] }, { to: ['other@example.invalid'] }, { reply_to: null }, { reply_to: [] }, { reply_to: ['other@example.invalid'] },
  { tags: null }, { tags: [] }, { tags: [{ name: 'wrong', value: id }] }, { tags: [{ name: 'carelink_operator_mail', value: providerId }] },
  { created_at: 'invalid' }, { created_at: '2026-10-25T11:54:59Z' }, { created_at: new Date(Date.now() + 3600000).toISOString() },
])('rejects a mismatched provider record: %j', change => {
  get.mockResolvedValue({ data: { ...message, ...change } }); return expect(inspectPlatformMail(client, envelope, id, providerId, at)).resolves.toBeNull();
});
test.each(['missing-envelope', 'missing-provider', 'changed-provider', 'matched'])('scheduled time is verified: %s', mode => {
  const scheduledAt = '2026-10-26T00:00:00Z';
  get.mockResolvedValue({ data: { ...message, last_event: 'scheduled', scheduled_at: mode === 'missing-provider' ? null : mode === 'changed-provider' ? at : scheduledAt } });
  return expect(inspectPlatformMail(client, mode === 'missing-envelope' ? envelope : { ...envelope, scheduledAt }, id, providerId, at)).resolves.toEqual(mode === 'matched' ? { id: providerId, event: 'scheduled' } : null);
});
test('cancellation needs a matching scheduled record and confirms exact provider ID', async () => {
  const scheduledAt = '2026-10-26T00:00:00Z';
  get.mockResolvedValue({ data: { ...message, last_event: 'scheduled', scheduled_at: scheduledAt } });
  expect(await cancelPlatformMail(client, { ...envelope, scheduledAt }, id, providerId, at)).toEqual({ id: providerId, event: 'cancelled' });
  expect(cancel).toHaveBeenCalledWith(providerId); expect(send).not.toHaveBeenCalled();
});
test('sent mail cannot be recalled and no cancel is attempted', async () => { expect(await cancelPlatformMail(client, envelope, id, providerId, at)).toEqual({ id: providerId, event: 'delivered' }); expect(cancel).not.toHaveBeenCalled(); });
test('unavailable inspection never cancels', async () => { expect(await cancelPlatformMail(null, envelope, id, providerId, at)).toBeNull(); get.mockResolvedValue(null); expect(await cancelPlatformMail(client, envelope, id, providerId, at)).toBeNull(); });
test.each([null, { error: { message: 'private' } }, { data: { id } }, 'reject'])('ambiguous cancellation is reconciled read-only: %j', result => {
  const scheduledAt = '2026-10-26T00:00:00Z';
  get.mockResolvedValueOnce({ data: { ...message, last_event: 'scheduled', scheduled_at: scheduledAt } }).mockResolvedValueOnce({ data: { ...message, last_event: 'canceled' } });
  if (result === 'reject') cancel.mockRejectedValue(new Error('private')); else cancel.mockResolvedValue(result);
  return expect(cancelPlatformMail(client, { ...envelope, scheduledAt }, id, providerId, at)).resolves.toEqual({ id: providerId, event: 'cancelled' });
});
