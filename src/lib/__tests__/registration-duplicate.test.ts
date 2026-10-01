/** @jest-environment node */
import { linkDuplicateRegistration } from '../registration-duplicate';
import type { createServiceRoleClient } from '../supabase-server';
const actor = 'b1000000-0000-4000-8000-000000000001';
const duplicateId = 'b2000000-0000-4000-8000-000000000002';
const canonicalId = 'b2000000-0000-4000-8000-000000000001';
const facilityId = 'b5000000-0000-4000-8000-000000000001';
const rpc = jest.fn();
const db = { rpc } as unknown as ReturnType<typeof createServiceRoleClient>;
const input = { action: 'preview', duplicateId, canonicalId };
const link = { ...input, action: 'link', duplicateRevision: 0, canonicalRevision: 1, sameSite: true };
const preview = { outcome: 'preview', duplicateId, canonicalId, duplicateRevision: 0, canonicalRevision: 1,
  facilityId, name: 'Synthetic', businessType: 'ヘアサロン', prefecture: '合成県', city: '合成市', address: '合成住所', building: null };
beforeEach(() => rpc.mockReset().mockResolvedValue({ data: preview, error: null }));
test.each([null, {}, [], { ...input, duplicateId: canonicalId }, { ...input, userId: actor },
  { ...link, sameSite: false }, { ...link, duplicateRevision: -1 }, { ...link, canonicalRevision: 2147483648 }])('invalid or unconfirmed input does not call RPC %#', async value => {
  expect(await linkDuplicateRegistration(db, actor, value)).toEqual({ outcome: 'invalid' }); expect(rpc).not.toHaveBeenCalled();
});
test('preview is read-only and excludes private identity fields', async () => {
  expect(await linkDuplicateRegistration(db, actor, input)).toEqual(preview);
  expect(rpc).toHaveBeenCalledWith('link_duplicate_registration', { p_actor: actor, p_duplicate: duplicateId, p_canonical: canonicalId,
    p_commit: false, p_duplicate_revision: -1, p_canonical_revision: -1, p_same_site: false });
});
test.each(['linked', 'replay'])('explicit CAS and same-site confirmation accepts %s', async outcome => {
  rpc.mockResolvedValue({ data: { outcome, facilityId }, error: null });
  expect(await linkDuplicateRegistration(db, actor, link)).toEqual({ outcome, facilityId });
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_commit: true, p_duplicate_revision: 0, p_canonical_revision: 1, p_same_site: true });
});
test.each(['invalid', 'forbidden', 'conflict'])('explicit rejection stays %s without a facility ID', async outcome => {
  rpc.mockResolvedValue({ data: { outcome }, error: null });
  expect(await linkDuplicateRegistration(db, actor, link)).toEqual({ outcome });
});
test('read-only preview may reconcile an existing record as replay', async () => {
  rpc.mockResolvedValue({ data: { outcome: 'replay', facilityId }, error: null });
  expect(await linkDuplicateRegistration(db, actor, input)).toEqual({ outcome: 'replay', facilityId });
});
test.each([null, [], {}, { ...preview, email: 'synthetic@example.invalid' }, { outcome: 'conflict', facilityId },
  { outcome: 'linked', facilityId: 'bad' }])('invalid result does not become success %#', async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(linkDuplicateRegistration(db, actor, input)).rejects.toThrow('Registration linkage result unavailable');
});
test.each([{ ...preview, duplicateId: actor }, { ...preview, canonicalId: actor }])('preview must match chosen pair %#', async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(linkDuplicateRegistration(db, actor, input)).rejects.toThrow('Registration linkage result mismatch');
});
test('commit cannot return a preview', async () => {
  await expect(linkDuplicateRegistration(db, actor, link)).rejects.toThrow('Registration linkage result mismatch');
});
test('preview cannot falsely acknowledge a new mutation', async () => {
  rpc.mockResolvedValue({ data: { outcome: 'linked', facilityId }, error: null });
  await expect(linkDuplicateRegistration(db, actor, input)).rejects.toThrow('Unexpected linkage mutation');
});
test('provider error and lost response do not auto-retry', async () => {
  rpc.mockResolvedValue({ data: preview, error: { message: 'private' } });
  await expect(linkDuplicateRegistration(db, actor, input)).rejects.toThrow('Registration linkage result unavailable');
  rpc.mockRejectedValue(new Error('synthetic timeout'));
  await expect(linkDuplicateRegistration(db, actor, link)).rejects.toThrow('synthetic timeout');
  expect(rpc).toHaveBeenCalledTimes(2);
});
