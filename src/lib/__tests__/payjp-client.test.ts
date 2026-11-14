/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
import { PAYJP_JS, loadPayjp } from '../payjp-client';

afterEach(() => {
  delete window.Payjp;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

test('読み込み済みならそのまま返す', async () => {
  const fn = jest.fn();
  window.Payjp = fn as never;
  await expect(loadPayjp()).resolves.toBe(fn);
  expect(document.querySelector('script')).toBeNull();
});
test('script を 1 回だけ差し込み、load で Payjp を返す', async () => {
  const p = loadPayjp();
  const script = document.querySelector<HTMLScriptElement>(`script[src="${PAYJP_JS}"]`)!;
  expect(script.async).toBe(true);
  const p2 = loadPayjp();
  expect(document.querySelectorAll('script')).toHaveLength(1);
  const fn = jest.fn();
  window.Payjp = fn as never;
  script.dispatchEvent(new Event('load'));
  await expect(p).resolves.toBe(fn);
  await expect(p2).resolves.toBe(fn);
});
test('load しても Payjp が無い・error なら reject', async () => {
  const p = loadPayjp();
  document.querySelector('script')!.dispatchEvent(new Event('load'));
  await expect(p).rejects.toThrow('unavailable');
  const q = loadPayjp();
  document.querySelector('script')!.dispatchEvent(new Event('error'));
  await expect(q).rejects.toThrow('failed to load');
});
