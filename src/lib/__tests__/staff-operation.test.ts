/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
import { staffOperationKey, pendingStaffOperation, beginStaffOperation, finishStaffOperation, recoverStaffOperation } from '../staff-operation';
const ID = '66000000-0000-4000-8000-000000000001';
const key = staffOperationKey('owner', 'facility');
const mockFetch = jest.fn();
beforeEach(() => { sessionStorage.clear(); jest.restoreAllMocks(); mockFetch.mockReset(); global.fetch = mockFetch; jest.spyOn(crypto, 'randomUUID').mockReturnValue(ID); });
test('only UUID persists with actor/tenant/target context and survives retries', () => {
  expect(key).toBe('carelink-staff-operation:owner:facility:new');
  expect(staffOperationKey('owner','facility','staff')).toBe('carelink-staff-operation:owner:facility:staff');
  expect(pendingStaffOperation(key)).toBeNull(); expect(beginStaffOperation(key)).toBe(ID); expect(beginStaffOperation(key)).toBe(ID);
  expect(crypto.randomUUID).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(ID); finishStaffOperation(key); expect(pendingStaffOperation(key)).toBeNull();
});
test('invalid stored UUID and unavailable storage fail closed before nonrecoverable writes', () => {
  sessionStorage.setItem(key, 'invalid'); expect(() => beginStaffOperation(key)).toThrow('Invalid pending operation');
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
  expect(() => beginStaffOperation(key)).toThrow('storage unavailable');
});
test('no pending UUID means no recovery network request', async () => { expect(await recoverStaffOperation(key,'facility')).toBe('absent'); expect(mockFetch).not.toHaveBeenCalled(); });
test.each(['absent','saved','retired'] as const)('confirmed %s receipt resolves UUID without locally storing input', async state => {
  sessionStorage.setItem(key,ID); mockFetch.mockResolvedValue({ ok: true, json: async () => ({ state }) });
  expect(await recoverStaffOperation(key,'facility')).toBe(state);
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff?facility_id=facility&operation_id=${ID}&kind=create`, { cache: 'no-store' });
  expect(pendingStaffOperation(key)).toBeNull();
});
test('weekly recovery is bound to staff target', async () => {
  sessionStorage.setItem(key,ID); mockFetch.mockResolvedValue({ ok: true, json: async () => ({ state: 'saved' }) });
  await recoverStaffOperation(key,'facility','staff'); expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('kind=weekly&staff_id=staff'), expect.anything());
});
test.each([{ ok: false }, { ok: true, json: async () => ({ state: 'unknown' }) }, { ok: true, json: async () => null }])('unconfirmed recovery preserves pending UUID', async response => {
  sessionStorage.setItem(key,ID); mockFetch.mockResolvedValue(response);
  await expect(recoverStaffOperation(key,'facility')).rejects.toThrow(); expect(pendingStaffOperation(key)).toBe(ID);
});
test('network failure preserves operation for later recovery', async () => {
  sessionStorage.setItem(key,ID); mockFetch.mockRejectedValue(new Error('network'));
  await expect(recoverStaffOperation(key,'facility')).rejects.toThrow('network'); expect(pendingStaffOperation(key)).toBe(ID);
});
