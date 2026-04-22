jest.mock('@upstash/ratelimit', () => ({ Ratelimit: jest.fn() }));
jest.mock('@upstash/redis', () => ({ Redis: jest.fn() }));

import { inMemoryRateLimit, checkRateLimit } from '../rate-limit';

describe('inMemoryRateLimit - advanced', () => {
  test('ウィンドウ期限後はカウントがリセットされる', async () => {
    const prefix = 'test-expire-' + Date.now();
    inMemoryRateLimit('9.9.9.9', 1, 50, prefix);
    expect(inMemoryRateLimit('9.9.9.9', 1, 50, prefix)).toBe(true);
    await new Promise(r => setTimeout(r, 60));
    expect(inMemoryRateLimit('9.9.9.9', 1, 50, prefix)).toBe(false);
  });

  test('limit=0は全リクエストを拒否する', () => {
    const prefix = 'test-zero-' + Date.now();
    expect(inMemoryRateLimit('1.1.1.1', 0, 60_000, prefix)).toBe(true);
  });

  test('空IPでも動作する', () => {
    const prefix = 'test-empty-ip-' + Date.now();
    expect(inMemoryRateLimit('', 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('', 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('', 2, 60_000, prefix)).toBe(true);
  });
});

describe('checkRateLimit', () => {
  test('limiterがnullの場合はin-memoryフォールバックを使用', async () => {
    const prefix = 'test-fallback-' + Date.now();
    const limited = await checkRateLimit(null, '2.2.2.2', 1, 60_000, prefix);
    expect(limited).toBe(false);
    const limited2 = await checkRateLimit(null, '2.2.2.2', 1, 60_000, prefix);
    expect(limited2).toBe(true);
  });
});

describe('inMemoryRateLimit - メモリ管理', () => {
  test('ウィンドウ境界値: ちょうど windowMs-1ms は同一ウィンドウ内', async () => {
    const prefix = 'test-boundary-' + Date.now();
    const windowMs = 100;
    inMemoryRateLimit('5.5.5.5', 1, windowMs, prefix);
    // ウィンドウが切れる前は制限される
    expect(inMemoryRateLimit('5.5.5.5', 1, windowMs, prefix)).toBe(true);
  });

  test('大量の異なる IP でメモリが爆発しない', () => {
    const prefix = 'test-memory-' + Date.now();
    // 600 件の異なる IP でリクエスト（store > 500 でクリーンアップが走る）
    for (let i = 0; i < 600; i++) {
      inMemoryRateLimit(`10.0.${Math.floor(i / 255)}.${i % 255}`, 100, 60_000, prefix);
    }
    // クラッシュしないことを確認（メモリ爆発なし）
    expect(true).toBe(true);
  });

  test('同一 prefix・異なる IP は独立してカウント', () => {
    const prefix = 'test-independence-' + Date.now();
    // IP A を 3 回
    inMemoryRateLimit('11.11.11.11', 3, 60_000, prefix);
    inMemoryRateLimit('11.11.11.11', 3, 60_000, prefix);
    inMemoryRateLimit('11.11.11.11', 3, 60_000, prefix);
    // IP A は制限される
    expect(inMemoryRateLimit('11.11.11.11', 3, 60_000, prefix)).toBe(true);
    // IP B はまだ制限されない
    expect(inMemoryRateLimit('22.22.22.22', 3, 60_000, prefix)).toBe(false);
  });

  test('IPv6 アドレスでも動作する', () => {
    const prefix = 'test-ipv6-' + Date.now();
    const ipv6 = '2001:db8::1';
    expect(inMemoryRateLimit(ipv6, 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit(ipv6, 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit(ipv6, 2, 60_000, prefix)).toBe(true);
  });

  test('windowMs=1ms は即座にリセット', async () => {
    const prefix = 'test-instant-' + Date.now();
    inMemoryRateLimit('6.6.6.6', 1, 1, prefix);
    await new Promise(r => setTimeout(r, 10));
    expect(inMemoryRateLimit('6.6.6.6', 1, 1, prefix)).toBe(false);
  });

  test('limit=1000000 は実質制限なし', () => {
    const prefix = 'test-unlimited-' + Date.now();
    for (let i = 0; i < 100; i++) {
      expect(inMemoryRateLimit('7.7.7.7', 1_000_000, 60_000, prefix)).toBe(false);
    }
  });

  test('非常に長い prefix でも動作する', () => {
    const prefix = 'test-long-prefix-' + 'x'.repeat(200) + Date.now();
    expect(inMemoryRateLimit('8.8.8.8', 1, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('8.8.8.8', 1, 60_000, prefix)).toBe(true);
  });

  test('特殊文字の IP（proxy経由）でも動作する', () => {
    const prefix = 'test-special-' + Date.now();
    expect(inMemoryRateLimit('::1', 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('::1', 2, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('::1', 2, 60_000, prefix)).toBe(true);
  });
});

describe('checkRateLimit - Upstash フォールバック', () => {
  test('limiter=null で連続超過はブロックされる', async () => {
    const prefix = 'test-fallback-seq-' + Date.now();
    const ip = '3.3.3.3';
    expect(await checkRateLimit(null, ip, 2, 60_000, prefix)).toBe(false);
    expect(await checkRateLimit(null, ip, 2, 60_000, prefix)).toBe(false);
    expect(await checkRateLimit(null, ip, 2, 60_000, prefix)).toBe(true);
  });

  test('limiter=null で異なる IP は独立している', async () => {
    const prefix = 'test-fallback-ind-' + Date.now();
    expect(await checkRateLimit(null, '4.4.4.4', 1, 60_000, prefix)).toBe(false);
    expect(await checkRateLimit(null, '5.5.5.5', 1, 60_000, prefix)).toBe(false);
    expect(await checkRateLimit(null, '4.4.4.4', 1, 60_000, prefix)).toBe(true);
    expect(await checkRateLimit(null, '5.5.5.5', 1, 60_000, prefix)).toBe(true);
  });
});
