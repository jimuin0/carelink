/**
 * Tests for getClientIp (spoofing-resistant client IP extraction).
 *
 * 全分岐を網羅:
 *   1. x-real-ip あり → それを返す（最優先）
 *   2. x-real-ip が空白のみ → trim 後 falsy → 次へフォールスルー
 *   3. x-forwarded-for あり（複数）→ 末尾（信頼できる外側プロキシ値）を返す
 *   4. x-forwarded-for 単一値 → その値を返す
 *   5. x-forwarded-for が空要素のみ（", ,"）→ parts.length 0 → 'unknown'
 *   6. x-real-ip も x-forwarded-for も無し → 'unknown'
 */

import { getClientIp } from '../client-ip';

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe('getClientIp', () => {
  test('x-real-ip があれば最優先で返す', () => {
    expect(
      getClientIp(
        req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1, 192.168.1.1' })
      )
    ).toBe('203.0.113.7');
  });

  test('x-real-ip は trim される', () => {
    expect(getClientIp(req({ 'x-real-ip': '  203.0.113.7  ' }))).toBe('203.0.113.7');
  });

  test('x-real-ip が空白のみなら XFF にフォールスルー', () => {
    expect(
      getClientIp(req({ 'x-real-ip': '   ', 'x-forwarded-for': '10.0.0.1, 192.168.1.1' }))
    ).toBe('192.168.1.1');
  });

  test('x-forwarded-for 複数値 → 末尾（信頼できる外側）を返す', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '10.0.0.1, 172.16.0.1, 192.168.1.1' }))).toBe(
      '192.168.1.1'
    );
  });

  test('x-forwarded-for 単一値 → その値を返す', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.5' }))).toBe('198.51.100.5');
  });

  test('x-forwarded-for が空要素のみ → unknown', () => {
    expect(getClientIp(req({ 'x-forwarded-for': ' , , ' }))).toBe('unknown');
  });

  test('ヘッダ無し → unknown', () => {
    expect(getClientIp(req({}))).toBe('unknown');
  });
});
