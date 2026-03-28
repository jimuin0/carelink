jest.mock('@upstash/ratelimit', () => ({ Ratelimit: jest.fn() }));
jest.mock('@upstash/redis', () => ({ Redis: jest.fn() }));

import { inMemoryRateLimit } from '../rate-limit';

describe('inMemoryRateLimit', () => {
  test('制限内はfalseを返す', () => {
    const prefix = 'test-' + Date.now();
    expect(inMemoryRateLimit('1.2.3.4', 3, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('1.2.3.4', 3, 60_000, prefix)).toBe(false);
    expect(inMemoryRateLimit('1.2.3.4', 3, 60_000, prefix)).toBe(false);
  });

  test('制限超過でtrueを返す', () => {
    const prefix = 'test-exceed-' + Date.now();
    inMemoryRateLimit('5.6.7.8', 2, 60_000, prefix);
    inMemoryRateLimit('5.6.7.8', 2, 60_000, prefix);
    expect(inMemoryRateLimit('5.6.7.8', 2, 60_000, prefix)).toBe(true);
  });

  test('異なるIPは独立してカウント', () => {
    const prefix = 'test-ip-' + Date.now();
    inMemoryRateLimit('10.0.0.1', 1, 60_000, prefix);
    expect(inMemoryRateLimit('10.0.0.1', 1, 60_000, prefix)).toBe(true);
    expect(inMemoryRateLimit('10.0.0.2', 1, 60_000, prefix)).toBe(false);
  });
});
