/** @jest-environment node */
const OP = '88888888-8888-4888-8888-888888888888', PROVIDER = '99999999-9999-4999-8999-999999999999';
const mockFrom = jest.fn(), mockAlert = jest.fn(), mockCapture = jest.fn();
jest.mock('node:crypto', () => ({ randomUUID: () => '88888888-8888-4888-8888-888888888888' }));
jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom }) }));
jest.mock('../safe', () => ({ safeCaptureException: (...args: unknown[]) => mockCapture(...args) }));
jest.mock('../alert', () => ({ postAlert: (...args: unknown[]) => mockAlert(...args) }));
import { sendDurableEventEmail, dispatchEventEmail, verifyEventEmailAcceptance } from '../event-email-delivery';
const envelope = { from: 'CareLink <noreply@carelink-jp.com>', to: 'synthetic@example.invalid', subject: 'synthetic', html: '<p>fixture</p>' };
let chain: Record<string, jest.Mock>, send: jest.Mock, get: jest.Mock;
function client() { return { emails: { send, get } } as never; }
beforeEach(() => {
  jest.clearAllMocks();
  send = jest.fn().mockResolvedValue({ data: { id: PROVIDER }, error: null }); get = jest.fn();
  chain = {};
  for (const name of ['insert', 'update', 'eq', 'is', 'select']) chain[name] = jest.fn(() => chain);
  for (const name of ['single', 'maybeSingle']) chain[name] = jest.fn().mockResolvedValue({ data: { id: OP }, error: null });
  mockFrom.mockReturnValue(chain);
});
afterEach(() => jest.useRealTimers());
test('first send is reserved and fenced before provider I/O; same operation key/tag is persisted', async () => {
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(true);
  expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ id: OP, email_envelope: envelope,
    payload: { event_email_version: 1, idempotency_key: `carelink-event-email/${OP}` } }));
  expect(chain.insert.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  expect(chain.update.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ ...envelope, tags: [{ name: 'carelink_event_operation', value: OP }] }, { idempotencyKey: `carelink-event-email/${OP}` });
  expect(chain.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success', provider_message_id: PROVIDER }));
});
test.each(['reserve-error', 'reserve-null', 'start-error', 'start-lost', 'db-throw'])('no dispatch after %s', async mode => {
  if (mode === 'reserve-error') chain.single.mockResolvedValue({ error: { message: 'private' } });
  if (mode === 'reserve-null') chain.single.mockResolvedValue({ data: null });
  if (mode === 'start-error') chain.maybeSingle.mockResolvedValue({ error: { message: 'private' } });
  if (mode === 'start-lost') chain.maybeSingle.mockResolvedValue({ data: null });
  if (mode === 'db-throw') mockFrom.mockImplementation(() => { throw new Error('private'); });
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(JSON.stringify(mockAlert.mock.calls)).not.toContain('private');
});
test.each([408, 409, 500, undefined])('uncertain provider error %s retains fence without another job/reset', async statusCode => {
  send.mockResolvedValue({ data: null, error: { statusCode, name: 'application_error', message: envelope.to } });
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(chain.insert).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
  expect(chain.update).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mockAlert.mock.calls)).not.toContain(envelope.to);
});
test.each([401, 422, 429])('definite rejection %s only resets same owned row for bounded retry', async statusCode => {
  send.mockResolvedValue({ data: null, error: { statusCode } });
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(chain.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending', delivery_started_at: null, attempt_count: 1 }));
  expect(chain.eq).toHaveBeenCalledWith('status', 'processing');
  expect(chain.eq).toHaveBeenCalledWith('delivery_started_at', expect.any(String));
});
test.each([{ data:null,error:null },{ data:{ id:OP },error:{} }])('lost rejection CAS stays uncertain without a second dispatch %j', async result => {
  send.mockResolvedValue({ data:null,error:{ statusCode:422 } });
  chain.maybeSingle.mockResolvedValueOnce({ data:{ id:OP },error:null }).mockResolvedValueOnce(result);
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(send).toHaveBeenCalledTimes(1); expect(chain.insert).toHaveBeenCalledTimes(1);
});
test.each([null, { data: { id: 'invalid' }, error: null }])('malformed acceptance stays unknown %j', async value => {
  send.mockResolvedValue(value);
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(chain.update).toHaveBeenCalledTimes(1);
});
test('accepted but final CAS is lost: no second send or reset', async () => {
  chain.maybeSingle.mockResolvedValueOnce({ data: { id: OP } }).mockResolvedValueOnce({ data: null });
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(send).toHaveBeenCalledTimes(1); expect(chain.insert).toHaveBeenCalledTimes(1);
  expect(chain.update.mock.calls.filter(([v]) => v.status === 'pending')).toHaveLength(0);
});
test('provider result mutated after reconciliation remains fenced, never falsely accepted', async () => {
  let reads = 0;
  send.mockResolvedValue({ get data() { return ++reads <= 3 ? { id:PROVIDER } : null; }, error:null });
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
  expect(chain.update).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
});
test('timeout and rejection retain unknown without replay', async () => {
  jest.useFakeTimers(); send.mockReturnValue(new Promise(() => {}));
  const pending = sendDurableEventEmail(client(), envelope, 'synthetic');
  await jest.advanceTimersByTimeAsync(10001);
  expect(await pending).toBe(false); expect(send).toHaveBeenCalledTimes(1);
  send.mockRejectedValue(new Error('network'));
  expect(await sendDurableEventEmail(client(), envelope, 'synthetic')).toBe(false);
});
test('invalid dispatch identity/envelope is rejected before provider', () => {
  expect(() => dispatchEventEmail(client(), envelope, 'bad')).toThrow();
  expect(() => dispatchEventEmail(client(), { ...envelope, to: 'bad' }, OP)).toThrow();
  expect(send).not.toHaveBeenCalled();
});
const message = () => ({ id: PROVIDER, ...envelope, to: [envelope.to], tags: [{ name: 'carelink_event_operation', value: OP }], created_at: new Date().toISOString() });
test('provider-only reconciliation verifies immutable payload, tag and time without sending', async () => {
  get.mockResolvedValue({ data: message(), error: null });
  expect(await verifyEventEmailAcceptance(client(), envelope, OP, PROVIDER, new Date().toISOString())).toBe(true);
  expect(send).not.toHaveBeenCalled();
});
test.each([{ id: OP }, { from: 'other' }, { to: ['other@example.invalid'] }, { subject: 'other' }, { html: 'other' },
  { tags: [] }, { created_at: '2000-01-01' }, { created_at: 'broken' }])('wrong provider evidence never releases unknown %j', async override => {
  get.mockResolvedValue({ data: { ...message(), ...override }, error: null });
  expect(await verifyEventEmailAcceptance(client(), envelope, OP, PROVIDER, new Date().toISOString())).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
test('unavailable, thrown, timed-out or malformed lookup is not acceptance', async () => {
  expect(await verifyEventEmailAcceptance(client(), envelope, 'bad', PROVIDER, 'bad')).toBe(false);
  get.mockResolvedValue({ data: null, error: {} });
  expect(await verifyEventEmailAcceptance(client(), envelope, OP, PROVIDER, new Date().toISOString())).toBe(false);
  get.mockRejectedValue(new Error('private'));
  expect(await verifyEventEmailAcceptance(client(), envelope, OP, PROVIDER, new Date().toISOString())).toBe(false);
  jest.useFakeTimers(); get.mockReturnValue(new Promise(() => {}));
  const pending = verifyEventEmailAcceptance(client(), envelope, OP, PROVIDER, new Date().toISOString());
  await jest.advanceTimersByTimeAsync(10001); expect(await pending).toBe(false);
});
