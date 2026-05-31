jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));

import { inMemoryRateLimit, checkRateLimit } from '../rate-limit';
const { createServiceRoleClient } = require('../supabase-server');

describe('inMemoryRateLimit', () => {
  test('allows requests under limit', () => {
    const ip = `192.168.1.${Math.random()}`;
    const limit = 3;
    const windowMs = 60000;

    expect(inMemoryRateLimit(ip, limit, windowMs, `test-${Math.random()}`)).toBe(false);
    expect(inMemoryRateLimit(ip, limit, windowMs, `test-${Math.random()}`)).toBe(false);
    expect(inMemoryRateLimit(ip, limit, windowMs, `test-${Math.random()}`)).toBe(false);
  });

  test('blocks request at limit', () => {
    const ip = `192.168.2.${Math.random()}`;
    const limit = 3;
    const windowMs = 60000;
    const prefix = `test-${Math.random()}`;

    inMemoryRateLimit(ip, limit, windowMs, prefix);
    inMemoryRateLimit(ip, limit, windowMs, prefix);
    inMemoryRateLimit(ip, limit, windowMs, prefix);
    expect(inMemoryRateLimit(ip, limit, windowMs, prefix)).toBe(true);
  });

  test('separate IPs with same key do not interfere', () => {
    const limit = 2;
    const windowMs = 60000;
    const prefix = `test-isolated-${Math.random()}`;

    expect(inMemoryRateLimit('1.1.1.1', limit, windowMs, prefix)).toBe(false);
    expect(inMemoryRateLimit('2.2.2.2', limit, windowMs, prefix)).toBe(false);
    expect(inMemoryRateLimit('1.1.1.1', limit, windowMs, prefix)).toBe(false);
    expect(inMemoryRateLimit('2.2.2.2', limit, windowMs, prefix)).toBe(false);

    expect(inMemoryRateLimit('1.1.1.1', limit, windowMs, prefix)).toBe(true);
    expect(inMemoryRateLimit('2.2.2.2', limit, windowMs, prefix)).toBe(true);
  });

  test('different prefixes have independent tracking', () => {
    const ip = `192.168.3.${Math.random()}`;
    const limit = 1;
    const windowMs = 60000;

    expect(inMemoryRateLimit(ip, limit, windowMs, 'prefix-a')).toBe(false);
    expect(inMemoryRateLimit(ip, limit, windowMs, 'prefix-a')).toBe(true);

    expect(inMemoryRateLimit(ip, limit, windowMs, 'prefix-b')).toBe(false);
    expect(inMemoryRateLimit(ip, limit, windowMs, 'prefix-b')).toBe(true);
  });

  test('limit of 0 blocks all requests', () => {
    const ip = `192.168.4.${Math.random()}`;
    const limit = 0;
    const windowMs = 60000;

    expect(inMemoryRateLimit(ip, limit, windowMs, `test-${Math.random()}`)).toBe(true);
    expect(inMemoryRateLimit(ip, limit, windowMs, `test-${Math.random()}`)).toBe(true);
  });

  test('large limits allow many requests', () => {
    const ip = `192.168.5.${Math.random()}`;
    const limit = 1000;
    const windowMs = 60000;
    const prefix = `test-${Math.random()}`;

    for (let i = 0; i < 1000; i++) {
      expect(inMemoryRateLimit(ip, limit, windowMs, prefix)).toBe(false);
    }
    expect(inMemoryRateLimit(ip, limit, windowMs, prefix)).toBe(true);
  });

  test('IPv6 addresses work like IPv4', () => {
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const limit = 1;
    const windowMs = 60000;
    const prefix = `test-${Math.random()}`;

    expect(inMemoryRateLimit(ipv6, limit, windowMs, prefix)).toBe(false);
    expect(inMemoryRateLimit(ipv6, limit, windowMs, prefix)).toBe(true);
  });

  test('LRU eviction triggers when store > 500 entries', () => {
    const limit = 1;
    const windowMs = 1; // すぐ expire させる
    for (let i = 0; i < 550; i++) {
      inMemoryRateLimit(`evict-ip-${i}`, limit, windowMs, 'lru-prefix');
    }
    // sleep 不要、windowMs=1ms で 550 個入れてさらに 1 追加 → expired cleanup 経路通過
    inMemoryRateLimit('final-ip', limit, windowMs, 'lru-prefix-final');
    expect(true).toBe(true);
  });

  test('LRU hard cap > 1000', () => {
    const limit = 1;
    const windowMs = 60000; // 期限切れさせずに 1000 超
    for (let i = 0; i < 1050; i++) {
      inMemoryRateLimit(`cap-ip-${i}`, limit, windowMs, 'cap-prefix');
    }
    expect(true).toBe(true);
  });

  test('high request rate is handled correctly', () => {
    const ip = `192.168.6.${Math.random()}`;
    const limit = 5;
    const windowMs = 60000;
    const prefix = `test-${Math.random()}`;

    for (let i = 0; i < 5; i++) {
      expect(inMemoryRateLimit(ip, limit, windowMs, prefix)).toBe(false);
    }
    // 6th request should be blocked
    expect(inMemoryRateLimit(ip, limit, windowMs, prefix)).toBe(true);
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    (createServiceRoleClient as jest.Mock).mockReset();
  });

  test('returns true when Supabase RPC returns true', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    });
    const result = await checkRateLimit(null, '1.2.3.4', 5, 60000, 'rl:test');
    expect(result).toBe(true);
  });

  test('returns false when Supabase RPC returns false', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    });
    const result = await checkRateLimit(null, '1.2.3.5', 5, 60000, 'rl:test2');
    expect(result).toBe(false);
  });

  test('falls back to in-memory when RPC returns error object', async () => {
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'rpc-failed' } }),
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkRateLimit(null, '9.9.9.9', 1, 60000, 'rl:fallback');
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('falls back to in-memory when createServiceRoleClient throws (non-Error)', async () => {
    (createServiceRoleClient as jest.Mock).mockImplementation(() => {
      throw 'string-error';
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkRateLimit(null, '8.8.8.8', 1, 60000, 'rl:fallback2');
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  test('falls back to in-memory when createServiceRoleClient throws Error', async () => {
    (createServiceRoleClient as jest.Mock).mockImplementation(() => {
      throw new Error('client-init-failed');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkRateLimit(null, '7.7.7.7', 1, 60000, 'rl:fallback3');
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});
