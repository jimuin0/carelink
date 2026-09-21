/** @jest-environment node */
import { sendResendForReconciliation } from '../resend-result';

afterEach(() => jest.useRealTimers());

test.each([400, 401, 403, 404, 422, 429])('HTTP %sは明確な拒否として安全な再試行へ返す', async (statusCode) => {
  await expect(sendResendForReconciliation(Promise.resolve({ data: null, error: { statusCode } }))).resolves.toBe('rejected');
});
test.each([408, 409, 500, 502, 503, null, undefined])('HTTP %sは受理を否定せず照合待ちへ返す', async (statusCode) => {
  await expect(sendResendForReconciliation(Promise.resolve({ data: null, error: { statusCode, name: 'application_error' } }))).resolves.toBe('uncertain');
});
test.each([null, {}, { data: null, error: null }, { data: { id: '' } }])('不完全な応答%sを成功にしない', async (result) => {
  await expect(sendResendForReconciliation(Promise.resolve(result))).resolves.toBe('uncertain');
});
test('provider IDのある正常応答のみ成功にする', async () => {
  await expect(sendResendForReconciliation(Promise.resolve({ data: { id: 'fixture-message' }, error: null }))).resolves.toBe('delivered');
});
test('rejectを未送信と断定しない', async () => {
  await expect(sendResendForReconciliation(Promise.reject(new Error('network')))).resolves.toBe('uncertain');
});
test('タイムアウト後の遅延応答でも二度目の送信を行わない', async () => {
  jest.useFakeTimers();
  let finish!: (value: unknown) => void;
  const send = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const result = sendResendForReconciliation(send());
  await jest.advanceTimersByTimeAsync(10_000);
  await expect(result).resolves.toBe('uncertain');
  finish({ data: { id: 'accepted-late' }, error: null });
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
