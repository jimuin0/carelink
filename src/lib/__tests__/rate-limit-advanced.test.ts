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
