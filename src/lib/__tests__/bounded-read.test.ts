/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readWithinDeadline, PageReadTimeoutError, PAGE_READ_TIMEOUT_MS } from '../bounded-read';

let consoleError: jest.SpyInstance;
beforeEach(() => { jest.useFakeTimers(); consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('a completed SELECT returns its exact result and clears the deadline', async () => {
  const result = { count: 3, error: null };
  const abortSignal = jest.fn().mockReturnValue(Promise.resolve(result));
  await expect(readWithinDeadline('menus', Object.assign(Promise.resolve(result), { abortSignal }))).resolves.toBe(result);
  expect(abortSignal).toHaveBeenCalledTimes(1);
  expect(abortSignal.mock.calls[0][0].aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  expect(consoleError).not.toHaveBeenCalled();
});

test('a Promise-like transport without an abort hook is still bounded', async () => {
  await expect(readWithinDeadline('plain', Promise.resolve('ready'))).resolves.toBe('ready');
  expect(jest.getTimerCount()).toBe(0);
});

test('a database rejection is preserved and not retried', async () => {
  const failure = { code: '08006' };
  await expect(readWithinDeadline('menus', Promise.reject(failure))).rejects.toBe(failure);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([true, false])('a stalled SELECT fails into the error boundary at the deadline (abort cooperation=%p)', async (cooperative) => {
  let signal!: AbortSignal;
  const query = Object.assign(new Promise<never>(() => {}), {
    abortSignal: (value: AbortSignal) => {
      signal = value;
      return new Promise<never>((_resolve, reject) => {
        if (cooperative) value.addEventListener('abort', () => reject(new Error('synthetic-private-transport')));
      });
    },
  });
  const result = readWithinDeadline('bookings-today', query).catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(PAGE_READ_TIMEOUT_MS - 1);
  expect(signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  const error = await result;
  expect(error).toBeInstanceOf(PageReadTimeoutError);
  expect((error as PageReadTimeoutError).message).toBe('PAGE_READ_TIMEOUT:bookings-today');
  expect((error as PageReadTimeoutError).label).toBe('bookings-today');
  expect(signal.aborted).toBe(true);
  expect(consoleError).toHaveBeenCalledWith('[page-read] timeout', { label: 'bookings-today', ms: PAGE_READ_TIMEOUT_MS });
  expect(jest.getTimerCount()).toBe(0);
});

test('a result that settles after the deadline (blocked event loop) is not presented', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(PAGE_READ_TIMEOUT_MS);
  const abortSignal = jest.fn((signal: AbortSignal) => { captured = signal; return Promise.resolve({ count: 1, error: null }); });
  let captured!: AbortSignal;
  const error = await readWithinDeadline('dashboard-menus', Object.assign(Promise.resolve(null), { abortSignal })).catch((e: unknown) => e);
  clock.mockRestore();
  expect(error).toBeInstanceOf(PageReadTimeoutError);
  expect(captured.aborted).toBe(true);
  expect(consoleError).toHaveBeenCalledWith('[page-read] timeout', { label: 'dashboard-menus', ms: PAGE_READ_TIMEOUT_MS });
  expect(jest.getTimerCount()).toBe(0);
});
