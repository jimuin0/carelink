// db-fallback ヘルパーの全分岐網羅テスト（純粋関数）
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '../db-fallback';

describe('warnMissingColumnFallback', () => {
  test('console.warn を context 付きで1回呼ぶ', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    warnMissingColumnFallback('coupons.insert');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('coupons.insert');
    spy.mockRestore();
  });
});

describe('isMissingColumnError', () => {
  test('null → false', () => {
    expect(isMissingColumnError(null)).toBe(false);
  });
  test('undefined → false', () => {
    expect(isMissingColumnError(undefined)).toBe(false);
  });
  test('code=PGRST204 → true', () => {
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true);
  });
  test('code=42703 → true', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
  });
  test('message が "column ... does not exist" → true', () => {
    expect(isMissingColumnError({ message: 'column "foo" does not exist' })).toBe(true);
  });
  test('無関係なエラー(code/message不一致) → false', () => {
    expect(isMissingColumnError({ code: 'XX999', message: 'some other error' })).toBe(false);
  });
  test('message 未定義かつ code 不一致 → false', () => {
    expect(isMissingColumnError({ code: 'ABC' })).toBe(false);
  });
});

describe('omitKeys', () => {
  test('指定キーを除外する', () => {
    const r = omitKeys({ a: 1, b: 2, c: 3 }, ['b']);
    expect(r).toEqual({ a: 1, c: 3 });
  });
  test('存在しないキー指定でも安全', () => {
    const r = omitKeys({ a: 1 }, ['x', 'y']);
    expect(r).toEqual({ a: 1 });
  });
  test('元オブジェクトは変更されない（浅いコピー）', () => {
    const src = { a: 1, b: 2 };
    omitKeys(src, ['a']);
    expect(src).toEqual({ a: 1, b: 2 });
  });
  test('空キー配列 → 全保持', () => {
    expect(omitKeys({ a: 1, b: 2 }, [])).toEqual({ a: 1, b: 2 });
  });
});
