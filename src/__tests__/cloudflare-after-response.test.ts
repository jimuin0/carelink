/** @jest-environment node */
const mockAfter = jest.fn();
jest.mock('next/server', () => ({ after: (task: () => PromiseLike<unknown>) => mockAfter(task) }));
import { runAfterResponse } from '../../tools/cloudflare/after-response';

beforeEach(() => mockAfter.mockReset());

test('registers the task without waiting for its completion', async () => {
  const task = jest.fn(async () => undefined);
  await runAfterResponse(task);
  expect(mockAfter).toHaveBeenCalledTimes(1);
  expect(task).not.toHaveBeenCalled();
  await mockAfter.mock.calls[0][0]();
  expect(task).toHaveBeenCalledTimes(1);
});

test('waits for the task if registration is unavailable', async () => {
  mockAfter.mockImplementation(() => { throw new Error('outside request'); });
  const task = jest.fn(async () => undefined);
  await runAfterResponse(task);
  expect(task).toHaveBeenCalledTimes(1);
});
