import { buildPlatformMailEnvelope, mailJapanTime, mailTimeLabel, PLATFORM_MAIL_FROM, PLATFORM_MAIL_REPLY_TO, platformMailDraftSchema } from '../platform-mail-contract';
const now = Date.parse('2026-10-25T12:00:00Z');
const draft = { id: '11111111-1111-4111-8111-111111111111', revision: 1, contactId: null, to: 'person@example.invalid', subject: 'ご案内', body: '本文\n', scheduledAt: null };
test('fixed business identity and plain text; trims addressing but preserves the written body', () => {
  expect(buildPlatformMailEnvelope({ ...draft, to: ' person@example.invalid ', subject: ' ご案内 ' }, now)).toEqual({
    from: PLATFORM_MAIL_FROM, replyTo: PLATFORM_MAIL_REPLY_TO, to: draft.to, subject: draft.subject, text: draft.body,
  });
});
test.each([60000, 86400000, 30 * 86400000])('accepts a future provider schedule within its supported window: %s', offset => {
  const scheduledAt = new Date(now + offset).toISOString();
  expect(buildPlatformMailEnvelope({ ...draft, scheduledAt }, now).scheduledAt).toBe(scheduledAt);
});
test.each([0, -60000, 59000, 30 * 86400000 + 1])('refuses past/too-close/unsupported schedule: %s', offset => {
  expect(() => buildPlatformMailEnvelope({ ...draft, scheduledAt: new Date(now + offset).toISOString() }, now)).toThrow('1分後から30日以内');
});
test('invalid parsed timestamp fails closed even if the platform parser fails', () => {
  const parse = jest.spyOn(Date, 'parse').mockReturnValueOnce(NaN);
  expect(() => buildPlatformMailEnvelope({ ...draft, scheduledAt: '2026-10-26T12:00:00Z' }, now)).toThrow();
  parse.mockRestore();
});
test.each([{ to: '' }, { to: 'invalid' }, { subject: '' }, { subject: 'header\r\nInjected' }, { body: '  \n ' }, { from: 'other@example.invalid' }])('refuses invalid/injected send input: %j', changed => {
  expect(() => buildPlatformMailEnvelope({ ...draft, ...changed }, now)).toThrow();
});
test('partial content can be saved as a draft without becoming a sendable envelope', () => {
  expect(platformMailDraftSchema.parse({ ...draft, revision: 0, to: '', subject: '', body: '' }).to).toBe('');
});
test('default current time is used for ordinary sending', () => { expect(buildPlatformMailEnvelope(draft).text).toBe(draft.body); });
test('Japan local input is independent of execution timezone', () => {
  expect(mailJapanTime('2026-10-26T09:00')).toBe('2026-10-26T00:00:00.000Z');
  expect(mailJapanTime('')).toBeNull();
  expect(mailTimeLabel('2026-10-26T00:00:00Z')).toMatch(/10\/26.*09:00/);
});
test.each(['not-a-date', '2026-02-30T09:00', '2026-99-01T09:00'])('rejects malformed/rolled-over local input: %s', value => {
  expect(() => mailJapanTime(value)).toThrow('送信日時を確認');
});
