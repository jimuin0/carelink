/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { Resend } from 'resend';
import { sendInquiryReplyEnvelope, verifyInquiryReplyAcceptance } from '../inquiry-reply-delivery';
const operation = '71000000-0000-4000-8000-000000000001';
const messageId = '71000000-0000-4000-8000-000000000002';
const envelope = { from: 'CareLink <support@example.invalid>', to: 'synthetic@example.invalid',
  replyTo: 'CareLink <support@example.invalid>', subject: 'Synthetic reply', html: '<p>Synthetic</p>' };
const send = jest.fn(); const get = jest.fn();
const client = { emails: { send, get } } as unknown as Resend;
const reservedAt = new Date(Date.now() - 60000).toISOString();
const message = { ...envelope, id: messageId, to: [envelope.to], reply_to: [envelope.replyTo],
  tags: [{ name: 'carelink_reply_operation', value: operation }], created_at: new Date().toISOString() };
beforeEach(() => { jest.clearAllMocks(); send.mockResolvedValue({ data: { id: messageId }, error: null });
  get.mockResolvedValue({ data: message, error: null }); });
afterEach(() => jest.useRealTimers());
test('accepted sends preserve ID and immutable envelope with only an opaque tag', async () => {
  expect(await sendInquiryReplyEnvelope(client, envelope, operation)).toEqual({ state: 'accepted', messageId });
  expect(send).toHaveBeenCalledWith({ ...envelope, tags: [{ name: 'carelink_reply_operation', value: operation }] }, { idempotencyKey: operation });
  expect(get).not.toHaveBeenCalled();
});
test.each([{ error: { statusCode: 422 } }, { error: { statusCode: 503 } }, null,
  { data: {} }, { data: { id: '' } }, { data: { id: 'invalid' } }])('send uncertainty never unlocks an operation %#', async value => {
  send.mockResolvedValue(value);
  expect(await sendInquiryReplyEnvelope(client, envelope, operation)).toEqual({ state: 'unknown' });
});
test.each([null, client])('missing client or invalid operation fails closed %#', async value => {
  expect(await sendInquiryReplyEnvelope(value, envelope, value ? 'bad' : operation)).toEqual({ state: 'unknown' });
  expect(send).not.toHaveBeenCalled();
});
test('invalid envelope does not dispatch', async () => {
  expect(await sendInquiryReplyEnvelope(client, { ...envelope, to: 'bad' }, operation)).toEqual({ state: 'unknown' });
  expect(send).not.toHaveBeenCalled();
});
test.each(['reject', 'sync', 'timeout'])('provider failure is unknown and timer is released %s', async failure => {
  jest.useFakeTimers();
  if (failure === 'reject') send.mockRejectedValue(new Error('synthetic private details'));
  else if (failure === 'sync') send.mockImplementation(() => { throw new Error('synthetic'); });
  else send.mockImplementation(() => new Promise(() => undefined));
  const result = sendInquiryReplyEnvelope(client, envelope, operation);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await result).toEqual({ state: 'unknown' });
  expect(jest.getTimerCount()).toBe(0);
});
test('reconciliation verifies provider record without sending, regardless of retry age', async () => {
  expect(await verifyInquiryReplyAcceptance(client, envelope, operation, messageId, reservedAt)).toEqual({ state: 'accepted', messageId });
  expect(get).toHaveBeenCalledWith(messageId); expect(send).not.toHaveBeenCalled();
});
test.each([
  { id: operation }, { from: 'other@example.invalid' }, { subject: 'other' }, { html: 'different' },
  { to: [] }, { to: [envelope.to, 'other@example.invalid'] }, { to: ['other@example.invalid'] },
  { reply_to: null }, { reply_to: [] }, { reply_to: ['other@example.invalid'] }, { tags: undefined },
  { tags: [] }, { tags: [{ name: 'other', value: operation }] }, { tags: [{ name: 'carelink_reply_operation', value: messageId }] },
  { created_at: 'bad' }, { created_at: '2000-01-01T00:00:00Z' }, { created_at: '2100-01-01T00:00:00Z' },
])('mismatched provider evidence cannot mark sent %#', async patch => {
  get.mockResolvedValue({ data: { ...message, ...patch }, error: null });
  expect(await verifyInquiryReplyAcceptance(client, envelope, operation, messageId, reservedAt)).toEqual({ state: 'unknown' });
  expect(send).not.toHaveBeenCalled();
});
test.each([null, { data: null }, { error: { statusCode: 404 } }])('missing provider evidence stays unknown %#', async response => {
  get.mockResolvedValue(response);
  expect(await verifyInquiryReplyAcceptance(client, envelope, operation, messageId, reservedAt)).toEqual({ state: 'unknown' });
});
test.each([
  [null, envelope, operation, messageId, reservedAt], [client, envelope, 'bad', messageId, reservedAt],
  [client, envelope, operation, 'bad', reservedAt], [client, { ...envelope, to: 'bad' }, operation, messageId, reservedAt],
  [client, envelope, operation, messageId, 'bad'],
])('invalid reconciliation input never reads or sends %#', async (c, e, o, m, at) => {
  expect(await verifyInquiryReplyAcceptance(c as Resend | null, e as typeof envelope, o as string, m as string, at as string)).toEqual({ state: 'unknown' });
  expect(get).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
