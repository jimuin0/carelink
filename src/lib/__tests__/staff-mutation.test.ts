/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/with-route', () => ({ serverError: jest.fn(() => new Response('{}', { status: 500 })) }));
import { staffMutationError } from '../staff-mutation';
import { serverError } from '../with-route';
test.each([
  [{ code: '42501', message: 'forbidden' }, 401],
  [{ message: 'STAFF_NOT_FOUND' }, 404],
  [{ message: 'STAFF_OPERATION_CONFLICT' }, 409],
  [{ message: 'STAFF_OPERATION_RETIRED' }, 409],
  [{ message: 'STAFF_INPUT_INVALID' }, 400],
  [{ message: 'unexpected database error' }, 500],
])('known business errors are classified, infrastructure errors remain visible: %j', async (error, status) => {
  jest.clearAllMocks(); const res = staffMutationError(error, 'tag', '/api/admin/staff'); expect(res.status).toBe(status);
  if (status === 500) expect(serverError).toHaveBeenCalledWith('tag', error, '/api/admin/staff'); else expect(serverError).not.toHaveBeenCalled();
});
