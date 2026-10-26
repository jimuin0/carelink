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

import { mailDisplayName, summarizeMailReplies, mailReplyLabels, type LegacyMailReply, type PlatformMailRecord } from '../platform-mail-contract';
const legacy: LegacyMailReply = { id: draft.id, contact_id: draft.id, author_name: '運営', body: '返信', is_internal: false,
  created_at: '2026-10-25T12:00:00Z', sent_at: null, delivery_abandoned_at: null };
const evidence = (state: PlatformMailRecord['state'], delivery_status: string | null = null) => ({ id: draft.id, contact_id: draft.id, state, delivery_status });
test.each([
  ['  山田  太郎　', '山田 太郎'], ['　山田　　太郎 ', '山田　太郎'], ['山田太郎', '山田太郎'],
  ['  María   de la Cruz  ', 'María de la Cruz'], ['王小明', '王小明'], ['　', ''],
  [' Jean\u00a0Luc ', 'Jean\u00a0Luc'], ['  李　 小明 ', '李　小明'],
])('display normalization preserves names, scripts and separator width: %s', (name, expected) => {
  expect(mailDisplayName(name)).toBe(expected); expect(mailDisplayName(mailDisplayName(name))).toBe(expected);
});
test.each(['draft', 'pending', 'scheduled', 'cancelling', 'cancelled'] as const)('an unsent platform operation never counts as replied: %s', state => {
  expect(summarizeMailReplies([evidence(state)], []).replied).toBe(false);
});
test.each(['accepted', 'sent', 'delivered', 'delayed', 'complained', null])('confirmed sending counts as replied without claiming delivery: %s', delivery => {
  expect(summarizeMailReplies([evidence('sent', delivery)], []).replied).toBe(true);
});
test.each(['failed', 'bounced'])('failed delivery alone is not a completed reply: %s', delivery => {
  const summary = summarizeMailReplies([evidence('sent', delivery)], []);
  expect(summary.replied).toBe(false); expect(summary.failed).toBe(true);
});
test('old internal notes, unknown and abandoned sends are not replies', () => {
  expect(summarizeMailReplies([], [{ ...legacy, is_internal: true, sent_at: legacy.created_at }]).replied).toBe(false);
  expect(summarizeMailReplies([], [legacy])).toMatchObject({ replied: false, pending: true });
  expect(summarizeMailReplies([], [{ ...legacy, delivery_abandoned_at: legacy.created_at }])).toMatchObject({ replied: false, pending: false });
  expect(summarizeMailReplies([], [{ ...legacy, sent_at: legacy.created_at }])).toMatchObject({ replied: true, pending: false });
});
test('reply and outstanding follow-up states remain independently visible', () => {
  const summary = summarizeMailReplies([evidence('draft'), evidence('pending'), evidence('scheduled'), evidence('sent', 'bounced')], [{ ...legacy, sent_at: legacy.created_at }]);
  expect(mailReplyLabels(summary)).toEqual(['返信済み', '下書きあり', '予約中', '送信結果不明', '送信失敗']);
  expect(mailReplyLabels(summarizeMailReplies([], []))).toEqual(['未返信']);
});
