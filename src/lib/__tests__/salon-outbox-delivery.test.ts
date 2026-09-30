/** @jest-environment node */
import type { Resend } from 'resend';
import type { createServiceRoleClient } from '../supabase-server';
import { prepareSalonOutboxDelivery } from '../salon-outbox-delivery';
import { postToSlack } from '../slack';

jest.mock('../slack', () => ({ postToSlack: jest.fn() }));
const id = '71000000-0000-4000-8000-000000000001';
const job = { registration_id: id, target_id: id, template_version: 1, payload: {},
  webhook_type: 'salon_registration_email', notification_kind: 'receipt' };
const internal = { ...job, webhook_type: 'salon_registration_internal', notification_kind: 'internal' };
const row = { source: 'register', email: 'fixture@example.invalid', facility_name: '<script>synthetic</script>' };
const send = jest.fn();
const resend = { emails: { send } } as unknown as Resend;
const query = jest.fn();
const eq = jest.fn(() => ({ maybeSingle: query }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select }));
const db = { from } as unknown as ReturnType<typeof createServiceRoleClient>;
const originalToken = process.env.SLACK_BOT_TOKEN;
const originalChannel = process.env.SLACK_DEFAULT_CHANNEL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_BOT_TOKEN = 'synthetic-only';
  process.env.SLACK_DEFAULT_CHANNEL = 'synthetic-only';
  query.mockResolvedValue({ data: row, error: null });
  send.mockResolvedValue({ data: { id: 'synthetic-message' }, error: null });
  (postToSlack as jest.Mock).mockResolvedValue({ ok: true, ts: 'synthetic-ts' });
});
afterAll(() => {
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
  if (originalChannel === undefined) delete process.env.SLACK_DEFAULT_CHANNEL;
  else process.env.SLACK_DEFAULT_CHANNEL = originalChannel;
});

test.each([null, {}, { ...job, registration_id: 'invalid' }, { ...job, target_id: 'different' },
  { ...job, template_version: 2 }, { ...job, payload: { email: 'untrusted@example.invalid' } },
  { ...job, notification_kind: 'internal' }, { ...internal, notification_kind: 'receipt' },
])('invalid references are rejected before any read or send %#', async value => {
  await expect(prepareSalonOutboxDelivery(db, value, resend)).rejects.toThrow('Invalid registration outbox reference');
  expect(from).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(postToSlack).not.toHaveBeenCalled();
});

test.each(['SLACK_BOT_TOKEN', 'SLACK_DEFAULT_CHANNEL'])('missing %s prevents internal send preparation', async key => {
  delete process.env[key];
  await expect(prepareSalonOutboxDelivery(db, internal, resend)).rejects.toThrow('not configured');
  expect(from).not.toHaveBeenCalled();
});
test('missing email configuration prevents read and send', async () => {
  await expect(prepareSalonOutboxDelivery(db, job, null)).rejects.toThrow('not configured');
  expect(from).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: null }, { data: { source: 'other' }, error: null },
  { data: row, error: { message: 'synthetic private provider details' } },
])('internal lookup failures use fixed errors %#', async result => {
  query.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, internal, resend)).rejects.toThrow('Registration internal reference unavailable');
  expect(postToSlack).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: null }, { data: { ...row, source: 'recruit' }, error: null },
  { data: { ...row, email: 'invalid' }, error: null },
  { data: row, error: { message: 'synthetic private provider details' } },
])('email lookup failures use fixed errors %#', async result => {
  query.mockResolvedValue(result);
  await expect(prepareSalonOutboxDelivery(db, job, resend)).rejects.toThrow('Registration email reference unavailable');
  expect(send).not.toHaveBeenCalled();
});
test.each([
  [{ ok: true, ts: 'synthetic-ts' }, 'delivered'], [{ ok: false, error: 'http_500' }, 'uncertain'],
  [{ ok: true }, 'uncertain'], [{ ok: true, ts: 123 }, 'uncertain'], [{ ok: true, ts: '' }, 'uncertain'],
])('internal provider result is classified conservatively %#', async (result, outcome) => {
  query.mockResolvedValue({ data: { source: 'recruit' }, error: null });
  const deliver = await prepareSalonOutboxDelivery(db, internal, resend);
  expect(postToSlack).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith('source');
  expect(eq).toHaveBeenCalledWith('id', id);
  (postToSlack as jest.Mock).mockResolvedValue(result);
  await expect(deliver()).resolves.toBe(outcome);
  expect(postToSlack).toHaveBeenCalledTimes(1);
  const payload = JSON.stringify((postToSlack as jest.Mock).mock.calls[0]);
  expect(payload).toContain(id);
  expect(payload).toContain('/admin/registrations');
  expect(payload).not.toContain(row.email);
  expect(payload).not.toContain(row.facility_name);
});
test.each([
  [{ data: { id: 'synthetic-message' }, error: null }, 'delivered'],
  [{ data: null, error: { statusCode: 422 } }, 'rejected'],
  [{ data: null, error: { statusCode: 503 } }, 'uncertain'],
])('email sends exactly once, classified by existing reconciliation contract %#', async (result, outcome) => {
  const deliver = await prepareSalonOutboxDelivery(db, job, resend);
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue(result);
  await expect(deliver()).resolves.toBe(outcome);
  expect(send).toHaveBeenCalledTimes(1);
  const [email, options] = send.mock.calls[0];
  expect(email.to).toBe(row.email);
  expect(email.text).toContain(id);
  expect(email.text).toContain('一般公開は');
  expect(email.text).toContain('/admin/onboarding');
  expect(email.html).toBeUndefined();
  expect(email.subject).not.toContain(row.facility_name);
  expect(options.idempotencyKey).toBe(`salon-receipt-v1-${id}`);
});
