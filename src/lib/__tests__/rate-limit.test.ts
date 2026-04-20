import { inMemoryRateLimit } from '../rate-limit';

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
