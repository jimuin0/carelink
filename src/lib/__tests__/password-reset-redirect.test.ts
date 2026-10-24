/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { PASSWORD_RESET_REDIRECT_KEY, PASSWORD_RESET_REDIRECT_MAX_AGE_MS,
  readPasswordResetRedirect, savePasswordResetRedirect, takePasswordResetRedirect } from '../password-reset-redirect';

// ログイン → パスワードをお忘れの方 → 再設定 の途中で redirect=/admin が落ちていた不具合の回帰テスト。
const ORIGIN = 'https://carelink.test';
const NOW = 1_800_000_000_000;

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: jest.fn((key: string) => data.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: jest.fn((key: string) => { data.delete(key); }),
  };
}

test('保存した戻り先は再設定の完了時に一度だけ取り出せる', () => {
  const store = memoryStore();
  savePasswordResetRedirect(store, '/admin/bookings?date=2026-10-23', ORIGIN, NOW);
  expect(JSON.parse(store.data.get(PASSWORD_RESET_REDIRECT_KEY)!)).toEqual({ path: '/admin/bookings?date=2026-10-23', savedAt: NOW });
  expect(takePasswordResetRedirect(store, ORIGIN, NOW + 1000)).toBe('/admin/bookings?date=2026-10-23');
  expect(store.data.has(PASSWORD_RESET_REDIRECT_KEY)).toBe(false);
  expect(takePasswordResetRedirect(store, ORIGIN, NOW + 2000)).toBe('/auth/landing');
});

test('外部への戻り先は保存時にも取り出し時にも同一オリジンへ正規化する', () => {
  const store = memoryStore();
  savePasswordResetRedirect(store, '/\\evil.example', ORIGIN, NOW);
  expect(takePasswordResetRedirect(store, ORIGIN, NOW)).toBe('/mypage');
  store.data.set(PASSWORD_RESET_REDIRECT_KEY, JSON.stringify({ path: 'https://evil.example/', savedAt: NOW }));
  expect(takePasswordResetRedirect(store, ORIGIN, NOW)).toBe('/mypage');
});

test('戻り先なしの申請は古い保存を消す（別の人の戻り先を使わない）', () => {
  const store = memoryStore();
  savePasswordResetRedirect(store, '/admin', ORIGIN, NOW);
  savePasswordResetRedirect(store, null, ORIGIN, NOW);
  expect(store.data.has(PASSWORD_RESET_REDIRECT_KEY)).toBe(false);
});

test.each([
  ['期限切れ', JSON.stringify({ path: '/admin', savedAt: NOW - PASSWORD_RESET_REDIRECT_MAX_AGE_MS })],
  ['未来の時刻', JSON.stringify({ path: '/admin', savedAt: NOW + 1 })],
  ['壊れた JSON', '{'],
  ['null', 'null'],
  ['文字列', '"x"'],
  ['path 欠落', JSON.stringify({ savedAt: NOW })],
  ['savedAt 欠落', JSON.stringify({ path: '/admin' })],
])('%s の保存は既定の振り分けにする', (_name, raw) => {
  const store = memoryStore();
  store.data.set(PASSWORD_RESET_REDIRECT_KEY, raw);
  expect(takePasswordResetRedirect(store, ORIGIN, NOW)).toBe('/auth/landing');
  expect(store.data.has(PASSWORD_RESET_REDIRECT_KEY)).toBe(false);
});

test('保存が無ければ既定の振り分け', () => {
  expect(takePasswordResetRedirect(memoryStore(), ORIGIN, NOW)).toBe('/auth/landing');
});

test('ストレージが使えなくても例外を外へ出さない', () => {
  const store = memoryStore();
  store.setItem.mockImplementation(() => { throw new Error('quota'); });
  store.removeItem.mockImplementation(() => { throw new Error('blocked'); });
  expect(() => savePasswordResetRedirect(store, '/admin', ORIGIN, NOW)).not.toThrow();
  expect(() => savePasswordResetRedirect(store, null, ORIGIN, NOW)).not.toThrow();
  store.getItem.mockImplementation(() => { throw new Error('blocked'); });
  expect(takePasswordResetRedirect(store, ORIGIN, NOW)).toBe('/auth/landing');
});

test('既定の現在時刻でも動く', () => {
  const store = memoryStore();
  savePasswordResetRedirect(store, '/admin', ORIGIN);
  expect(takePasswordResetRedirect(store, ORIGIN)).toBe('/admin');
});

test('表示のための読み取りでは戻り先を消費しない', () => {
  const store = memoryStore();
  savePasswordResetRedirect(store, '/admin', ORIGIN, NOW);
  expect(readPasswordResetRedirect(store, ORIGIN, NOW)).toBe('/admin');
  expect(store.data.has(PASSWORD_RESET_REDIRECT_KEY)).toBe(true);
  expect(takePasswordResetRedirect(store, ORIGIN, NOW)).toBe('/admin');
});
