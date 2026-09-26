/** @jest-environment node */
import type { Resend } from 'resend';
import type { createServiceRoleClient } from '../supabase-server';
import { prepareFacilityWelcomeDelivery } from '../facility-welcome-delivery';
const userId = '68000000-0000-4000-8000-000000000001';
const facilityId = '67000000-0000-4000-8000-000000000001';
const job = { webhook_type: 'facility_welcome', target_id: facilityId, payload: { user_id: userId, template_version: 1 } };
const membership = { user_id: userId, facility_id: facilityId, role: 'owner' };
const user = { id: userId, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-26T00:00:00Z' };
const memberRead = jest.fn(); const profileRead = jest.fn(); const getUserById = jest.fn(); const send = jest.fn();
const eq = jest.fn(); const select = jest.fn();
const from = jest.fn((table: string) => {
  const chain = { select, eq, maybeSingle: table === 'facility_members' ? memberRead : profileRead };
  select.mockReturnValue(chain); eq.mockReturnValue(chain); return chain;
});
const db = { from, auth: { admin: { getUserById } } } as unknown as ReturnType<typeof createServiceRoleClient>;
const resend = { emails: { send } } as unknown as Resend;
beforeEach(() => {
  jest.clearAllMocks();
  memberRead.mockResolvedValue({ data: membership, error: null });
  profileRead.mockResolvedValue({ data: { name: '<script>synthetic</script>', status: 'draft' }, error: null });
  getUserById.mockResolvedValue({ data: { user }, error: null });
  send.mockResolvedValue({ data: { id: 'synthetic-message' }, error: null });
});
test.each([null, {}, { ...job, target_id: 'bad' }, { ...job, webhook_type: 'email' },
  { ...job, payload: { ...job.payload, to: 'other@example.invalid' } },
  { ...job, payload: { ...job.payload, template_version: 2 } },
])('invalid queue reference cannot read or send %#', async input => {
  await expect(prepareFacilityWelcomeDelivery(db, input, resend)).rejects.toThrow('Invalid facility welcome reference');
  expect(from).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
test('missing sender configuration cannot prepare/send', async () => {
  await expect(prepareFacilityWelcomeDelivery(db, job, null)).rejects.toThrow('not configured');
  expect(from).not.toHaveBeenCalled();
});
test.each([null, { ...membership, user_id: facilityId }, { ...membership, facility_id: userId }, { ...membership, role: 'admin' }])('removed/mismatched owner not sent %#', async data => {
  memberRead.mockResolvedValue({ data, error: null });
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('reference unavailable');
  expect(send).not.toHaveBeenCalled(); expect(getUserById).not.toHaveBeenCalled();
});
test.each([null, { name: 'Synthetic', status: 'suspended' }, { name: '', status: 'draft' }])('missing/ineligible facility not sent %#', async data => {
  profileRead.mockResolvedValue({ data, error: null });
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('reference unavailable');
  expect(send).not.toHaveBeenCalled(); expect(getUserById).not.toHaveBeenCalled();
});
test.each([null, { ...user, id: facilityId }, { ...user, email: 'invalid' },
  { ...user, email_confirmed_at: null }, { ...user, email: 'synthetic@LINE.CARELINK.LOCAL' },
])('missing/mismatched/unverified/LINE synthetic recipient not sent %#', async value => {
  getUserById.mockResolvedValue({ data: { user: value }, error: null });
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('reference unavailable');
  expect(send).not.toHaveBeenCalled();
});
test.each(['member', 'profile', 'user'])('provider error in %s is fixed/private', async stage => {
  if (stage === 'member') memberRead.mockResolvedValue({ data: membership, error: { message: 'PRIVATE' } });
  if (stage === 'profile') profileRead.mockResolvedValue({ data: { name: 'Synthetic', status: 'draft' }, error: { message: 'PRIVATE' } });
  if (stage === 'user') getUserById.mockResolvedValue({ data: { user }, error: { message: 'PRIVATE' } });
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('Facility welcome reference unavailable');
  expect(send).not.toHaveBeenCalled();
});
test('provider rejection and null auth envelope are not exposed', async () => {
  getUserById.mockRejectedValue(new Error('PRIVATE'));
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('Facility welcome reference unavailable');
  getUserById.mockResolvedValue({ data: null, error: null });
  await expect(prepareFacilityWelcomeDelivery(db, job, resend)).rejects.toThrow('Facility welcome reference unavailable');
});
test.each([
  [{ data: { id: 'synthetic-message' }, error: null }, 'delivered'],
  [{ data: null, error: { statusCode: 422 } }, 'rejected'],
  [{ data: null, error: { statusCode: 503 } }, 'uncertain'],
])('external effect is deferred, once and conservatively classified %#', async (response, outcome) => {
  const deliver = await prepareFacilityWelcomeDelivery(db, job, resend);
  expect(send).not.toHaveBeenCalled();
  expect(eq).toHaveBeenCalledWith('facility_id', facilityId); expect(eq).toHaveBeenCalledWith('user_id', userId);
  expect(eq).toHaveBeenCalledWith('role', 'owner'); expect(getUserById).toHaveBeenCalledWith(userId);
  send.mockResolvedValue(response);
  expect(await deliver()).toBe(outcome); expect(send).toHaveBeenCalledTimes(1);
  const [message, options] = send.mock.calls[0];
  expect(message.to).toBe(user.email); expect(message.html).toBeUndefined();
  expect(message.text).toContain('一般公開の完了を意味しません');
  expect(message.text).toContain('<script>synthetic</script>');
  expect(options.idempotencyKey).toBe('facility-welcome-v1-' + facilityId);
});
